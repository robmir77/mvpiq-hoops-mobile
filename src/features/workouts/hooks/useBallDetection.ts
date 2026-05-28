// src/features/workouts/hooks/useBallDetection.ts
//
// Architettura snapshot-based:
//  - Nessun frame processor (ArrayBuffer non attraversa il boundary worklet→JS)
//  - startInferenceLoop(cameraRef) avvia un timer che chiama takeSnapshot() ogni ~250ms
//  - Il JPEG viene decodificato con jpeg-js → pixel RGB → ONNX inference
//  - I risultati (soli numeri) vengono passati all'overlay tramite onDetection callback

import { useEffect, useRef, useCallback, useState } from 'react'
import { InferenceSession, Tensor } from 'onnxruntime-react-native'
import { Asset } from 'expo-asset'
import * as FileSystem from 'expo-file-system'
import jpeg from 'jpeg-js'
import { Camera } from 'react-native-vision-camera'
import { DetectionResult } from '../types/workouts.types'

const MODEL_ASSET = require('../../../../assets/models/ball_detection.onnx')

const INPUT_SIZE           = 640
const CONF_THRESHOLD_BALL   = 0.35   // modello fine-tunato → score alti
const CONF_THRESHOLD_HOOP   = 0.35
const CONF_THRESHOLD_PERSON = 0.35
const NMS_IOU_THRESHOLD    = 0.4
const INFERENCE_INTERVAL   = 250   // ms tra uno snapshot e il prossimo (~4 fps)

// ─── Classi del modello fine-tunato basketball ────────────────────────────────
// "Basketball Players" - Roboflow Universe (YOLOv8n)
// Classi: 0=Ball, 1=Hoop, 2=Player  (verificare con session.inputNames al primo run)
// Se l'ordine è diverso verrà loggato e corretto
const CLASS_BALL   = 0
const CLASS_HOOP   = 1
const CLASS_PLAYER = 2
const NUM_CLASSES  = 3
const NUM_DETECTIONS = 8400   // colonne output [1, 4+NUM_CLASSES, 8400]

// ─── Exported result type ─────────────────────────────────────────────────────
export interface BallDetectionResult {
    ball:   DetectionResult | null
    hoop:   DetectionResult | null   // sempre null — hoop dalla calibrazione
    player: DetectionResult | null
    frameTimestamp: number
}

// ─── Debug ────────────────────────────────────────────────────────────────────
const DEBUG = true
let inferenceCount = 0
let droppedFrames  = 0
let lastLogTime    = Date.now()
function log(...args: any[]) { if (DEBUG) console.log('[BallDetection]', ...args) }

// ─── Preprocessing ────────────────────────────────────────────────────────────
// Input:  Uint8Array pixel RGB packed (3 byte/pixel) dal JPEG decodificato
// Output: Float32Array [1, 3, INPUT_SIZE, INPUT_SIZE] CHW normalizzato 0-1
function preprocessFrame(src: Uint8Array, srcWidth: number, srcHeight: number): Float32Array {
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

// ─── IOU ──────────────────────────────────────────────────────────────────────
function iou(a: number[], b: number[]): number {
    const [ax1, ay1, ax2, ay2] = a
    const [bx1, by1, bx2, by2] = b
    const interX1   = Math.max(ax1, bx1);  const interY1 = Math.max(ay1, by1)
    const interX2   = Math.min(ax2, bx2);  const interY2 = Math.min(ay2, by2)
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

// ─── YOLOv8 output decoder ────────────────────────────────────────────────────
// Output shape: [1, 84, 8400] — layout column-major: feature f, detection i → data[f*8400+i]
function parseYoloOutput(output: Float32Array, imgW: number, imgH: number): DetectionResult[] {
    const N = NUM_DETECTIONS
    const raw: number[][] = []

    for (let i = 0; i < N; i++) {
        const cx = output[0 * N + i];  const cy = output[1 * N + i]
        const w  = output[2 * N + i];  const h  = output[3 * N + i]
        const scoreBall   = output[(4 + CLASS_BALL)   * N + i]
        const scoreHoop   = output[(4 + CLASS_HOOP)   * N + i]
        const scorePlayer = output[(4 + CLASS_PLAYER) * N + i]

        let bestScore = 0, bestClass = -1
        if (scoreBall >= CONF_THRESHOLD_BALL && scoreBall >= scoreHoop && scoreBall >= scorePlayer) {
            bestScore = scoreBall;   bestClass = CLASS_BALL
        } else if (scoreHoop >= CONF_THRESHOLD_HOOP && scoreHoop >= scorePlayer) {
            bestScore = scoreHoop;   bestClass = CLASS_HOOP
        } else if (scorePlayer >= CONF_THRESHOLD_PERSON) {
            bestScore = scorePlayer; bestClass = CLASS_PLAYER
        }
        if (bestClass === -1) continue

        const x1 = (cx - w / 2) / INPUT_SIZE;  const y1 = (cy - h / 2) / INPUT_SIZE
        const x2 = (cx + w / 2) / INPUT_SIZE;  const y2 = (cy + h / 2) / INPUT_SIZE
        raw.push([x1, y1, x2, y2, bestScore, bestClass])
    }

    return nms(raw, NMS_IOU_THRESHOLD)
        .filter(([x1, y1, x2, y2, conf, cls]) => {
            // Filtra bbox troppo grandi: una palla non occupa mai >25% del frame
            const bboxW = x2 - x1
            const bboxH = y2 - y1
            if (cls === COCO_SPORTS_BALL && (bboxW > 0.25 || bboxH > 0.25)) return false
            return true
        })
        .map(([x1, y1, x2, y2, conf, cls]) => ({
            class: cls === CLASS_BALL ? 'basketball' : cls === CLASS_HOOP ? 'hoop' : 'player',
            confidence: conf,
            bbox: { x: x1*imgW, y: y1*imgH, width: (x2-x1)*imgW, height: (y2-y1)*imgH },
            centerX: (x1 + x2) / 2,
            centerY: (y1 + y2) / 2,
        }))
}

// ─── Decode JPEG snapshot → RGB Uint8Array ────────────────────────────────────
async function snapshotToRgb(snapshotPath: string): Promise<{
    pixels: Uint8Array; width: number; height: number
}> {
    const uri    = snapshotPath.startsWith('file://') ? snapshotPath : `file://${snapshotPath}`
    const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 })

    // Converti base64 → Uint8Array
    const binaryStr = atob(base64)
    const jpegBytes = new Uint8Array(binaryStr.length)
    for (let i = 0; i < binaryStr.length; i++) jpegBytes[i] = binaryStr.charCodeAt(i)

    // Decodifica JPEG → RGBA
    const { data: rgba, width, height } = jpeg.decode(jpegBytes, { useTArray: true })

    // RGBA → RGB (rimuovi canale alpha)
    const rgb = new Uint8Array(width * height * 3)
    for (let i = 0; i < width * height; i++) {
        rgb[i * 3]     = rgba[i * 4]
        rgb[i * 3 + 1] = rgba[i * 4 + 1]
        rgb[i * 3 + 2] = rgba[i * 4 + 2]
    }
    return { pixels: rgb, width, height }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────
export const useBallDetection = (
    onDetection: (r: BallDetectionResult) => void,
    // Callback per pose: riceve gli stessi pixel RGB già decodificati
    onPoseFrame?: (pixels: Uint8Array, width: number, height: number) => Promise<void>
) => {
    const sessionRef  = useRef<InferenceSession | null>(null)
    const isInferring = useRef(false)
    const timerRef    = useRef<ReturnType<typeof setInterval> | null>(null)
    const [isReady, setIsReady] = useState(false)

    // ── Caricamento modello ───────────────────────────────────────────────
    useEffect(() => {
        let mounted = true
        const load = async () => {
            try {
                log('Loading ONNX model...')
                const [asset]   = await Asset.loadAsync(MODEL_ASSET)
                const uri       = asset.localUri ?? asset.uri
                if (!uri) throw new Error('URI modello non disponibile')
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
                    log('Input names:', session.inputNames)
                    log('Output names:', session.outputNames)
                }
            } catch (e) { console.error('[BallDetection] model load error:', e) }
        }
        load()
        return () => { mounted = false }
    }, [])

    // ── Inference su un singolo snapshot ─────────────────────────────────
    const runInferenceFromSnapshot = useCallback(async (cameraRef: React.RefObject<Camera | null>) => {
        if (!sessionRef.current || !cameraRef.current) return
        if (isInferring.current) { droppedFrames++; return }
        isInferring.current = true
        inferenceCount++

        let snapshotPath: string | null = null
        try {
            // Timeout di 2s: se takeSnapshot si appende, skippa il frame
            const snapshot = await Promise.race([
                cameraRef.current.takeSnapshot({ quality: 80 }),
                new Promise<never>((_, reject) =>
                    setTimeout(() => reject(Object.assign(new Error('timeout'), { _snapshotFail: true })), 2000)
                ),
            ]).catch((e: any) => { throw Object.assign(e, { _snapshotFail: true }) })
            snapshotPath     = snapshot.path
            const { pixels, width, height } = await snapshotToRgb(snapshotPath)
            log('inference start', { width, height })

            const inputData  = preprocessFrame(pixels, width, height)
            const tensor     = new Tensor('float32', inputData, [1, 3, INPUT_SIZE, INPUT_SIZE])
            const out        = await sessionRef.current.run({ images: tensor })

            const outputKeys = Object.keys(out)
            log('output keys:', outputKeys)
            const output = out[outputKeys[0]]
            if (!output) { console.error('[BallDetection] nessun output'); return }

            const data       = output.data as Float32Array
            const dims       = output.dims
            log('dims:', dims)

            // Debug: max scores per le classi di interesse
            const N = NUM_DETECTIONS
            let maxBall = 0, maxHoop = 0, maxPlayer = 0
            for (let i = 0; i < N; i++) {
                const sb = data[(4 + CLASS_BALL)   * N + i]
                const sh = data[(4 + CLASS_HOOP)   * N + i]
                const sp = data[(4 + CLASS_PLAYER) * N + i]
                if (sb > maxBall)   maxBall   = sb
                if (sh > maxHoop)   maxHoop   = sh
                if (sp > maxPlayer) maxPlayer = sp
            }
            log('max scores', { ball: maxBall.toFixed(3), hoop: maxHoop.toFixed(3), player: maxPlayer.toFixed(3) })

            const detections = parseYoloOutput(data, width, height)
            log('detections:', detections.length)

            onDetection({
                ball:   detections.find(d => d.class === 'basketball') ?? null,
                hoop:   detections.find(d => d.class === 'hoop')       ?? null,
                player: detections.find(d => d.class === 'player')     ?? null,
                frameTimestamp: Date.now(),
            })

            // Passa gli stessi pixel già decodificati alla pose detection
            await onPoseFrame?.(pixels, width, height)

            const now = Date.now()
            if (now - lastLogTime > 3000) {
                log('stats', { totalInferences: inferenceCount, droppedFrames, detections: detections.length })
                lastLogTime = now
            }
        } catch (e: any) {
            // Ignora silenziosamente i fallimenti di takeSnapshot (camera session non pronta)
            if (!e?._snapshotFail) console.error('[BallDetection] inference error:', e)
            else log('snapshot skipped (camera not ready)')
        } finally {
            isInferring.current = false
            // Elimina il file snapshot per non riempire lo storage
            if (snapshotPath) {
                FileSystem.deleteAsync(
                    snapshotPath.startsWith('file://') ? snapshotPath : `file://${snapshotPath}`,
                    { idempotent: true }
                ).catch(() => {})
            }
        }
    }, [onDetection, onPoseFrame])

    // ── Loop inferenza: avvia/ferma timer ─────────────────────────────────
    const startInferenceLoop = useCallback((cameraRef: React.RefObject<Camera | null>) => {
        if (timerRef.current) clearInterval(timerRef.current)
        log('Inference loop avviato')
        timerRef.current = setInterval(() => {
            runInferenceFromSnapshot(cameraRef)
        }, INFERENCE_INTERVAL)
    }, [runInferenceFromSnapshot])

    const stopInferenceLoop = useCallback(() => {
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
        log('Inference loop fermato')
    }, [])

    return { startInferenceLoop, stopInferenceLoop, isReady }
}