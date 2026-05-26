// src/features/workouts/hooks/useBallDetection.ts

import { useEffect, useRef, useCallback } from 'react'
import { useSharedValue, runOnJS } from 'react-native-reanimated'
import { useFrameProcessor, Frame } from 'react-native-vision-camera'
import { InferenceSession, Tensor } from 'onnxruntime-react-native'
import { Asset } from 'expo-asset'

import { DetectionResult } from '../types/workouts.types'

const MODEL_ASSET = require('../../../../assets/models/ball_detection.onnx')

const CONF_THRESHOLD = 0.45
const NMS_IOU_THRESHOLD = 0.4
const INPUT_SIZE = 320

const CLASSES = ['basketball', 'hoop', 'player'] as const

function iou(a: number[], b: number[]): number {
    const [ax1, ay1, ax2, ay2] = a
    const [bx1, by1, bx2, by2] = b

    const interX1 = Math.max(ax1, bx1)
    const interY1 = Math.max(ay1, by1)
    const interX2 = Math.min(ax2, bx2)
    const interY2 = Math.min(ay2, by2)

    const interArea =
        Math.max(0, interX2 - interX1) *
        Math.max(0, interY2 - interY1)

    const aArea = (ax2 - ax1) * (ay2 - ay1)
    const bArea = (bx2 - bx1) * (by2 - by1)

    return interArea / (aArea + bArea - interArea + 1e-6)
}

function nms(detections: number[][], iouThresh: number): number[][] {
    const sorted = [...detections].sort((a, b) => b[4] - a[4])

    const kept: number[][] = []
    const suppressed = new Set<number>()

    for (let i = 0; i < sorted.length; i++) {
        if (suppressed.has(i)) continue

        kept.push(sorted[i])

        for (let j = i + 1; j < sorted.length; j++) {
            if (iou(sorted[i], sorted[j]) > iouThresh) {
                suppressed.add(j)
            }
        }
    }

    return kept
}

function parseYoloOutput(
    output: Float32Array,
    numDetections: number,
    imgW: number,
    imgH: number
): DetectionResult[] {
    const rawDets: number[][] = []

    for (let i = 0; i < numDetections; i++) {
        const offset = i * 6

        const cx = output[offset + 0]
        const cy = output[offset + 1]
        const w = output[offset + 2]
        const h = output[offset + 3]
        const conf = output[offset + 4]
        const cls = Math.round(output[offset + 5])

        if (conf < CONF_THRESHOLD) continue

        const x1 = (cx - w / 2) / INPUT_SIZE
        const y1 = (cy - h / 2) / INPUT_SIZE
        const x2 = (cx + w / 2) / INPUT_SIZE
        const y2 = (cy + h / 2) / INPUT_SIZE

        rawDets.push([x1, y1, x2, y2, conf, cls])
    }

    const afterNMS = nms(rawDets, NMS_IOU_THRESHOLD)

    return afterNMS.map(([x1, y1, x2, y2, conf, cls]): DetectionResult => ({
        class: CLASSES[cls] ?? 'basketball',
        confidence: conf,
        bbox: {
            x: x1 * imgW,
            y: y1 * imgH,
            width: (x2 - x1) * imgW,
            height: (y2 - y1) * imgH,
        },
        centerX: (x1 + x2) / 2,
        centerY: (y1 + y2) / 2,
    }))
}

export interface BallDetectionResult {
    ball: DetectionResult | null
    hoop: DetectionResult | null
    player: DetectionResult | null
    frameTimestamp: number
}

export const useBallDetection = (
    onDetection: (result: BallDetectionResult) => void
) => {
    const sessionRef = useRef<InferenceSession | null>(null)

    const frameSkip = useSharedValue(0)

    const isInferring = useRef(false)

    const SKIP_FRAMES = 2

    useEffect(() => {
        let mounted = true

        const loadModel = async () => {
            try {
                const asset = Asset.fromModule(MODEL_ASSET)

                await asset.downloadAsync()

                console.log(
                    '[BallDetection] asset.localUri:',
                    asset.localUri
                )

                console.log(
                    '[BallDetection] asset.uri:',
                    asset.uri
                )

                if (!asset.localUri) {
                    throw new Error('Model localUri is null')
                }

                // ONNX Runtime Android vuole path filesystem puro
                const modelPath =
                    asset.localUri.replace('file://', '')

                console.log(
                    '[BallDetection] FINAL MODEL PATH:',
                    modelPath
                )

                const session = await InferenceSession.create(
                    modelPath,
                    {
                        executionProviders: ['cpu'],
                        graphOptimizationLevel: 'all',
                    }
                )

                if (mounted) {
                    sessionRef.current = session

                    console.log(
                        '[BallDetection] Modello ONNX caricato'
                    )
                }
            } catch (e) {
                console.error(
                    '[BallDetection] Errore caricamento modello:',
                    e
                )
            }
        }

        loadModel()

        return () => {
            mounted = false
        }
    }, [])

    const handleDetection = useCallback(onDetection, [])

    const runInference = useCallback(async (
        width: number,
        height: number,
        ts: number
    ) => {
        if (!sessionRef.current || isInferring.current) {
            return
        }

        isInferring.current = true

        try {
            // TODO:
            // sostituire con preprocessing reale del frame camera
            const inputData =
                new Float32Array(
                    1 * 3 * INPUT_SIZE * INPUT_SIZE
                )

            const inputTensor = new Tensor(
                'float32',
                inputData,
                [1, 3, INPUT_SIZE, INPUT_SIZE]
            )

            const feeds = {
                images: inputTensor,
            }

            const outputMap =
                await sessionRef.current.run(feeds)

            const outputTensor = outputMap['output0']

            const outputData =
                outputTensor.data as Float32Array

            const numDetections = outputTensor.dims[1]

            const detections = parseYoloOutput(
                outputData,
                numDetections,
                width,
                height
            )

            const result: BallDetectionResult = {
                ball:
                    detections.find(
                        d => d.class === 'basketball'
                    ) ?? null,

                hoop:
                    detections.find(
                        d => d.class === 'hoop'
                    ) ?? null,

                player:
                    detections.find(
                        d => d.class === 'player'
                    ) ?? null,

                frameTimestamp: ts,
            }

            handleDetection(result)
        } catch (e) {
            console.error(
                '[BallDetection] Inference error:',
                e
            )
        } finally {
            isInferring.current = false
        }
    }, [handleDetection])

    const frameProcessor = useFrameProcessor(
        (frame: Frame) => {
            'worklet'

            frameSkip.value =
                (frameSkip.value + 1) %
                (SKIP_FRAMES + 1)

            if (frameSkip.value !== 0) {
                return
            }

            const width = frame.width
            const height = frame.height
            const ts = frame.timestamp

            runOnJS(runInference)(
                width,
                height,
                ts
            )
        },
        []
    )

    const isReady =
        sessionRef.current !== null

    return {
        frameProcessor,
        isReady,
    }
}