// src/features/workouts/hooks/useTrackingEngine.ts
//
// FIX #7 — Shot detection migliorata:
//   - MADE richiede palla in discesa (vy > 0) + vicinanza al canestro
//   - MISS richiede traiettoria che ha superato il picco e si allontana
//   - shotConfirmedAt: debounce per evitare doppi rilevamenti
//
// FIX #8 — getState() esposto correttamente per il loop esterno

import { useRef, useCallback } from 'react'
import { TrackingState, ShotResult } from '../types/workouts.types'

interface KalmanState {
    x: number; y: number
    vx: number; vy: number
    px: number; py: number
    mx: number; my: number
}

const INITIAL_KALMAN: KalmanState = {
    x: 0, y: 0, vx: 0, vy: 0,
    px: 1, py: 1,
    mx: 2, my: 2,
}

// Velocità verticale minima (unità normalizzate/s) per considerare un tiro in volo
const SHOT_LAUNCH_THRESHOLD = 3.0
// Raggio normalizzato entro cui la palla deve passare per essere MADE
const HOOP_RADIUS_MADE = 0.08
// La palla deve scendere (vy > 0 nello spazio schermo) per il check MADE
const DESCENDING_VY_THRESHOLD = 0.5
// Frame minimi prima di poter rilevare un tiro
const MIN_TRAJECTORY_FRAMES = 6
// ms di cooldown tra un tiro e l'altro
const SHOT_COOLDOWN_MS = 800

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
    const lastShotTs = useRef<number>(0)
    const peakY = useRef<number>(Infinity)   // minimo y = punto più alto (y cresce verso il basso)
    const inFlight = useRef<boolean>(false)  // palla è in fase di volo ascendente

    const kalmanUpdate = useCallback((measX: number, measY: number): { x: number; y: number } => {
        const k = kalman.current
        const dt = Math.max(0.01, Math.min(0.1, (Date.now() - lastFrameTs.current) / 1000))

        const predX = k.x + k.vx * dt
        const predY = k.y + k.vy * dt

        const gx = k.px / (k.px + k.mx)
        const gy = k.py / (k.py + k.my)

        k.x = predX + gx * (measX - predX)
        k.y = predY + gy * (measY - predY)
        k.vx = (k.x - predX) / dt
        k.vy = (k.y - predY) / dt
        k.px = (1 - gx) * k.px
        k.py = (1 - gy) * k.py

        return { x: k.x, y: k.y }
    }, [])

    const processFrame = useCallback((
        ballDetection: { x: number; y: number; confidence: number } | null,
        hoopDetection: { x: number; y: number; confidence: number } | null,
        frameTs: number
    ): TrackingState => {
        const current = state.current
        const now = Date.now()

        if (ballDetection && ballDetection.confidence > 0.4) {
            const smoothed = kalmanUpdate(ballDetection.x, ballDetection.y)
            current.ballPosition = smoothed
            current.ballVelocity = { vx: kalman.current.vx, vy: kalman.current.vy }
            current.confidence = ballDetection.confidence

            trajectory.current.push({ x: smoothed.x, y: smoothed.y, t: frameTs })
            if (trajectory.current.length > 90) trajectory.current.shift()
            current.trajectory = [...trajectory.current]

            // Aggiorna picco massimo (y minima = punto più alto nell'immagine)
            if (smoothed.y < peakY.current) peakY.current = smoothed.y
        }

        if (hoopDetection && hoopDetection.confidence > 0.5) {
            current.hoopPosition = { x: hoopDetection.x, y: hoopDetection.y }
        }

        // ── Shot detection migliorata ──────────────────────────────
        const vel = current.ballVelocity
        const hoop = current.hoopPosition
        const ball = current.ballPosition
        const cooldownOk = (now - lastShotTs.current) > SHOT_COOLDOWN_MS

        if (vel && hoop && ball && cooldownOk && !current.shotDetected) {
            const rising = vel.vy < -SHOT_LAUNCH_THRESHOLD  // palla che sale (y diminuisce)
            const descending = vel.vy > DESCENDING_VY_THRESHOLD  // palla che scende

            // Fase lancio: la palla inizia a salire
            if (rising && trajectory.current.length >= MIN_TRAJECTORY_FRAMES) {
                inFlight.current = true
            }

            // Fase atterraggio: la palla scende dopo essere salita
            if (inFlight.current && descending) {
                const dx = ball.x - hoop.x
                const dy = ball.y - hoop.y
                const dist = Math.sqrt(dx * dx + dy * dy)

                // MADE: scende verso il canestro e gli si avvicina abbastanza
                // MISS: scende ma passa lontano dal canestro
                const isDescendingTowardHoop = dy > 0 && dist < HOOP_RADIUS_MADE * 2

                if (isDescendingTowardHoop && dist < HOOP_RADIUS_MADE) {
                    current.shotDetected = true
                    current.shotResult = 'MADE'
                    lastShotTs.current = now
                } else if (isDescendingTowardHoop && dist >= HOOP_RADIUS_MADE) {
                    // Fuori ma puntava verso il canestro
                    current.shotDetected = true
                    current.shotResult = 'MISS'
                    lastShotTs.current = now
                } else if (descending && vel.vy > SHOT_LAUNCH_THRESHOLD * 2) {
                    // Scende velocemente lontano dal canestro = airball/miss netto
                    current.shotDetected = true
                    current.shotResult = dist < 0.25 ? 'MISS' : 'AIRBALL'
                    lastShotTs.current = now
                }
            }
        }

        lastFrameTs.current = frameTs
        return { ...current }
    }, [kalmanUpdate])

    const resetShot = useCallback(() => {
        state.current.shotDetected = false
        state.current.shotResult = null
        trajectory.current = []
        peakY.current = Infinity
        inFlight.current = false
    }, [])

    const resetAll = useCallback(() => {
        kalman.current = { ...INITIAL_KALMAN }
        trajectory.current = []
        peakY.current = Infinity
        inFlight.current = false
        lastShotTs.current = 0
        state.current = {
            ballPosition: null, ballVelocity: null, hoopPosition: null,
            shotDetected: false, shotResult: null, trajectory: [], confidence: 0,
        }
    }, [])

    // Inizializza la posizione del canestro dalla calibrazione
    // (FIX #5 — la sessione carica la calibrazione e la passa qui)
    const setHoopFromCalibration = useCallback((hoopX: number, hoopY: number) => {
        state.current.hoopPosition = { x: hoopX, y: hoopY }
    }, [])

    const computeTrajectoryMetrics = useCallback((): {
        arcHeight: number; releaseAngle: number; smoothness: number
    } => {
        const traj = trajectory.current
        if (traj.length < MIN_TRAJECTORY_FRAMES) return { arcHeight: 0, releaseAngle: 0, smoothness: 0 }

        const minY = Math.min(...traj.map(p => p.y))
        const startY = traj[0].y
        const arcHeight = Math.max(0, startY - minY)

        const n = Math.max(2, Math.floor(traj.length * 0.3))
        const dx = traj[n].x - traj[0].x
        const dy = traj[n].y - traj[0].y
        const releaseAngle = Math.abs(Math.atan2(-dy, Math.abs(dx)) * (180 / Math.PI))

        let smoothness = 1.0
        if (traj.length >= 3) {
            const accels: number[] = []
            for (let i = 1; i < traj.length - 1; i++) {
                const ax = traj[i + 1].x - 2 * traj[i].x + traj[i - 1].x
                const ay = traj[i + 1].y - 2 * traj[i].y + traj[i - 1].y
                accels.push(Math.sqrt(ax * ax + ay * ay))
            }
            const mean = accels.reduce((a, b) => a + b, 0) / accels.length
            const variance = accels.reduce((s, a) => s + (a - mean) ** 2, 0) / accels.length
            smoothness = Math.max(0, Math.min(1, 1 - variance / 10))
        }

        return { arcHeight, releaseAngle, smoothness }
    }, [])

    // FIX #8 — getState ritorna sempre una copia fresca (non stale ref)
    const getState = useCallback((): TrackingState => ({ ...state.current }), [])

    return {
        processFrame,
        resetShot,
        resetAll,
        setHoopFromCalibration,
        computeTrajectoryMetrics,
        getState,
    }
}
