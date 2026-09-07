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
    AndroidDelegateOption,
    IosDelegateOption,
    BallDetection,
    PoseResult,
    ShotEvent,
} from './types'

// Re-export dei delegate types.
// useCameraPipeline.ts li importa da './useShotTracker'.
export type {
    AndroidDelegateOption,
    IosDelegateOption,
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
// Hardware delegate options
//
// Android:
//   - android-gpu
//   - nnapi
//
// iOS:
//   - core-ml
//
// react-native-fast-tflite 1.6.1 accepts ONE delegate string,
// not an array of delegates.
// ─────────────────────────────────────────────────────────────────────────────

export const ANDROID_DELEGATE_OPTIONS: AndroidDelegateOption[] = [
    'android-gpu',
    'nnapi',
]

export const DEFAULT_ANDROID_DELEGATE: AndroidDelegateOption =
    'android-gpu'

export const DEFAULT_IOS_DELEGATE: IosDelegateOption =
    'core-ml'

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

    yoloDelegate?: AndroidDelegateOption | IosDelegateOption | null,
    poseDelegate?: AndroidDelegateOption | IosDelegateOption | null
) => {

    // ─────────────────────────────────────────────────────────────────────────
    // Mount-instance diagnostic
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

    const isProcessingFrame =
        useSharedValue(false)

    const hasFatalError =
        useSharedValue(false)

    const lastRNDispatch =
        useSharedValue(0)

    // ─────────────────────────────────────────────────────────────────────────
    // Fatal error recovery
    // ─────────────────────────────────────────────────────────────────────────

    const recoveryTimerRef =
        useRef<ReturnType<typeof setTimeout> | null>(null)

    const scheduleFatalErrorRecovery =
        useCallback(
            () => {

                if (recoveryTimerRef.current) {
                    clearTimeout(
                        recoveryTimerRef.current
                    )
                }

                recoveryTimerRef.current =
                    setTimeout(
                        () => {

                            hasFatalError.value =
                                false

                            console.log(
                                '[ShotTracker] Recovering from fatal error'
                            )

                        },
                        3000
                    )
            },
            []
        )

    useEffect(
        () => () => {

            if (recoveryTimerRef.current) {
                clearTimeout(
                    recoveryTimerRef.current
                )
            }

        },
        []
    )

    // ─────────────────────────────────────────────────────────────────────────
    // Enable flags
    // ─────────────────────────────────────────────────────────────────────────

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
    // IMPORTANT:
    // react-native-fast-tflite 1.6.1 accepts ONE delegate string.
    //
    // NOT:
    //   ['android-gpu']
    //
    // BUT:
    //   'android-gpu'
    // ─────────────────────────────────────────────────────────────────────────

    const yoloDelegateValue =
        useMemo(
            () => {

                if (
                    yoloDelegate !== undefined &&
                    yoloDelegate !== null
                ) {
                    return yoloDelegate
                }

                return Platform.OS === 'android'
                    ? DEFAULT_ANDROID_DELEGATE
                    : DEFAULT_IOS_DELEGATE

            },
            [yoloDelegate]
        )

    const poseDelegateValue =
        useMemo(
            () => {

                if (
                    poseDelegate !== undefined &&
                    poseDelegate !== null
                ) {
                    return poseDelegate
                }

                return Platform.OS === 'android'
                    ? DEFAULT_ANDROID_DELEGATE
                    : DEFAULT_IOS_DELEGATE

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
            yoloDelegateValue
        )

    const poseModel =
        useTensorflowModel(
            require(
                '../../assets/models/movenet_lightning_int8.tflite'
            ),
            poseDelegateValue
        )

    // ─────────────────────────────────────────────────────────────────────────
    // Model instances
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

                const now =
                    Date.now()

                detectionHistory.current.push({
                    confidence:
                        ball?.confidence ?? 0,
                    timestamp:
                        now,
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
                            d =>
                                d.confidence > 0
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
                            x:
                                kalmanFilteredBall.x,

                            y:
                                kalmanFilteredBall.y,

                            width:
                                ball.width,

                            height:
                                ball.height,

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

    // ─────────────────────────────────────────────────────────────────────────
    // Resizers
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
    } = useResizer(
        yoloResizerConfig
    )

    const {
        resizer: poseResizer,
    } = useResizer(
        poseResizerConfig
    )

    // ─────────────────────────────────────────────────────────────────────────
    // Frame processor
    //
    // IMPORTANT:
    // onFrame MUST remain stabilized with useCallback.
    // ─────────────────────────────────────────────────────────────────────────

    const onFrame =
        useCallback(
            (frame: Frame) => {

                'worklet'

                // ─────────────────────────────────────────────────────────────
                // Fatal error guard
                // ─────────────────────────────────────────────────────────────

                if (
                    hasFatalError.value
                ) {

                    frame.dispose()

                    return
                }

                // ─────────────────────────────────────────────────────────────
                // Reentrancy guard
                // ─────────────────────────────────────────────────────────────

                if (
                    isProcessingFrame.value
                ) {

                    frame.dispose()

                    return
                }

                isProcessingFrame.value =
                    true

                // ─────────────────────────────────────────────────────────────
                // Frame counter
                // ─────────────────────────────────────────────────────────────

                frameCounter.value += 1

                const currentFrame =
                    frameCounter.value

                try {

                    // ─────────────────────────────────────────────────────────
                    // Global enable
                    // ─────────────────────────────────────────────────────────

                    if (
                        !enabledShared.value
                    ) {
                        return
                    }

                    // ─────────────────────────────────────────────────────────
                    // Model readiness
                    // ─────────────────────────────────────────────────────────

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

                    // ─────────────────────────────────────────────────────────
                    // YOLO
                    // ─────────────────────────────────────────────────────────

                    if (
                        yoloReady &&
                        ballEnabledShared.value &&
                        currentFrame %
                        YOLO_FRAME_SKIP ===
                        0
                    ) {

                        console.log(
                            '[ShotTracker][YOLO] BEFORE resize',
                            currentFrame
                        )

                        const resized =
                            yoloResizer?.resize(
                                frame
                            )

                        console.log(
                            '[ShotTracker][YOLO] AFTER resize',
                            currentFrame,
                            !!resized
                        )

                        if (resized) {

                            try {

                                console.log(
                                    '[ShotTracker][YOLO] BEFORE getPixelBuffer',
                                    currentFrame
                                )

                                const pixelBuffer =
                                    resized.getPixelBuffer()

                                console.log(
                                    '[ShotTracker][YOLO] AFTER getPixelBuffer',
                                    currentFrame
                                )

                                // fast-tflite 1.6.1:
                                // runSync() expects TypedArray[]
                                //
                                // YOLO:
                                // Float32Array[416 * 416 * 3]

                                const source =
                                    new Float32Array(
                                        pixelBuffer as ArrayBuffer
                                    )

                                if (
                                    source.length ===
                                    YOLO_INPUT_ELEMENTS
                                ) {

                                    console.log(
                                        '[ShotTracker][YOLO] BEFORE runSync',
                                        currentFrame
                                    )

                                    const outputs =
                                        yoloModelInstance!.runSync(
                                            [source]
                                        )

                                    console.log(
                                        '[ShotTracker][YOLO] AFTER runSync',
                                        currentFrame,
                                        'outputs:',
                                        outputs.length
                                    )

                                    const output =
                                        outputs[0] as Float32Array

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

                                    console.log(
                                        '[ShotTracker][YOLO] PARSED',
                                        currentFrame,
                                        'ball:',
                                        !!ball,
                                        'rim:',
                                        !!rim,
                                        'maxConf:',
                                        debug?.conf?.toFixed(3),
                                        'threshold:',
                                        adaptiveThreshold.value
                                    )

                                    // Limit bridge crossings.
                                    const now =
                                        Date.now()

                                    if (
                                        now -
                                        lastRNDispatch.value >=
                                        150
                                    ) {

                                        lastRNDispatch.value =
                                            now

                                        scheduleOnRN(
                                            emitBallDetection,
                                            {
                                                ball:
                                                    ball
                                                        ? {
                                                            x:
                                                                ball.x,

                                                            y:
                                                                ball.y,

                                                            width:
                                                                ball.width,

                                                            height:
                                                                ball.height,

                                                            confidence:
                                                                ball.confidence,
                                                        }
                                                        : undefined,

                                                rim:
                                                    rim
                                                        ? {
                                                            x:
                                                                rim.x,

                                                            y:
                                                                rim.y,

                                                            width:
                                                                rim.width,

                                                            height:
                                                                rim.height,

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

                                console.log(
                                    '[ShotTracker][YOLO] BEFORE dispose',
                                    currentFrame
                                )

                                resized.dispose()

                                console.log(
                                    '[ShotTracker][YOLO] AFTER dispose',
                                    currentFrame
                                )
                            }
                        }
                    }

                    // ─────────────────────────────────────────────────────────
                    // MoveNet
                    // ─────────────────────────────────────────────────────────

                    if (
                        poseReady &&
                        poseEnabledShared.value &&
                        currentFrame %
                        POSE_FRAME_SKIP ===
                        0
                    ) {

                        console.log(
                            '[ShotTracker][POSE] BEFORE resize',
                            currentFrame
                        )

                        const resized =
                            poseResizer?.resize(
                                frame
                            )

                        console.log(
                            '[ShotTracker][POSE] AFTER resize',
                            currentFrame,
                            !!resized
                        )

                        if (resized) {

                            try {

                                console.log(
                                    '[ShotTracker][POSE] BEFORE getPixelBuffer',
                                    currentFrame
                                )

                                const pixelBuffer =
                                    resized.getPixelBuffer()

                                console.log(
                                    '[ShotTracker][POSE] AFTER getPixelBuffer',
                                    currentFrame
                                )

                                // fast-tflite 1.6.1:
                                // runSync() expects TypedArray[]
                                //
                                // MoveNet:
                                // Uint8Array[192 * 192 * 3]

                                const source =
                                    new Uint8Array(
                                        pixelBuffer as ArrayBuffer
                                    )

                                if (
                                    source.length ===
                                    POSE_INPUT_ELEMENTS
                                ) {

                                    console.log(
                                        '[ShotTracker][POSE] BEFORE runSync',
                                        currentFrame
                                    )

                                    const outputs =
                                        poseModelInstance!.runSync(
                                            [source]
                                        )

                                    console.log(
                                        '[ShotTracker][POSE] AFTER runSync',
                                        currentFrame,
                                        'outputs:',
                                        outputs.length
                                    )

                                    const output =
                                        outputs[0] as Float32Array

                                    console.log(
                                        '[ShotTracker][POSE] OUTPUT LENGTH',
                                        output.length
                                    )

                                    const pose =
                                        parseMoveNetOutput(
                                            output
                                        )

                                    console.log(
                                        '[ShotTracker][POSE] PARSED',
                                        currentFrame
                                    )

                                    const angles =
                                        computeJointAngles(
                                            pose
                                        )

                                    // Limit bridge crossings.
                                    const now =
                                        Date.now()

                                    if (
                                        now -
                                        lastRNDispatch.value >=
                                        150
                                    ) {

                                        lastRNDispatch.value =
                                            now

                                        scheduleOnRN(
                                            emitPoseResult,
                                            {
                                                keypoints:
                                                    pose,

                                                angles,

                                                timestamp:
                                                    Date.now(),
                                            }
                                        )
                                    }
                                }

                            } finally {

                                console.log(
                                    '[ShotTracker][POSE] BEFORE dispose',
                                    currentFrame
                                )

                                resized.dispose()

                                console.log(
                                    '[ShotTracker][POSE] AFTER dispose',
                                    currentFrame
                                )
                            }
                        }
                    }

                } catch (error) {

                    const errorMessage =
                        (error as any)?.message ||
                        String(error)

                    console.error(
                        '[ShotTracker][FRAME ERROR]',
                        error,
                        'message:',
                        errorMessage,
                        'stack:',
                        (error as any)?.stack
                    )

                } finally {

                    frame.dispose()

                    isProcessingFrame.value =
                        false
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

            dropFramesWhileBusy:
                true,

            onFrame,
        })

    // ─────────────────────────────────────────────────────────────────────────
    // Reset shot tracking
    // ─────────────────────────────────────────────────────────────────────────

    const resetShotTracking =
        useCallback(
            () => {

                shotDetector.current.reset()

                lastBallRef.current =
                    null

            },
            []
        )

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
            '[ShotTracker] YOLO delegate:',
            JSON.stringify(
                yoloDelegateValue
            ),
            '+ RGB Resizer'
        )

        console.log(
            '[ShotTracker] MoveNet delegate:',
            JSON.stringify(
                poseDelegateValue
            ),
            '+ RGB Resizer'
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

    }, [
        isModelReady,
        yoloDelegateValue,
        poseDelegateValue,
    ])

    // ─────────────────────────────────────────────────────────────────────────
    // Return
    // ─────────────────────────────────────────────────────────────────────────

    return {
        frameOutput,
        isModelReady,
        resetShotTracking,
    }
}
