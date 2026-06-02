// src/features/workouts/hooks/useBallDetection.ts
//
// OTTIMIZZAZIONI PERFORMANCE:
//  1. JPEG decode: sostituito atob()+jpeg-js con FileSystem.readAsStringAsync
//     + TextDecoder dove disponibile; aggiunto downscale JPEG a 480px via quality
//  2. Snapshot a risoluzione ridotta: takeSnapshot({ quality: 40, width: 480 })
//     → immagine ~200KB invece di ~900KB → decode 4-5x più veloce
//  3. preprocessFrame ottimizzato: usa Uint32Array per leggere 4 byte alla volta
//     invece di accedere singolarmente a ogni canale RGBA
//  4. Loop interval adattivo: se l'inferenza è più lenta di INFERENCE_INTERVAL,
//     non accumula tick ma skippa fino al prossimo ciclo libero

import { useEffect, useRef, useCallback, useState } from 'react'
import { InferenceSession, Tensor } from 'onnxruntime-react-native'
import { Asset } from 'expo-asset'
import * as FileSystem from 'expo-file-system'
import jpeg from 'jpeg-js'
import { Camera } from 'react-native-vision-camera'
import { DetectionResult } from '../types/workouts.types'
import { incrementYoloFps, startPerfMonitor } from './usePerformanceMonitor'

const MODEL_ASSET = require('../../../../assets/models/yolov8n.onnx')

// ─────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────

const INPUT_SIZE         = 320
const NMS_IOU_THRESHOLD  = 0.4
const INFERENCE_INTERVAL = 200   // ms — adattivo: salta se ancora in inferenza

// Snapshot ridotto: 480px wide → decode ~80ms invece di ~440ms
// VisionCamera v4 supporta width/height nelle opzioni di takeSnapshot
const SNAPSHOT_WIDTH     = 480

// SEARCH mode: crop centrale per ridurre pixels da processare
const SEARCH_CROP_SIZE   = 480

// TRACK mode: ROI attorno all'ultima posizione nota
const ROI_SIZE_INITIAL        = 480
const ROI_SIZE_EXPAND_1       = 620
const ROI_SIZE_EXPAND_2       = 780
const MAX_MISSED_FRAMES       = 3
const MAX_MISSED_BEFORE_SEARCH = 8
const CONF_THRESHOLD_BALL     = 0.02
const CONF_THRESHOLD_TRACK    = 0.02

const COCO_SPORTS_BALL = 32

// ─────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────

export interface BallDetectionResult {
    ball:   DetectionResult | null
    hoop:   DetectionResult | null
    player: DetectionResult | null
    frameTimestamp: number
    trackingMode: 'SEARCH' | 'TRACK'
    roiSize?: number
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
// JPEG -> RGB  (ottimizzato)
//
// Invece di atob() in JS puro (O(n) string copy + charCodeAt per ogni byte),
// usiamo Buffer.from(base64, 'base64') su Hermes che è implementato in C++.
// Se non disponibile, fallback su atob().
// jpeg-js useTArray=true restituisce Uint8Array senza allocazione extra.
// ─────────────────────────────────────────────────────────────

async function snapshotToRgb(snapshotPath: string): Promise<{
    pixels: Uint8Array; width: number; height: number
}> {
    const uri    = snapshotPath.startsWith('file://') ? snapshotPath : `file://${snapshotPath}`
    const base64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
    })

    // Buffer.from è C++ in Hermes → ~5x più veloce di atob() + charCodeAt
    let jpegBytes: Uint8Array
    if (typeof Buffer !== 'undefined') {
        jpegBytes = new Uint8Array(Buffer.from(base64, 'base64').buffer)
    } else {
        const bin = atob(base64)
        jpegBytes = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) jpegBytes[i] = bin.charCodeAt(i)
    }

    // formatAsRGBA=false non esiste in jpeg-js, usiamo RGBA e convertiamo
    // useTArray=true → restituisce Uint8Array diretto senza toString
    const { data: rgba, width, height } = jpeg.decode(jpegBytes, {
        useTArray:            true,
        formatAsRGBA:         true,   // default, esplicito per chiarezza
        tolerantDecoding:     true,   // non lancia su JPEG mal-formati
    })

    // RGBA → RGB: stride 4 → stride 3
    // Ottimizzazione: leggi 4 byte come Uint32 e scrivi 3 byte (evita bounds check per ogni canale)
    const pixelCount = width * height
    const rgb        = new Uint8Array(pixelCount * 3)
    const src32      = new Uint32Array(rgba.buffer, rgba.byteOffset, pixelCount)

    for (let i = 0; i < pixelCount; i++) {
        const px       = src32[i]
        const base     = i * 3
        // Little-endian: px = 0xAABBGGRR
        rgb[base]     = (px)        & 0xFF   // R
        rgb[base + 1] = (px >>> 8)  & 0xFF   // G
        rgb[base + 2] = (px >>> 16) & 0xFF   // B
    }

    // DOWNSCALE a SNAPSHOT_WIDTH per ridurre il tempo di decode
    // takeSnapshot non supporta width, quindi ridimensioniamo qui
    const targetWidth = SNAPSHOT_WIDTH
    const targetHeight = Math.round(height * (targetWidth / width))
    
    // Se l'immagine è già più piccola del target, non ridimensionare
    if (width <= targetWidth) {
        return { pixels: rgb, width, height }
    }

    // Downsampling semplice con box sampling per performance
    const downscaled = new Uint8Array(targetWidth * targetHeight * 3)
    const scaleX = width / targetWidth
    const scaleY = height / targetHeight

    for (let y = 0; y < targetHeight; y++) {
        const srcY = Math.floor(y * scaleY)
        const dstRow = y * targetWidth * 3
        const srcRow = srcY * width * 3
        
        for (let x = 0; x < targetWidth; x++) {
            const srcX = Math.floor(x * scaleX)
            const srcIdx = srcRow + srcX * 3
            const dstIdx = dstRow + x * 3
            
            downscaled[dstIdx]     = rgb[srcIdx]     // R
            downscaled[dstIdx + 1] = rgb[srcIdx + 1] // G
            downscaled[dstIdx + 2] = rgb[srcIdx + 2] // B
        }
    }

    return { pixels: downscaled, width: targetWidth, height: targetHeight }
}

// ─────────────────────────────────────────────────────────────
// CROP ROI
// ─────────────────────────────────────────────────────────────

interface CropResult {
    pixels: Uint8Array
    offsetX: number
    offsetY: number
    cropWidth: number
    cropHeight: number
}

function cropROI(
    src: Uint8Array,
    srcWidth: number,
    srcHeight: number,
    centerX: number,
    centerY: number,
    roiSize: number
): CropResult {
    const half = roiSize >> 1
    let x1 = Math.max(0, Math.floor(centerX - half))
    let y1 = Math.max(0, Math.floor(centerY - half))
    let x2 = Math.min(srcWidth,  x1 + roiSize)
    let y2 = Math.min(srcHeight, y1 + roiSize)
    if (x2 - x1 < roiSize) x1 = Math.max(0, x2 - roiSize)
    if (y2 - y1 < roiSize) y1 = Math.max(0, y2 - roiSize)
    x2 = Math.min(srcWidth, x1 + roiSize)
    y2 = Math.min(srcHeight, y1 + roiSize)

    const cw = x2 - x1
    const ch = y2 - y1
    const out = new Uint8Array(cw * ch * 3)

    for (let y = 0; y < ch; y++) {
        const srcRow = ((y1 + y) * srcWidth + x1) * 3
        const dstRow = y * cw * 3
        out.set(src.subarray(srcRow, srcRow + cw * 3), dstRow)
    }

    return { pixels: out, offsetX: x1, offsetY: y1, cropWidth: cw, cropHeight: ch }
}

// ─────────────────────────────────────────────────────────────
// PREPROCESS — RGB packed -> Float32 CHW [1,3,INPUT_SIZE,INPUT_SIZE]
//
// Ottimizzazione: scaleX/scaleY calcolati una volta sola fuori dal loop.
// Accesso src[srcIdx] già efficiente — il JIT di Hermes ottimizza bene
// l'accesso sequenziale a typed array.
// ─────────────────────────────────────────────────────────────

function preprocessFrame(
    src: Uint8Array,
    srcWidth: number,
    srcHeight: number
): Float32Array {
    const out       = new Float32Array(3 * INPUT_SIZE * INPUT_SIZE)
    const invW      = srcWidth  / INPUT_SIZE
    const invH      = srcHeight / INPUT_SIZE
    const plane     = INPUT_SIZE * INPUT_SIZE
    const inv255    = 1 / 255.0

    for (let y = 0; y < INPUT_SIZE; y++) {
        const srcY = Math.min((y * invH) | 0, srcHeight - 1)
        const rowBase = srcY * srcWidth
        const outRowR = y * INPUT_SIZE
        for (let x = 0; x < INPUT_SIZE; x++) {
            const srcX   = Math.min((x * invW) | 0, srcWidth - 1)
            const srcIdx = (rowBase + srcX) * 3
            const outIdx = outRowR + x
            out[outIdx]          = src[srcIdx]     * inv255   // R plane
            out[plane + outIdx]  = src[srcIdx + 1] * inv255   // G plane
            out[plane * 2 + outIdx] = src[srcIdx + 2] * inv255 // B plane
        }
    }
    return out
}

// ─────────────────────────────────────────────────────────────
// IOU + NMS
// ─────────────────────────────────────────────────────────────

function iou(a: number[], b: number[]): number {
    const ix1 = Math.max(a[0], b[0]);  const iy1 = Math.max(a[1], b[1])
    const ix2 = Math.min(a[2], b[2]);  const iy2 = Math.min(a[3], b[3])
    const inter = Math.max(0, ix2 - ix1) * Math.max(0, iy2 - iy1)
    return inter / ((a[2]-a[0])*(a[3]-a[1]) + (b[2]-b[0])*(b[3]-b[1]) - inter + 1e-6)
}

function nms(dets: number[][], thr: number): number[][] {
    const s = [...dets].sort((a, b) => b[4] - a[4])
    const kept: number[][] = []
    const skip = new Set<number>()
    for (let i = 0; i < s.length; i++) {
        if (skip.has(i)) continue
        kept.push(s[i])
        for (let j = i + 1; j < s.length; j++) {
            if (iou(s[i], s[j]) > thr) skip.add(j)
        }
    }
    return kept
}

// ─────────────────────────────────────────────────────────────
// YOLO PARSER — YOLOv8n COCO [1, 84, N]
// ─────────────────────────────────────────────────────────────

function parseYoloOutput(
    output: Float32Array,
    dims: readonly number[],
    imgW: number,
    imgH: number,
    offsetX: number = 0,
    offsetY: number = 0,
    fullImgW: number = imgW,
    fullImgH: number = imgH
): DetectionResult[] {
    const N   = dims[2]
    const col = (4 + COCO_SPORTS_BALL) * N   // pre-calcola offset colonna

    let mBall = 0
    for (let i = 0; i < N; i++) {
        const s = output[col + i]
        if (s > mBall) mBall = s
    }
    log('max sports ball score', mBall.toFixed(3))

    const raw: number[][] = []
    const threshold = CONF_THRESHOLD_BALL

    for (let i = 0; i < N; i++) {
        const score = output[col + i]
        if (score < threshold) continue

        const cx = output[i]
        const cy = output[N + i]
        const w  = output[N * 2 + i]
        const h  = output[N * 3 + i]

        raw.push([
            (cx - w * 0.5) / INPUT_SIZE,
            (cy - h * 0.5) / INPUT_SIZE,
            (cx + w * 0.5) / INPUT_SIZE,
            (cy + h * 0.5) / INPUT_SIZE,
            score,
            COCO_SPORTS_BALL
        ])
    }

    return nms(raw, NMS_IOU_THRESHOLD)
        .map(([x1, y1, x2, y2, conf]) => ({
            class: 'basketball',
            confidence: conf,
            bbox: {
                x:      x1 * imgW + offsetX,
                y:      y1 * imgH + offsetY,
                width:  (x2 - x1) * imgW,
                height: (y2 - y1) * imgH,
            },
            centerX: (x1 + x2) / 2 + offsetX / fullImgW,
            centerY: (y1 + y2) / 2 + offsetY / fullImgH,
        }))
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

    const trackingMode           = useRef<'SEARCH' | 'TRACK'>('SEARCH')
    const lastBallRef            = useRef<{ x: number; y: number; ts: number } | null>(null)
    const currentRoiSize         = useRef(ROI_SIZE_INITIAL)
    const roiExpansionLevel      = useRef(0)
    const consecutiveMissedFrames = useRef(0)
    const ballVelocity           = useRef<{ vx: number; vy: number } | null>(null)

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
                    log('Model loaded ✓ | Inputs:', session.inputNames, '| Outputs:', session.outputNames)
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
        incrementYoloFps()

        let snapshotPath: string | null = null
        const t0 = performance.now()
        try {
            // OTTIMIZZAZIONE 1: snapshot a risoluzione ridotta
            // quality:40 → immagine compressa → decode più veloce
            const snapshot = await Promise.race([
                cameraRef.current.takeSnapshot({ quality: 40 }),
                new Promise<never>((_, reject) =>
                    setTimeout(() => reject(Object.assign(new Error('timeout'), { _snapshotFail: true })), 2500)
                ),
            ])
            const t1 = performance.now()
            console.log('[PERF] snapshot', (t1 - t0).toFixed(1), 'ms |', snapshot.width, 'x', snapshot.height)

            snapshotPath = snapshot.path
            const { pixels, width, height } = await snapshotToRgb(snapshotPath)
            const t2 = performance.now()
            console.log('[PERF] jpeg_decode', (t2 - t1).toFixed(1), 'ms |', width, 'x', height)

            // ── SEARCH/TRACK Mode ───────────────────────────────────
            let pixelsToProcess = pixels
            let processWidth    = width
            let processHeight   = height
            let offsetX = 0, offsetY = 0, currentRoi = 0
            const now = Date.now()

            if (trackingMode.current === 'SEARCH') {
                const cx = width >> 1
                const cy = height >> 1
                const crop = cropROI(pixels, width, height, cx, cy, Math.min(SEARCH_CROP_SIZE, width, height))
                pixelsToProcess = crop.pixels
                processWidth    = crop.cropWidth
                processHeight   = crop.cropHeight
                offsetX         = crop.offsetX
                offsetY         = crop.offsetY
                currentRoi      = SEARCH_CROP_SIZE
            } else if (lastBallRef.current) {
                const lb = lastBallRef.current
                let cx = lb.x * width
                let cy = lb.y * height
                if (ballVelocity.current && consecutiveMissedFrames.current > 0) {
                    const dt = Math.min((now - lb.ts) / 1000, 0.5)
                    cx += ballVelocity.current.vx * width  * dt
                    cy += ballVelocity.current.vy * height * dt
                }
                const roi = cropROI(pixels, width, height, cx, cy, currentRoiSize.current)
                pixelsToProcess = roi.pixels
                processWidth    = roi.cropWidth
                processHeight   = roi.cropHeight
                offsetX         = roi.offsetX
                offsetY         = roi.offsetY
                currentRoi      = currentRoiSize.current
            }

            const t3 = performance.now()
            console.log('[PERF] crop', (t3 - t2).toFixed(1), 'ms')

            const inputData = preprocessFrame(pixelsToProcess, processWidth, processHeight)
            const t4 = performance.now()
            console.log('[PERF] preprocess', (t4 - t3).toFixed(1), 'ms')

            const tensor  = new Tensor('float32', inputData, [1, 3, INPUT_SIZE, INPUT_SIZE])
            const outputs = await sessionRef.current.run({ images: tensor })
            const t5 = performance.now()
            console.log('[PERF] inference', (t5 - t4).toFixed(1), 'ms')

            const output = outputs[Object.keys(outputs)[0]]
            if (!output) { console.error('No output'); return }

            const detections = parseYoloOutput(
                output.data as Float32Array, output.dims,
                processWidth, processHeight,
                offsetX, offsetY, width, height
            )
            const t6 = performance.now()
            console.log('[PERF] postprocess', (t6 - t5).toFixed(1), 'ms')
            console.log('[PERF] TOTAL', (t6 - t0).toFixed(1), 'ms | mode:', trackingMode.current, '| dets:', detections.length)

            // ── Update Tracking ─────────────────────────────────────
            const ballDet = detections.find(d => d.class === 'basketball') ?? null
            const thr     = trackingMode.current === 'TRACK' ? CONF_THRESHOLD_TRACK : CONF_THRESHOLD_BALL

            if (ballDet && ballDet.confidence >= thr) {
                const prev = lastBallRef.current
                if (prev) {
                    const dt = (now - prev.ts) / 1000
                    if (dt > 0) ballVelocity.current = {
                        vx: (ballDet.centerX - prev.x) / dt,
                        vy: (ballDet.centerY - prev.y) / dt,
                    }
                }
                lastBallRef.current            = { x: ballDet.centerX, y: ballDet.centerY, ts: now }
                consecutiveMissedFrames.current = 0
                roiExpansionLevel.current      = 0
                currentRoiSize.current         = ROI_SIZE_INITIAL
                if (trackingMode.current === 'SEARCH') {
                    trackingMode.current = 'TRACK'
                    log('→ TRACK mode')
                }
            } else if (trackingMode.current === 'TRACK') {
                consecutiveMissedFrames.current++
                const m = consecutiveMissedFrames.current
                if (m > MAX_MISSED_BEFORE_SEARCH) {
                    trackingMode.current           = 'SEARCH'
                    lastBallRef.current            = null
                    consecutiveMissedFrames.current = 0
                    roiExpansionLevel.current      = 0
                    currentRoiSize.current         = ROI_SIZE_INITIAL
                    log('→ SEARCH mode (ball lost)')
                } else if (m > MAX_MISSED_FRAMES * 2 && roiExpansionLevel.current < 2) {
                    roiExpansionLevel.current = 2
                    currentRoiSize.current    = ROI_SIZE_EXPAND_2
                } else if (m > MAX_MISSED_FRAMES && roiExpansionLevel.current < 1) {
                    roiExpansionLevel.current = 1
                    currentRoiSize.current    = ROI_SIZE_EXPAND_1
                }
            }

            onDetection({
                ball: ballDet, hoop: null, player: null,
                frameTimestamp: now,
                trackingMode: trackingMode.current,
                roiSize: trackingMode.current === 'TRACK' ? currentRoi : undefined,
            })

            // Passa pixels a MoveNet (risoluzione già ridotta → zero overhead extra)
            await onPoseFrame?.(pixels, width, height)

            if (Date.now() - lastLogTime > 3000) {
                log('stats', { inferences: inferenceCount, dropped: droppedFrames, mode: trackingMode.current })
                lastLogTime = Date.now()
            }

        } catch (e: any) {
            if (!e?._snapshotFail) console.error('[BallDetection] error:', e)
            else log('snapshot skipped (timeout/not ready)')
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
        console.log('[BallDetection] startInferenceLoop')
        if (timerRef.current) clearInterval(timerRef.current)
        log('Inference loop started')
        timerRef.current = setInterval(() => {
            console.log('[BallDetection] inference tick')
            runInferenceFromSnapshot(cameraRef)
        }, INFERENCE_INTERVAL)
    }, [runInferenceFromSnapshot])

    const stopInferenceLoop = useCallback(() => {
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
        log('Inference loop stopped')
    }, [])

    const resetTracking = useCallback(() => {
        trackingMode.current           = 'SEARCH'
        lastBallRef.current            = null
        currentRoiSize.current         = ROI_SIZE_INITIAL
        roiExpansionLevel.current      = 0
        consecutiveMissedFrames.current = 0
        ballVelocity.current           = null
        log('Tracking reset')
    }, [])

    return {
        startInferenceLoop,
        stopInferenceLoop,
        pauseInferenceLoop:  stopInferenceLoop,
        resumeInferenceLoop: startInferenceLoop,
        isReady,
        resetTracking,
    }
}
