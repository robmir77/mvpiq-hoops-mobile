// src/features/workouts/hooks/useBallDetection.ts
//
// YOLO11 on-device detection — ONNX Runtime React Native + VisionCamera v5 Frame Output.
//
// Pipeline per frame:
//   1. Frame RGB → resize 320×320 (bilinear)  [nel worklet]
//   2. Normalizza [0,255] → [0,1] float32      [nel worklet]
//   3. Passa Float32Array a JS via runOnJS
//   4. ONNX inference async → [1, N, 6]        [in JS]
//   5. NMS (Non-Maximum Suppression)
//   6. Pubblica risultati via callback → UI thread
//
// Classi YOLO:
//   0 = basketball
//   1 = hoop
//   2 = player

import { useEffect, useRef, useCallback } from 'react'
import { useSharedValue, runOnJS } from 'react-native-reanimated'
import { useFrameOutput, Frame } from 'react-native-vision-camera'
import { InferenceSession, Tensor } from 'onnxruntime-react-native'
import { DetectionResult } from '../types/workouts.types'

const MODEL_PATH = require('../../../../assets/models/ball_detection.onnx')

const CONF_THRESHOLD = 0.45
const NMS_IOU_THRESHOLD = 0.4
const INPUT_SIZE = 320

const CLASSES = ['basketball', 'hoop', 'player'] as const

// ─── NMS ──────────────────────────────────────────────────────────────────────
function iou(a: number[], b: number[]): number {
    const [ax1, ay1, ax2, ay2] = a
    const [bx1, by1, bx2, by2] = b
    const interX1 = Math.max(ax1, bx1)
    const interY1 = Math.max(ay1, by1)
    const interX2 = Math.min(ax2, bx2)
    const interY2 = Math.min(ay2, by2)
    const interArea = Math.max(0, interX2 - interX1) * Math.max(0, interY2 - interY1)
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
            if (iou(sorted[i], sorted[j]) > iouThresh) suppressed.add(j)
        }
    }
    return kept
}

// ─── Parse YOLO11 output ───────────────────────────────────────────────────────
function parseYoloOutput(
    output: Float32Array,
    numDetections: number,
    imgW: number,
    imgH: number
): DetectionResult[] {
    const rawDets: number[][] = []
    for (let i = 0; i < numDetections; i++) {
        const offset = i * 6
        const cx   = output[offset + 0]
        const cy   = output[offset + 1]
        const w    = output[offset + 2]
        const h    = output[offset + 3]
        const conf = output[offset + 4]
        const cls  = Math.round(output[offset + 5])
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

// ─── Preprocess ───────────────────────────────────────────────────────────────
function preprocessFrame(
    frameBytes: Uint8Array,
    frameWidth: number,
    frameHeight: number
): Float32Array {
    const input = new Float32Array(3 * INPUT_SIZE * INPUT_SIZE)
    const scaleX = frameWidth / INPUT_SIZE
    const scaleY = frameHeight / INPUT_SIZE
    for (let y = 0; y < INPUT_SIZE; y++) {
        for (let x = 0; x < INPUT_SIZE; x++) {
            const srcX = Math.min(Math.floor(x * scaleX), frameWidth - 1)
            const srcY = Math.min(Math.floor(y * scaleY), frameHeight - 1)
            const srcIdx = (srcY * frameWidth + srcX) * 3
            const pixIdx = y * INPUT_SIZE + x
            input[pixIdx]                               = frameBytes[srcIdx]     / 255.0
            input[INPUT_SIZE * INPUT_SIZE + pixIdx]     = frameBytes[srcIdx + 1] / 255.0
            input[2 * INPUT_SIZE * INPUT_SIZE + pixIdx] = frameBytes[srcIdx + 2] / 255.0
        }
    }
    return input
}

// ─── Hook principale ───────────────────────────────────────────────────────────
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
                const session = await InferenceSession.create(MODEL_PATH, {
                    executionProviders: ['cpu'],
                    graphOptimizationLevel: 'all',
                })
                if (mounted) {
                    sessionRef.current = session
                    console.log('[BallDetection] Modello ONNX caricato')
                }
            } catch (e) {
                console.error('[BallDetection] Errore caricamento modello:', e)
            }
        }
        loadModel()
        return () => { mounted = false }
    }, [])

    const handleDetection = useCallback(onDetection, [])

    const runInference = useCallback(async (
        inputData: Float32Array,
        width: number,
        height: number,
        ts: number
    ) => {
        if (!sessionRef.current || isInferring.current) return
        isInferring.current = true
        try {
            const inputTensor = new Tensor('float32', inputData, [1, 3, INPUT_SIZE, INPUT_SIZE])
            const feeds = { images: inputTensor }
            const outputMap = await sessionRef.current.run(feeds)
            const outputTensor = outputMap['output0']
            const outputData = outputTensor.data as Float32Array
            const numDetections = outputTensor.dims[1]
            const detections = parseYoloOutput(outputData, numDetections, width, height)
            const result: BallDetectionResult = {
                ball:   detections.find(d => d.class === 'basketball') ?? null,
                hoop:   detections.find(d => d.class === 'hoop')       ?? null,
                player: detections.find(d => d.class === 'player')     ?? null,
                frameTimestamp: ts,
            }
            handleDetection(result)
        } catch {
            // silenzioso
        } finally {
            isInferring.current = false
        }
    }, [handleDetection])

    const frameOutput = useFrameOutput({
        pixelFormat: 'rgb',
        onFrame(frame: Frame) {
            'worklet'
            frameSkip.value = (frameSkip.value + 1) % (SKIP_FRAMES + 1)
            if (frameSkip.value !== 0) {
                frame.dispose()
                return
            }
            const width = frame.width
            const height = frame.height
            const ts = frame.timestamp
            try {
                const arrayBuffer = frame.getPixelBuffer()
                const bytes = new Uint8Array(arrayBuffer)
                const inputData = preprocessFrame(bytes, width, height)
                runOnJS(runInference)(inputData, width, height, ts)
            } catch {
                // silenzioso
            } finally {
                frame.dispose()
            }
        },
    })

    const isReady = sessionRef.current !== null
    return { frameOutput, isReady }
}
