// src/features/workouts/hooks/useBallDetection.ts
//
// Adattato per YOLOv8 COCO standard - detection della sola palla (sports ball)
// Overlay gestito in WorkoutSessionScreen.tsx con Skia

import { useEffect, useRef, useCallback, useState } from 'react'
import { InferenceSession, Tensor } from 'onnxruntime-react-native'
import { Asset } from 'expo-asset'
import * as FileSystem from 'expo-file-system'
import jpeg from 'jpeg-js'
import { Camera } from 'react-native-vision-camera'
import { DetectionResult } from '../types/workouts.types'

// Modello YOLOv8n COCO standard - deve essere scaricato e posizionato in assets/models/
// Download: https://github.com/ultralytics/assets/releases/download/v0.0.0/yolov8n.onnx
const MODEL_ASSET = require('../../../../assets/models/yolov8n.onnx')

// ─────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────

const INPUT_SIZE         = 320   // standard YOLOv8n per migliori performance
const NMS_IOU_THRESHOLD  = 0.4
const INFERENCE_INTERVAL = 150   // ~6-7 fps per bilanciare performance

// ─────────────────────────────────────────────────────────────
// MODEL CLASSES - YOLOv8n COCO Standard
//
// Output: [1, 84, 8400] - 80 classi COCO + 4 bbox coordinates
// Classe 32 = sports ball (palla)
// ─────────────────────────────────────────────────────────────

const COCO_SPORTS_BALL = 32
const CONF_THRESHOLD_BALL = 0.02   // threshold molto basso per rilevare palla

// ─────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────

export interface BallDetectionResult {
    ball:   DetectionResult | null
    hoop:   DetectionResult | null
    player: DetectionResult | null
    frameTimestamp: number
}

// ─────────────────────────────────────────────────────────────
// DEBUG
// ─────────────────────────────────────────────────────────────

const DEBUG = true

let inferenceCount = 0
let droppedFrames  = 0
let lastLogTime    = Date.now()

function log(...args: any[]) {
    if (DEBUG) console.log('[BallDetection]', ...args)
}

// ─────────────────────────────────────────────────────────────
// PREPROCESS — RGB packed -> Float32 CHW [1,3,640,640]
// ─────────────────────────────────────────────────────────────

function preprocessFrame(
    src: Uint8Array,
    srcWidth: number,
    srcHeight: number
): Float32Array {
    const out    = new Float32Array(3 * INPUT_SIZE * INPUT_SIZE)
    const scaleX = srcWidth  / INPUT_SIZE
    const scaleY = srcHeight / INPUT_SIZE

    for (let y = 0; y < INPUT_SIZE; y++) {
        for (let x = 0; x < INPUT_SIZE; x++) {
            const srcX   = Math.min(Math.floor(x * scaleX), srcWidth  - 1)
            const srcY   = Math.min(Math.floor(y * scaleY), srcHeight - 1)
            const srcIdx = (srcY * srcWidth + srcX) * 3
            out[0 * INPUT_SIZE * INPUT_SIZE + y * INPUT_SIZE + x] = src[srcIdx]     / 255.0
            out[1 * INPUT_SIZE * INPUT_SIZE + y * INPUT_SIZE + x] = src[srcIdx + 1] / 255.0
            out[2 * INPUT_SIZE * INPUT_SIZE + y * INPUT_SIZE + x] = src[srcIdx + 2] / 255.0
        }
    }
    return out
}

// ─────────────────────────────────────────────────────────────
// IOU
// ─────────────────────────────────────────────────────────────

function iou(a: number[], b: number[]): number {
    const [ax1, ay1, ax2, ay2] = a
    const [bx1, by1, bx2, by2] = b
    const interX1   = Math.max(ax1, bx1)
    const interY1   = Math.max(ay1, by1)
    const interX2   = Math.min(ax2, bx2)
    const interY2   = Math.min(ay2, by2)
    const interArea = Math.max(0, interX2 - interX1) * Math.max(0, interY2 - interY1)
    const aArea     = (ax2 - ax1) * (ay2 - ay1)
    const bArea     = (bx2 - bx1) * (by2 - by1)
    return interArea / (aArea + bArea - interArea + 1e-6)
}

// ─────────────────────────────────────────────────────────────
// NMS
// ─────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────
// YOLO PARSER — YOLOv8n COCO Standard (solo sports ball)
// Output column-major: feature f, detection i → data[f * N + i]
// ─────────────────────────────────────────────────────────────

function parseYoloOutput(
    output: Float32Array,
    dims: readonly number[],
    imgW: number,
    imgH: number
): DetectionResult[] {

    const features   = dims[1]   // 84 = COCO (80 classi + 4 bbox)
    const N          = dims[2]   // 8400 per 640x640, 18900 per 960x960, ecc.

    log('YOLOv8n COCO parser', { features, N, inputSize: INPUT_SIZE })

    // Debug max score per sports ball
    let mBall = 0
    for (let i = 0; i < N; i++) {
        const sb = output[(4 + COCO_SPORTS_BALL) * N + i]
        if (sb > mBall) mBall = sb
    }
    log('max sports ball score', mBall.toFixed(3))

    const raw: number[][] = []

    for (let i = 0; i < N; i++) {
        const cx = output[0 * N + i]
        const cy = output[1 * N + i]
        const w  = output[2 * N + i]
        const h  = output[3 * N + i]

        // Rileva solo sports ball (classe 32)
        const scoreBall = output[(4 + COCO_SPORTS_BALL) * N + i]

        if (scoreBall >= CONF_THRESHOLD_BALL) {
            const x1 = (cx - w / 2) / INPUT_SIZE
            const y1 = (cy - h / 2) / INPUT_SIZE
            const x2 = (cx + w / 2) / INPUT_SIZE
            const y2 = (cy + h / 2) / INPUT_SIZE

            raw.push([x1, y1, x2, y2, scoreBall, COCO_SPORTS_BALL])
        }
    }

    return nms(raw, NMS_IOU_THRESHOLD)
        .map(([x1, y1, x2, y2, conf, cls]) => ({
            class: 'basketball',
            confidence: conf,
            bbox: {
                x:      x1 * imgW,
                y:      y1 * imgH,
                width:  (x2 - x1) * imgW,
                height: (y2 - y1) * imgH,
            },
            centerX: (x1 + x2) / 2,
            centerY: (y1 + y2) / 2,
        }))
}

// ─────────────────────────────────────────────────────────────
// JPEG -> RGB
// ─────────────────────────────────────────────────────────────

async function snapshotToRgb(snapshotPath: string): Promise<{
    pixels: Uint8Array; width: number; height: number
}> {
    const uri     = snapshotPath.startsWith('file://') ? snapshotPath : `file://${snapshotPath}`
    const base64  = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 })
    const binaryStr = atob(base64)
    const jpegBytes = new Uint8Array(binaryStr.length)
    for (let i = 0; i < binaryStr.length; i++) jpegBytes[i] = binaryStr.charCodeAt(i)

    const { data: rgba, width, height } = jpeg.decode(jpegBytes, { useTArray: true })
    const rgb = new Uint8Array(width * height * 3)
    for (let i = 0; i < width * height; i++) {
        rgb[i * 3]     = rgba[i * 4]
        rgb[i * 3 + 1] = rgba[i * 4 + 1]
        rgb[i * 3 + 2] = rgba[i * 4 + 2]
    }
    return { pixels: rgb, width, height }
}

// ─────────────────────────────────────────────────────────────
// HOOK
// ─────────────────────────────────────────────────────────────

export const useBallDetection = (
    onDetection: (r: BallDetectionResult) => void,
    onPoseFrame?: (pixels: Uint8Array, width: number, height: number) => Promise<void>
) => {
    const sessionRef  = useRef<InferenceSession | null>(null)
    const isInferring = useRef(false)
    const timerRef    = useRef<ReturnType<typeof setInterval> | null>(null)
    const [isReady, setIsReady] = useState(false)

    // ── Caricamento modello ───────────────────────────────────
    useEffect(() => {
        let mounted = true
        const load = async () => {
            try {
                log('Loading ONNX model...')
                const [asset]   = await Asset.loadAsync(MODEL_ASSET)
                const uri       = asset.localUri ?? asset.uri
                if (!uri) throw new Error('Model URI missing')
                const modelPath = uri.startsWith('file://') ? uri.slice(7) : uri
                log('Model path:', modelPath)
                const session   = await InferenceSession.create(modelPath, {
                    executionProviders: ['cpu'],
                    graphOptimizationLevel: 'all',
                })
                if (mounted) {
                    sessionRef.current = session
                    setIsReady(true)
                    log('Model loaded ✓')
                    log('Inputs:',  session.inputNames)
                    log('Outputs:', session.outputNames)
                }
            } catch (e) {
                console.error('[BallDetection] model load error:', e)
            }
        }
        load()
        return () => { mounted = false }
    }, [])

    // ── Inference su snapshot ─────────────────────────────────
    const runInferenceFromSnapshot = useCallback(async (
        cameraRef: React.RefObject<Camera | null>
    ) => {
        if (!sessionRef.current || !cameraRef.current) return
        if (isInferring.current) { droppedFrames++; return }
        isInferring.current = true
        inferenceCount++

        let snapshotPath: string | null = null
        try {
            const snapshot = await Promise.race([
                cameraRef.current.takeSnapshot({ quality: 60 }),
                new Promise<never>((_, reject) =>
                    setTimeout(() => reject(Object.assign(new Error('timeout'), { _snapshotFail: true })), 2000)
                ),
            ])

            snapshotPath = snapshot.path
            const { pixels, width, height } = await snapshotToRgb(snapshotPath)
            log('snapshot', { width, height })

            const inputData = preprocessFrame(pixels, width, height)
            const tensor    = new Tensor('float32', inputData, [1, 3, INPUT_SIZE, INPUT_SIZE])
            const outputs   = await sessionRef.current.run({ images: tensor })

            const outputKeys = Object.keys(outputs)
            const output     = outputs[outputKeys[0]]
            if (!output) { console.error('No output'); return }

            log('output dims', output.dims)

            const detections = parseYoloOutput(output.data as Float32Array, output.dims, width, height)
            log('detections', detections.length)

            onDetection({
                ball:   detections.find(d => d.class === 'basketball') ?? null,
                hoop:   null,  // canestro dalla calibrazione, non dal modello
                player: null,  // non rilevato in questa versione
                frameTimestamp: Date.now(),
            })

            await onPoseFrame?.(pixels, width, height)

            const now = Date.now()
            if (now - lastLogTime > 3000) {
                log('stats', { totalInferences: inferenceCount, droppedFrames, detections: detections.length })
                lastLogTime = now
            }

        } catch (e: any) {
            if (!e?._snapshotFail) console.error('[BallDetection] inference error:', e)
            else log('snapshot skipped')
        } finally {
            isInferring.current = false
            if (snapshotPath) {
                FileSystem.deleteAsync(
                    snapshotPath.startsWith('file://') ? snapshotPath : `file://${snapshotPath}`,
                    { idempotent: true }
                ).catch(() => {})
            }
        }
    }, [onDetection, onPoseFrame])

    // ── Loop ─────────────────────────────────────────────────
    const startInferenceLoop = useCallback((cameraRef: React.RefObject<Camera | null>) => {
        if (timerRef.current) clearInterval(timerRef.current)
        log('Inference loop started')
        timerRef.current = setInterval(() => { runInferenceFromSnapshot(cameraRef) }, INFERENCE_INTERVAL)
    }, [runInferenceFromSnapshot])

    const stopInferenceLoop = useCallback(() => {
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
        log('Inference loop stopped')
    }, [])

    return { startInferenceLoop, stopInferenceLoop, isReady }
}