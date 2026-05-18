// src/features/workouts/hooks/useTrackingEngine.ts
//
// Motore di tracking on-device per il Fase 1 MVP:
// - Kalman filter per smoothing posizione pallone
// - Shot detection basata su velocità e direzione
// - Calcolo traiettoria parabola
//
// La detection YOLO (fase 2) avviene nel frame processor nativo.
// Questo hook gestisce la logica stateful del tracking.

import { useRef, useCallback } from 'react'
import { TrackingState, ShotResult } from '../types/workouts.types'

interface KalmanState {
    x: number; y: number
    vx: number; vy: number
    px: number; py: number  // process noise
    mx: number; my: number  // measurement noise
}

const INITIAL_KALMAN: KalmanState = {
    x: 0, y: 0, vx: 0, vy: 0,
    px: 1, py: 1,
    mx: 2, my: 2,
}

const SHOT_VELOCITY_THRESHOLD = 5.0       // min velocità verticale ascendente
const SHOT_DIRECTION_TOWARD_HOOP = 0.6    // cos angolo verso canestro
const MIN_TRAJECTORY_FRAMES = 5           // frame minimi per analisi traiettoria

export const useTrackingEngine = () => {
    const kalman = useRef<KalmanState>({ ...INITIAL_KALMAN })
    const trajectory = useRef<Array<{ x: number; y: number; t: number }>>([])
    const state = useRef<TrackingState>({
        ballPosition: null,
        ballVelocity: null,
        hoopPosition: null,
        shotDetected: false,
        shotResult: null,
        trajectory: [],
        confidence: 0,
    })
    const lastFrameTs = useRef<number>(0)

    // Kalman filter update — 1D per X e Y indipendentemente
    const kalmanUpdate = useCallback((measX: number, measY: number): { x: number; y: number } => {
        const k = kalman.current
        const dt = 1 / 30  // 30fps

        // Predict
        const predX = k.x + k.vx * dt
        const predY = k.y + k.vy * dt

        // Gain
        const gx = k.px / (k.px + k.mx)
        const gy = k.py / (k.py + k.my)

        // Update
        k.x = predX + gx * (measX - predX)
        k.y = predY + gy * (measY - predY)
        k.vx = (k.x - predX) / dt
        k.vy = (k.y - predY) / dt
        k.px = (1 - gx) * k.px
        k.py = (1 - gy) * k.py

        return { x: k.x, y: k.y }
    }, [])

    // Aggiorna lo stato dal frame processor
    const processFrame = useCallback((
        ballDetection: { x: number; y: number; confidence: number } | null,
        hoopDetection: { x: number; y: number; confidence: number } | null,
        frameTs: number
    ): TrackingState => {
        const current = state.current

        if (ballDetection && ballDetection.confidence > 0.4) {
            const smoothed = kalmanUpdate(ballDetection.x, ballDetection.y)
            current.ballPosition = smoothed
            current.ballVelocity = { vx: kalman.current.vx, vy: kalman.current.vy }
            current.confidence = ballDetection.confidence

            // Accumula traiettoria
            trajectory.current.push({ x: smoothed.x, y: smoothed.y, t: frameTs })
            if (trajectory.current.length > 60) trajectory.current.shift()  // max 2s a 30fps
            current.trajectory = [...trajectory.current]
        }

        if (hoopDetection && hoopDetection.confidence > 0.5) {
            current.hoopPosition = { x: hoopDetection.x, y: hoopDetection.y }
        }

        // Shot detection: pallone con velocità verticale positiva (verso l'alto nello schermo = y negativa)
        if (current.ballVelocity && current.hoopPosition && current.ballPosition) {
            const vy = current.ballVelocity.vy
            const rising = vy < -SHOT_VELOCITY_THRESHOLD  // y diminuisce = verso l'alto

            if (rising && !current.shotDetected && trajectory.current.length >= MIN_TRAJECTORY_FRAMES) {
                current.shotDetected = true
                // Classifica made/miss in base alla vicinanza al canestro
                // (logica semplificata — sarà affinata con più dati)
                const dx = current.ballPosition.x - current.hoopPosition.x
                const dy = current.ballPosition.y - current.hoopPosition.y
                const dist = Math.sqrt(dx * dx + dy * dy)
                // Se il pallone è entro ~15% della larghezza del frame dal canestro → MADE (provvisorio)
                current.shotResult = dist < 0.15 ? 'MADE' : 'MISS'
            }
        }

        lastFrameTs.current = frameTs
        return { ...current }
    }, [kalmanUpdate])

    const resetShot = useCallback(() => {
        state.current.shotDetected = false
        state.current.shotResult = null
        trajectory.current = []
    }, [])

    const resetAll = useCallback(() => {
        kalman.current = { ...INITIAL_KALMAN }
        trajectory.current = []
        state.current = {
            ballPosition: null, ballVelocity: null, hoopPosition: null,
            shotDetected: false, shotResult: null, trajectory: [], confidence: 0,
        }
    }, [])

    // Calcola metriche parabola dalla traiettoria (regressione quadratica semplificata)
    const computeTrajectoryMetrics = useCallback((): {
        arcHeight: number; releaseAngle: number; smoothness: number
    } => {
        const traj = trajectory.current
        if (traj.length < MIN_TRAJECTORY_FRAMES) return { arcHeight: 0, releaseAngle: 0, smoothness: 0 }

        const minY = Math.min(...traj.map(p => p.y))
        const startY = traj[0].y
        const arcHeight = Math.max(0, startY - minY)

        // Angolo rilascio: direzione del vettore nel primo 30% della traiettoria
        const n = Math.max(2, Math.floor(traj.length * 0.3))
        const dx = traj[n].x - traj[0].x
        const dy = traj[n].y - traj[0].y
        const releaseAngle = Math.abs(Math.atan2(-dy, Math.abs(dx)) * (180 / Math.PI))

        // Smoothness: varianza delle accelerazioni
        let smoothness = 1.0
        if (traj.length >= 3) {
            const accels: number[] = []
            for (let i = 1; i < traj.length - 1; i++) {
                const ax = traj[i+1].x - 2*traj[i].x + traj[i-1].x
                const ay = traj[i+1].y - 2*traj[i].y + traj[i-1].y
                accels.push(Math.sqrt(ax*ax + ay*ay))
            }
            const mean = accels.reduce((a, b) => a + b, 0) / accels.length
            const variance = accels.reduce((s, a) => s + (a - mean) ** 2, 0) / accels.length
            smoothness = Math.max(0, Math.min(1, 1 - variance / 10))
        }

        return { arcHeight, releaseAngle, smoothness }
    }, [])

    return { processFrame, resetShot, resetAll, computeTrajectoryMetrics, getState: () => state.current }
}
