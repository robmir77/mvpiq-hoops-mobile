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

    // runtimeActive parameter exists for API compatibility but is not used in the frame processor
    // Vision pipeline continues to run even when Runtime is ACTIVE
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

    // Essential metrics only - FPS and drop count for production monitoring
    const perfLastLogAt = useSharedValue(Date.now())
    const perfFramesReceived = useSharedValue(0)
    const perfFramesProcessed = useSharedValue(0)
    const perfFramesDroppedBusy = useSharedValue(0)

    // Actual FPS values for UI (updated every second)
    const actualCameraFps = useSharedValue(0)
    const actualYoloFps = useSharedValue(0)
    const actualMoveNetFps = useSharedValue(0)

    // Track last time player was detected for invalidation logic
    const lastPlayerDetectedAt = useSharedValue(0)

    // Removed yoloWorkerSync to avoid duplicate TFLite model loading
    // Only useYoloWorkerAsync is used (ENABLE_ASYNC_YOLO_POC = true)

    // yoloWorkerAsync will be initialized after handleYoloAsyncResult is defined

    const moveNetWorker = useMoveNetWorker(
        poseEnabled,
        poseDelegate,
        moveNetModelId,
        onPoseResult // Pass pose result callback to MoveNet worker
        // Profiling parameters removed - simplified for production
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



    // Player bbox from YOLO (for direct display in overlay)
    const playerX = useSharedValue(0)
    const playerY = useSharedValue(0)
    const playerWidth = useSharedValue(0)
    const playerHeight = useSharedValue(0)
    const playerConfidence = useSharedValue(0)
    const latestPlayerDetectionId = useSharedValue(0) // Incremented only on new YOLO detections

    // Visual tracking state for debugging
    const playerTrackState = useSharedValue('LOST')
    const playerTrackAge = useSharedValue(0)

    // Debug rejection reasons from YOLO parser
    const ballRejectionReason = useSharedValue('')
    const rimRejectionReason = useSharedValue('')

    // Ring buffer for detection history (avoids filter() overhead on long sessions)


    // Callback refs

    const onPoseResultRef =
        useRef(onPoseResult)

    const onPlayerDetectionRef =
        useRef(onPlayerDetection)

    useEffect(() => {

        onPoseResultRef.current =
            onPoseResult

    }, [onPoseResult])

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
                onBallDetection(detection)
            },
            [onBallDetection]
        )

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
        onBallDetection(detection)

        // Note: telemetryLogger metrics are already recorded in useYoloWorkerAsync worker

        if (result.player) {
            // Update shared values for direct display in overlay
            playerX.value = result.player.x
            playerY.value = result.player.y
            playerWidth.value = result.player.width
            playerHeight.value = result.player.height
            playerConfidence.value = result.player.confidence
            // Increment detection ID only on new YOLO detection
            latestPlayerDetectionId.value += 1
            // Update PlayerCrop - only when YOLO returns new player
            playerCrop.update({
                x: result.player.x,
                y: result.player.y,
                width: result.player.width,
                height: result.player.height,
                confidence: result.player.confidence,
            }, latestPlayerDetectionId.value)
            // Update visual tracking state for overlay
            playerTrackState.value = 'DETECTED'
            playerTrackAge.value = 0
            // Emit player detection (actual YOLO detection, not Frame Processor emission)
            onPlayerDetectionRef.current?.(result.player)
        } else {
            // Reset shared values for overlay when no player detected
            playerX.value = 0
            playerY.value = 0
            playerWidth.value = 0
            playerHeight.value = 0
            playerConfidence.value = 0
            // Update visual tracking state for overlay
            playerTrackState.value = 'LOST'
            playerTrackAge.value = 0
            // Reset PlayerCrop when no player detected
            playerCrop.update(null, latestPlayerDetectionId.value)
        }
    }, [playerX, playerY, playerWidth, playerHeight, playerConfidence, playerTrackState, playerTrackAge, latestPlayerDetectionId])


    // Initialize async YOLO worker with callback (must be after handleYoloAsyncResult)
    const yoloWorkerAsync = useYoloWorkerAsync(
        ballEnabled && TEST_CONFIG.ENABLE_ASYNC_YOLO_POC,
        yoloDelegate,
        yoloModelId,
        undefined, // yoloScheduledCount
        undefined, // perfYoloScheduleWaitTotal
        handleYoloAsyncResult
        // Profiling parameters removed - simplified for production
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

                // Single Date.now() for the entire frame (used for MoveNet throttling + FPS calculation)
                const now = Date.now()

                // FPS calculation - reset counters every second
                if (now - perfLastLogAt.value >= 1000) {
                    const elapsed = now - perfLastLogAt.value
                    const cameraFps = (perfFramesReceived.value / elapsed) * 1000
                    const yoloFps = (perfFramesProcessed.value / elapsed) * 1000

                    actualCameraFps.value = cameraFps
                    actualYoloFps.value = yoloFps
                    // MoveNet FPS cannot be calculated in worklet (telemetryLogger not worklet-safe)
                    // It remains at 0 or is updated elsewhere

                    perfLastLogAt.value = now
                    perfFramesReceived.value = 0
                    perfFramesProcessed.value = 0
                    perfFramesDroppedBusy.value = 0
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
                    const timestamp = now // Reuse single Date.now() call

                    // Call YOLO worker every frame - it handles its own throttling internally
                    if (ballEnabledShared.value) {
                        // Async YOLO: submit frame and return immediately
                        // Results are handled via onResultCallback
                        yoloWorkerAsync.submitFrame(frame, timestamp, currentFrame)
                    }

                    // Call MoveNet worker every frame - it handles its own throttling internally
                    if (poseEnabledShared.value) {
                        // Get effective bbox from PlayerCropManager for MoveNet crop
                        const trackedBbox = playerCrop.getEffectiveBbox(now)
                        
                        if (trackedBbox !== null) {
                            // Check confidence threshold
                            const confidence = trackedBbox.bbox.confidence ?? 0
                            if (confidence >= YOLO_CONFIG.PLAYER_CROP_MIN_CONFIDENCE) {
                                moveNetWorker.playerBbox.value = {
                                    x: trackedBbox.bbox.x,
                                    y: trackedBbox.bbox.y,
                                    width: trackedBbox.bbox.width,
                                    height: trackedBbox.bbox.height,
                                    confidence: trackedBbox.bbox.confidence,
                                }

                                // MoveNet throttling removed - execute every frame with valid bbox
                                moveNetWorker.processFrame(frame, timestamp)
                            }
                        }
                    }

                    // YOLO results handled exclusively by handleYoloAsyncResult() callback
                    // No SharedValue reads or copies needed in Frame Processor

                    // PlayerCrop update moved to handleYoloAsyncResult() - only when YOLO returns new player

                    // MoveNet results handled by MoveNet worker callback
                    // No SharedValue reads needed in Frame Processor



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
                isProcessingFrame,
                ballEnabledShared,
                poseEnabledShared,
                yoloWorker,
                moveNetWorker,
                emitBallDetection,
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
        moveNetFps: moveNetWorker.telemetryThroughputFps,
        currentFps: useSharedValue(selectedFps || 30),
        actualCameraFps,
        actualYoloFps,
        actualMoveNetFps: moveNetWorker.telemetryThroughputFps,
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
        },
    }
}
