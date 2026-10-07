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

    // PASS 2: Granular YOLO SharedValue profiling
    const perfYoloSvReadTotal = useSharedValue(0)
    const perfYoloSvSpreadTotal = useSharedValue(0)

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
    const perfPlayerLostCount = useSharedValue(0)
    const perfPlayerBboxExpiredCount = useSharedValue(0)
    
    // Granular player flow telemetry (with detectionId)
    const perfPlayerTrackingFreshCount = useSharedValue(0)
    const perfPlayerTrackingPersistedCount = useSharedValue(0)
    const perfPlayerTrackingFreshWithMoveNetCount = useSharedValue(0)
    const perfPlayerTrackingPersistedWithMoveNetCount = useSharedValue(0)
    const perfPlayerMoveNetExecutionCount = useSharedValue(0)
    const perfLastPlayerDetectionId = useSharedValue(0)
    const perfLastPersistedBboxAgeMs = useSharedValue(0) // Store last persisted bbox age for telemetry
    
    // MoveNet decision telemetry (worklet-safe counters)
    const perfMoveNetDecisionFrames = useSharedValue(0) // Total frames evaluated
    const perfMoveNetDecisionHasBbox = useSharedValue(0) // Frames with trackedBbox
    const perfMoveNetDecisionCurrentBbox = useSharedValue(0) // Frames with fresh bbox
    const perfMoveNetDecisionPersistedBbox = useSharedValue(0) // Frames with persisted bbox
    const perfMoveNetDecisionConfidenceRejected = useSharedValue(0) // Rejected by confidence threshold
    const perfMoveNetDecisionSizeRejected = useSharedValue(0) // Rejected by size validation
    const perfMoveNetDecisionBoundsRejected = useSharedValue(0) // Rejected by bounds validation
    const perfMoveNetDecisionRun = useSharedValue(0) // MoveNet actually executed

    // Track last time player was detected for invalidation logic
    const lastPlayerDetectedAt = useSharedValue(0)

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

    // PASS 5C: PlayerCrop internal profiling counters
    const perfPlayerCropUpdateCount = useSharedValue(0)
    const perfPlayerCropUpdateTimeMs = useSharedValue(0)
    const perfPlayerCropGetEffectiveBboxCount = useSharedValue(0)
    const perfPlayerCropGetEffectiveBboxTimeMs = useSharedValue(0)
    const perfPlayerCropSharedValueWrites = useSharedValue(0)

    // PASS 5I: Cache hit/miss metrics
    const perfPlayerCropCacheHits = useSharedValue(0)
    const perfPlayerCropCacheMisses = useSharedValue(0)

    // PASS 5J: Cache HIT vs MISS timing
    const perfPlayerCropCacheHitTimeMs = useSharedValue(0)
    const perfPlayerCropCacheHitMinMs = useSharedValue(Number.MAX_SAFE_INTEGER)
    const perfPlayerCropCacheHitMaxMs = useSharedValue(0)
    const perfPlayerCropCacheMissTimeMs = useSharedValue(0)
    const perfPlayerCropCacheMissMinMs = useSharedValue(Number.MAX_SAFE_INTEGER)
    const perfPlayerCropCacheMissMaxMs = useSharedValue(0)

    // PASS 5D: Granular getEffectiveBbox profiling
    const perfPlayerCropSvReadsMs = useSharedValue(0)
    const perfPlayerCropAgeTtlMs = useSharedValue(0)
    const perfPlayerCropDetectionIdMs = useSharedValue(0)
    const perfPlayerCropSmoothingMs = useSharedValue(0)
    const perfPlayerCropSvWritesMs = useSharedValue(0)
    const perfPlayerCropResultMs = useSharedValue(0)

    // PASS 5E: Smoothing reads/lerp/writes/result separation
    const perfSmoothingReadsMs = useSharedValue(0)
    const perfSmoothingLerpMs = useSharedValue(0)
    const perfSmoothingWritesMs = useSharedValue(0)
    const perfResultReadsMs = useSharedValue(0)
    const perfResultConstructionMs = useSharedValue(0)

    // PASS 5F: Date.now() overhead and unaccounted time
    const perfDateNowOverheadMs = useSharedValue(0)
    const perfSmoothingUnaccountedMs = useSharedValue(0)
    const perfResultUnaccountedMs = useSharedValue(0)

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
        telemetryLogger.logPlayerFlowMetrics()
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

            // Record player detection telemetry
            if (player) {
                telemetryLogger.recordPlayerYoloDetection()
            }

            onPlayerDetectionRef.current?.(player)
        },
        []
    )

    // Batch player tracking telemetry callback - dispatched once per second
    const flushPlayerTrackingTelemetry = useCallback((
        lostCount: number,
        expiredCount: number,
        trackingFreshCount: number,
        trackingPersistedCount: number,
        trackingFreshWithMoveNetCount: number,
        trackingPersistedWithMoveNetCount: number,
        moveNetExecutionCount: number,
        lastPersistedBboxAgeMs: number,
        // MoveNet decision telemetry
        moveNetDecisionFrames: number,
        moveNetDecisionHasBbox: number,
        moveNetDecisionCurrentBbox: number,
        moveNetDecisionPersistedBbox: number,
        moveNetDecisionConfidenceRejected: number,
        moveNetDecisionSizeRejected: number,
        moveNetDecisionBoundsRejected: number,
        moveNetDecisionRun: number
    ) => {
        // Skip if unmounted
        if (!isMountedRef.current) {
            return
        }

        // Flush aggregated counters to telemetry logger
        for (let i = 0; i < lostCount; i++) {
            telemetryLogger.recordPlayerLost()
        }
        for (let i = 0; i < expiredCount; i++) {
            telemetryLogger.recordPlayerBboxExpired()
        }
        // Flush granular player flow counters
        for (let i = 0; i < trackingFreshCount; i++) {
            telemetryLogger.recordPlayerTrackingFresh()
        }
        // Record persisted bbox ageMs from SharedValue (worklet-safe)
        for (let i = 0; i < trackingPersistedCount; i++) {
            telemetryLogger.recordPlayerTrackingPersisted(lastPersistedBboxAgeMs)
        }
        for (let i = 0; i < trackingFreshWithMoveNetCount; i++) {
            telemetryLogger.recordPlayerTrackingFreshWithMoveNet()
        }
        for (let i = 0; i < trackingPersistedWithMoveNetCount; i++) {
            telemetryLogger.recordPlayerTrackingPersistedWithMoveNet()
        }
        for (let i = 0; i < moveNetExecutionCount; i++) {
            telemetryLogger.recordPlayerMoveNetExecution()
        }
        
        // Log MoveNet decision telemetry
        console.log('[MOVENET][DECISION]',
            `frames=${moveNetDecisionFrames} ` +
            `hasBbox=${moveNetDecisionHasBbox} ` +
            `currentBbox=${moveNetDecisionCurrentBbox} ` +
            `persistedBbox=${moveNetDecisionPersistedBbox} ` +
            `confidenceRejected=${moveNetDecisionConfidenceRejected} ` +
            `sizeRejected=${moveNetDecisionSizeRejected} ` +
            `boundsRejected=${moveNetDecisionBoundsRejected} ` +
            `run=${moveNetDecisionRun}`
        )
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
                let tTelemetryWrites = 0
                let tTelemetryFlush = 0
                let tFrameDurationWrites = 0
                let tYoloTimingWrites = 0
                let tSharedValueReadsStart = 0
                let tSharedValueReadsEnd = 0
                let tYoloSharedValueReads = 0
                let tYoloReadOnly = 0
                let tYoloSpreadOnly = 0
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
                        perfPlayerLostCount.value,
                        perfPlayerBboxExpiredCount.value,
                        perfPlayerTrackingFreshCount.value,
                        perfPlayerTrackingPersistedCount.value,
                        perfPlayerTrackingFreshWithMoveNetCount.value,
                        perfPlayerTrackingPersistedWithMoveNetCount.value,
                        perfPlayerMoveNetExecutionCount.value,
                        perfLastPersistedBboxAgeMs.value,
                        // MoveNet decision telemetry
                        perfMoveNetDecisionFrames.value,
                        perfMoveNetDecisionHasBbox.value,
                        perfMoveNetDecisionCurrentBbox.value,
                        perfMoveNetDecisionPersistedBbox.value,
                        perfMoveNetDecisionConfidenceRejected.value,
                        perfMoveNetDecisionSizeRejected.value,
                        perfMoveNetDecisionBoundsRejected.value,
                        perfMoveNetDecisionRun.value
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
                    perfPlayerLostCount.value = 0
                    perfPlayerBboxExpiredCount.value = 0
                    // Reset granular player flow counters
                    perfPlayerTrackingFreshCount.value = 0
                    perfPlayerTrackingPersistedCount.value = 0
                    perfPlayerTrackingFreshWithMoveNetCount.value = 0
                    perfPlayerTrackingPersistedWithMoveNetCount.value = 0
                    perfPlayerMoveNetExecutionCount.value = 0
                    perfLastPlayerDetectionId.value = 0
                    perfLastPersistedBboxAgeMs.value = 0
                    // Reset MoveNet decision telemetry
                    perfMoveNetDecisionFrames.value = 0
                    perfMoveNetDecisionHasBbox.value = 0
                    perfMoveNetDecisionCurrentBbox.value = 0
                    perfMoveNetDecisionPersistedBbox.value = 0
                    perfMoveNetDecisionConfidenceRejected.value = 0
                    perfMoveNetDecisionSizeRejected.value = 0
                    perfMoveNetDecisionBoundsRejected.value = 0
                    perfMoveNetDecisionRun.value = 0
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
                        // Record MoveNet decision telemetry
                        perfMoveNetDecisionFrames.value += 1
                        
                        // Get effective bbox from PlayerCropManager for MoveNet crop
                        const trackedBbox = playerCrop.getEffectiveBbox(Date.now())
                        
                        if (trackedBbox !== null) {
                            perfMoveNetDecisionHasBbox.value += 1
                            
                            if (!trackedBbox.isUsingLastBbox) {
                                perfMoveNetDecisionCurrentBbox.value += 1
                                
                                // Check confidence threshold
                                const confidence = trackedBbox.bbox.confidence ?? 0
                                if (confidence >= YOLO_CONFIG.PLAYER_CROP_MIN_CONFIDENCE) {
                                    // Check size validation (optional - add if needed)
                                    // For now, just run MoveNet
                                    moveNetWorker.playerBbox.value = {
                                        x: trackedBbox.bbox.x,
                                        y: trackedBbox.bbox.y,
                                        width: trackedBbox.bbox.width,
                                        height: trackedBbox.bbox.height,
                                        confidence: trackedBbox.bbox.confidence,
                                    }
                                    // Update visual tracking state
                                    playerTrackState.value = 'DETECTED'
                                    playerTrackAge.value = 0
                                    
                                    // Record granular telemetry: fresh bbox → MoveNet execution
                                    perfPlayerTrackingFreshCount.value += 1
                                    perfPlayerTrackingFreshWithMoveNetCount.value += 1
                                    perfLastPlayerDetectionId.value = trackedBbox.detectionId
                                    perfPlayerMoveNetExecutionCount.value += 1
                                    perfMoveNetDecisionRun.value += 1

                                    // MoveNet worker handles its own performance tracking in the async callback
                                    moveNetWorker.processFrame(frame, timestamp)
                                } else {
                                    perfMoveNetDecisionConfidenceRejected.value += 1
                                }
                            } else {
                                perfMoveNetDecisionPersistedBbox.value += 1
                                // No current player detection - skip MoveNet execution
                                // Update visual tracking state to indicate lost player
                                playerTrackState.value = 'PREDICTED'
                                playerTrackAge.value = trackedBbox.ageMs
                                // Record granular telemetry: persisted bbox (no MoveNet)
                                if (trackedBbox.detectionId > perfLastPlayerDetectionId.value) {
                                    // This should not happen - fresh bbox should have isUsingLastBbox=false
                                    // But handle it defensively
                                    perfPlayerTrackingFreshCount.value += 1
                                    perfLastPlayerDetectionId.value = trackedBbox.detectionId
                                } else {
                                    perfPlayerTrackingPersistedCount.value += 1
                                    // Store ageMs in SharedValue for JS-side telemetry (worklet-safe)
                                    perfLastPersistedBboxAgeMs.value = trackedBbox.ageMs
                                }
                            }
                        } else {
                            // No bbox at all
                            playerTrackState.value = 'LOST'
                            playerTrackAge.value = 0
                        }
                    }
                    tMoveNetEnd = performance.now()

                    // Process worker results (get latest available from shared values)
                    tSharedValueReadsStart = performance.now()

                    // YOLO shared value reads - PASS 2 profiling
                    const tYoloSvStart = performance.now()
                    
                    // Micro-benchmark 1: SharedValue read only
                    const tYoloReadStart = performance.now()
                    const rawBall = yoloWorker.latestResultBall.value
                    const rawPlayer = yoloWorker.latestResultPlayer.value
                    const rawRim = yoloWorker.latestResultRim.value
                    tYoloReadOnly = performance.now() - tYoloReadStart
                    
                    // Micro-benchmark 2: Spread/clone only
                    const tYoloSpreadStart = performance.now()
                    const yoloResult = {
                        ball: rawBall ? { ...rawBall } : null,
                        player: rawPlayer ? { ...rawPlayer } : null,
                        rim: rawRim ? { ...rawRim } : null,
                        debug: yoloWorker.latestResultDebug.value,
                        timestamp: yoloWorker.latestResultTimestamp.value
                    }
                    tYoloSpreadOnly = performance.now() - tYoloSpreadStart
                    
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

                    // PASS 5C: Read PlayerCrop internal profiling counters
                    perfPlayerCropUpdateCount.value = playerCrop.updateCount.value
                    perfPlayerCropUpdateTimeMs.value = playerCrop.updateTimeMs.value
                    perfPlayerCropGetEffectiveBboxCount.value = playerCrop.getEffectiveBboxCount.value
                    perfPlayerCropGetEffectiveBboxTimeMs.value = playerCrop.getEffectiveBboxTimeMs.value
                    perfPlayerCropSharedValueWrites.value = playerCrop.sharedValueWrites.value

                    // PASS 5I: Read cache hit/miss metrics
                    perfPlayerCropCacheHits.value = playerCrop.cacheHits.value
                    perfPlayerCropCacheMisses.value = playerCrop.cacheMisses.value

                    // PASS 5J: Read cache HIT vs MISS timing
                    perfPlayerCropCacheHitTimeMs.value = playerCrop.cacheHitTimeMs.value
                    perfPlayerCropCacheHitMinMs.value = playerCrop.cacheHitMinMs.value
                    perfPlayerCropCacheHitMaxMs.value = playerCrop.cacheHitMaxMs.value
                    perfPlayerCropCacheMissTimeMs.value = playerCrop.cacheMissTimeMs.value
                    perfPlayerCropCacheMissMinMs.value = playerCrop.cacheMissMinMs.value
                    perfPlayerCropCacheMissMaxMs.value = playerCrop.cacheMissMaxMs.value

                    // PASS 5D: Read granular getEffectiveBbox profiling
                    perfPlayerCropSvReadsMs.value = playerCrop.getEffectiveBboxSvReadsMs.value
                    perfPlayerCropAgeTtlMs.value = playerCrop.getEffectiveBboxAgeTtlMs.value
                    perfPlayerCropDetectionIdMs.value = playerCrop.getEffectiveBboxDetectionIdMs.value
                    perfPlayerCropSmoothingMs.value = playerCrop.getEffectiveBboxSmoothingMs.value
                    perfPlayerCropSvWritesMs.value = playerCrop.getEffectiveBboxSvWritesMs.value
                    perfPlayerCropResultMs.value = playerCrop.getEffectiveBboxResultMs.value

                    // PASS 5E: Read smoothing reads/lerp/writes/result separation
                    perfSmoothingReadsMs.value = playerCrop.smoothingReadsMs.value
                    perfSmoothingLerpMs.value = playerCrop.smoothingLerpMs.value
                    perfSmoothingWritesMs.value = playerCrop.smoothingWritesMs.value
                    perfResultReadsMs.value = playerCrop.resultReadsMs.value
                    perfResultConstructionMs.value = playerCrop.resultConstructionMs.value

                    // PASS 5F: Read Date.now() overhead and unaccounted time
                    perfDateNowOverheadMs.value = playerCrop.dateNowOverheadMs.value
                    perfSmoothingUnaccountedMs.value = playerCrop.smoothingUnaccountedMs.value
                    perfResultUnaccountedMs.value = playerCrop.resultUnaccountedMs.value

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
                        // Player detected - update timestamp and emit detection
                        lastPlayerDetectedAt.value = now
                        scheduleOnRN(emitPlayerDetection, yoloResult.player)
                    } else {
                        // No player detected - check if we should invalidate lastPlayer
                        // Use 2000ms TTL (double the PlayerTrackingEngine TTL of 1000ms)
                        const PLAYER_INVALIDATION_TTL_MS = 2000
                        if (lastPlayerDetectedAt.value > 0 && (now - lastPlayerDetectedAt.value) > PLAYER_INVALIDATION_TTL_MS) {
                            // Player not detected for too long - invalidate by sending null
                            scheduleOnRN(emitPlayerDetection, null as any)
                            lastPlayerDetectedAt.value = 0
                        }
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
                    
                    // PASS 4B: Profile SharedValue writes breakdown
                    const tTelemetryWritesStart = performance.now()
                    
                    // Category 1: Frame duration metrics
                    const tFrameDurationStart = performance.now()
                    perfFrameDurationTotal.value += frameDurationMs
                    perfFrameDurationMax.value = Math.max(perfFrameDurationMax.value, frameDurationMs)
                    tFrameDurationWrites = performance.now() - tFrameDurationStart
                    
                    // Category 2: PASS 2 granular YOLO timing
                    const tYoloTimingStart = performance.now()
                    perfYoloSvReadTotal.value += tYoloReadOnly
                    perfYoloSvSpreadTotal.value += tYoloSpreadOnly
                    tYoloTimingWrites = performance.now() - tYoloTimingStart
                    
                    tTelemetryWrites = performance.now() - tTelemetryWritesStart
                    
                    const tTelemetryFlushStart = performance.now()
                    maybeFlushDiagnosticWindow(Date.now())
                    tTelemetryFlush = performance.now() - tTelemetryFlushStart
                    
                    tTelemetryEnd = performance.now()

                    // Log frame processor phase breakdown every ~5 seconds (150 frames at 30 FPS)
                    if (currentFrame % 150 === 0) {
                        const yoloMs = tYoloEnd - tYoloStart
                        const moveNetMs = tMoveNetEnd - tMoveNetStart
                        const sharedValueReadsMs = tSharedValueReadsEnd - tSharedValueReadsStart
                        const telemetryMs = tTelemetryEnd - tTelemetryStart
                        // Clamp otherMs to zero to prevent negative values from overlapping phase measurements
                        const otherMs = Math.max(0, frameDurationMs - yoloMs - moveNetMs - sharedValueReadsMs - telemetryMs)
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
                            yoloRead: tYoloReadOnly.toFixed(1),
                            yoloSpread: tYoloSpreadOnly.toFixed(1),
                            playerCrop: tPlayerCropSharedValueReads.toFixed(1),
                            tracking: tTrackingSharedValueReads.toFixed(1),
                            moveNet: tMoveNetSharedValueReads.toFixed(1),
                            writes: tSharedValueWrites.toFixed(1)
                        })
                        console.log('[FRAME PROC] playerCrop breakdown:', {
                            updateCount: perfPlayerCropUpdateCount.value,
                            updateTimeMs: perfPlayerCropUpdateTimeMs.value.toFixed(1),
                            updateAvgMs: perfPlayerCropUpdateCount.value > 0 ? (perfPlayerCropUpdateTimeMs.value / perfPlayerCropUpdateCount.value).toFixed(2) : '0.00',
                            getEffectiveBboxCount: perfPlayerCropGetEffectiveBboxCount.value,
                            getEffectiveBboxTimeMs: perfPlayerCropGetEffectiveBboxTimeMs.value.toFixed(1),
                            getEffectiveBboxAvgMs: perfPlayerCropGetEffectiveBboxCount.value > 0 ? (perfPlayerCropGetEffectiveBboxTimeMs.value / perfPlayerCropGetEffectiveBboxCount.value).toFixed(2) : '0.00',
                            sharedValueWrites: perfPlayerCropSharedValueWrites.value,
                            cacheHits: perfPlayerCropCacheHits.value,
                            cacheMisses: perfPlayerCropCacheMisses.value,
                            cacheHitRate: (perfPlayerCropCacheHits.value + perfPlayerCropCacheMisses.value) > 0 ? ((perfPlayerCropCacheHits.value / (perfPlayerCropCacheHits.value + perfPlayerCropCacheMisses.value)) * 100).toFixed(1) + '%' : '0.0%',
                            cacheHitAvgMs: perfPlayerCropCacheHits.value > 0 ? (perfPlayerCropCacheHitTimeMs.value / perfPlayerCropCacheHits.value).toFixed(2) : '0.00',
                            cacheHitMinMs: perfPlayerCropCacheHitMinMs.value === Number.MAX_SAFE_INTEGER ? '0.00' : perfPlayerCropCacheHitMinMs.value.toFixed(2),
                            cacheHitMaxMs: perfPlayerCropCacheHitMaxMs.value.toFixed(2),
                            cacheMissAvgMs: perfPlayerCropCacheMisses.value > 0 ? (perfPlayerCropCacheMissTimeMs.value / perfPlayerCropCacheMisses.value).toFixed(2) : '0.00',
                            cacheMissMinMs: perfPlayerCropCacheMissMinMs.value === Number.MAX_SAFE_INTEGER ? '0.00' : perfPlayerCropCacheMissMinMs.value.toFixed(2),
                            cacheMissMaxMs: perfPlayerCropCacheMissMaxMs.value.toFixed(2)
                        })
                        console.log('[FRAME PROC] getEffectiveBbox breakdown:', {
                            svReadsMs: perfPlayerCropSvReadsMs.value.toFixed(1),
                            svReadsAvgMs: perfPlayerCropGetEffectiveBboxCount.value > 0 ? (perfPlayerCropSvReadsMs.value / perfPlayerCropGetEffectiveBboxCount.value).toFixed(3) : '0.000',
                            ageTtlMs: perfPlayerCropAgeTtlMs.value.toFixed(1),
                            ageTtlAvgMs: perfPlayerCropGetEffectiveBboxCount.value > 0 ? (perfPlayerCropAgeTtlMs.value / perfPlayerCropGetEffectiveBboxCount.value).toFixed(3) : '0.000',
                            detectionIdMs: perfPlayerCropDetectionIdMs.value.toFixed(1),
                            detectionIdAvgMs: perfPlayerCropGetEffectiveBboxCount.value > 0 ? (perfPlayerCropDetectionIdMs.value / perfPlayerCropGetEffectiveBboxCount.value).toFixed(3) : '0.000',
                            smoothingMs: perfPlayerCropSmoothingMs.value.toFixed(1),
                            smoothingAvgMs: perfPlayerCropGetEffectiveBboxCount.value > 0 ? (perfPlayerCropSmoothingMs.value / perfPlayerCropGetEffectiveBboxCount.value).toFixed(3) : '0.000',
                            svWritesMs: perfPlayerCropSvWritesMs.value.toFixed(1),
                            svWritesAvgMs: perfPlayerCropGetEffectiveBboxCount.value > 0 ? (perfPlayerCropSvWritesMs.value / perfPlayerCropGetEffectiveBboxCount.value).toFixed(3) : '0.000',
                            resultMs: perfPlayerCropResultMs.value.toFixed(1),
                            resultAvgMs: perfPlayerCropGetEffectiveBboxCount.value > 0 ? (perfPlayerCropResultMs.value / perfPlayerCropGetEffectiveBboxCount.value).toFixed(3) : '0.000'
                        })
                        console.log('[FRAME PROC] smoothing breakdown:', {
                            readsMs: perfSmoothingReadsMs.value.toFixed(1),
                            readsAvgMs: perfPlayerCropGetEffectiveBboxCount.value > 0 ? (perfSmoothingReadsMs.value / perfPlayerCropGetEffectiveBboxCount.value).toFixed(3) : '0.000',
                            lerpMs: perfSmoothingLerpMs.value.toFixed(1),
                            lerpAvgMs: perfPlayerCropGetEffectiveBboxCount.value > 0 ? (perfSmoothingLerpMs.value / perfPlayerCropGetEffectiveBboxCount.value).toFixed(3) : '0.000',
                            writesMs: perfSmoothingWritesMs.value.toFixed(1),
                            writesAvgMs: perfPlayerCropGetEffectiveBboxCount.value > 0 ? (perfSmoothingWritesMs.value / perfPlayerCropGetEffectiveBboxCount.value).toFixed(3) : '0.000'
                        })
                        console.log('[FRAME PROC] result breakdown:', {
                            readsMs: perfResultReadsMs.value.toFixed(1),
                            readsAvgMs: perfPlayerCropGetEffectiveBboxCount.value > 0 ? (perfResultReadsMs.value / perfPlayerCropGetEffectiveBboxCount.value).toFixed(3) : '0.000',
                            constructionMs: perfResultConstructionMs.value.toFixed(1),
                            constructionAvgMs: perfPlayerCropGetEffectiveBboxCount.value > 0 ? (perfResultConstructionMs.value / perfPlayerCropGetEffectiveBboxCount.value).toFixed(3) : '0.000'
                        })
                        console.log('[FRAME PROC] unaccounted time breakdown:', {
                            dateNowOverheadMs: perfDateNowOverheadMs.value.toFixed(1),
                            dateNowOverheadAvgMs: perfPlayerCropGetEffectiveBboxCount.value > 0 ? (perfDateNowOverheadMs.value / perfPlayerCropGetEffectiveBboxCount.value).toFixed(3) : '0.000',
                            smoothingUnaccountedMs: perfSmoothingUnaccountedMs.value.toFixed(1),
                            smoothingUnaccountedAvgMs: perfPlayerCropGetEffectiveBboxCount.value > 0 ? (perfSmoothingUnaccountedMs.value / perfPlayerCropGetEffectiveBboxCount.value).toFixed(3) : '0.000',
                            resultUnaccountedMs: perfResultUnaccountedMs.value.toFixed(1),
                            resultUnaccountedAvgMs: perfPlayerCropGetEffectiveBboxCount.value > 0 ? (perfResultUnaccountedMs.value / perfPlayerCropGetEffectiveBboxCount.value).toFixed(3) : '0.000'
                        })
                        console.log('[FRAME PROC] telemetry breakdown:', {
                            total: telemetryMs.toFixed(1),
                            writes: tTelemetryWrites.toFixed(1),
                            flush: tTelemetryFlush.toFixed(1)
                        })
                        console.log('[FRAME PROC] telemetry writes breakdown:', {
                            total: tTelemetryWrites.toFixed(1),
                            frameDuration: tFrameDurationWrites.toFixed(1),
                            yoloTiming: tYoloTimingWrites.toFixed(1)
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
                perfYoloSvReadTotal,
                perfYoloSvSpreadTotal,
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
                // updateAllTelemetry and flushPlayerTrackingTelemetry are NOT worklet dependencies
                // They are called via scheduleOnRN with primitive data only
                perfPlayerLostCount,
                perfPlayerBboxExpiredCount,
                perfPlayerTrackingFreshCount,
                perfPlayerTrackingPersistedCount,
                perfPlayerTrackingFreshWithMoveNetCount,
                perfPlayerTrackingPersistedWithMoveNetCount,
                perfPlayerMoveNetExecutionCount,
                perfLastPlayerDetectionId,
                perfLastPersistedBboxAgeMs,
                // MoveNet decision telemetry
                perfMoveNetDecisionFrames,
                perfMoveNetDecisionHasBbox,
                perfMoveNetDecisionCurrentBbox,
                perfMoveNetDecisionPersistedBbox,
                perfMoveNetDecisionConfidenceRejected,
                perfMoveNetDecisionSizeRejected,
                perfMoveNetDecisionBoundsRejected,
                perfMoveNetDecisionRun,
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
            // PASS 2: Granular YOLO SharedValue profiling
            perfYoloSvReadTotal,
            perfYoloSvSpreadTotal,
        },
    }
}
