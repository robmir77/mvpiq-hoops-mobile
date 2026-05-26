// src/features/workouts/hooks/usePoseDetection.ts

import { useEffect, useRef, useCallback, useState } from 'react'
import { Asset } from 'expo-asset'
import { InferenceSession, Tensor } from 'onnxruntime-react-native'
import { PoseKeypoints } from '../types/workouts.types'

const MODEL_ASSET = require('../../../../assets/models/movenet_lightning.onnx')

const INPUT_SIZE = 192
const SCORE_THRESHOLD = 0.3
const POSE_INTERVAL_MS = 150

const KP_MAP: Record<number, keyof PoseKeypoints> = {
    5: 'leftShoulder',
    6: 'rightShoulder',
    7: 'leftElbow',
    8: 'rightElbow',
    9: 'leftWrist',
    10: 'rightWrist',
    11: 'leftHip',
    12: 'rightHip',
    13: 'leftKnee',
    14: 'rightKnee',
    15: 'leftAnkle',
    16: 'rightAnkle',
}

function preprocessForMoveNet(
    frameBytes: Uint8Array,
    frameWidth: number,
    frameHeight: number
): Float32Array {
    const input = new Float32Array(INPUT_SIZE * INPUT_SIZE * 3)

    const scaleX = frameWidth / INPUT_SIZE
    const scaleY = frameHeight / INPUT_SIZE

    for (let y = 0; y < INPUT_SIZE; y++) {
        for (let x = 0; x < INPUT_SIZE; x++) {
            const srcX = Math.min(
                Math.floor(x * scaleX),
                frameWidth - 1
            )

            const srcY = Math.min(
                Math.floor(y * scaleY),
                frameHeight - 1
            )

            const srcIdx = (srcY * frameWidth + srcX) * 4
            const outIdx = (y * INPUT_SIZE + x) * 3

            input[outIdx] =
                frameBytes[srcIdx] / 255.0

            input[outIdx + 1] =
                frameBytes[srcIdx + 1] / 255.0

            input[outIdx + 2] =
                frameBytes[srcIdx + 2] / 255.0
        }
    }

    return input
}

function parseMoveNetOutput(
    outputData: Float32Array
): PoseKeypoints {
    const keypoints: PoseKeypoints = {}

    for (let i = 0; i < 17; i++) {
        const offset = i * 3

        const yNorm = outputData[offset]
        const xNorm = outputData[offset + 1]
        const score = outputData[offset + 2]

        if (score < SCORE_THRESHOLD) {
            continue
        }

        const name = KP_MAP[i]

        if (name) {
            keypoints[name] = {
                x: xNorm,
                y: yNorm,
                score,
            }
        }
    }

    return keypoints
}

export interface JointAngles {
    elbowAngle: number
    kneeAngle: number
    shoulderAngle: number
    wristAngle: number
}

function angleBetween(
    a: { x: number; y: number },
    b: { x: number; y: number },
    c: { x: number; y: number }
): number {
    const ba = {
        x: a.x - b.x,
        y: a.y - b.y,
    }

    const bc = {
        x: c.x - b.x,
        y: c.y - b.y,
    }

    const dot =
        ba.x * bc.x +
        ba.y * bc.y

    const magBA = Math.sqrt(
        ba.x ** 2 + ba.y ** 2
    )

    const magBC = Math.sqrt(
        bc.x ** 2 + bc.y ** 2
    )

    if (magBA < 1e-6 || magBC < 1e-6) {
        return 0
    }

    const cosAngle = Math.max(
        -1,
        Math.min(1, dot / (magBA * magBC))
    )

    return Math.acos(cosAngle) * (180 / Math.PI)
}

export function computeJointAngles(
    kp: PoseKeypoints
): Partial<JointAngles> {
    const angles: Partial<JointAngles> = {}

    if (
        kp.rightShoulder &&
        kp.rightElbow &&
        kp.rightWrist
    ) {
        angles.elbowAngle = angleBetween(
            kp.rightShoulder,
            kp.rightElbow,
            kp.rightWrist
        )
    }

    if (
        kp.rightHip &&
        kp.rightKnee &&
        kp.rightAnkle
    ) {
        angles.kneeAngle = angleBetween(
            kp.rightHip,
            kp.rightKnee,
            kp.rightAnkle
        )
    }

    if (
        kp.rightElbow &&
        kp.rightShoulder &&
        kp.rightHip
    ) {
        angles.shoulderAngle = angleBetween(
            kp.rightElbow,
            kp.rightShoulder,
            kp.rightHip
        )
    }

    if (
        kp.rightElbow &&
        kp.rightWrist
    ) {
        const dx =
            kp.rightWrist.x -
            kp.rightElbow.x

        const dy =
            kp.rightWrist.y -
            kp.rightElbow.y

        angles.wristAngle =
            Math.atan2(
                Math.abs(dy),
                Math.abs(dx)
            ) *
            (180 / Math.PI)
    }

    return angles
}

export const usePoseDetection = (
    onPose: (
        keypoints: PoseKeypoints,
        angles: Partial<JointAngles>
    ) => void
) => {
    const sessionRef =
        useRef<InferenceSession | null>(null)

    const lastPoseTs = useRef(0)

    const [isReady, setIsReady] =
        useState(false)

    useEffect(() => {
        let mounted = true

        const load = async () => {
            try {
                console.log(
                    '[PoseDetection] Caricamento asset ONNX...'
                )

                const asset =
                    Asset.fromModule(MODEL_ASSET)

                await asset.downloadAsync()

                const localUri =
                    asset.localUri || asset.uri

                if (!localUri) {
                    throw new Error(
                        'localUri non disponibile'
                    )
                }

                console.log(
                    '[PoseDetection] Model path:',
                    localUri
                )

                const session =
                    await InferenceSession.create(
                        localUri,
                        {
                            executionProviders: ['cpu'],
                            graphOptimizationLevel:
                                'all',
                        }
                    )

                if (mounted) {
                    sessionRef.current = session
                    setIsReady(true)

                    console.log(
                        '[PoseDetection] MoveNet caricato'
                    )
                }
            } catch (e) {
                console.error(
                    '[PoseDetection] Errore caricamento modello:',
                    e
                )
            }
        }

        load()

        return () => {
            mounted = false
        }
    }, [])

    const handlePose = useCallback(
        onPose,
        []
    )

    const processFrameForPose =
        useCallback(
            async (
                frameBytes: Uint8Array,
                frameWidth: number,
                frameHeight: number
            ) => {
                if (!sessionRef.current) {
                    return
                }

                const now = Date.now()

                if (
                    now - lastPoseTs.current <
                    POSE_INTERVAL_MS
                ) {
                    return
                }

                lastPoseTs.current = now

                try {
                    const inputData =
                        preprocessForMoveNet(
                            frameBytes,
                            frameWidth,
                            frameHeight
                        )

                    const inputTensor =
                        new Tensor(
                            'float32',
                            inputData,
                            [
                                1,
                                INPUT_SIZE,
                                INPUT_SIZE,
                                3,
                            ]
                        )

                    const feeds = {
                        input: inputTensor,
                    }

                    const outputMap =
                        await sessionRef.current.run(
                            feeds
                        )

                    const outputTensor =
                        outputMap['output_0']

                    if (!outputTensor) {
                        console.warn(
                            '[PoseDetection] output_0 non trovato'
                        )
                        return
                    }

                    const outputData =
                        outputTensor.data as Float32Array

                    const keypoints =
                        parseMoveNetOutput(
                            outputData
                        )

                    const angles =
                        computeJointAngles(
                            keypoints
                        )

                    handlePose(
                        keypoints,
                        angles
                    )
                } catch (e) {
                    console.error(
                        '[PoseDetection] Inference error:',
                        e
                    )
                }
            },
            [handlePose]
        )

    return {
        processFrameForPose,
        isReady,
    }
}