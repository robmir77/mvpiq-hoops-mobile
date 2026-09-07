// src/vision/useShotTracker.ts
//
// Orchestrates ball detection, pose detection, and shot analysis.
// Both YOLO and MoveNet run entirely in the Frame Processor Worklet.
// Only processed results (BallDetection, PoseResult, ShotEvent) cross to JS.

import { useRef, useCallback, useEffect, useMemo } from 'react'
import { useFrameOutput } from 'react-native-vision-camera'
import type { Frame } from 'react-native-vision-camera'
import { useResizer } from 'react-native-vision-camera-resizer'
import { useSharedValue } from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'
import { useTensorflowModel } from 'react-native-fast-tflite'
import { parseYoloOutput } from './yoloParser'
import { parseMoveNetOutput } from './poseParser'
import { computeJointAngles } from './biomechanics'
import { ShotDetector } from './shotDetector'
import type {
    BallDetection,
    PoseResult,
    ShotEvent,
} from './types'
import {
    incrementYoloFps,
    incrementMoveNetFps,
} from '@/features/workouts/hooks/usePerformanceMonitor'
import { Platform } from 'react-native'

// ─────────────────────────────────────────────────────────────────────────────
// Model input sizes
// ─────────────────────────────────────────────────────────────────────────────

const YOLO_INPUT_SIZE = 416
const POSE_INPUT_SIZE = 192

// ─────────────────────────────────────────────────────────────────────────────
// AI throttling
// ─────────────────────────────────────────────────────────────────────────────

const YOLO_FRAME_SKIP = 10
const POSE_FRAME_SKIP = 9

// ─────────────────────────────────────────────────────────────────────────────
// Expected input buffer sizes
// ─────────────────────────────────────────────────────────────────────────────

const YOLO_INPUT_ELEMENTS =
    YOLO_INPUT_SIZE *
    YOLO_INPUT_SIZE *
    3

const POSE_INPUT_ELEMENTS =
    POSE_INPUT_SIZE *
    POSE_INPUT_SIZE *
    3

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

    yoloDelegate?: string[] | null,
    poseDelegate?: string[] | null
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

        return () => {
            console.log(
                '[ShotTracker][INSTANCE] UNMOUNT',
                instanceIdRef.current
            )
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

    // ─────────────────────────────────────────────────────────────────────────
    // Adaptive confidence threshold
    // ─────────────────────────────────────────────────────────────────────────

    const adaptiveThreshold =
        useSharedValue(0.25)

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
    // Model delegates
    //
    // Hardware-accelerated delegates:
    //   Android → GPU delegate ('android-gpu'), backed by the OpenCL/Mali
    //             libraries already declared in app.json under
    //             react-native-fast-tflite's enableAndroidGpuLibraries.
    //   iOS     → Core ML delegate ('core-ml').
    //
    // If a delegate fails to load on a given device, useTensorflowModel's
    // state flips to 'error' (see the diagnostics effects below, already
    // logging yoloModel/poseModel .error) — it does NOT automatically fall
    // back to CPU. Worth watching after this change; say the word if you
    // want an automatic CPU-fallback path added.
    // ─────────────────────────────────────────────────────────────────────────

    const yoloDelegates =
        useMemo(
            () => {
                if (yoloDelegate !== undefined && yoloDelegate !== null) {
                    return yoloDelegate
                }
                return Platform.OS === 'android'
                    ? []
                    : ['core-ml']
            },
            [yoloDelegate]
        )

    const poseDelegates =
        useMemo(
            () => {
                if (poseDelegate !== undefined && poseDelegate !== null) {
                    return poseDelegate
                }
                return Platform.OS === 'android'
                    ? []
                    : ['core-ml']
            },
            [poseDelegate]
        )

    // ─────────────────────────────────────────────────────────────────────────
    // Models
    // ─────────────────────────────────────────────────────────────────────────

    const yoloModel =
        useTensorflowModel(
            require(
                '../../assets/models/ball_rimV8_float16.tflite'
            ),
            yoloDelegates as any
        )

    const poseModel =
        useTensorflowModel(
            require(
                '../../assets/models/movenet_lightning_int8.tflite'
            ),
            poseDelegates as any
        )

    // ─────────────────────────────────────────────────────────────────────────
    // Stable model instances
    // ─────────────────────────────────────────────────────────────────────────

    const yoloModelInstance =
        yoloModel.state === 'loaded' &&
        yoloModel.model != null
            ? yoloModel.model
            : null

    const poseModelInstance =
        poseModel.state === 'loaded' &&
        poseModel.model != null
            ? poseModel.model
            : null

    // ─────────────────────────────────────────────────────────────────────────
    // Model diagnostics
    // ─────────────────────────────────────────────────────────────────────────

    useEffect(() => {

        console.log(
            '[ShotTracker] YOLO Model state changed:',
            yoloModel.state
        )

        if (
            yoloModel.state === 'loaded' &&
            yoloModel.model
        ) {

            console.log(
                '[ShotTracker] YOLO Model loaded successfully!'
            )

            console.log(
                '[ShotTracker] YOLO Inputs:',
                JSON.stringify(
                    yoloModel.model.inputs
                )
            )

            console.log(
                '[ShotTracker] YOLO Outputs:',
                JSON.stringify(
                    yoloModel.model.outputs
                )
            )
        }

        if (
            yoloModel.state === 'error'
        ) {

            console.error(
                '[ShotTracker] YOLO Model load error:',
                (yoloModel as any).error
            )
        }

    }, [yoloModel.state])

    useEffect(() => {

        console.log(
            '[ShotTracker] Pose Model state changed:',
            poseModel.state
        )

        if (
            poseModel.state === 'loaded' &&
            poseModel.model
        ) {

            console.log(
                '[ShotTracker] Pose Model loaded successfully!'
            )

            console.log(
                '[ShotTracker] Pose Inputs:',
                JSON.stringify(
                    poseModel.model.inputs
                )
            )

            console.log(
                '[ShotTracker] Pose Outputs:',
                JSON.stringify(
                    poseModel.model.outputs
                )
            )
        }

        if (
            poseModel.state === 'error'
        ) {

            console.error(
                '[ShotTracker] Pose Model load error:',
                (poseModel as any).error
            )
        }

    }, [poseModel.state])

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
                            now - d.timestamp <
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
                        0.005

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

                    console.log(
                        '[AdaptiveThreshold] Rate:',
                        detectionRate.toFixed(2),
                        'Threshold:',
                        adaptiveThreshold.value.toFixed(3)
                    )
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
            ) => {

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

                    return
                }

                const ballForTracking =
                    kalmanFilteredBall
                        ? {
                            x: kalmanFilteredBall.x,
                            y: kalmanFilteredBall.y,
                            width: ball.width,
                            height: ball.height,
                            confidence:
                            ball.confidence,
                        }
                        : ball

                shotDetector.current
                    .updateTrajectory(
                        ballForTracking
                    )

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
                    return
                }

                if (
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

                const effectiveRim =
                    detection.rim ||
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

                onBallDetection(
                    detection
                )

                handleBallDetectionForShotTracking(
                    detection
                )
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

                incrementMoveNetFps()

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
    // Resizers
    //
    // IMPORTANT: these config objects must be memoized. useResizer() uses
    // them to decide whether to recreate its native resizer, and an
    // unstable reference here was the root cause of the frame processor
    // being torn down and recreated on every render (~106 HybridWorkletQueueFactory
    // creations observed in logcat), racing on the TFLite model buffer and
    // producing "TypedArray can only be updated with an array of the same size".
    // ─────────────────────────────────────────────────────────────────────────

    const yoloResizerConfig =
        useMemo(
            () => ({
                width:
                YOLO_INPUT_SIZE,

                height:
                YOLO_INPUT_SIZE,

                channelOrder:
                    'rgb' as const,

                dataType:
                    'float32' as const,

                pixelLayout:
                    'interleaved' as const,

                scaleMode:
                    'contain' as const,
            }),
            []
        )

    const poseResizerConfig =
        useMemo(
            () => ({
                width:
                POSE_INPUT_SIZE,

                height:
                POSE_INPUT_SIZE,

                channelOrder:
                    'rgb' as const,

                dataType:
                    'uint8' as const,

                pixelLayout:
                    'interleaved' as const,

                scaleMode:
                    'contain' as const,
            }),
            []
        )

    const {
        resizer: yoloResizer,
    } = useResizer(yoloResizerConfig)

    const {
        resizer: poseResizer,
    } = useResizer(poseResizerConfig)

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
                    frame.dispose()
                    return
                }

                isProcessingFrame.value = true

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

                    const yoloReady =
                        yoloModelInstance != null

                    const poseReady =
                        poseModelInstance != null

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
                    // YOLO
                    // ────────────────────────────────────────────────────────────────

                    if (
                        yoloReady &&
                        ballEnabledShared.value &&
                        currentFrame %
                        YOLO_FRAME_SKIP ===
                        0
                    ) {

                        const resized =
                            yoloResizer?.resize(
                                frame
                            )

                        if (resized) {

                            try {

                                const arrayBuffer =
                                    resized.getPixelBuffer()

                                const source =
                                    new Float32Array(
                                        arrayBuffer
                                    )

                                if (
                                    source.length !==
                                    YOLO_INPUT_ELEMENTS
                                ) {
                                    // Buffer size mismatch - skip this frame
                                } else {

                                    // IMPORTANT:
                                    // Create a fresh TypedArray for runSync.
                                    // Use slice() to ensure complete copy, not just reference.
                                    const input =
                                        source.slice()

                                    const outputs =
                                        yoloModelInstance!.runSync(
                                            [input]
                                        )

                                    const output =
                                        outputs[0] as Float32Array

                                    const {
                                        ball,
                                        rim,
                                    } =
                                        parseYoloOutput(
                                            output,
                                            adaptiveThreshold.value,
                                            frameWidth,
                                            frameHeight
                                        )

                                    scheduleOnRN(
                                        emitBallDetection,
                                        {
                                            ball: ball
                                                ? {
                                                    x: ball.x,
                                                    y: ball.y,
                                                    width: ball.width,
                                                    height: ball.height,
                                                    confidence:
                                                    ball.confidence,
                                                }
                                                : undefined,

                                            rim: rim
                                                ? {
                                                    x: rim.x,
                                                    y: rim.y,
                                                    width: rim.width,
                                                    height: rim.height,
                                                    confidence:
                                                    rim.confidence,
                                                }
                                                : undefined,

                                            timestamp:
                                                Date.now(),
                                        }
                                    )
                                }

                            } finally {

                                resized.dispose()
                            }
                        }
                    }

                    // ────────────────────────────────────────────────────────────────
                    // MoveNet
                    // ────────────────────────────────────────────────────────────────

                    if (
                        poseReady &&
                        poseEnabledShared.value &&
                        currentFrame %
                        POSE_FRAME_SKIP ===
                        0
                    ) {

                        const resized =
                            poseResizer?.resize(
                                frame
                            )

                        if (resized) {

                            try {

                                const arrayBuffer =
                                    resized.getPixelBuffer()

                                const source =
                                    new Uint8Array(
                                        arrayBuffer
                                    )

                                if (
                                    source.length !==
                                    POSE_INPUT_ELEMENTS
                                ) {
                                    // Buffer size mismatch - skip this frame
                                } else {

                                    // IMPORTANT:
                                    // Create a fresh TypedArray for runSync.
                                    const input =
                                        new Uint8Array(
                                            POSE_INPUT_ELEMENTS
                                        )

                                    input.set(
                                        source
                                    )

                                    const outputs =
                                        poseModelInstance!.runSync(
                                            [input]
                                        )

                                    const output =
                                        outputs[0] as Float32Array

                                    const pose =
                                        parseMoveNetOutput(
                                            output
                                        )

                                    const angles =
                                        computeJointAngles(
                                            pose
                                        )

                                    scheduleOnRN(
                                        emitPoseResult,
                                        {
                                            keypoints: pose,
                                            angles,
                                            timestamp:
                                                Date.now(),
                                        }
                                    )
                                }

                            } finally {

                                resized.dispose()
                            }
                        }
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
                yoloModelInstance,
                poseModelInstance,
                yoloResizer,
                poseResizer,
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

            targetResolution: {
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
    // Model ready
    // ─────────────────────────────────────────────────────────────────────────

    const isModelReady =
        yoloModel.state === 'loaded' &&
        yoloModel.model != null &&
        poseModel.state === 'loaded' &&
        poseModel.model != null

    // ─────────────────────────────────────────────────────────────────────────
    // Pipeline ready log
    // ─────────────────────────────────────────────────────────────────────────

    useEffect(() => {

        if (!isModelReady) {
            return
        }

        console.log(
            '[ShotTracker] Stable pipeline ready:'
        )

        console.log(
            '[ShotTracker] Camera: YUV 1280x720'
        )

        console.log(
            '[ShotTracker] YOLO:',
            Platform.OS === 'android' ? 'CPU TFLite + RGB Resizer' : 'Core ML TFLite + RGB Resizer'
        )

        console.log(
            '[ShotTracker] MoveNet:',
            Platform.OS === 'android' ? 'CPU TFLite + RGB Resizer' : 'Core ML TFLite + RGB Resizer'
        )

        console.log(
            '[ShotTracker] YOLO:',
            YOLO_INPUT_SIZE,
            'x',
            YOLO_INPUT_SIZE,
            '| every',
            YOLO_FRAME_SKIP,
            'frames'
        )

        console.log(
            '[ShotTracker] MoveNet:',
            POSE_INPUT_SIZE,
            'x',
            POSE_INPUT_SIZE,
            '| every',
            POSE_FRAME_SKIP,
            'frames'
        )

    }, [isModelReady])

    // ─────────────────────────────────────────────────────────────────────────
    // Return
    // ─────────────────────────────────────────────────────────────────────────

    return {
        frameOutput,
        isModelReady,
        resetShotTracking,
    }
}