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
import type {
    AndroidDelegateOption,
    IosDelegateOption,
} from './delegates'
import {
    ANDROID_DELEGATE_OPTIONS,
    DEFAULT_ANDROID_DELEGATE,
    DEFAULT_IOS_DELEGATE,
} from './delegates'

import {
    incrementYoloFps,
    incrementMoveNetFps,
} from '@/features/workouts/hooks/usePerformanceMonitor'

import { Platform } from 'react-native'
import { getYoloModel, getMoveNetModelUri } from './yoloModels'

// ─────────────────────────────────────────────────────────────────────────────
// Model input sizes
// ─────────────────────────────────────────────────────────────────────────────

const YOLO_INPUT_SIZE = 512
const DEFAULT_POSE_INPUT_SIZE = 192
const POSE_INPUT_SIZES = [192, 256]

// ─────────────────────────────────────────────────────────────────────────────
// AI throttling
// ─────────────────────────────────────────────────────────────────────────────

const YOLO_FRAME_SKIP = 1
// POSE runs only when YOLO detects a ball with sufficient confidence
const POSE_FRAME_SKIP = 1

// ─────────────────────────────────────────────────────────────────────────────
// Expected input buffer sizes
// ─────────────────────────────────────────────────────────────────────────────

const YOLO_INPUT_ELEMENTS =
    YOLO_INPUT_SIZE *
    YOLO_INPUT_SIZE *
    3

const POSE_INPUT_ELEMENTS =
    DEFAULT_POSE_INPUT_SIZE *
    DEFAULT_POSE_INPUT_SIZE *
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
    rimEnabled: boolean = false,

    yoloDelegate?: AndroidDelegateOption | IosDelegateOption | null,
    poseDelegate?: AndroidDelegateOption | IosDelegateOption | null,
    yoloModelId?: string,
    selectedResolution?: { width: number; height: number } | null,
    selectedFps?: number | null,
    selectedPoseResolution?: number
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

    // Throttle for scheduleOnRN calls - limit bridge crossings to ~16ms
    const lastRNDispatch =
        useSharedValue(0)

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


    // ─────────────────────────────────────────────────────────────────────────
    // Adaptive confidence threshold
    // ─────────────────────────────────────────────────────────────────────────

    const adaptiveThreshold =
        useSharedValue(0.015)

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
                    return [yoloDelegate]
                }
                return Platform.OS === 'android'
                    ? [DEFAULT_ANDROID_DELEGATE]
                    : [DEFAULT_IOS_DELEGATE]
            },
            [yoloDelegate]
        )

    const poseDelegates =
        useMemo(
            () => {
                if (poseDelegate !== undefined && poseDelegate !== null) {
                    return [poseDelegate]
                }
                return Platform.OS === 'android'
                    ? [DEFAULT_ANDROID_DELEGATE]
                    : [DEFAULT_IOS_DELEGATE]
            },
            [poseDelegate]
        )

    // ─────────────────────────────────────────────────────────────────────────
    // Model selection
    // ─────────────────────────────────────────────────────────────────────────

    const selectedYoloModel = useMemo(() => getYoloModel(yoloModelId), [yoloModelId])

    const yoloInputSize = selectedYoloModel?.inputSize ?? YOLO_INPUT_SIZE
    const yoloInputElements = yoloInputSize * yoloInputSize * 3

    // ─────────────────────────────────────────────────────────────────────────
    // Models
    // ─────────────────────────────────────────────────────────────────────────

    // IMPORTANT: memoize yoloModelSource so useTensorflowModel receives a
    // stable reference across renders. An unstable object (new { url } literal
    // every render) causes useTensorflowModel to tear down and reload the model
    // on every parent re-render, producing the infinite reload loop seen in logs.
    const yoloModelSource = useMemo(
        () => {
            if (!selectedYoloModel) {
                console.error('[ShotTracker] No valid YOLO model source available. selectedYoloModel:', selectedYoloModel)
                return undefined as any
            }
            return selectedYoloModel.fileUri
                ? { url: selectedYoloModel.fileUri } as any
                : selectedYoloModel.asset as any
        },
        // Re-derive only when the fileUri or asset identity actually changes.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [selectedYoloModel?.fileUri, selectedYoloModel?.asset]
    )

    const yoloModel =
        useTensorflowModel(
            yoloModelSource,
            yoloDelegates as any
        )

    // IMPORTANT: same stability requirement as yoloModelSource above.
    const moveNetUri = getMoveNetModelUri()
    const poseModelSource = useMemo(
        () => moveNetUri
            ? { url: moveNetUri } as any
            : require('../../assets/models/movenet_lightning_int8.tflite') as any,
        // Re-derive only when the URI itself changes (null → path or path change).
        [moveNetUri]
    )

    const poseModel =
        useTensorflowModel(
            poseModelSource,
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
                width: yoloInputSize,
                height: yoloInputSize,
                channelOrder:
                    'rgb' as const,
                dataType:
                    'float32' as const,
                pixelLayout:
                    'interleaved' as const,
                scaleMode:
                    'contain' as const,
            }),
            [yoloInputSize]
        )

    const poseInputSize = selectedPoseResolution ?? DEFAULT_POSE_INPUT_SIZE

    const poseResizerConfig =
        useMemo(
            () => ({
                width: poseInputSize,
                height: poseInputSize,
                channelOrder: 'rgb' as const,
                dataType: 'uint8' as const,
                pixelLayout: 'interleaved' as const,
                scaleMode: 'contain' as const,
            }),
            [poseInputSize]
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
                    // Scheduling — YOLO and POSE are mutually exclusive per frame.
                    //
                    // Running both models sequentially in the same onFrame call blocks
                    // the worklet thread for T_yolo + T_pose (~70 ms at 512 px).
                    // By giving each model its own "slot", the worst-case block per
                    // frame is max(T_yolo, T_pose) instead of their sum.
                    // POSE_FRAME_SKIP is intentionally lower than YOLO_FRAME_SKIP so
                    // the few frames where YOLO preempts POSE are quickly recovered.
                    // ────────────────────────────────────────────────────────────────

                    const runYolo =
                        yoloReady &&
                        ballEnabledShared.value &&
                        currentFrame % YOLO_FRAME_SKIP === 0

                    const runPose =
                        poseReady &&
                        poseEnabledShared.value &&
                        currentFrame % POSE_FRAME_SKIP === 0

                    // ────────────────────────────────────────────────────────────────
                    // YOLO
                    // ────────────────────────────────────────────────────────────────

                    if (runYolo) {

                        const t0 = performance.now()
                        const resized =
                            yoloResizer?.resize(
                                frame
                            )
                        const t1 = performance.now()

                        if (resized) {

                            try {

                                const t2 = performance.now()
                                const pixelBuffer =
                                    resized.getPixelBuffer()
                                const t3 = performance.now()

                                const source =
                                    new Float32Array(
                                        pixelBuffer as unknown as ArrayBufferLike
                                    )

                                if (
                                    source.length ===
                                    yoloInputElements
                                ) {
                                    // TFLite 3.x: usa buffer.slice() per input ArrayBuffer
                                    const t4 = performance.now()
                                    const inputBuffer =
                                        source.buffer.slice(
                                            source.byteOffset,
                                            source.byteOffset + source.byteLength
                                        ) as ArrayBuffer

                                    const outputs =
                                        yoloModelInstance!.runSync(
                                            [inputBuffer]
                                        )
                                    const t5 = performance.now()

                                    // TFLite 3.x: runSync restituisce ArrayBuffer[], converti a Float32Array
                                    const output =
                                        new Float32Array(
                                            outputs[0] as ArrayBufferLike
                                        )

                                    const t6 = performance.now()
                                    const {
                                        ball,
                                        rim,
                                        debug,
                                    } =
                                        parseYoloOutput(
                                            output,
                                            adaptiveThreshold.value,
                                            frameWidth,
                                            frameHeight
                                        )
                                    const t7 = performance.now()

                                    console.log(`[YOLO PERF] resize:${(t1-t0).toFixed(1)}ms getBuffer:${(t3-t2).toFixed(1)}ms slice:${(t5-t4).toFixed(1)}ms runSync:${(t5-t4).toFixed(1)}ms parse:${(t7-t6).toFixed(1)}ms total:${(t7-t0).toFixed(1)}ms`)


                                    // Throttle scheduleOnJS a 16ms per evitare instabilità del bridge
                                    const now = Date.now()
                                    if (now - lastRNDispatch.value >= 16) {
                                        lastRNDispatch.value = now
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
                                }

                            } finally {

                                resized.dispose()
                            }
                        }
                    }

                    // ────────────────────────────────────────────────────────────────
                    // MoveNet
                    // ────────────────────────────────────────────────────────────────

                    if (runPose) {

                        const t0 = performance.now()
                        const resized =
                            poseResizer?.resize(
                                frame
                            )
                        const t1 = performance.now()

                        if (resized) {

                            try {

                                const t2 = performance.now()
                                const pixelBuffer =
                                    resized.getPixelBuffer()
                                const t3 = performance.now()

                                const source =
                                    new Uint8Array(
                                        pixelBuffer as unknown as ArrayBufferLike
                                    )

                                if (
                                    source.length ===
                                    POSE_INPUT_ELEMENTS
                                ) {
                                    // TFLite 3.x: usa buffer.slice() per input ArrayBuffer
                                    const inputBuffer =
                                        source.buffer.slice(
                                            source.byteOffset,
                                            source.byteOffset + source.byteLength
                                        ) as ArrayBuffer

                                    const t4 = performance.now()
                                    const outputs =
                                        poseModelInstance!.runSync(
                                            [inputBuffer]
                                        )
                                    const t5 = performance.now()

                                    // TFLite 3.x: runSync restituisce ArrayBuffer[], converti a Float32Array
                                    const output =
                                        new Float32Array(
                                            outputs[0] as ArrayBufferLike
                                        )

                                    const pose =
                                        parseMoveNetOutput(
                                            output
                                        )

                                    const t6 = performance.now()
                                    const angles =
                                        computeJointAngles(
                                            pose
                                        )

                                    const t7 = performance.now()
                                    console.log(`[POSE PERF] resize:${(t1-t0).toFixed(1)}ms getBuffer:${(t3-t2).toFixed(1)}ms runSync:${(t5-t4).toFixed(1)}ms parse:${(t6-t5).toFixed(1)}ms angles:${(t7-t6).toFixed(1)}ms total:${(t7-t0).toFixed(1)}ms`)

                                    // Increment FPS counter immediately after pose inference
                                    scheduleOnRN(incrementMoveNetFps)

                                    // Throttle scheduleOnJS a 16ms per evitare instabilità del bridge
                                    const now = Date.now()
                                    if (now - lastRNDispatch.value >= 16) {
                                        lastRNDispatch.value = now
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

        const cameraRes = selectedResolution || { width: 1280, height: 720 }
        const cameraFps = selectedFps || 30
        console.log(
            `[ShotTracker] Camera: YUV ${cameraRes.width}x${cameraRes.height} @ ${cameraFps}fps`
        )

        console.log(
            '[ShotTracker] YOLO delegate:',
            JSON.stringify(yoloDelegates),
            '+ RGB Resizer'
        )

        console.log(
            '[ShotTracker] MoveNet delegate:',
            JSON.stringify(poseDelegates),
            '+ RGB Resizer'
        )

        console.log(
            '[ShotTracker] YOLO:',
            yoloInputSize,
            'x',
            yoloInputSize,
            '| every',
            YOLO_FRAME_SKIP,
            'frames',
            '| target FPS:',
            Math.round(1000 / (yoloInputSize * yoloInputSize / 100000))
        )

        console.log(
            '[ShotTracker] MoveNet:',
            poseInputSize,
            'x',
            poseInputSize,
            '| every',
            POSE_FRAME_SKIP,
            'frames',
            '| target FPS:',
            Math.round(1000 / (poseInputSize * poseInputSize / 100000))
        )

    }, [isModelReady, yoloDelegates, poseDelegates])

    // ─────────────────────────────────────────────────────────────────────────
    // Return
    // ─────────────────────────────────────────────────────────────────────────

    return {
        frameOutput,
        isModelReady,
        resetShotTracking,
    }
}
