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

// ShotDetector removed - shot detection now handled by Runtime → TrackingEngine → ShotDetectionEngine
// useYoloWorker removed - only useYoloWorkerAsync is used to avoid duplicate TFLite model loading
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

    onRimDetection?: (
        rim: {
            x: number
            y: number
            width: number
            height: number
            confidence: number
        }
    ) => void,

    onPlayerDetection?: (
        player: {
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

    enabled: boolean = true,
    poseEnabled: boolean = true,
    ballEnabled: boolean = true,
    rimEnabled: boolean = true,

    // When Runtime is active, useShotTracker should be disabled to avoid duplicate work
    // VisionEngineAdapter handles YOLO/MoveNet execution when Runtime is active
    runtimeActive: boolean = false,

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

    // Shot detector removed - shot detection now handled by Runtime → TrackingEngine → ShotDetectionEngine

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
    const perfYoloWorkletPrepTotal = useSharedValue(0)
    const perfYoloJsPreprocessTotal = useSharedValue(0)
    const perfYoloPostprocessTotal = useSharedValue(0)
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
    const perfMoveNetRnScheduleWaitTotal = useSharedValue(0)
    const perfMoveNetCropTotal = useSharedValue(0)
    const perfMoveNetQuantizationTotal = useSharedValue(0)
    // perfMoveNetResizeTotal removed - resize is now included in jsPreprocessMs
    const perfMoveNetRunTotal = useSharedValue(0)
    const perfMoveNetParseTotal = useSharedValue(0)

    // Actual FPS values for UI (updated every second)
    const actualCameraFps = useSharedValue(0)
    const actualYoloFps = useSharedValue(0)
    const actualMoveNetFps = useSharedValue(0)

    // Detection tracking for telemetry (sampled once per second)
    const perfYoloBallDetected = useSharedValue(0)
    const perfTrackingAccepted = useSharedValue(0)

    // Player tracking telemetry - aggregated in worklet, dispatched once per second
    const perfPlayerUsingLastBboxCount = useSharedValue(0)
    const perfPlayerLostCount = useSharedValue(0)
    const perfPlayerBboxExpiredCount = useSharedValue(0)

    // Removed yoloWorkerSync to avoid duplicate TFLite model loading
    // Only useYoloWorkerAsync is used (ENABLE_ASYNC_YOLO_POC = true)

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
        perfMoveNetRnScheduleWaitTotal,
        perfMoveNetCropTotal,
        perfMoveNetQuantizationTotal,
        // perfMoveNetResizeTotal removed - resize is now included in jsPreprocessMs
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

    // Unified telemetry callback (runs on JS thread) - batches pipeline metrics + diagnostic window
    // Reduces RN bridge crossings from 2 to 1 per second
    const updateAllTelemetry = useCallback((
        cameraFPS: number,
        received: number,
        processed: number,
        droppedBusy: number,
        trackingAccepted: number,
        snapshot: DiagnosticWindowSnapshot
    ) => {
        // Skip if unmounted
        if (!isMountedRef.current) {
            return
        }

        // Update pipeline metrics
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

        // Record diagnostic window with percentiles
        const yoloPercentiles = telemetryLogger.getYoloScheduleWaitPercentiles()
        const moveNetPercentiles = telemetryLogger.getMoveNetScheduleWaitPercentiles()
        
        const snapshotWithPercentiles: DiagnosticWindowSnapshot = {
            ...snapshot,
            yoloScheduleWaitP50: yoloPercentiles.p50,
            yoloScheduleWaitP95: yoloPercentiles.p95,
            yoloScheduleWaitP99: yoloPercentiles.p99,
            moveNetScheduleWaitP50: moveNetPercentiles.p50,
            moveNetScheduleWaitP95: moveNetPercentiles.p95,
            moveNetScheduleWaitP99: moveNetPercentiles.p99,
        }
        
        telemetryLogger.recordDiagnosticWindow(snapshotWithPercentiles)
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

    // Ring buffer for detection history (avoids filter() overhead on long sessions)


    // Callback refs

    const onPoseResultRef =
        useRef(onPoseResult)

    const onRimDetectionRef =
        useRef(onRimDetection)

    const onPlayerDetectionRef =
        useRef(onPlayerDetection)

    useEffect(() => {

        onPoseResultRef.current =
            onPoseResult

    }, [onPoseResult])

    useEffect(() => {

        onRimDetectionRef.current =
            onRimDetection

    }, [onRimDetection])

    useEffect(() => {

        onPlayerDetectionRef.current =
            onPlayerDetection

    }, [onPlayerDetection])

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

                // Pass detection directly to TrackingEngine (no legacy filtering)
                perfTrackingAccepted.value += 1
                onBallDetection(detection)
            },
            [onBallDetection]
        )

    const emitRimDetection = useCallback(
        (
            rim: {
                x: number
                y: number
                width: number
                height: number
                confidence: number
            }
        ) => {
            // Skip if unmounted
            if (!isMountedRef.current) {
                return
            }

            onRimDetectionRef.current?.(rim)
        },
        []
    )

    const emitPlayerDetection = useCallback(
        (
            player: {
                x: number
                y: number
                width: number
                height: number
                confidence: number
            }
        ) => {
            // Skip if unmounted
            if (!isMountedRef.current) {
                return
            }

            onPlayerDetectionRef.current?.(player)
        },
        []
    )

    // Batch player tracking telemetry callback - dispatched once per second
    // Replaces per-frame scheduleOnRN calls for recordPlayerUsingLastBbox, recordPlayerLost, recordPlayerBboxExpired
    const flushPlayerTrackingTelemetry = useCallback((
        usingLastBboxCount: number,
        lostCount: number,
        expiredCount: number
    ) => {
        // Skip if unmounted
        if (!isMountedRef.current) {
            return
        }

        // Flush aggregated counters to telemetry logger
        for (let i = 0; i < usingLastBboxCount; i++) {
            telemetryLogger.recordPlayerUsingLastBbox(0) // ageMs not tracked in aggregated mode
        }
        for (let i = 0; i < lostCount; i++) {
            telemetryLogger.recordPlayerLost()
        }
        for (let i = 0; i < expiredCount; i++) {
            telemetryLogger.recordPlayerBboxExpired()
        }
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

        // Pass detection directly to TrackingEngine (no legacy filtering)
        perfTrackingAccepted.value += 1
        onBallDetection(detection)

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

    // Only use async YOLO worker (sync removed to avoid duplicate model loading)
    const yoloWorker = yoloWorkerAsync

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
                        yoloScheduleWaitP50: 0, // Calculated in recordDiagnosticWindow on JS thread
                        yoloScheduleWaitP95: 0, // Calculated in recordDiagnosticWindow on JS thread
                        yoloScheduleWaitP99: 0, // Calculated in recordDiagnosticWindow on JS thread
                        yoloWorkletPrepAvgMs: yoloExecuted > 0
                            ? perfYoloWorkletPrepTotal.value / yoloExecuted
                            : 0,
                        yoloJsPreprocessAvgMs: yoloExecuted > 0
                            ? perfYoloJsPreprocessTotal.value / yoloExecuted
                            : 0,
                        yoloInferenceAvgMs: yoloExecuted > 0
                            ? perfYoloInferenceTotal.value / yoloExecuted
                            : 0,
                        yoloPostprocessAvgMs: yoloExecuted > 0
                            ? perfYoloPostprocessTotal.value / yoloExecuted
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
                            ? perfMoveNetRnScheduleWaitTotal.value / moveNetExecuted
                            : 0,
                        moveNetScheduleWaitP50: 0, // Calculated in recordDiagnosticWindow on JS thread
                        moveNetScheduleWaitP95: 0, // Calculated in recordDiagnosticWindow on JS thread
                        moveNetScheduleWaitP99: 0, // Calculated in recordDiagnosticWindow on JS thread
                        moveNetCropAvgMs: moveNetExecuted > 0
                            ? perfMoveNetCropTotal.value / moveNetExecuted
                            : 0,
                        moveNetQuantizationAvgMs: moveNetExecuted > 0
                            ? perfMoveNetQuantizationTotal.value / moveNetExecuted
                            : 0,
                        // moveNetResizeAvgMs removed - resize is now included in jsPreprocessMs
                        moveNetRunAvgMs: moveNetExecuted > 0
                            ? perfMoveNetRunTotal.value / moveNetExecuted
                            : 0,
                        moveNetParseAvgMs: moveNetExecuted > 0
                            ? perfMoveNetParseTotal.value / moveNetExecuted
                            : 0,
                    }

                    // Batch telemetry: single RN bridge crossing for both pipeline metrics and diagnostic window
                    scheduleOnRN(
                        updateAllTelemetry,
                        snapshot.cameraFps,
                        snapshot.received,
                        snapshot.processed,
                        snapshot.droppedBusy,
                        perfTrackingAccepted.value,
                        snapshot
                    )

                    // Flush aggregated player tracking telemetry (single RN bridge crossing)
                    scheduleOnRN(
                        flushPlayerTrackingTelemetry,
                        perfPlayerUsingLastBboxCount.value,
                        perfPlayerLostCount.value,
                        perfPlayerBboxExpiredCount.value
                    )

                    // Update actual FPS values for UI
                    actualCameraFps.value = snapshot.cameraFps
                    actualYoloFps.value = snapshot.yoloThroughputFps
                    actualMoveNetFps.value = snapshot.moveNetThroughputFps

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
                    perfMoveNetRnScheduleWaitTotal.value = 0
                    perfMoveNetCropTotal.value = 0
                    perfMoveNetQuantizationTotal.value = 0
                    // perfMoveNetResizeTotal removed - resize is now included in jsPreprocessMs
                    perfMoveNetRunTotal.value = 0
                    perfMoveNetParseTotal.value = 0
                    perfTrackingAccepted.value = 0
                    // Reset aggregated player tracking counters
                    perfPlayerUsingLastBboxCount.value = 0
                    perfPlayerLostCount.value = 0
                    perfPlayerBboxExpiredCount.value = 0
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
                        // Async YOLO: submit frame and return immediately
                        // perfYoloRequested is tracked internally by yoloWorkerAsync
                        // Results are handled via onResultCallback
                        yoloWorkerAsync.submitFrame(frame, timestamp, currentFrame)
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
                                // Aggregate in worklet instead of per-frame scheduleOnRN
                                perfPlayerUsingLastBboxCount.value += 1
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
                        // Emit rim detection callback to update tracking engine
                        scheduleOnRN(emitRimDetection, yoloResult.rim)
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

                    // Process player detection for telemetry and tracking
                    if (yoloResult.player) {
                        // Emit player detection callback to update VisionEngineAdapter and TrackingEngine
                        scheduleOnRN(emitPlayerDetection, yoloResult.player)
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

                    // Log frame processor phase breakdown every ~5 seconds (150 frames at 30 FPS)
                    if (currentFrame % 150 === 0) {
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
                perfMoveNetRnScheduleWaitTotal,
                perfMoveNetCropTotal,
                perfMoveNetQuantizationTotal,
                // perfMoveNetResizeTotal removed - resize is now included in jsPreprocessMs
                perfMoveNetRunTotal,
                perfMoveNetParseTotal,
                perfLastLogAt,
                updateAllTelemetry,
                flushPlayerTrackingTelemetry,
                perfPlayerUsingLastBboxCount,
                perfPlayerLostCount,
                perfPlayerBboxExpiredCount,
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

            // ShotDetector removed - shot detection now handled by Runtime → TrackingEngine → ShotDetectionEngine

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
