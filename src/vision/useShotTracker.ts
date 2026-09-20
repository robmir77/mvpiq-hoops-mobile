// src/vision/useShotTracker.ts
//
// Orchestrates ball detection, pose detection, and shot analysis.
// Both YOLO and MoveNet run entirely in the Frame Processor Worklet.
// Only processed results (BallDetection, PoseResult, ShotEvent) cross to JS.

import { useRef, useCallback, useEffect, useState } from 'react'
import { Platform } from 'react-native'
import { useFrameOutput } from 'react-native-vision-camera'
import type { Frame } from 'react-native-vision-camera'
import { useSharedValue } from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'

import { ShotDetector } from './shotDetector'
import { useYoloWorker } from './useYoloWorker'
import { useMoveNetWorker } from './useMoveNetWorker'
import { usePlayerCropManager } from './usePlayerCropManager'

import type {
    BallDetection,
    PoseResult,
    ShotEvent,
} from './types'
import type {
    AndroidDelegateOption,
    IosDelegateOption,
} from './delegates'

import {
    incrementYoloFps,
    incrementMoveNetFps,
} from '@/features/workouts/hooks/usePerformanceMonitor'
import { telemetryLogger } from './telemetry'


// AI throttling

const YOLO_FRAME_SKIP = 1
const YOLO_FRAME_SKIP_STABLE = 3 // Throttle YOLO when ball is stable
const BALL_STABILITY_THRESHOLD = 0.02 // Position change threshold (2%)
const BALL_STABILITY_FRAMES = 5 // Consecutive frames to consider stable

// MoveNet is throttled independently from camera/YOLO.
// Time-based scheduling keeps the target stable if effective camera throughput changes.
const MOVENET_TARGET_FPS = 3
const MOVENET_INTERVAL_MS = 1000 / MOVENET_TARGET_FPS

// Constants

const RIM_CONFIDENCE_THRESHOLD = 0.15


export const useShotTracker = (
    onBallDetection: (
        detection: BallDetection
    ) => void,

    onPoseResult: (
        result: PoseResult
    ) => void,

    onShotEvent: (
        event: ShotEvent
    ) => void,

    onRimDetection?: (
        rim: {
            x: number
            y: number
            width: number
            height: number
            confidence: number
        }
    ) => void,

    rimFromCalibration?: {
        x: number
        y: number
        width: number
        height: number
    } | null,

    kalmanFilteredBall?: {
        x: number
        y: number
        vx: number
        vy: number
    } | null,

    enabled: boolean = true,
    poseEnabled: boolean = true,
    ballEnabled: boolean = true,
    rimEnabled: boolean = true,

    yoloDelegate?: AndroidDelegateOption | IosDelegateOption | null,
    poseDelegate?: AndroidDelegateOption | IosDelegateOption | null,
    yoloModelId?: string,
    selectedResolution?: { width: number; height: number } | null,
    selectedFps?: number | null,
    selectedPoseResolution?: number,
    moveNetModelId?: string
) => {

    // Mount-instance diagnostic: detect concurrent hook mounts by logging unique IDs

    const instanceIdRef =
        useRef(
            Math.random().toString(36).slice(2, 8)
        )

    useEffect(() => {
        console.log(
            '[ShotTracker][INSTANCE] MOUNT',
            instanceIdRef.current
        )


        return () => {
            console.log(
                '[ShotTracker][INSTANCE] UNMOUNT',
                instanceIdRef.current
            )

        }
    }, [])

    // Shot detector

    const shotDetector =
        useRef(new ShotDetector())

    const lastBallRef =
        useRef<{
            x: number
            y: number
            t: number
        } | null>(null)

    const lastPlayerDetectedRef = useRef(false)

    // Shared values

    const frameCounter =
        useSharedValue(0)

    // Reentrancy guard: prevents concurrent onFrame invocations
    const isProcessingFrame =
        useSharedValue(false)

    // Fatal error guard: stops processing after a critical error (e.g. TypedArray corruption)
    const hasFatalError =
        useSharedValue(false)

    // Throttle scheduleOnRN calls to ~16ms (limit bridge crossings)
    const lastRNDispatch =
        useSharedValue(0)

    // Throughput instrumentation (sampled once per second)
    const perfLastLogAt = useSharedValue(0)
    const perfFramesReceived = useSharedValue(0)
    const perfFramesProcessed = useSharedValue(0)
    const perfFramesDroppedBusy = useSharedValue(0)
    const lastMoveNetInferenceAt = useSharedValue(0)

    // Detection tracking for telemetry (sampled once per second)
    const perfYoloBallDetected = useSharedValue(0)
    const perfTrackingAccepted = useSharedValue(0)

    // Ball stability for YOLO throttling
    const lastBallX = useSharedValue(0)
    const lastBallY = useSharedValue(0)
    const stableFrameCount = useSharedValue(0)
    const isBallStable = useSharedValue(false)

    // Size continuity filter for incompatible detections
    const lastBallWidth = useSharedValue(0)
    const lastBallHeight = useSharedValue(0)
    const lastValidBallTime = useSharedValue(0)

    // Parallel Workers

    const yoloWorker = useYoloWorker(
        ballEnabled,
        yoloDelegate,
        yoloModelId
    )

    const moveNetWorker = useMoveNetWorker(
        poseEnabled,
        poseDelegate,
        moveNetModelId
    )

    // Player crop manager (worklet-compatible hook)
    const playerCrop = usePlayerCropManager()

    // Fatal error recovery: schedule reset from JS thread when error is caught
    // Cannot use useEffect (runs once at mount, before error exists)
    // Cannot mutate plain useRef from worklet (not synchronized)
    // Must use scheduleOnRN from catch block below
    const recoveryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    const scheduleFatalErrorRecovery =
        useCallback(
            () => {
                if (recoveryTimerRef.current) {
                    clearTimeout(recoveryTimerRef.current)
                }

                recoveryTimerRef.current =
                    setTimeout(
                        () => {
                            hasFatalError.value = false
                            console.log('[ShotTracker] Recovering from fatal error')
                        },
                        3000
                    )
            },
            []
        )

    useEffect(
        () => () => {
            if (recoveryTimerRef.current) {
                clearTimeout(recoveryTimerRef.current)
            }
        },
        []
    )

    const enabledShared =
        useSharedValue(enabled)

    const poseEnabledShared =
        useSharedValue(poseEnabled)

    const ballEnabledShared =
        useSharedValue(ballEnabled)

    const rimEnabledShared =
        useSharedValue(rimEnabled)

    // Pipeline telemetry callback (runs on JS thread)
    const updatePipelineTelemetry = useCallback((
        cameraFPS: number,
        received: number,
        processed: number,
        droppedBusy: number,
        trackingAccepted: number
    ) => {
        telemetryLogger.updatePipelineMetrics(
            cameraFPS,
            received,
            processed,
            droppedBusy,
            trackingAccepted,
            0 // overlayRendered deprecated: Skia renders at camera FPS, not tracked separately
        )
        telemetryLogger.logPipelineMetrics()
        telemetryLogger.logYoloPerf()
        telemetryLogger.logMoveNetMetrics()
        telemetryLogger.logBallDetectionMetrics(processed)
        telemetryLogger.logPlayerDetectionMetrics(processed)
        telemetryLogger.logFalsePositiveSummary()
        telemetryLogger.logBboxStability()
        telemetryLogger.logPlayerTrackingMetrics()
        telemetryLogger.logBallTrackingMetrics()
    }, [])


    // Adaptive confidence threshold

    const adaptiveThreshold =
        useSharedValue(0.01)

    // Player bbox from YOLO (for direct display in overlay)
    const playerX = useSharedValue(0)
    const playerY = useSharedValue(0)
    const playerWidth = useSharedValue(0)
    const playerHeight = useSharedValue(0)
    const playerConfidence = useSharedValue(0)
    
    // Debug rejection reasons from YOLO parser
    const ballRejectionReason = useSharedValue('')
    const rimRejectionReason = useSharedValue('')

    const detectionHistory =
        useRef<
            Array<{
                confidence: number
                timestamp: number
            }>
        >([])

    const TARGET_DETECTION_RATE = 0.15
    const ADAPTATION_WINDOW_MS = 2000

    const lastAdjustmentTs =
        useRef(0)


    // Callback refs

    const onPoseResultRef =
        useRef(onPoseResult)

    const onRimDetectionRef =
        useRef(onRimDetection)

    useEffect(() => {

        onPoseResultRef.current =
            onPoseResult

    }, [onPoseResult])

    useEffect(() => {

        onRimDetectionRef.current =
            onRimDetection

    }, [onRimDetection])

    // Shared flags

    useEffect(() => {

        enabledShared.value =
            enabled

    }, [enabled])

    useEffect(() => {

        poseEnabledShared.value =
            poseEnabled

    }, [poseEnabled])

    useEffect(() => {

        ballEnabledShared.value =
            ballEnabled

    }, [ballEnabled])

    useEffect(() => {

        rimEnabledShared.value =
            rimEnabled

    }, [rimEnabled])

    // Adaptive threshold update

    const updateAdaptiveThreshold =
        useCallback(
            (
                ball:
                    | { confidence: number }
                    | null
                    | undefined
            ) => {

                const now = Date.now()

                detectionHistory.current.push({
                    confidence:
                        ball?.confidence ?? 0,
                    timestamp: now,
                })

                detectionHistory.current =
                    detectionHistory.current.filter(
                        d =>
                            now -
                            d.timestamp <
                            ADAPTATION_WINDOW_MS
                    )

                if (
                    now -
                    lastAdjustmentTs.current >
                    ADAPTATION_WINDOW_MS &&
                    detectionHistory.current.length >
                    10
                ) {

                    lastAdjustmentTs.current =
                        now

                    const totalFrames =
                        detectionHistory.current.length

                    // Count entries with detection (each entry represents one frame sample)
                    const framesWithDetection =
                        detectionHistory.current.filter(
                            d => d.confidence > 0
                        ).length

                    const detectionRate =
                        framesWithDetection /
                        totalFrames

                    const adjustment =
                        0.02

                    if (
                        detectionRate >
                        TARGET_DETECTION_RATE * 1.5
                    ) {

                        adaptiveThreshold.value =
                            Math.min(
                                0.15,
                                adaptiveThreshold.value +
                                adjustment
                            )

                    } else if (
                        detectionRate <
                        TARGET_DETECTION_RATE * 0.5
                    ) {

                        adaptiveThreshold.value =
                            Math.max(
                                0.015,
                                adaptiveThreshold.value -
                                adjustment
                            )
                    }

                    // Log adaptive threshold changes (DEV only)
                    if (__DEV__) {
                        console.log(
                            '[AdaptiveThreshold] Rate:',
                            detectionRate.toFixed(2),
                            'Threshold:',
                            adaptiveThreshold.value.toFixed(3)
                        )
                    }
                }
            },
            []
        )

    // Shot detection

    const handleBallDetectionForShotTracking =
        useCallback(
            (
                detection: BallDetection
            ): BallDetection | null => {

                const { ball } =
                    detection

                updateAdaptiveThreshold(
                    ball
                )

                if (!ball) {

                    const now =
                        Date.now()

                    if (
                        lastBallRef.current &&
                        now -
                        lastBallRef.current.t >
                        300
                    ) {

                        shotDetector.current.reset()

                        lastBallRef.current =
                            null
                    }

                    return null
                }

                // Size continuity filter: fallback only when detection is invalid
                const now = Date.now()
                const timeSinceLastValid = lastValidBallTime.value > 0 ? now - lastValidBallTime.value : Infinity
                const MAX_TIME_FOR_FALLBACK = 500 // ms - fallback only for recent gaps

                let filteredBall: typeof ball | null = ball
                let filterReason: string | null = null

                // Check if detection is invalid (zero dimensions or non-finite coordinates)
                const isInvalid = !Number.isFinite(ball.x) || !Number.isFinite(ball.y) || ball.width <= 0 || ball.height <= 0

                if (isInvalid && lastBallWidth.value > 0 && lastBallHeight.value > 0) {
                    // Fallback to previous valid detection
                    if (timeSinceLastValid < MAX_TIME_FOR_FALLBACK) {
                        filterReason = `Current detection invalid (w=${ball.width.toFixed(3)}, h=${ball.height.toFixed(3)}), using previous valid bbox`
                        filteredBall = {
                            ...ball,
                            width: lastBallWidth.value,
                            height: lastBallHeight.value,
                            x: ball.x === 0 ? lastBallX.value : ball.x,
                            y: ball.y === 0 ? lastBallY.value : ball.y
                        }
                    } else {
                        // Too much time passed, skip fallback
                        filterReason = `Current detection invalid but too much time since last valid (${timeSinceLastValid.toFixed(0)}ms), not using fallback`
                        filteredBall = null
                    }
                }

                // Log filter decisions (DEV only)
                if (__DEV__ && filterReason) {
                    console.log(`[BBOX FILTER] ${filterReason}`)
                    console.log(`[BBOX FILTER] Previous valid bbox: w=${lastBallWidth.value.toFixed(3)}, h=${lastBallHeight.value.toFixed(3)}`)
                    console.log(`[BBOX FILTER] Current bbox (raw): w=${ball.width.toFixed(3)}, h=${ball.height.toFixed(3)}`)
                    console.log(`[BBOX FILTER] Filtered bbox passed to tracking: w=${filteredBall?.width.toFixed(3) ?? 'null'}, h=${filteredBall?.height.toFixed(3) ?? 'null'}`)
                }

                // Update continuity tracking with valid detections only
                if (!isInvalid && !filterReason) {
                    lastBallWidth.value = ball.width
                    lastBallHeight.value = ball.height
                    lastBallX.value = ball.x
                    lastBallY.value = ball.y
                    lastValidBallTime.value = now
                }

                const ballForTracking =
                    !filteredBall
                        ? undefined
                        : kalmanFilteredBall
                            ? {
                                x: kalmanFilteredBall.x,
                                y: kalmanFilteredBall.y,
                                width: filteredBall.width,
                                height: filteredBall.height,
                                confidence:
                                filteredBall.confidence,
                            }
                            : filteredBall

                shotDetector.current
                    .updateTrajectory(
                        ballForTracking
                    )

                if (ballForTracking) {
                    lastBallRef.current = {
                        x:
                            ballForTracking.x +
                            ballForTracking.width / 2,

                        y:
                            ballForTracking.y +
                            ballForTracking.height / 2,

                        t:
                        detection.timestamp,
                    }
                }

                if (
                    detection.rim &&
                    detection.rim.confidence >
                    RIM_CONFIDENCE_THRESHOLD
                ) {

                    onRimDetectionRef.current?.(
                        detection.rim
                    )
                }

                if (
                    !enabledShared.value
                ) {
                    return null
                }

                if (
                    ballForTracking &&
                    shotDetector.current
                        .detectShotStart(
                            ballForTracking
                        )
                ) {

                    console.log(
                        '[ShotTracker] Shot started'
                    )
                }

                if (
                    shotDetector.current
                        .detectShotRelease()
                ) {

                    console.log(
                        '[ShotTracker] Shot released'
                    )

                    const ev =
                        shotDetector.current
                            .getShotEvent()

                    if (ev) {
                        onShotEvent(ev)
                    }
                }

                // Filter detected rim: only use if close to calibration point
                let filteredRim = detection.rim
                if (detection.rim && rimFromCalibration) {
                    const dx = detection.rim.x - rimFromCalibration.x
                    const dy = detection.rim.y - rimFromCalibration.y
                    const distance = Math.sqrt(dx * dx + dy * dy)
                    // Reject detected rim if too far from calibration (max 10% of screen)
                    const MAX_RIM_DISTANCE = 0.1
                    if (distance > MAX_RIM_DISTANCE) {
                        filteredRim = undefined
                        console.log('[ShotTracker] Rejected rim detection: too far from calibration', {
                            detected: { x: detection.rim.x.toFixed(3), y: detection.rim.y.toFixed(3) },
                            calibration: { x: rimFromCalibration.x.toFixed(3), y: rimFromCalibration.y.toFixed(3) },
                            distance: distance.toFixed(3)
                        })
                    }
                }

                const effectiveRim =
                    filteredRim ||
                    rimFromCalibration ||
                    null

                if (
                    shotDetector.current
                        .detectShotMade(
                            effectiveRim
                        )
                ) {

                    console.log(
                        '[ShotTracker] Shot made!'
                    )

                    const ev =
                        shotDetector.current
                            .getShotEvent()

                    if (ev) {
                        onShotEvent(ev)
                    }

                    shotDetector.current.reset()
                }

                if (
                    shotDetector.current
                        .detectShotMiss()
                ) {

                    console.log(
                        '[ShotTracker] Shot missed!'
                    )

                    const ev =
                        shotDetector.current
                            .getShotEvent()

                    if (ev) {
                        onShotEvent(ev)
                    }

                    shotDetector.current.reset()
                }

                // Return detection with filtered bbox for TrackingEngine
                if (!filteredBall) {
                    return null
                }

                return {
                    ...detection,
                    ball: filteredBall
                }
            },
            [
                onShotEvent,
                rimFromCalibration,
                kalmanFilteredBall,
                updateAdaptiveThreshold,
            ]
        )

    // Ball callback wrapper
    const wrappedOnBallDetection =
        useCallback(
            (
                detection: BallDetection
            ) => {

                // Apply filter to get filtered bbox
                const filteredDetection = handleBallDetectionForShotTracking(
                    detection
                )

                // Pass filtered detection to TrackingEngine
                if (filteredDetection) {
                    perfTrackingAccepted.value += 1
                    onBallDetection(filteredDetection)
                }
            },
            [
                onBallDetection,
                handleBallDetectionForShotTracking,
            ]
        )

    const wrappedOnBallDetectionRef =
        useRef(
            wrappedOnBallDetection
        )

    useEffect(() => {

        wrappedOnBallDetectionRef.current =
            wrappedOnBallDetection

    }, [wrappedOnBallDetection])

    // JS bridge wrappers
    const emitBallDetection =
        useCallback(
            (
                detection: BallDetection
            ) => {

                incrementYoloFps()

                wrappedOnBallDetectionRef.current(
                    detection
                )
            },
            []
        )

    const recordPlayerDetected = useCallback(() => {
        telemetryLogger.recordPlayerDetected()
    }, [])

    const recordPlayerLost = useCallback(() => {
        telemetryLogger.recordPlayerLost()
    }, [])

    const recordPlayerUsingLastBbox = useCallback((ageMs: number) => {
        telemetryLogger.recordPlayerUsingLastBbox(ageMs)
    }, [])

    const recordPlayerBboxExpired = useCallback(() => {
        telemetryLogger.recordPlayerBboxExpired()
    }, [])

    const emitPoseResult =
        useCallback(
            (
                result: PoseResult
            ) => {

                onPoseResultRef.current(
                    result
                )
            },
            []
        )

    // scheduleOnRN called directly at worklet call site (no createRunOnJS needed)

    // Frame processor: onFrame MUST use useCallback to prevent TypedArray/worklet binding issues
    const onFrame =
        useCallback(
            (frame: Frame) => {

                'worklet'

                perfFramesReceived.value += 1

                if (hasFatalError.value) {
                    // Stop processing after fatal error (TypedArray corruption)
                    frame.dispose()
                    return
                }

                // Workers have internal processing guards (no global guard needed)
                frameCounter.value += 1

                const currentFrame =
                    frameCounter.value

                try {
                    // Global enable
                    if (!enabledShared.value) {
                        return
                    }

                    // Model readiness
                    const yoloReady = yoloWorker.isReady.value
                    const poseReady = moveNetWorker.isReady.value

                    if (!yoloReady && !poseReady) {
                        return
                    }

                    const frameWidth = frame.width
                    const frameHeight = frame.height

                    // Model scheduling: YOLO ~10-15 FPS (throttled by ball stability), MoveNet ~3 FPS
                    // Both use runSync() on same TFLite thread (sequential, not truly parallel)
                    const timestamp = Date.now()

                    // MoveNet: time-based scheduling (target 3 FPS)
                    const nowForMoveNet = Date.now()
                    const lastMoveNet = lastMoveNetInferenceAt.value
                    const timeSinceLastMoveNet = lastMoveNet > 0 ? nowForMoveNet - lastMoveNet : MOVENET_INTERVAL_MS

                    const moveNetDue =
                        poseReady &&
                        poseEnabledShared.value &&
                        timeSinceLastMoveNet >= MOVENET_INTERVAL_MS

                    // YOLO: frame-based scheduling with stability-based throttling
                    const currentSkip = isBallStable.value ? YOLO_FRAME_SKIP_STABLE : YOLO_FRAME_SKIP
                    const yoloDue =
                        yoloReady &&
                        ballEnabledShared.value &&
                        currentFrame % currentSkip === 0

                    // Log throttling (DEV only)
                    if (__DEV__) {
                        if (poseReady && poseEnabledShared.value && !moveNetDue) {
                            console.log(`[MoveNet Throttle] Skip: ${timeSinceLastMoveNet.toFixed(0)}ms since last (need ${MOVENET_INTERVAL_MS.toFixed(0)}ms)`)
                        }
                        if (yoloReady && ballEnabledShared.value && !yoloDue) {
                            console.log(`[YOLO Throttle] Skip: frame=${currentFrame}, skip=${currentSkip}, stable=${isBallStable.value}`)
                        }
                    }

                    // Execute YOLO and MoveNet (independent throttling per model)
                    if (yoloDue) {
                        yoloWorker.processFrame(frame, timestamp, currentFrame)
                        
                        // Update player bbox via PlayerCropManager (time-based tracking)
                        const currentPlayer = yoloWorker.latestResultPlayer.value
                        if (__DEV__) {
                            console.log('[PlayerCrop] currentPlayer (raw YOLO):', currentPlayer)
                        }
                        if (currentPlayer) {
                            playerCrop.update({
                                x: currentPlayer.x,
                                y: currentPlayer.y,
                                width: currentPlayer.width,
                                height: currentPlayer.height,
                                confidence: currentPlayer.confidence,
                            })
                            // Update shared values for direct display in overlay
                            playerX.value = currentPlayer.x
                            playerY.value = currentPlayer.y
                            playerWidth.value = currentPlayer.width
                            playerHeight.value = currentPlayer.height
                            playerConfidence.value = currentPlayer.confidence
                            // Check if the detection was accepted by the confidence filter
                            const trackedBbox = playerCrop.getEffectiveBbox(Date.now())
                            if (trackedBbox) {
                                if (!lastPlayerDetectedRef.current) {
                                    // Transition: LOST → DETECTED
                                    lastPlayerDetectedRef.current = true
                                }
                                scheduleOnRN(recordPlayerDetected)
                            }
                        } else {
                            playerCrop.update(null)
                            if (lastPlayerDetectedRef.current) {
                                // Transition: DETECTED → LOST
                                lastPlayerDetectedRef.current = false
                                scheduleOnRN(recordPlayerLost)
                            }
                        }
                    }

                    if (moveNetDue) {
                        lastMoveNetInferenceAt.value = nowForMoveNet
                        
                        // Get effective bbox from PlayerCropManager (time-based tracking)
                        const trackedBbox = playerCrop.getEffectiveBbox(nowForMoveNet)
                        if (trackedBbox) {
                            // Pass effective bbox to MoveNet (YOLO provides center coordinates)
                            moveNetWorker.playerBbox.value = {
                                x: trackedBbox.bbox.x,
                                y: trackedBbox.bbox.y,
                                width: trackedBbox.bbox.width,
                                height: trackedBbox.bbox.height,
                                confidence: trackedBbox.bbox.confidence,
                            }
                            if (trackedBbox.isUsingLastBbox) {
                                scheduleOnRN(recordPlayerUsingLastBbox, trackedBbox.ageMs)
                            }
                            
                            // Execute MoveNet only if bbox is available
                            moveNetWorker.processFrame(frame, timestamp)
                        } else {
                            moveNetWorker.playerBbox.value = null
                            // BBox expired: MoveNet still runs in FULL_FRAME fallback.
                            // This keeps Phase 10 operational while player YOLO is temporarily lost.
                            scheduleOnRN(recordPlayerBboxExpired)
                            moveNetWorker.processFrame(frame, timestamp)
                        }
                    }

                    // Process worker results (get latest available from shared values)
                    const yoloResult = {
                        ball: yoloWorker.latestResultBall.value,
                        player: yoloWorker.latestResultPlayer.value,
                        rim: yoloWorker.latestResultRim.value,
                        debug: yoloWorker.latestResultDebug.value,
                        timestamp: yoloWorker.latestResultTimestamp.value
                    }
                    
                    // Update rejection reasons from debug data
                    if (yoloResult.debug) {
                        ballRejectionReason.value = yoloResult.debug.ballRejectionReason || ''
                        rimRejectionReason.value = yoloResult.debug.rimRejectionReason || ''
                    }
                    const poseResult = {
                        keypoints: moveNetWorker.latestResultKeypoints.value,
                        angles: moveNetWorker.latestResultAngles.value,
                        timestamp: moveNetWorker.latestResultTimestamp.value
                    }

                    // Process YOLO result - send every result even without ball to enable Kalman prediction
                    perfYoloBallDetected.value += (yoloResult.ball ? 1 : 0)

                    const detection: BallDetection = {
                        ball: yoloResult.ball ?? undefined,
                        rim: yoloResult.rim ?? undefined,
                        timestamp: yoloResult.timestamp
                    }

                    // Emit via bridge
                    const now = Date.now()
                    if (now - lastRNDispatch.value >= 16) {
                        lastRNDispatch.value = now
                        scheduleOnRN(emitBallDetection, detection)
                    }

                    // Process player detection for telemetry
                    if (yoloResult.player) {
                        // Player detection is logged via scheduleOnRN in the YOLO worker
                        // No additional processing needed here for now
                    }

                    // Process pose result if available
                    if (poseResult.keypoints) {
                        const result: PoseResult = {
                            keypoints: poseResult.keypoints,
                            angles: poseResult.angles,
                            timestamp: poseResult.timestamp
                        }

                        const now = Date.now()
                        if (now - lastRNDispatch.value >= 16) {
                            lastRNDispatch.value = now
                            scheduleOnRN(emitPoseResult, result)
                        }
                    }

                    const perfNow = Date.now()
                    if (
                        perfLastLogAt.value === 0 ||
                        perfNow - perfLastLogAt.value >= 1000
                    ) {
                        // Log pipeline performance (DEV only)
                        if (__DEV__) {
                            console.log(
                                `[PIPE PERF] received:${perfFramesReceived.value} ` +
                                `processed:${perfFramesProcessed.value} ` +
                                `droppedBusy:${perfFramesDroppedBusy.value}`
                            )
                        }

                        // Calculate camera FPS from received frames (1-second interval)
                        const cameraFPS = perfFramesReceived.value / 1.0
                        
                        // Update telemetry pipeline metrics
                        scheduleOnRN(
                            updatePipelineTelemetry,
                            cameraFPS,
                            perfFramesReceived.value,
                            perfFramesProcessed.value,
                            perfFramesDroppedBusy.value,
                            perfTrackingAccepted.value
                        )

                        perfLastLogAt.value = perfNow
                        perfFramesReceived.value = 0
                        perfFramesProcessed.value = 0
                        perfFramesDroppedBusy.value = 0
                        perfYoloBallDetected.value = 0
                        perfTrackingAccepted.value = 0
                    }

                } catch (error) {

                    const errorMessage = (error as any)?.message || String(error)

                    // Detect fatal TypedArray corruption errors
                    if (
                        errorMessage.includes('TypedArray can only be updated') ||
                        errorMessage.includes('no ArrayBuffer attached')
                    ) {
                        hasFatalError.value = true
                        scheduleOnRN(scheduleFatalErrorRecovery)
                        console.error(
                            '[ShotTracker][FATAL ERROR] Stopping processing:',
                            errorMessage
                        )
                    } else {
                        console.error(
                            '[ShotTracker][FRAME ERROR]',
                            error,
                            'message:',
                            errorMessage,
                            'stack:',
                            (error as any)?.stack
                        )
                    }

                } finally {

                    // Camera frame is disposed exactly once.
                    frame.dispose()
                }
            },

            [
                hasFatalError,
                perfFramesReceived,
                perfFramesProcessed,
                frameCounter,
                ballEnabledShared,
                poseEnabledShared,
                yoloWorker,
                moveNetWorker,
                lastRNDispatch,
                emitBallDetection,
                emitPoseResult,
                scheduleFatalErrorRecovery,
            ]
        )

    // Frame Output

    const frameOutput =
        useFrameOutput({
            pixelFormat:
                'yuv',

            targetResolution: selectedResolution || {
                width: 1280,
                height: 720,
            },

            // dropFramesWhileBusy: prevents overlapping onFrame calls when inference takes longer than frame interval

            onFrame,
        })

    // Reset shot tracking
    const resetShotTracking =
        useCallback(() => {

            shotDetector.current.reset()

            lastBallRef.current =
                null

            playerCrop.reset()

        }, [])

    // Model ready (synced from worker shared values to avoid render warning)
    const [isModelReady, setIsModelReady] = useState(false)

    useEffect(() => {
        const checkReady = () => {
            setIsModelReady(yoloWorker.isReady.value && moveNetWorker.isReady.value)
        }

        checkReady()

        // Poll shared values periodically (they don't trigger re-renders)
        const interval = setInterval(checkReady, 100)

        return () => clearInterval(interval)
    }, [yoloWorker.isReady, moveNetWorker.isReady])

    // Telemetry control
    const exportTelemetrySummary = useCallback(() => {
        const cameraFPS = selectedFps || 30
        const moveNetFPS = moveNetWorker.fps.value || 0
        return telemetryLogger.exportTestSummary(cameraFPS, moveNetFPS)
    }, [selectedFps, moveNetWorker.fps])

    const logTelemetrySummary = useCallback(() => {
        const cameraFPS = selectedFps || 30
        const moveNetFPS = moveNetWorker.fps.value || 0
        telemetryLogger.logTestSummary(cameraFPS, moveNetFPS)
    }, [selectedFps, moveNetWorker.fps])

    const resetTelemetry = useCallback(() => {
        telemetryLogger.reset()
    }, [])

    return {
        frameOutput,
        isModelReady,
        resetShotTracking,
        yoloFps: yoloWorker.fps,
        moveNetFps: moveNetWorker.fps,
        exportTelemetrySummary,
        logTelemetrySummary,
        resetTelemetry,
        sharedValues: {
            playerX,
            playerY,
            playerWidth,
            playerHeight,
            playerConfidence,
            ballRejectionReason,
            rimRejectionReason,
        },
    }
}
