// src/features/workouts/hooks/useBallDetection.ts
//
// MIGRATO A FRAME PROCESSOR:
//  - Eliminato pipeline JPEG/Base64/jpeg-js (1600-1700ms → 20-50ms)
//  - Usa VisionCamera Frame Processor con YUV nativo
//  - YUV → RGB → Resize 320x320 → ONNX direttamente in worklet + JS thread
//
// Performance target: 20-50ms/frame invece di 1745ms/frame (~0.5 FPS → 20+ FPS)

import { useEffect, useRef, useCallback, useState } from 'react'
import { InferenceSession } from 'onnxruntime-react-native'
import { Asset } from 'expo-asset'
import { DetectionResult } from '../types/workouts.types'
import { incrementYoloFps } from './usePerformanceMonitor'
import { useFrameProcessor, FrameProcessorResult } from './useFrameProcessor'

const MODEL_ASSET = require('../../../../assets/models/yolov8n_320_int8.onnx')

// ─────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────

const INPUT_SIZE         = 320
const NMS_IOU_THRESHOLD  = 0.4
const CONF_THRESHOLD_BALL     = 0.01
const CONF_THRESHOLD_TRACK    = 0.01

const COCO_SPORTS_BALL = 32

// SEARCH mode: crop centrale per ridurre pixels da processare
const SEARCH_CROP_SIZE   = 480

// TRACK mode: ROI attorno all'ultima posizione nota
const ROI_SIZE_INITIAL        = 480
const ROI_SIZE_EXPAND_1       = 620
const ROI_SIZE_EXPAND_2       = 780
const MAX_MISSED_FRAMES       = 3
const MAX_MISSED_BEFORE_SEARCH = 8

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
let lastLogTime    = Date.now()

function log(...args: any[]) {
    if (DEBUG) console.log('[BallDetection]', ...args)
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
// HOOK - FRAME PROCESSOR VERSION
// ─────────────────────────────────────────────────────────────

export const useBallDetection = (
    onDetection: (r: BallDetectionResult) => void,
    onPoseFrame?: (pixels: Uint8Array, width: number, height: number) => Promise<void>
) => {
    const sessionRef  = useRef<InferenceSession | null>(null)
    const [isReady, setIsReady] = useState(false)
    const [frameProcessorEnabled, setFrameProcessorEnabled] = useState(false)
    const onPoseFrameRef = useRef(onPoseFrame)

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
                    executionProviders: ['nnapi', 'cpu'],
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

    // ── Update ref when callback changes ─────────────────────
    useEffect(() => {
        onPoseFrameRef.current = onPoseFrame
    }, [onPoseFrame])

    // ── Handle Frame Processor Output ───────────────────────
    const handleFrameProcessorResult = useCallback(async (result: FrameProcessorResult) => {
        const now = Date.now()
        inferenceCount++
        incrementYoloFps()

        const ballDet = result.ball
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
            roiSize: trackingMode.current === 'TRACK' ? currentRoiSize.current : undefined,
        })

        if (Date.now() - lastLogTime > 3000) {
            log('stats', { inferences: inferenceCount, mode: trackingMode.current })
            lastLogTime = Date.now()
        }
    }, [onDetection])

    // ── Frame Processor ───────────────────────────────────────
    const frameProcessor = useFrameProcessor(
        sessionRef,
        handleFrameProcessorResult,
        onPoseFrameRef.current,
        frameProcessorEnabled
    )

    // ── Control Methods ───────────────────────────────────────
    const startInferenceLoop = useCallback(() => {
        console.log('[BallDetection] Starting Frame Processor')
        setFrameProcessorEnabled(true)
        log('Frame Processor enabled')
    }, [])

    const stopInferenceLoop = useCallback(() => {
        console.log('[BallDetection] Stopping Frame Processor')
        setFrameProcessorEnabled(false)
        log('Frame Processor disabled')
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
        frameProcessor,
    }
}
