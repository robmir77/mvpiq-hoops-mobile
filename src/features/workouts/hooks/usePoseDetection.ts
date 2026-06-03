// src/features/workouts/hooks/usePoseDetection.ts
//
// Riceve pixel RGB già decodificati da useBallDetection (stesso snapshot).
// Non dipende più dal frame processor — zero overhead di VisionCamera.

import { useEffect, useRef, useCallback, useState } from 'react'
import { Asset } from 'expo-asset'
import { InferenceSession, Tensor } from 'onnxruntime-react-native'
import { PoseKeypoints } from '../types/workouts.types'
import { incrementMoveNetFps } from './usePerformanceMonitor'

const MODEL_ASSET = require('../../../../assets/models/movenet_lightning.onnx')

const INPUT_SIZE       = 192
const SCORE_THRESHOLD  = 0.3
const POSE_INTERVAL_MS = 1000 // Throttle to 1 fps to prioritize YOLO

const KP_MAP: Record<number, keyof PoseKeypoints> = {
    5:  'leftShoulder',  6:  'rightShoulder',
    7:  'leftElbow',     8:  'rightElbow',
    9:  'leftWrist',     10: 'rightWrist',
    11: 'leftHip',       12: 'rightHip',
    13: 'leftKnee',      14: 'rightKnee',
    15: 'leftAnkle',     16: 'rightAnkle',
}

// ─── Preprocessing ────────────────────────────────────────────────────────────
// Input:  Uint8Array pixel RGB packed (3 byte/pixel)
// Output: Int32Array [1, INPUT_SIZE, INPUT_SIZE, 3] HWC, valori interi 0-255
// MoveNet Lightning attende int32 con valori 0-255 (non normalizzati)
function preprocessForMoveNet(src: Uint8Array, srcWidth: number, srcHeight: number): Int32Array {
    const out    = new Int32Array(INPUT_SIZE * INPUT_SIZE * 3)
    const scaleX = srcWidth  / INPUT_SIZE
    const scaleY = srcHeight / INPUT_SIZE

    for (let y = 0; y < INPUT_SIZE; y++) {
        for (let x = 0; x < INPUT_SIZE; x++) {
            const srcX   = Math.min(Math.floor(x * scaleX), srcWidth  - 1)
            const srcY   = Math.min(Math.floor(y * scaleY), srcHeight - 1)
            const srcIdx = (srcY * srcWidth + srcX) * 3
            const outIdx = (y * INPUT_SIZE + x) * 3
            out[outIdx]     = src[srcIdx]
            out[outIdx + 1] = src[srcIdx + 1]
            out[outIdx + 2] = src[srcIdx + 2]
        }
    }
    return out
}

// Preprocess from Float32Array (CHW, 0-1) to Int32Array (HWC, 0-255)
function preprocessForMoveNetFromFloat32(
    src: Float32Array,
    srcWidth: number,
    srcHeight: number
): Int32Array {
    const out = new Int32Array(INPUT_SIZE * INPUT_SIZE * 3)
    const plane = INPUT_SIZE * INPUT_SIZE
    const scaleX = srcWidth / INPUT_SIZE
    const scaleY = srcHeight / INPUT_SIZE

    for (let y = 0; y < INPUT_SIZE; y++) {
        const srcY = Math.min(Math.floor(y * scaleY), srcHeight - 1)
        for (let x = 0; x < INPUT_SIZE; x++) {
            const srcX = Math.min(Math.floor(x * scaleX), srcWidth - 1)

            // Convert CHW (YOLO format, 0-1) to HWC (MoveNet format, 0-255)
            const r = Math.min(255, Math.max(0, src[srcY * srcWidth + srcX] * 255)) | 0
            const g = Math.min(255, Math.max(0, src[plane + srcY * srcWidth + srcX] * 255)) | 0
            const b = Math.min(255, Math.max(0, src[2 * plane + srcY * srcWidth + srcX] * 255)) | 0

            const outIdx = (y * INPUT_SIZE + x) * 3
            out[outIdx]     = r
            out[outIdx + 1] = g
            out[outIdx + 2] = b
        }
    }
    return out
}

// ─── Parse output ─────────────────────────────────────────────────────────────
function parseMoveNetOutput(outputData: Float32Array): PoseKeypoints {
    const keypoints: PoseKeypoints = {}
    for (let i = 0; i < 17; i++) {
        const offset = i * 3
        const yNorm  = outputData[offset]
        const xNorm  = outputData[offset + 1]
        const score  = outputData[offset + 2]
        if (score < SCORE_THRESHOLD) continue
        const name = KP_MAP[i]
        if (name) keypoints[name] = { x: xNorm, y: yNorm, score }
    }
    return keypoints
}

// ─── Joint angles ─────────────────────────────────────────────────────────────
export interface JointAngles {
    elbowAngle:    number
    kneeAngle:     number
    shoulderAngle: number
    wristAngle:    number
}

function angleBetween(
    a: { x: number; y: number },
    b: { x: number; y: number },
    c: { x: number; y: number }
): number {
    const ba = { x: a.x - b.x, y: a.y - b.y }
    const bc = { x: c.x - b.x, y: c.y - b.y }
    const dot   = ba.x * bc.x + ba.y * bc.y
    const magBA = Math.sqrt(ba.x ** 2 + ba.y ** 2)
    const magBC = Math.sqrt(bc.x ** 2 + bc.y ** 2)
    if (magBA < 1e-6 || magBC < 1e-6) return 0
    return Math.acos(Math.max(-1, Math.min(1, dot / (magBA * magBC)))) * (180 / Math.PI)
}

export function computeJointAngles(kp: PoseKeypoints): Partial<JointAngles> {
    const angles: Partial<JointAngles> = {}
    if (kp.rightShoulder && kp.rightElbow && kp.rightWrist)
        angles.elbowAngle    = angleBetween(kp.rightShoulder, kp.rightElbow, kp.rightWrist)
    if (kp.rightHip && kp.rightKnee && kp.rightAnkle)
        angles.kneeAngle     = angleBetween(kp.rightHip, kp.rightKnee, kp.rightAnkle)
    if (kp.rightElbow && kp.rightShoulder && kp.rightHip)
        angles.shoulderAngle = angleBetween(kp.rightElbow, kp.rightShoulder, kp.rightHip)
    if (kp.rightElbow && kp.rightWrist) {
        const dx = kp.rightWrist.x - kp.rightElbow.x
        const dy = kp.rightWrist.y - kp.rightElbow.y
        angles.wristAngle    = Math.atan2(Math.abs(dy), Math.abs(dx)) * (180 / Math.PI)
    }
    return angles
}

// ─── Hook ─────────────────────────────────────────────────────────────────────
export const usePoseDetection = (
    onPose: (keypoints: PoseKeypoints, angles: Partial<JointAngles>) => void
) => {
    const sessionRef = useRef<InferenceSession | null>(null)
    const lastPoseTs = useRef(0)
    const [isReady, setIsReady] = useState(false)

    // ── Caricamento modello ───────────────────────────────────────────────
    useEffect(() => {
        let mounted = true
        const load = async () => {
            try {
                console.log('[PoseDetection] Caricamento asset ONNX...')
                const [asset]   = await Asset.loadAsync(MODEL_ASSET)
                const uri       = asset.localUri ?? asset.uri
                if (!uri) throw new Error('URI modello non disponibile')
                const modelPath = uri.startsWith('file://') ? uri.slice(7) : uri
                console.log('[PoseDetection] Model path:', modelPath)
                const session   = await InferenceSession.create(modelPath, {
                    executionProviders: ['nnapi', 'cpu'],
                    graphOptimizationLevel: 'all',
                })
                if (mounted) {
                    sessionRef.current = session
                    setIsReady(true)
                    console.log('[PoseDetection] MoveNet caricato ✓')
                }
            } catch (e) { console.error('[PoseDetection] Errore caricamento modello:', e) }
        }
        load()
        return () => { mounted = false }
    }, [])

    const handlePose = useCallback(onPose, [])

    // ── Inference principale ──────────────────────────────────────────────
    // Chiamata da useBallDetection con i pixel RGB in Float32Array (CHW, 0-1)
    const runPoseFromFrame = useCallback(async (
        pixels: Float32Array,
        width: number,
        height: number
    ) => {
        if (!sessionRef.current) return
        const now = Date.now()
        if (now - lastPoseTs.current < POSE_INTERVAL_MS) return
        lastPoseTs.current = now
        incrementMoveNetFps()

        try {
            const inputData    = preprocessForMoveNetFromFloat32(pixels, width, height)
            const inputTensor  = new Tensor('int32', inputData, [1, INPUT_SIZE, INPUT_SIZE, 3])
            const outputMap    = await sessionRef.current.run({ input: inputTensor })
            const outputKeys   = Object.keys(outputMap)
            const outputTensor = outputMap[outputKeys[0]]
            if (!outputTensor) { console.warn('[PoseDetection] nessun output'); return }
            const keypoints = parseMoveNetOutput(outputTensor.data as Float32Array)
            handlePose(keypoints, computeJointAngles(keypoints))
        } catch (e) { console.error('[PoseDetection] Inference error:', e) }
    }, [handlePose])

    // Alias per compatibilità con chiamate dirette (es. plugin esterno con Uint8Array)
    const processFrameForPose = useCallback(async (
        frameBytes: Uint8Array,
        frameWidth: number,
        frameHeight: number
    ) => {
        // Convert Uint8Array to Float32Array (0-255 -> 0-1, HWC -> CHW)
        const float32 = new Float32Array(frameBytes.length)
        const plane = frameWidth * frameHeight
        for (let i = 0; i < frameBytes.length; i++) {
            float32[i] = frameBytes[i] / 255
        }
        await runPoseFromFrame(float32, frameWidth, frameHeight)
    }, [runPoseFromFrame])

    return { runPoseFromFrame, processFrameForPose, isReady }
}
