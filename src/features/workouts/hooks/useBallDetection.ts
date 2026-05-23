// src/features/workouts/hooks/useBallDetection.ts
//
// YOLO11 on-device detection — ONNX Runtime Web (WASM) + VisionCamera v5 Frame Output.
//
// Pipeline per frame:
//   1. Frame RGB → resize 320×320 (bilinear)  [nel worklet]
//   2. Normalizza [0,255] → [0,1] float32      [nel worklet]
//   3. ONNX inference async → [1, N, 6]        [in JS via runOnJS]
//   4. NMS (Non-Maximum Suppression)
//   5. Pubblica risultati via callback → UI thread
//
// Classi YOLO:
//   0 = basketball
//   1 = hoop
//   2 = player
//
// ⚠️  Migrato da onnxruntime-react-native → onnxruntime-web (WASM).
//     Il worklet ora fa solo preprocessing e passa Float32Array a JS via runOnJS.
//     L'inferenza è async (no runSync disponibile in ort-web).

import { useEffect, useRef, useCallback } from 'react'
import { useSharedValue, runOnJS } from 'react-native-reanimated'
import { useFrameOutput, Frame } from 'react-native-vision-camera'
import * as ort from 'onnxruntime-web'
import { Asset } from 'expo-asset'
import { DetectionResult } from '../types/workouts.types'

// Percorso modello in assets/models/
const MODEL_ASSET = require('../../../../assets/models/ball_detection.onnx')

// Soglie
const CONF_THRESHOLD = 0.45
const NMS_IOU_THRESHOLD = 0.4
const INPUT_SIZE = 320

// Classi YOLO
const CLASSES = ['basketball', 'hoop', 'player'] as const

// ─── NMS (Non-Maximum Suppression) ────────────────────────────────────────────
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

// ─── Preprocess: resize + normalize frame ─────────────────────────────────────
// pixelFormat: 'rgb' → 3 byte per pixel (R,G,B)
// Gira nel worklet: riduce il dato trasferito a JS da ~6MB a ~1.2MB (Float32Array 320×320×3)
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
            // RGB: 3 byte per pixel (nessun canale alpha)
            const srcIdx = (srcY * frameWidth + srcX) * 3

            const pixIdx = y * INPUT_SIZE + x
            input[pixIdx]                               = frameBytes[srcIdx]     / 255.0 // R
            input[INPUT_SIZE * INPUT_SIZE + pixIdx]     = frameBytes[srcIdx + 1] / 255.0 // G
            input[2 * INPUT_SIZE * INPUT_SIZE + pixIdx] = frameBytes[srcIdx + 2] / 255.0 // B
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
    // ort.InferenceSession invece di InferenceSession da onnxruntime-react-native
    const sessionRef = useRef<ort.InferenceSession | null>(null)
    const frameSkip = useSharedValue(0)
    // Previene inferenze concorrenti (run() è async — nessun runSync in ort-web)
    const isInferring = useRef(false)
    const SKIP_FRAMES = 2  // ~10fps su camera 30fps

    // ─── Carica il modello ONNX all'avvio ─────────────────────────────────────
    // Asset.fromModule → URI locale → fetch ArrayBuffer → ort.InferenceSession.create
    // (ort-web accetta ArrayBuffer direttamente, più affidabile di file:// URI)
    useEffect(() => {
        let mounted = true
        const loadModel = async () => {
            try {
                const asset = await Asset.fromModule(MODEL_ASSET).downloadAsync()
                const response = await fetch(asset.localUri!)
                const buffer = await response.arrayBuffer()
                const session = await ort.InferenceSession.create(buffer, {
                    executionProviders: ['wasm'],
                    graphOptimizationLevel: 'all',
                })
                if (mounted) {
                    sessionRef.current = session
                    console.log('[BallDetection] Modello ONNX caricato (ort-web WASM)')
                }
            } catch (e) {
                console.error('[BallDetection] Errore caricamento modello:', e)
            }
        }
        loadModel()
        return () => { mounted = false }
    }, [])

    const handleDetection = useCallback(onDetection, [])

    // ─── Inferenza async in JS (chiamata dal worklet via runOnJS) ──────────────
    // ort-web non ha runSync: l'inferenza deve essere await run()
    // isInferring evita di accodare frame mentre l'inferenza precedente è in corso
    const runInference = useCallback(async (
        inputData: Float32Array,
        width: number,
        height: number,
        ts: number
    ) => {
        if (!sessionRef.current || isInferring.current) return
        isInferring.current = true
        try {
            // new ort.Tensor invece di new Tensor da onnxruntime-react-native
            const inputTensor = new ort.Tensor('float32', inputData, [1, 3, INPUT_SIZE, INPUT_SIZE])
            const feeds = { images: inputTensor }

            // await run() invece di runSync (non disponibile in ort-web)
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
            // Silenzioso: non interrompere il flusso per un errore di inferenza
        } finally {
            isInferring.current = false
        }
    }, [handleDetection])

    // ─── VisionCamera v5: useFrameOutput ──────────────────────────────────────
    // Il worklet ora fa SOLO preprocessing (CHW float32) e passa i dati a JS.
    // L'inferenza async gira in runInference via runOnJS.
    const frameOutput = useFrameOutput({
        pixelFormat: 'rgb',
        onFrame(frame: Frame) {
            'worklet'

            // Frame skip per ridurre carico CPU
            frameSkip.value = (frameSkip.value + 1) % (SKIP_FRAMES + 1)
            if (frameSkip.value !== 0) {
                frame.dispose()
                return
            }

            const width = frame.width
            const height = frame.height
            const ts = frame.timestamp

            try {
                // Preprocessing nel worklet: riduce trasferimento dati a JS (~1.2MB vs ~6MB raw)
                const arrayBuffer = frame.getPixelBuffer()
                const bytes = new Uint8Array(arrayBuffer)
                const inputData = preprocessFrame(bytes, width, height)

                // Passa Float32Array preprocessato al thread JS per inferenza async
                runOnJS(runInference)(inputData, width, height, ts)
            } catch {
                // Silenzioso
            } finally {
                // ⚠️ OBBLIGATORIO in v5: libera il buffer GPU/CPU
                frame.dispose()
            }
        },
    })

    const isReady = sessionRef.current !== null

    return { frameOutput, isReady }
}
