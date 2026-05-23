// src/features/workouts/hooks/usePoseDetection.ts
//
// MoveNet Lightning on-device via ONNX Runtime Web (WASM).
// Rileva 17 keypoints del giocatore in coordinate normalizzate [0-1].
//
// Keypoints MoveNet (indici standard COCO):
//   0: nose         5: leftShoulder   6: rightShoulder
//   7: leftElbow    8: rightElbow     9: leftWrist
//  10: rightWrist  11: leftHip       12: rightHip
//  13: leftKnee    14: rightKnee     15: leftAnkle
//  16: rightAnkle
//
// Input:  [1, 192, 192, 3] float32
// Output: [1, 1, 17, 3]   (y, x, score) normalizzati [0-1]
//
// ⚠️ Gira a ~5-10fps per non sovraccaricare il device (throttle nel hook).
// ⚠️ Migrato da onnxruntime-react-native → onnxruntime-web (WASM).

import { useEffect, useRef, useCallback } from 'react'
import * as ort from 'onnxruntime-web'
import { Asset } from 'expo-asset'
import { PoseKeypoints } from '../types/workouts.types'

const MODEL_ASSET = require('../../../../assets/models/movenet_lightning.onnx')
const INPUT_SIZE = 192
const SCORE_THRESHOLD = 0.3
const POSE_INTERVAL_MS = 150  // ~6fps

// Indici MoveNet → nome keypoint
const KP_MAP: Record<number, keyof PoseKeypoints> = {
    5:  'leftShoulder',
    6:  'rightShoulder',
    7:  'leftElbow',
    8:  'rightElbow',
    9:  'leftWrist',
    10: 'rightWrist',
    11: 'leftHip',
    12: 'rightHip',
    13: 'leftKnee',
    14: 'rightKnee',
    15: 'leftAnkle',
    16: 'rightAnkle',
}

// ─── Preprocess frame → 192×192 float32 ──────────────────────────────────────
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
            const srcX = Math.min(Math.floor(x * scaleX), frameWidth - 1)
            const srcY = Math.min(Math.floor(y * scaleY), frameHeight - 1)
            const srcIdx = (srcY * frameWidth + srcX) * 4  // RGBA

            const outIdx = (y * INPUT_SIZE + x) * 3
            // MoveNet vuole int [0,255] ma usiamo float normalizzato per ONNX export
            input[outIdx]     = frameBytes[srcIdx]     / 255.0  // R
            input[outIdx + 1] = frameBytes[srcIdx + 1] / 255.0  // G
            input[outIdx + 2] = frameBytes[srcIdx + 2] / 255.0  // B
        }
    }
    return input
}

// ─── Parse output MoveNet ─────────────────────────────────────────────────────
// Output shape: [1, 1, 17, 3] → (y_norm, x_norm, score)
function parseMoveNetOutput(outputData: Float32Array): PoseKeypoints {
    const keypoints: PoseKeypoints = {}

    for (let i = 0; i < 17; i++) {
        const offset = i * 3
        const yNorm  = outputData[offset]      // y normalizzato [0-1]
        const xNorm  = outputData[offset + 1]  // x normalizzato [0-1]
        const score  = outputData[offset + 2]

        if (score < SCORE_THRESHOLD) continue

        const name = KP_MAP[i]
        if (name) {
            keypoints[name] = { x: xNorm, y: yNorm, score }
        }
    }

    return keypoints
}

// ─── Calcola angoli articolari ────────────────────────────────────────────────
export interface JointAngles {
    elbowAngle: number      // angolo gomito dominante (tiro)
    kneeAngle: number       // angolo ginocchio (caricamento)
    shoulderAngle: number   // angolo spalla (allineamento)
    wristAngle: number      // angolo polso (follow-through)
}

function angleBetween(
    a: { x: number; y: number },
    b: { x: number; y: number },  // vertice
    c: { x: number; y: number }
): number {
    const ba = { x: a.x - b.x, y: a.y - b.y }
    const bc = { x: c.x - b.x, y: c.y - b.y }
    const dot = ba.x * bc.x + ba.y * bc.y
    const magBA = Math.sqrt(ba.x ** 2 + ba.y ** 2)
    const magBC = Math.sqrt(bc.x ** 2 + bc.y ** 2)
    if (magBA < 1e-6 || magBC < 1e-6) return 0
    const cosAngle = Math.max(-1, Math.min(1, dot / (magBA * magBC)))
    return Math.acos(cosAngle) * (180 / Math.PI)
}

export function computeJointAngles(kp: PoseKeypoints): Partial<JointAngles> {
    const angles: Partial<JointAngles> = {}

    // Gomito destro (braccio di tiro dominante — assumiamo destrorso)
    if (kp.rightShoulder && kp.rightElbow && kp.rightWrist) {
        angles.elbowAngle = angleBetween(kp.rightShoulder, kp.rightElbow, kp.rightWrist)
    }

    // Ginocchio destro
    if (kp.rightHip && kp.rightKnee && kp.rightAnkle) {
        angles.kneeAngle = angleBetween(kp.rightHip, kp.rightKnee, kp.rightAnkle)
    }

    // Spalla: angolo tra gomito-spalla-anca
    if (kp.rightElbow && kp.rightShoulder && kp.rightHip) {
        angles.shoulderAngle = angleBetween(kp.rightElbow, kp.rightShoulder, kp.rightHip)
    }

    // Polso: angolo gomito-polso con orizzontale
    if (kp.rightElbow && kp.rightWrist) {
        const dx = kp.rightWrist.x - kp.rightElbow.x
        const dy = kp.rightWrist.y - kp.rightElbow.y
        angles.wristAngle = Math.atan2(Math.abs(dy), Math.abs(dx)) * (180 / Math.PI)
    }

    return angles
}

// ─── Hook principale ───────────────────────────────────────────────────────────
export const usePoseDetection = (
    onPose: (keypoints: PoseKeypoints, angles: Partial<JointAngles>) => void
) => {
    // ort.InferenceSession invece di InferenceSession da onnxruntime-react-native
    const sessionRef = useRef<ort.InferenceSession | null>(null)
    const lastPoseTs = useRef(0)

    // ─── Carica il modello ONNX all'avvio ─────────────────────────────────────
    // Asset.fromModule → URI locale → fetch ArrayBuffer → ort.InferenceSession.create
    useEffect(() => {
        let mounted = true
        const load = async () => {
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
                    console.log('[PoseDetection] MoveNet caricato (ort-web WASM)')
                }
            } catch (e) {
                console.error('[PoseDetection] Errore:', e)
            }
        }
        load()
        return () => { mounted = false }
    }, [])

    const handlePose = useCallback(onPose, [])

    // Funzione da chiamare con i dati del frame (già async in origine — nessuna modifica necessaria)
    // Chiamata da useBallDetection tramite runOnJS per evitare doppia allocazione del frame buffer
    const processFrameForPose = useCallback(async (
        frameBytes: Uint8Array,
        frameWidth: number,
        frameHeight: number
    ) => {
        if (!sessionRef.current) return
        const now = Date.now()
        if (now - lastPoseTs.current < POSE_INTERVAL_MS) return
        lastPoseTs.current = now

        try {
            const inputData = preprocessForMoveNet(frameBytes, frameWidth, frameHeight)
            // new ort.Tensor invece di new Tensor da onnxruntime-react-native
            // MoveNet input: [1, 192, 192, 3]
            const inputTensor = new ort.Tensor('float32', inputData, [1, INPUT_SIZE, INPUT_SIZE, 3])
            const feeds = { input: inputTensor }

            // await run() — identico a prima (era già async, nessuna modifica necessaria)
            const outputMap = await sessionRef.current.run(feeds)
            const outputTensor = outputMap['output_0']
            const outputData = outputTensor.data as Float32Array

            const keypoints = parseMoveNetOutput(outputData)
            const angles = computeJointAngles(keypoints)

            handlePose(keypoints, angles)
        } catch {
            // Silenzioso
        }
    }, [handlePose])

    return { processFrameForPose, isReady: sessionRef.current !== null }
}
