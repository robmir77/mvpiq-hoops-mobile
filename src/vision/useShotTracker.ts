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
import { useYoloWorkerAsync } from './useYoloWorkerAsync'
import { useMoveNetWorker } from './useMoveNetWorker'
import { usePlayerCropManager } from './usePlayerCropManager'

import { HOT_PATH_LOGS } from '@/config/debugConfig'

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
import { telemetryLogger, type DiagnosticWindowSnapshot } from './telemetry'
import { YOLO_CONFIG, TEST_CONFIG } from '@/config/appConfig'


const BALL_STABILITY_THRESHOLD = 0.02 // Position change threshold (2%)
const BALL_STABILITY_FRAMES = 5 // Consecutive frames to consider stable

// MoveNet throttling is handled internally by useMoveNetWorker
// No external scheduling needed here

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
    moveNetModelId?: string,
) => {
    // TEMP: Commented to reduce log noise during performance investigation
    // console.log('[useShotTracker] Received params:', {
    //     selectedResolution,
    //     selectedFps,
    //     selectedPoseResolution,
    //     yoloModelId,
    //     moveNetModelId,
    //     yoloDelegate,
    //     poseDelegate,
    //     enabled,
    //     poseEnabled,
    //     ballEnabled,
    //     rimEnabled,
    // })

    // Mount-instance diagnostic: detect concurrent hook mounts by logging unique IDs

    const instanceIdRef =
        useRef(
            Math.random().toString(36).slice(2, 8)
        )

    // Mount flag to prevent callbacks after unmount
    const isMountedRef = useRef(true)

    useEffect(() => {
        console.log(
            '[ShotTracker][INSTANCE] MOUNT',
            instanceIdRef.current
        )
        isMountedRef.current = true

        return () => {
            console.log(
                '[ShotTracker][INSTANCE] UNMOUNT',
                instanceIdRef.current
            )
            isMountedRef.current = false
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

    const lastPlayerDetectedRef = useSharedValue(false)

    // Shared values

    // Reentrancy guard: prevents concurrent onFrame invocations
    const isProcessingFrame =
        useSharedValue(false)

    // Frame counter for logging purposes only
    const frameCounter =
        useSharedValue(0)

    // Fatal error guard: stops processing after a critical error (e.g. TypedArray corruption)
    const hasFatalError =
        useSharedValue(false)

    // Throttle scheduleOnRN calls to ~66ms (15 FPS) to reduce bridge crossings
    const lastRNDispatch =
        useSharedValue(0)

    // One-second diagnostic window. These counters are reset after every emitted window;
    // cumulative telemetry remains in telemetryLogger for the final workout summary.
    const perfLastLogAt = useSharedValue(0)
    const perfFramesReceived = useSharedValue(0)
    const perfFramesProcessed = useSharedValue(0)
    const perfFramesDroppedBusy = useSharedValue(0)
    const perfFrameDurationTotal = useSharedValue(0)
    const perfFrameDurationMax = useSharedValue(0)
    const perfYoloRequested = useSharedValue(0)
    const perfYoloExecuted = useSharedValue(0)
    const perfYoloSkipped = useSharedValue(0)
    const perfYoloInferenceTotal = useSharedValue(0)
    const perfYoloInferenceMin = useSharedValue(0)
    const perfYoloInferenceMax = useSharedValue(0)
    const perfYoloScheduleWaitTotal = useSharedValue(0)
    const perfYoloResizeTotal = useSharedValue(0)
    const perfYoloRunTotal = useSharedValue(0)
    const perfYoloParseTotal = useSharedValue(0)

    const perfMoveNetRequested = useSharedValue(0)
    const perfMoveNetExecuted = useSharedValue(0)
    const perfMoveNetSkipped = useSharedValue(0)
    const perfMoveNetInferenceTotal = useSharedValue(0)
    const perfMoveNetInferenceMin = useSharedValue(0)
    const perfMoveNetInferenceMax = useSharedValue(0)
    const perfMoveNetWorkletPrepTotal = useSharedValue(0)
    const perfMoveNetScheduleWaitTotal = useSharedValue(0)
    const perfMoveNetCropTotal = useSharedValue(0)
    const perfMoveNetResizeTotal = useSharedValue(0)
    const perfMoveNetRunTotal = useSharedValue(0)
    const perfMoveNetParseTotal = useSharedValue(0)

    // Actual FPS values for UI (updated every second)
    const actualCameraFps = useSharedValue(0)
    const actualYoloFps = useSharedValue(0)
    const actualMoveNetFps = useSharedValue(0)

    // Detection tracking for telemetry (sampled once per second)
    const perfYoloBallDetected = useSharedValue(0)
    const perfTrackingAccepted = useSharedValue(0)


    // Size continuity filter for incompatible detections
    const lastBallWidth = useSharedValue(0)
    const lastBallHeight = useSharedValue(0)
    const lastBallX = useSharedValue(0)
    const lastBallY = useSharedValue(0)
    const lastValidBallTime = useSharedValue(0)


    // Parallel Workers - use selected model ID directly
    // Both hooks are always called; the flag selects the active implementation.
    const yoloWorkerSync = useYoloWorker(
        ballEnabled && !TEST_CONFIG.ENABLE_ASYNC_YOLO_POC,
        yoloDelegate,
        yoloModelId,
        undefined,
        perfYoloScheduleWaitTotal
    )

    // yoloWorkerAsync will be initialized after handleYoloAsyncResult is defined

    const moveNetWorker = useMoveNetWorker(
        poseEnabled,
        poseDelegate,
        moveNetModelId,
        perfMoveNetRequested,
        perfMoveNetExecuted,
        perfMoveNetSkipped,
        perfMoveNetInferenceTotal,
        perfMoveNetInferenceMin,
        perfMoveNetInferenceMax,
        perfMoveNetWorkletPrepTotal,
        perfMoveNetScheduleWaitTotal,
        perfMoveNetCropTotal,
        perfMoveNetResizeTotal,
        perfMoveNetRunTotal,
        perfMoveNetParseTotal
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

    const selectedFpsShared =
        useSharedValue(selectedFps ?? 30)

    // Pipeline telemetry callback (runs on JS thread)
    const updatePipelineTelemetry = useCallback((
        cameraFPS: number,
        received: number,
        processed: number,
        droppedBusy: number,
        trackingAccepted: number
    ) => {
        // Skip if unmounted
        if (!isMountedRef.current) {
            return
        }

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


    const recordDiagnosticWindow = useCallback((snapshot: DiagnosticWindowSnapshot) => {
        telemetryLogger.recordDiagnosticWindow(snapshot)
    }, [])



    // Player bbox from YOLO (for direct display in overlay)
    const playerX = useSharedValue(0)
    const playerY = useSharedValue(0)
    const playerWidth = useSharedValue(0)
    const playerHeight = useSharedValue(0)
    const playerConfidence = useSharedValue(0)

    // Visual tracking state for debugging
    const playerTrackState = useSharedValue('LOST')
    const playerTrackAge = useSharedValue(0)
    const rimTrackState = useSharedValue('LOST')
    const rimTrackAge = useSharedValue(0)

    // Debug rejection reasons from YOLO parser
    const ballRejectionReason = useSharedValue('')
    const rimRejectionReason = useSharedValue('')

    // Rim tracking: only update if confidence is higher than previous
    const lastRimConfidence = useSharedValue(0)
    const lastRimPosition = useSharedValue<{ x: number; y: number; width: number; height: number } | null>(null)

    // Ring buffer for detection history (avoids filter() overhead on long sessions)


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

        selectedFpsShared.value =
            selectedFps ?? 30

    }, [selectedFps])

    useEffect(() => {

        rimEnabledShared.value =
            rimEnabled

    }, [rimEnabled])


    // Shot detection

    const handleBallDetectionForShotTracking =
        useCallback(
            (
                detection: BallDetection
            ): BallDetection | null => {

                const { ball } =
                    detection

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

                    // Return detection with null ball to enable Kalman prediction
                    return detection
                }

                // Size continuity filter: fallback only when detection is invalid
                const now = Date.now()
                const timeSinceLastValid = lastValidBallTime.value > 0 ? now - lastValidBallTime.value : Infinity
                const MAX_TIME_FOR_FALLBACK = 500 // ms - fallback only for recent gaps

                let filteredBall: typeof ball | null = ball
                let filterReason: string | null = null
                let rejectedBall: typeof ball | null = null

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
                        rejectedBall = ball // Store rejected detection for visualization
                    }
                }

                // Log filter decisions (DEV only)
                if (HOT_PATH_LOGS && filterReason) {
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
                    // Only update rim if confidence is higher than previous
                    // This keeps rim stable since camera is typically stationary
                    if (detection.rim.confidence > lastRimConfidence.value) {
                        lastRimConfidence.value = detection.rim.confidence
                        lastRimPosition.value = {
                            x: detection.rim.x,
                            y: detection.rim.y,
                            width: detection.rim.width,
                            height: detection.rim.height
                        }
                        onRimDetectionRef.current?.(
                            detection.rim
                        )
                    }
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
                        if (HOT_PATH_LOGS) {
                            console.log('[ShotTracker] Rejected rim detection: too far from calibration', {
                                detected: { x: detection.rim.x.toFixed(3), y: detection.rim.y.toFixed(3) },
                                calibration: { x: rimFromCalibration.x.toFixed(3), y: rimFromCalibration.y.toFixed(3) },
                                distance: distance.toFixed(3)
                            })
                        }
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
                // Pass null ball to enable Kalman prediction when detection is filtered
                return {
                    ...detection,
                    ball: filteredBall ?? undefined,
                    rejectedBall: rejectedBall ?? undefined
                }
            },
            [
                onShotEvent,
                rimFromCalibration,
                kalmanFilteredBall,
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
                // Skip if unmounted
                if (!isMountedRef.current) {
                    return
                }

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

    // Callback for async YOLO results - updates overlay when results are ready
    const handleYoloAsyncResult = useCallback((result: any) => {
        // Skip if unmounted
        if (!isMountedRef.current) {
            return
        }

        // IMPORTANT: Async YOLO must feed the same TrackingEngine path as sync YOLO.
        const detection: BallDetection = {
            ball: result.ball ?? undefined,
            rim: result.rim ?? undefined,
            timestamp: result.timestamp,
        }

        wrappedOnBallDetectionRef.current(detection)

        // Update telemetry counters for async YOLO
        perfYoloExecuted.value += 1

        // Update timing metrics for YOLO DETAIL log
        if (result.inferenceMs) {
            perfYoloInferenceTotal.value += result.inferenceMs
            perfYoloInferenceMin.value = perfYoloInferenceMin.value === 0
                ? result.inferenceMs
                : Math.min(perfYoloInferenceMin.value, result.inferenceMs)
            perfYoloInferenceMax.value = Math.max(perfYoloInferenceMax.value, result.inferenceMs)
        }
        if (result.resizeMs) {
            perfYoloResizeTotal.value += result.resizeMs
        }
        if (result.runMs) {
            perfYoloRunTotal.value += result.runMs
        }
        if (result.parseMs) {
            perfYoloParseTotal.value += result.parseMs
        }

        // Note: telemetryLogger metrics (executed, processedFrame, timing)
        // are already recorded in useYoloWorkerAsync worker
        
        if (result.player) {
            // Update shared values for direct display in overlay
            // Frame processor will read these and call playerCrop.update() in worklet context
            playerX.value = result.player.x
            playerY.value = result.player.y
            playerWidth.value = result.player.width
            playerHeight.value = result.player.height
            playerConfidence.value = result.player.confidence
            // Update visual tracking state
            playerTrackState.value = 'DETECTED'
            playerTrackAge.value = 0
        } else {
            // Reset shared values for overlay when no player detected
            playerX.value = 0
            playerY.value = 0
            playerWidth.value = 0
            playerHeight.value = 0
            playerConfidence.value = 0
        }
    }, [playerX, playerY, playerWidth, playerHeight, playerConfidence, playerTrackState, playerTrackAge])

    // Initialize async YOLO worker with callback (must be after handleYoloAsyncResult)
    const yoloWorkerAsync = useYoloWorkerAsync(
        ballEnabled && TEST_CONFIG.ENABLE_ASYNC_YOLO_POC,
        yoloDelegate,
        yoloModelId,
        undefined, // yoloScheduledCount
        perfYoloScheduleWaitTotal,
        handleYoloAsyncResult
    )

    const yoloWorker = TEST_CONFIG.ENABLE_ASYNC_YOLO_POC
        ? yoloWorkerAsync
        : yoloWorkerSync

    const emitPoseResult =
        useCallback(
            (
                result: PoseResult
            ) => {
                // Skip if unmounted
                if (!isMountedRef.current) {
                    return
                }

                onPoseResultRef.current(
                    result
                )
            },
            []
        )

    // scheduleOnRN called directly at worklet call site

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

                // Reentrancy guard: prevents concurrent onFrame invocations
                if (isProcessingFrame.value) {
                    perfFramesDroppedBusy.value += 1
                    // Busy frames are still part of the camera-throughput window.
                    // Flush here as well because no finally block will run for this frame.
                    // The helper is defined below the guard, so only update counters here.
                    frame.dispose()
                    return
                }

                isProcessingFrame.value = true
                perfFramesProcessed.value += 1
                const frameStartTime = performance.now()

                // Granular timing for frame processor phases
                let tYoloStart = 0
                let tYoloEnd = 0
                let tMoveNetStart = 0
                let tMoveNetEnd = 0
                let tTrackingStart = 0
                let tTrackingEnd = 0
                let tTelemetryStart = 0
                let tTelemetryEnd = 0
                let tSharedValueReadsStart = 0
                let tSharedValueReadsEnd = 0
                let tYoloSharedValueReads = 0
                let tPlayerCropSharedValueReads = 0
                let tTrackingSharedValueReads = 0
                let tMoveNetSharedValueReads = 0
                let tSharedValueWrites = 0

                // Emit exactly one diagnostic record per ~1s window. The snapshot is
                // intentionally based on current-window counters, not cumulative averages.
                const maybeFlushDiagnosticWindow = (now: number) => {
                    'worklet'

                    if (perfLastLogAt.value === 0) {
                        perfLastLogAt.value = now
                        return
                    }

                    const windowMs = now - perfLastLogAt.value
                    if (windowMs < 1000) {
                        return
                    }

                    const yoloExecuted = perfYoloExecuted.value
                    const moveNetExecuted = perfMoveNetExecuted.value
                    const snapshot: DiagnosticWindowSnapshot = {
                        windowMs,
                        cameraFps: perfFramesReceived.value / (windowMs / 1000),
                        received: perfFramesReceived.value,
                        processed: perfFramesProcessed.value,
                        droppedBusy: perfFramesDroppedBusy.value,
                        onFrameAvgMs: perfFramesProcessed.value > 0
                            ? perfFrameDurationTotal.value / perfFramesProcessed.value
                            : 0,
                        onFrameMaxMs: perfFrameDurationMax.value,
                        yoloRequested: perfYoloRequested.value,
                        yoloExecuted,
                        yoloSkipped: perfYoloSkipped.value,
                        yoloThroughputFps: yoloExecuted / (windowMs / 1000),
                        yoloAvgMs: yoloExecuted > 0
                            ? perfYoloInferenceTotal.value / yoloExecuted
                            : 0,
                        yoloMinMs: perfYoloInferenceMin.value,
                        yoloMaxMs: perfYoloInferenceMax.value,
                        yoloScheduleWaitMs: yoloExecuted > 0
                            ? perfYoloScheduleWaitTotal.value / yoloExecuted
                            : 0,
                        yoloResizeAvgMs: yoloExecuted > 0
                            ? perfYoloResizeTotal.value / yoloExecuted
                            : 0,
                        yoloRunAvgMs: yoloExecuted > 0
                            ? perfYoloRunTotal.value / yoloExecuted
                            : 0,
                        yoloParseAvgMs: yoloExecuted > 0
                            ? perfYoloParseTotal.value / yoloExecuted
                            : 0,
                        moveNetRequested: perfMoveNetRequested.value,
                        moveNetExecuted,
                        moveNetSkipped: perfMoveNetSkipped.value,
                        moveNetThroughputFps: moveNetExecuted / (windowMs / 1000),
                        moveNetAvgMs: moveNetExecuted > 0
                            ? perfMoveNetInferenceTotal.value / moveNetExecuted
                            : 0,
                        moveNetMinMs: perfMoveNetInferenceMin.value,
                        moveNetMaxMs: perfMoveNetInferenceMax.value,
                        moveNetWorkletPrepMs: moveNetExecuted > 0
                            ? perfMoveNetWorkletPrepTotal.value / moveNetExecuted
                            : 0,
                        moveNetScheduleWaitMs: moveNetExecuted > 0
                            ? perfMoveNetScheduleWaitTotal.value / moveNetExecuted
                            : 0,
                        moveNetCropAvgMs: moveNetExecuted > 0
                            ? perfMoveNetCropTotal.value / moveNetExecuted
                            : 0,
                        moveNetResizeAvgMs: moveNetExecuted > 0
                            ? perfMoveNetResizeTotal.value / moveNetExecuted
                            : 0,
                        moveNetRunAvgMs: moveNetExecuted > 0
                            ? perfMoveNetRunTotal.value / moveNetExecuted
                            : 0,
                        moveNetParseAvgMs: moveNetExecuted > 0
                            ? perfMoveNetParseTotal.value / moveNetExecuted
                            : 0,
                    }

                    scheduleOnRN(
                        updatePipelineTelemetry,
                        snapshot.cameraFps,
                        snapshot.received,
                        snapshot.processed,
                        snapshot.droppedBusy,
                        perfTrackingAccepted.value
                    )
                    scheduleOnRN(recordDiagnosticWindow, snapshot)

                    // Update actual FPS values for UI
                    actualCameraFps.value = snapshot.cameraFps
                    actualYoloFps.value = snapshot.yoloThroughputFps
                    actualMoveNetFps.value = snapshot.moveNetThroughputFps
                    console.log('[useShotTracker] FPS update:', { 
                        cameraFps: snapshot.cameraFps, 
                        yoloThroughputFps: snapshot.yoloThroughputFps, 
                        moveNetThroughputFps: snapshot.moveNetThroughputFps 
                    })

                    perfLastLogAt.value = now
                    perfFramesReceived.value = 0
                    perfFramesProcessed.value = 0
                    perfFramesDroppedBusy.value = 0
                    perfFrameDurationTotal.value = 0
                    perfFrameDurationMax.value = 0
                    perfYoloRequested.value = 0
                    perfYoloExecuted.value = 0
                    perfYoloSkipped.value = 0
                    perfYoloInferenceTotal.value = 0
                    perfYoloInferenceMin.value = 0
                    perfYoloInferenceMax.value = 0
                    perfYoloScheduleWaitTotal.value = 0
                    perfYoloResizeTotal.value = 0
                    perfYoloRunTotal.value = 0
                    perfYoloParseTotal.value = 0
                    perfMoveNetRequested.value = 0
                    perfMoveNetExecuted.value = 0
                    perfMoveNetSkipped.value = 0
                    perfMoveNetInferenceTotal.value = 0
                    perfMoveNetInferenceMin.value = 0
                    perfMoveNetInferenceMax.value = 0
                    perfMoveNetWorkletPrepTotal.value = 0
                    perfMoveNetScheduleWaitTotal.value = 0
                    perfMoveNetCropTotal.value = 0
                    perfMoveNetResizeTotal.value = 0
                    perfMoveNetRunTotal.value = 0
                    perfMoveNetParseTotal.value = 0
                    perfTrackingAccepted.value = 0
                }

                // Increment frame counter for logging
                frameCounter.value += 1
                const currentFrame = frameCounter.value

                try {
                    // Global enable
                    if (!enabledShared.value) {
                        return
                    }

                    const frameWidth = frame.width
                    const frameHeight = frame.height
                    const timestamp = Date.now()

                    // Call YOLO worker every frame - it handles its own throttling internally
                    tYoloStart = performance.now()
                    if (ballEnabledShared.value) {
                        if (TEST_CONFIG.ENABLE_ASYNC_YOLO_POC) {
                            // Async YOLO: submit frame and return immediately
                            // perfYoloRequested is tracked internally by yoloWorkerAsync
                            // Results are handled via onResultCallback
                            yoloWorkerAsync.submitFrame(frame, timestamp, currentFrame)
                        } else {
                            // Sync YOLO: process frame and check execution
                            perfYoloRequested.value += 1
                            const yoloExecutionCountBefore = yoloWorkerSync.executionCount.value
                            yoloWorkerSync.processFrame(frame, timestamp, currentFrame)
                            const yoloExecutedNow = yoloWorkerSync.executionCount.value > yoloExecutionCountBefore

                            if (yoloExecutedNow) {
                                const yoloInferenceTime = yoloWorkerSync.lastInferenceMs.value
                                perfYoloExecuted.value += 1
                                perfYoloInferenceTotal.value += yoloInferenceTime
                                perfYoloInferenceMin.value = perfYoloInferenceMin.value === 0
                                    ? yoloInferenceTime
                                    : Math.min(perfYoloInferenceMin.value, yoloInferenceTime)
                                perfYoloInferenceMax.value = Math.max(perfYoloInferenceMax.value, yoloInferenceTime)
                                perfYoloResizeTotal.value += yoloWorkerSync.lastResizeMs.value
                                perfYoloRunTotal.value += yoloWorkerSync.lastRunMs.value
                                perfYoloParseTotal.value += yoloWorkerSync.lastParseMs.value
                            } else {
                                perfYoloSkipped.value += 1
                            }

                            // Update player bbox via PlayerCropManager (time-based tracking) - SYNC ONLY
                            const currentPlayer = yoloWorkerSync.latestResultPlayer.value
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
                                // Update visual tracking state
                                playerTrackState.value = 'DETECTED'
                                playerTrackAge.value = 0
                                // Check if the detection was accepted by the confidence filter
                                const trackedBbox = playerCrop.getEffectiveBbox(Date.now())
                                if (trackedBbox) {
                                    if (!lastPlayerDetectedRef.value) {
                                        // Transition: LOST → DETECTED
                                        lastPlayerDetectedRef.value = true
                                    }
                                    scheduleOnRN(recordPlayerDetected)
                                }
                            } else {
                                playerCrop.update(null)
                                if (lastPlayerDetectedRef.value) {
                                    // Transition: DETECTED → LOST
                                    lastPlayerDetectedRef.value = false
                                    scheduleOnRN(recordPlayerLost)
                                }
                            }
                        }
                    }
                    tYoloEnd = performance.now()

                    // Call MoveNet worker every frame - it handles its own throttling internally
                    tMoveNetStart = performance.now()
                    if (poseEnabledShared.value) {
                        // Get effective bbox from PlayerCropManager for MoveNet crop
                        const trackedBbox = playerCrop.getEffectiveBbox(Date.now())
                        if (trackedBbox !== null && (trackedBbox.bbox.confidence ?? 0) >= YOLO_CONFIG.PLAYER_CROP_MIN_CONFIDENCE) {
                            moveNetWorker.playerBbox.value = {
                                x: trackedBbox.bbox.x,
                                y: trackedBbox.bbox.y,
                                width: trackedBbox.bbox.width,
                                height: trackedBbox.bbox.height,
                                confidence: trackedBbox.bbox.confidence,
                            }
                            // Update visual tracking state
                            if (trackedBbox.isUsingLastBbox) {
                                playerTrackState.value = 'PREDICTED'
                                playerTrackAge.value = trackedBbox.ageMs
                                scheduleOnRN(recordPlayerUsingLastBbox, trackedBbox.ageMs)
                            } else {
                                playerTrackState.value = 'DETECTED'
                                playerTrackAge.value = 0
                            }

                            // MoveNet worker handles its own performance tracking in the async callback
                            moveNetWorker.processFrame(frame, timestamp)
                        } else {
                            // Invalid bbox - MoveNet worker will handle skipped counting
                            moveNetWorker.processFrame(frame, timestamp)
                        }
                    }
                    tMoveNetEnd = performance.now()

                    // Process worker results (get latest available from shared values)
                    tSharedValueReadsStart = performance.now()

                    // YOLO shared value reads
                    const tYoloSvStart = performance.now()
                    const rawBall = yoloWorker.latestResultBall.value
                    const rawPlayer = yoloWorker.latestResultPlayer.value
                    const rawRim = yoloWorker.latestResultRim.value
                    const yoloResult = {
                        ball: rawBall ? { ...rawBall } : null,
                        player: rawPlayer ? { ...rawPlayer } : null,
                        rim: rawRim ? { ...rawRim } : null,
                        debug: yoloWorker.latestResultDebug.value,
                        timestamp: yoloWorker.latestResultTimestamp.value
                    }
                    tYoloSharedValueReads = performance.now() - tYoloSvStart

                    // PlayerCrop shared value reads + writes
                    const tPlayerCropSvStart = performance.now()
                    if (playerX.value !== 0 || playerY.value !== 0) {
                        playerCrop.update({
                            x: playerX.value,
                            y: playerY.value,
                            width: playerWidth.value,
                            height: playerHeight.value,
                            confidence: playerConfidence.value,
                        })
                    } else {
                        playerCrop.update(null)
                    }
                    tPlayerCropSharedValueReads = performance.now() - tPlayerCropSvStart

                    // Tracking shared value writes
                    const tTrackingSvStart = performance.now()
                    if (yoloResult.rim && yoloResult.rim.confidence > RIM_CONFIDENCE_THRESHOLD) {
                        rimTrackState.value = 'DETECTED'
                        rimTrackAge.value = 0
                    } else if (rimFromCalibration) {
                        rimTrackState.value = 'PREDICTED'
                        rimTrackAge.value = 0
                    } else {
                        rimTrackState.value = 'LOST'
                        rimTrackAge.value = 0
                    }

                    if (yoloResult.debug) {
                        ballRejectionReason.value = yoloResult.debug.ballRejectionReason || ''
                        rimRejectionReason.value = yoloResult.debug.rimRejectionReason || ''
                    }
                    tTrackingSharedValueReads = performance.now() - tTrackingSvStart

                    // MoveNet shared value reads
                    const tMoveNetSvStart = performance.now()
                    const poseResult = {
                        keypoints: moveNetWorker.latestResultKeypoints.value,
                        angles: moveNetWorker.latestResultAngles.value,
                        timestamp: moveNetWorker.latestResultTimestamp.value
                    }
                    tMoveNetSharedValueReads = performance.now() - tMoveNetSvStart

                    // Shared value writes (counters)
                    const tSvWritesStart = performance.now()
                    perfYoloBallDetected.value += (yoloResult.ball ? 1 : 0)
                    tSharedValueWrites = performance.now() - tSvWritesStart

                    tSharedValueReadsEnd = performance.now()

                    const detection: BallDetection = {
                        ball: yoloResult.ball ?? undefined,
                        rim: yoloResult.rim ?? undefined,
                        timestamp: yoloResult.timestamp
                    }

                    // Emit via bridge
                    const now = Date.now()
                    if (now - lastRNDispatch.value >= 66) {
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
                        if (now - lastRNDispatch.value >= 66) {
                            lastRNDispatch.value = now
                            scheduleOnRN(emitPoseResult, result)
                        }
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
                    tTelemetryStart = performance.now()
                    const frameDurationMs = performance.now() - frameStartTime
                    perfFrameDurationTotal.value += frameDurationMs
                    perfFrameDurationMax.value = Math.max(perfFrameDurationMax.value, frameDurationMs)
                    maybeFlushDiagnosticWindow(Date.now())
                    tTelemetryEnd = performance.now()

                    // Log frame processor phase breakdown every 100 frames
                    if (currentFrame % 100 === 0) {
                        const yoloMs = tYoloEnd - tYoloStart
                        const moveNetMs = tMoveNetEnd - tMoveNetStart
                        const sharedValueReadsMs = tSharedValueReadsEnd - tSharedValueReadsStart
                        const telemetryMs = tTelemetryEnd - tTelemetryStart
                        const otherMs = frameDurationMs - yoloMs - moveNetMs - sharedValueReadsMs - telemetryMs
                        console.log('[FRAME PROC] breakdown:', {
                            total: frameDurationMs.toFixed(1),
                            yolo: yoloMs.toFixed(1),
                            moveNet: moveNetMs.toFixed(1),
                            sharedValueReads: sharedValueReadsMs.toFixed(1),
                            telemetry: telemetryMs.toFixed(1),
                            other: otherMs.toFixed(1)
                        })
                        console.log('[FRAME PROC] sharedValueReads breakdown:', {
                            yolo: tYoloSharedValueReads.toFixed(1),
                            playerCrop: tPlayerCropSharedValueReads.toFixed(1),
                            tracking: tTrackingSharedValueReads.toFixed(1),
                            moveNet: tMoveNetSharedValueReads.toFixed(1),
                            writes: tSharedValueWrites.toFixed(1)
                        })
                    }

                    // Reset reentrancy guard
                    isProcessingFrame.value = false

                    // Camera frame is disposed exactly once.
                    frame.dispose()
                }
            },

            [
                hasFatalError,
                perfFramesReceived,
                perfFramesProcessed,
                perfFramesDroppedBusy,
                perfFrameDurationTotal,
                perfFrameDurationMax,
                perfYoloRequested,
                perfYoloExecuted,
                perfYoloSkipped,
                perfYoloInferenceTotal,
                perfYoloInferenceMin,
                perfYoloInferenceMax,
                perfYoloScheduleWaitTotal,
                perfYoloResizeTotal,
                perfYoloRunTotal,
                perfYoloParseTotal,
                perfMoveNetRequested,
                perfMoveNetExecuted,
                perfMoveNetSkipped,
                perfMoveNetInferenceTotal,
                perfMoveNetInferenceMin,
                perfMoveNetInferenceMax,
                perfMoveNetWorkletPrepTotal,
                perfMoveNetScheduleWaitTotal,
                perfMoveNetCropTotal,
                perfMoveNetResizeTotal,
                perfMoveNetRunTotal,
                perfMoveNetParseTotal,
                perfLastLogAt,
                recordDiagnosticWindow,
                updatePipelineTelemetry,
                perfTrackingAccepted,
                isProcessingFrame,
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
        const moveNetMetrics = telemetryLogger.getMoveNetMetrics()
        const moveNetFPS = moveNetMetrics.throughputFps
        return telemetryLogger.exportTestSummary(cameraFPS, moveNetFPS)
    }, [selectedFps])

    const logTelemetrySummary = useCallback(() => {
        const cameraFPS = selectedFps || 30
        const moveNetMetrics = telemetryLogger.getMoveNetMetrics()
        const moveNetFPS = moveNetMetrics.throughputFps
        telemetryLogger.logTestSummary(cameraFPS, moveNetFPS)
    }, [selectedFps])

    const resetTelemetry = useCallback(() => {
        telemetryLogger.reset()
    }, [])

    return {
        frameOutput,
        isModelReady,
        resetShotTracking,
        yoloFps: yoloWorker.theoreticalFps,
        yoloThroughputFps: actualYoloFps,
        moveNetFps: telemetryLogger.getMoveNetMetrics().throughputFps,
        currentFps: useSharedValue(selectedFps || 30),
        actualCameraFps,
        actualYoloFps,
        actualMoveNetFps,
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
            playerTrackState,
            playerTrackAge,
            rimTrackState,
            rimTrackAge,
        },
    }
}
