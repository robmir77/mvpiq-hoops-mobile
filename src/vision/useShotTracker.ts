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
// import * as Battery from 'expo-battery' // TODO: Install expo-battery package first


// ─────────────────────────────────────────────────────────────────────────────
// AI throttling
// ─────────────────────────────────────────────────────────────────────────────

const YOLO_FRAME_SKIP = 1
const YOLO_FRAME_SKIP_STABLE = 3 // Throttle YOLO when ball is stable
const BALL_STABILITY_THRESHOLD = 0.02 // Position change threshold (2%)
const BALL_STABILITY_FRAMES = 5 // Consecutive frames to consider stable

// MoveNet is throttled independently from camera/YOLO.
// Time-based scheduling keeps the target stable if effective camera throughput changes.
const MOVENET_TARGET_FPS = 3
const MOVENET_INTERVAL_MS = 1000 / MOVENET_TARGET_FPS

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const RIM_CONFIDENCE_THRESHOLD = 0.15

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

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

    // ─────────────────────────────────────────────────────────────────────────
    // Mount-instance diagnostic
    //
    // If this hook is ever mounted twice concurrently (React remount, a
    // stale navigation stack entry, etc.), each instance gets its own
    // Worklet Runtime/shared values — which is consistent with the
    // remaining rare TypedArray/ArrayBuffer crash surviving every JS-level
    // stabilization fix so far. This has near-zero cost and tells us
    // directly, from the same Metro log you already share, whether that's
    // happening: if you ever see two different [instanceId] values alive
    // at the same time (a MOUNT for id B before an UNMOUNT for id A),
    // that's the proof — no adb/logcat needed for this specific check.
    // ─────────────────────────────────────────────────────────────────────────

    const instanceIdRef =
        useRef(
            Math.random().toString(36).slice(2, 8)
        )

    useEffect(() => {
        console.log(
            '[ShotTracker][INSTANCE] MOUNT',
            instanceIdRef.current
        )

        // TODO: Enable battery monitoring after installing expo-battery
        // const startBatteryMonitoring = async () => {
        //     try {
        //         const batteryLevel = await Battery.getBatteryLevelAsync()
        //         const batteryLevelPercent = Math.round(batteryLevel * 100)
        //         
        //         let temperature = 0
        //         if (Platform.OS === 'android') {
        //             temperature = 35.0 // Placeholder
        //         }
        //         
        //         telemetryLogger.startBatteryMonitoring(batteryLevelPercent, temperature)
        //         console.log('[ShotTracker] Battery monitoring started', { level: batteryLevelPercent, temperature })
        //     } catch (error) {
        //         console.error('[ShotTracker] Failed to start battery monitoring:', error)
        //     }
        // }
        // startBatteryMonitoring()

        return () => {
            console.log(
                '[ShotTracker][INSTANCE] UNMOUNT',
                instanceIdRef.current
            )

            // TODO: Enable battery monitoring after installing expo-battery
            // const endBatteryMonitoring = async () => {
            //     try {
            //         const batteryLevel = await Battery.getBatteryLevelAsync()
            //         const batteryLevelPercent = Math.round(batteryLevel * 100)
            //         
            //         let temperature = 0
            //         if (Platform.OS === 'android') {
            //             temperature = 35.0 // Placeholder
            //         }
            //         
            //         telemetryLogger.endBatteryMonitoring(batteryLevelPercent, temperature)
            //         console.log('[ShotTracker] Battery monitoring ended', { level: batteryLevelPercent, temperature })
            //     } catch (error) {
            //         console.error('[ShotTracker] Failed to end battery monitoring:', error)
            //     }
            // }
            // endBatteryMonitoring()
        }
    }, [])

    // ─────────────────────────────────────────────────────────────────────────
    // Shot detector
    // ─────────────────────────────────────────────────────────────────────────

    const shotDetector =
        useRef(new ShotDetector())

    const lastBallRef =
        useRef<{
            x: number
            y: number
            t: number
        } | null>(null)

    // ─────────────────────────────────────────────────────────────────────────
    // Shared values
    // ─────────────────────────────────────────────────────────────────────────

    const frameCounter =
        useSharedValue(0)

    // Reentrancy guard: prevents a second onFrame invocation from starting
    // while a previous one is still running (e.g. inside model.runSync()).
    // Belt-and-suspenders alongside dropFramesWhileBusy below.
    const isProcessingFrame =
        useSharedValue(false)

    // Fatal error guard: stops processing after a critical error (e.g. TypedArray corruption)
    const hasFatalError =
        useSharedValue(false)

    // Throttle for scheduleOnRN calls - limit bridge crossings to ~16ms
    const lastRNDispatch =
        useSharedValue(0)

    // Worklet-side throughput instrumentation; sampled once per second.
    const perfLastLogAt = useSharedValue(0)
    const perfFramesReceived = useSharedValue(0)
    const perfFramesProcessed = useSharedValue(0)
    const perfFramesDroppedBusy = useSharedValue(0)
    const lastMoveNetInferenceAt = useSharedValue(0)

    // End-to-end detection tracking
    const perfYoloBallDetected = useSharedValue(0)
    const perfTrackingAccepted = useSharedValue(0)
    const perfOverlayRendered = useSharedValue(0)

    // Ball stability tracking for intelligent YOLO throttling
    const lastBallX = useSharedValue(0)
    const lastBallY = useSharedValue(0)
    const stableFrameCount = useSharedValue(0)
    const isBallStable = useSharedValue(false)

    // Size continuity tracking to filter incompatible detections
    const lastBallWidth = useSharedValue(0)
    const lastBallHeight = useSharedValue(0)
    const lastValidBallTime = useSharedValue(0)

    // ─────────────────────────────────────────────────────────────────────────
    // Parallel Workers
    // ─────────────────────────────────────────────────────────────────────────

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

    // Recovery mechanism: reset the fatal error flag after a delay.
    // IMPORTANT: this must be scheduled from the JS thread at the moment
    // the error is actually caught (via scheduleOnRN in the catch block
    // below) — NOT from a mount-time useEffect. A useEffect with an empty
    // dependency array only runs once, at mount, when there is no error
    // yet to react to; mutating a plain useRef from inside the onFrame
    // worklet doesn't propagate back to the JS thread's ref either way
    // (worklets get their own copy of captured plain objects — only
    // shared values are synchronized across runtimes). Net effect of the
    // old approach: the timeout was never scheduled, and hasFatalError
    // stayed true forever after the first fatal error.
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

    // JS-side callback for pipeline telemetry recording
    const updatePipelineTelemetry = useCallback((
        received: number,
        processed: number,
        droppedBusy: number,
        trackingAccepted: number,
        overlayRendered: number
    ) => {
        telemetryLogger.updatePipelineMetrics(
            received,
            processed,
            droppedBusy,
            trackingAccepted,
            overlayRendered
        )
        telemetryLogger.logPipelineMetrics()
        
        // Log YOLO performance metrics
        telemetryLogger.logYoloPerf()
        
        // Log ball detection metrics
        telemetryLogger.logBallDetectionMetrics(processed)
        
        // Log player detection metrics
        telemetryLogger.logPlayerDetectionMetrics(processed)
        
        // Log false positive summary
        telemetryLogger.logFalsePositiveSummary()
        
        // Log bbox stability
        telemetryLogger.logBboxStability()
    }, [])


    // ─────────────────────────────────────────────────────────────────────────
    // Adaptive confidence threshold
    // ─────────────────────────────────────────────────────────────────────────

    const adaptiveThreshold =
        useSharedValue(0.01)

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


    // ─────────────────────────────────────────────────────────────────────────
    // Callback refs
    // ─────────────────────────────────────────────────────────────────────────

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

    // ─────────────────────────────────────────────────────────────────────────
    // Shared flags
    // ─────────────────────────────────────────────────────────────────────────

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

    // ─────────────────────────────────────────────────────────────────────────
    // Adaptive threshold
    // ─────────────────────────────────────────────────────────────────────────

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

                    const detectedFrames =
                        detectionHistory.current.filter(
                            d => d.confidence > 0
                        ).length

                    const detectionRate =
                        detectedFrames /
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

                    // DEV ONLY: Log adaptive threshold changes
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

    // ─────────────────────────────────────────────────────────────────────────
    // Shot detection
    // ─────────────────────────────────────────────────────────────────────────

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

                // Size continuity filter - only fallback when current detection is invalid (0/null)
                const now = Date.now()
                const timeSinceLastValid = lastValidBallTime.value > 0 ? now - lastValidBallTime.value : Infinity
                const MAX_TIME_FOR_FALLBACK = 500 // ms - only fallback for recent gaps

                let filteredBall: typeof ball | null = ball
                let filterReason: string | null = null

                // Check if current detection is invalid (zero dimensions)
                const isInvalid = ball.width === 0 || ball.height === 0 || ball.x === 0 || ball.y === 0

                if (isInvalid && lastBallWidth.value > 0 && lastBallHeight.value > 0) {
                    // Current detection is invalid, fallback to previous valid detection
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
                        // Too much time passed, don't fallback
                        filterReason = `Current detection invalid but too much time since last valid (${timeSinceLastValid.toFixed(0)}ms), not using fallback`
                        filteredBall = null
                    }
                }

                // Log filter decisions
                if (__DEV__ && filterReason) {
                    console.log(`[BBOX FILTER] ${filterReason}`)
                    console.log(`[BBOX FILTER] Previous valid bbox: w=${lastBallWidth.value.toFixed(3)}, h=${lastBallHeight.value.toFixed(3)}`)
                    console.log(`[BBOX FILTER] Current bbox (raw): w=${ball.width.toFixed(3)}, h=${ball.height.toFixed(3)}`)
                    console.log(`[BBOX FILTER] Filtered bbox passed to tracking: w=${filteredBall?.width.toFixed(3) ?? 'null'}, h=${filteredBall?.height.toFixed(3) ?? 'null'}`)
                }

                // Update continuity tracking only with valid detections
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

                // Return the detection with filtered bbox for TrackingEngine
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

    // ─────────────────────────────────────────────────────────────────────────
    // Ball callback
    // ─────────────────────────────────────────────────────────────────────────

    const wrappedOnBallDetection =
        useCallback(
            (
                detection: BallDetection
            ) => {

                // Apply filter first to get the filtered bbox
                const filteredDetection = handleBallDetectionForShotTracking(
                    detection
                )

                // Pass the filtered detection to TrackingEngine
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

    // ─────────────────────────────────────────────────────────────────────────
    // JS bridges
    // ─────────────────────────────────────────────────────────────────────────

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

    // NOTE: with react-native-worklets, scheduleOnRN(fn, ...args) is called
    // directly at the worklet call site (see onFrame below) — no need to
    // pre-wrap emitBallDetection/emitPoseResult with createRunOnJS here.


    // ─────────────────────────────────────────────────────────────────────────
    // Frame processor
    //
    // IMPORTANT:
    //
    // onFrame is stabilized with useCallback.
    //
    // DO NOT change this back to:
    //
    //   onFrame: (frame) => { ... }
    //
    // The Test 3F proved that the stable callback prevents the previous
    // TypedArray/worklet binding problem.
    // ─────────────────────────────────────────────────────────────────────────

    const onFrame =
        useCallback(
            (frame: Frame) => {

                'worklet'

                perfFramesReceived.value += 1

                // ───────────────────────────────────────────────────────────────────
                // Reentrancy guard
                // ───────────────────────────────────────────────────────────────────

                if (hasFatalError.value) {
                    // A fatal error occurred (e.g. TypedArray corruption).
                    // Stop all processing to prevent cascading failures.
                    frame.dispose()
                    return
                }

                if (isProcessingFrame.value) {
                    // A previous invocation is still running (e.g. slow
                    // model.runSync()). Drop this one instead of letting it
                    // race on the same Frame/buffers.
                    perfFramesDroppedBusy.value += 1
                    frame.dispose()
                    return
                }

                isProcessingFrame.value = true
                perfFramesProcessed.value += 1

                // ───────────────────────────────────────────────────────────────────
                // Frame counter
                // ───────────────────────────────────────────────────────────────────

                frameCounter.value += 1

                const currentFrame =
                    frameCounter.value

                try {

                    // ────────────────────────────────────────────────────────────────
                    // Global enable
                    // ────────────────────────────────────────────────────────────────

                    if (
                        !enabledShared.value
                    ) {
                        return
                    }

                    // ────────────────────────────────────────────────────────────────
                    // Model readiness
                    // ────────────────────────────────────────────────────────────────

                    const yoloReady = yoloWorker.isReady.value
                    const poseReady = moveNetWorker.isReady.value

                    if (
                        !yoloReady &&
                        !poseReady
                    ) {
                        return
                    }

                    const frameWidth =
                        frame.width

                    const frameHeight =
                        frame.height

                    // ────────────────────────────────────────────────────────────────
                    // FASE 6: Scheduling chiaro per YOLO e MoveNet
                    //
                    // YOLO: ~15-30 FPS (con throttling intelligente basato sulla stabilità della palla)
                    // MoveNet: ~3 FPS (time-based scheduling)
                    //
                    // I due modelli NON sono mutualmente esclusivi - possono girare indipendentemente
                    // ────────────────────────────────────────────────────────────────

                    const timestamp = Date.now()

                    // MoveNet: time-based scheduling per target 3 FPS
                    const nowForMoveNet = Date.now()
                    const lastMoveNet = lastMoveNetInferenceAt.value
                    const timeSinceLastMoveNet = lastMoveNet > 0 ? nowForMoveNet - lastMoveNet : MOVENET_INTERVAL_MS

                    const moveNetDue =
                        poseReady &&
                        poseEnabledShared.value &&
                        timeSinceLastMoveNet >= MOVENET_INTERVAL_MS

                    // YOLO: frame-based scheduling con throttling intelligente
                    const currentSkip = isBallStable.value ? YOLO_FRAME_SKIP_STABLE : YOLO_FRAME_SKIP
                    const yoloDue =
                        yoloReady &&
                        ballEnabledShared.value &&
                        currentFrame % currentSkip === 0

                    // Log throttling per debugging
                    if (__DEV__) {
                        if (poseReady && poseEnabledShared.value && !moveNetDue) {
                            console.log(`[MoveNet Throttle] Skip: ${timeSinceLastMoveNet.toFixed(0)}ms since last (need ${MOVENET_INTERVAL_MS.toFixed(0)}ms)`)
                        }
                        if (yoloReady && ballEnabledShared.value && !yoloDue) {
                            console.log(`[YOLO Throttle] Skip: frame=${currentFrame}, skip=${currentSkip}, stable=${isBallStable.value}`)
                        }
                    }

                    // Esegui YOLO prima per ottenere il player bbox corrente
                    if (yoloDue) {
                        yoloWorker.processFrame(frame, timestamp, perfFramesProcessed.value)
                        
                        // Aggiorna playerBbox immediatamente dopo YOLO
                        // così MoveNet userà il bbox del frame corrente
                        const currentPlayer = yoloWorker.latestResultPlayer.value
                        if (currentPlayer) {
                            moveNetWorker.playerBbox.value = {
                                x: currentPlayer.x,
                                y: currentPlayer.y,
                                width: currentPlayer.width,
                                height: currentPlayer.height,
                            }
                        }
                    }

                    // Esegui MoveNet dopo YOLO con il player bbox aggiornato
                    if (moveNetDue) {
                        lastMoveNetInferenceAt.value = nowForMoveNet
                        moveNetWorker.processFrame(frame, timestamp)
                    }

                    // Process worker results (get latest available from shared values)
                    const yoloResult = {
                        ball: yoloWorker.latestResultBall.value,
                        player: yoloWorker.latestResultPlayer.value,
                        rim: yoloWorker.latestResultRim.value,
                        timestamp: yoloWorker.latestResultTimestamp.value
                    }
                    const poseResult = {
                        keypoints: moveNetWorker.latestResultKeypoints.value,
                        angles: moveNetWorker.latestResultAngles.value,
                        timestamp: moveNetWorker.latestResultTimestamp.value
                    }

                    // Process YOLO result if available
                    if (yoloResult.ball) {
                        perfYoloBallDetected.value += 1

                        const detection: BallDetection = {
                            ball: yoloResult.ball,
                            rim: yoloResult.rim ?? undefined,
                            timestamp: yoloResult.timestamp
                        }

                        // Emit via bridge
                        const now = Date.now()
                        if (now - lastRNDispatch.value >= 16) {
                            lastRNDispatch.value = now
                            scheduleOnRN(emitBallDetection, detection)
                        }
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
                        // DEV ONLY: Log pipeline performance metrics
                        if (__DEV__) {
                            console.log(
                                `[PIPE PERF] received:${perfFramesReceived.value} ` +
                                `processed:${perfFramesProcessed.value} ` +
                                `droppedBusy:${perfFramesDroppedBusy.value}`
                            )
                        }

                        // Update telemetry pipeline metrics via scheduleOnRN
                        scheduleOnRN(
                            updatePipelineTelemetry,
                            perfFramesReceived.value,
                            perfFramesProcessed.value,
                            perfFramesDroppedBusy.value,
                            perfTrackingAccepted.value,
                            perfOverlayRendered.value
                        )

                        perfLastLogAt.value = perfNow
                        perfFramesReceived.value = 0
                        perfFramesProcessed.value = 0
                        perfFramesDroppedBusy.value = 0
                        perfYoloBallDetected.value = 0
                        perfTrackingAccepted.value = 0
                        perfOverlayRendered.value = 0
                    }

                } catch (error) {

                    const errorMessage = (error as any)?.message || String(error)

                    // Detect fatal errors that indicate TypedArray corruption
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

                    // Always release the guard, even on error, so the next
                    // frame can be processed.
                    isProcessingFrame.value = false
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

    // ─────────────────────────────────────────────────────────────────────────
    // Frame Output
    // ─────────────────────────────────────────────────────────────────────────

    const frameOutput =
        useFrameOutput({
            pixelFormat:
                'yuv',

            targetResolution: selectedResolution || {
                width: 1280,
                height: 720,
            },

            // Inference (YOLO + MoveNet) can take longer than the interval
            // between camera frames at low fps. Without this, VisionCamera
            // starts a new onFrame call before the previous one has finished
            // disposing its Frame/buffer, causing overlapping invocations
            // and "no ArrayBuffer attached" errors.
            dropFramesWhileBusy: true,

            onFrame,
        })

    // ─────────────────────────────────────────────────────────────────────────
    // Reset shot tracking
    // ─────────────────────────────────────────────────────────────────────────

    const resetShotTracking =
        useCallback(() => {

            shotDetector.current.reset()

            lastBallRef.current =
                null

        }, [])

    // ─────────────────────────────────────────────────────────────────────────
    // Model ready (synced from worker shared values to avoid render warning)
    // ─────────────────────────────────────────────────────────────────────────

    const [isModelReady, setIsModelReady] = useState(false)

    useEffect(() => {
        // Sync from shared values to state
        const checkReady = () => {
            setIsModelReady(yoloWorker.isReady.value && moveNetWorker.isReady.value)
        }

        checkReady()

        // Set up interval to check periodically (shared values don't trigger re-renders)
        const interval = setInterval(checkReady, 100)

        return () => clearInterval(interval)
    }, [yoloWorker.isReady, moveNetWorker.isReady])

    // ─────────────────────────────────────────────────────────────────────────
    // Telemetry control
    // ─────────────────────────────────────────────────────────────────────────

    const exportTelemetrySummary = useCallback(() => {
        const cameraFPS = selectedFps || 30
        // Read fps from SharedValue at call time (not during render)
        const moveNetFPS = moveNetWorker.fps.value || 0
        return telemetryLogger.exportTestSummary(cameraFPS, moveNetFPS)
    }, [selectedFps, moveNetWorker.fps])

    const logTelemetrySummary = useCallback(() => {
        const cameraFPS = selectedFps || 30
        // Read fps from SharedValue at call time (not during render)
        const moveNetFPS = moveNetWorker.fps.value || 0
        telemetryLogger.logTestSummary(cameraFPS, moveNetFPS)
    }, [selectedFps, moveNetWorker.fps])

    const resetTelemetry = useCallback(() => {
        telemetryLogger.reset()
    }, [])

    // ─────────────────────────────────────────────────────────────────────────
    // Return
    // ─────────────────────────────────────────────────────────────────────────

    return {
        frameOutput,
        isModelReady,
        resetShotTracking,
        yoloFps: yoloWorker.fps,
        moveNetFps: moveNetWorker.fps,
        exportTelemetrySummary,
        logTelemetrySummary,
        resetTelemetry,
    }
}
