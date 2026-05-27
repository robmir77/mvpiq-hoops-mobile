// src/features/workouts/hooks/useBallDetection.ts

import { useEffect, useRef, useCallback, useState } from 'react'
import { useFrameProcessor, Frame } from 'react-native-vision-camera'
import { Worklets } from 'react-native-worklets-core'
import { InferenceSession, Tensor } from 'onnxruntime-react-native'
import { Asset } from 'expo-asset'
import { DetectionResult } from '../types/workouts.types'

const MODEL_ASSET = require('../../../../assets/models/ball_detection.onnx')

const INPUT_SIZE        = 640
const SKIP_FRAMES       = 3
const CONF_THRESHOLD    = 0.45
const NMS_IOU_THRESHOLD = 0.4

const CLASSES = ['basketball', 'hoop', 'player'] as const

// ─── Exported result type ─────────────────────────────────────────────────────
export interface BallDetectionResult {
    ball: DetectionResult | null
    hoop: DetectionResult | null
    player: DetectionResult | null
    frameTimestamp: number
}

// ─── Debug ────────────────────────────────────────────────────────────────────
const DEBUG = true
let inferenceCount  = 0
let droppedFrames   = 0
let lastLogTime     = Date.now()

function log(...args: any[]) {
    if (DEBUG) console.log('[BallDetection]', ...args)
}

// ─── IOU ──────────────────────────────────────────────────────────────────────
function iou(a: number[], b: number[]): number {
    const [ax1, ay1, ax2, ay2] = a
    const [bx1, by1, bx2, by2] = b
    const interX1  = Math.max(ax1, bx1)
    const interY1  = Math.max(ay1, by1)
    const interX2  = Math.min(ax2, bx2)
    const interY2  = Math.min(ay2, by2)
    const interArea = Math.max(0, interX2 - interX1) * Math.max(0, interY2 - interY1)
    const aArea     = (ax2 - ax1) * (ay2 - ay1)
    const bArea     = (bx2 - bx1) * (by2 - by1)
    return interArea / (aArea + bArea - interArea + 1e-6)
}

// ─── NMS ──────────────────────────────────────────────────────────────────────
function nms(detections: number[][], iouThresh: number): number[][] {
    const sorted     = [...detections].sort((a, b) => b[4] - a[4])
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

// ─── YOLO output decoder (YOLOv8/11 style [1,84,2100]) ───────────────────────
function parseYoloOutput(
    output: Float32Array,
    numDetections: number,
    imgW: number,
    imgH: number
): DetectionResult[] {
    const raw: number[][] = []

    for (let i = 0; i < numDetections; i++) {
        const o  = i * 84
        const cx = output[o];     const cy = output[o + 1]
        const w  = output[o + 2]; const h  = output[o + 3]
        const obj = output[o + 4]

        let bestClass = 0, bestScore = 0
        for (let c = 0; c < CLASSES.length; c++) {
            const score = output[o + 5 + c]
            if (score > bestScore) { bestScore = score; bestClass = c }
        }

        const conf = obj * bestScore
        if (conf < CONF_THRESHOLD) continue

        const x1 = (cx - w / 2) / INPUT_SIZE
        const y1 = (cy - h / 2) / INPUT_SIZE
        const x2 = (cx + w / 2) / INPUT_SIZE
        const y2 = (cy + h / 2) / INPUT_SIZE

        raw.push([x1, y1, x2, y2, conf, bestClass])
    }

    return nms(raw, NMS_IOU_THRESHOLD).map(([x1, y1, x2, y2, conf, cls]) => ({
        class: CLASSES[cls as number] ?? 'basketball',
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

// ─── Hook ─────────────────────────────────────────────────────────────────────
export const useBallDetection = (
    onDetection: (r: BallDetectionResult) => void,
    /** Callback opzionale per triggerare la pose inference dalla stessa worklet */
    onPoseFrame?: (width: number, height: number, ts: number) => Promise<void>
) => {
    const sessionRef   = useRef<InferenceSession | null>(null)
    const isInferring  = useRef(false)
    const frameCounter = useRef(0)
    // FIX: usa useState invece di derivare da sessionRef (che è stale al render)
    const [isReady, setIsReady] = useState(false)

    // ── Caricamento modello ───────────────────────────────────────────────
    useEffect(() => {
        let mounted = true
        const load = async () => {
            try {
                log('Loading ONNX asset...')
                const asset = Asset.fromModule(MODEL_ASSET)
                await asset.downloadAsync()
                if (!asset.localUri) throw new Error('Missing localUri')
                const modelPath = asset.localUri.replace('file://', '')
                log('MODEL PATH:', modelPath)
                const session = await InferenceSession.create(modelPath, {
                    executionProviders: ['cpu'],
                    graphOptimizationLevel: 'all',
                })
                if (mounted) {
                    sessionRef.current = session
                    setIsReady(true)           // ← FIX: aggiorna lo state React
                    log('Model loaded ✓')
                }
            } catch (e) {
                console.error('[BallDetection] model load error:', e)
            }
        }
        load()
        return () => { mounted = false }
    }, [])

    // ── Inference ─────────────────────────────────────────────────────────
    const runInference = useCallback(async (width: number, height: number, ts: number) => {
        if (!sessionRef.current) return
        if (isInferring.current) { droppedFrames++; return }
        isInferring.current = true
        inferenceCount++

        try {
            log('inference start', { width, height, ts })
            const input  = new Float32Array(1 * 3 * INPUT_SIZE * INPUT_SIZE)
            const tensor = new Tensor('float32', input, [1, 3, INPUT_SIZE, INPUT_SIZE])
            const out    = await sessionRef.current.run({ images: tensor })

            const output = out['output0']
            const data   = output.data as Float32Array
            const dims   = output.dims
            log('dims:', dims)

            const detections = parseYoloOutput(data, dims[1], width, height)
            log('detections:', detections.length)

            onDetection({
                ball:   detections.find(d => d.class === 'basketball') ?? null,
                hoop:   detections.find(d => d.class === 'hoop')       ?? null,
                player: detections.find(d => d.class === 'player')     ?? null,
                frameTimestamp: ts,
            })

            const now = Date.now()
            if (now - lastLogTime > 3000) {
                log('stats', { totalInferences: inferenceCount, droppedFrames, detections: detections.length })
                lastLogTime = now
            }
        } catch (e) {
            console.error('[BallDetection] inference error:', e)
        } finally {
            isInferring.current = false
        }
    }, [onDetection])

    const runInferenceJS = Worklets.createRunOnJS(runInference)
    // Pose trigger — si crea solo se il callback è fornito
    const runPoseOnJS = onPoseFrame ? Worklets.createRunOnJS(onPoseFrame) : null

    // ── Frame processor ────────────────────────────────────────────────────
    const frameProcessor = useFrameProcessor((frame: Frame) => {
        'worklet'
        frameCounter.current++
        if (frameCounter.current % (SKIP_FRAMES + 1) !== 0) return
        runInferenceJS(frame.width, frame.height, frame.timestamp)
        // Triggera pose detection dalla stessa worklet (stesso throttle frame)
        runPoseOnJS?.(frame.width, frame.height, frame.timestamp)
    }, [])

    return { frameProcessor, isReady }
}
