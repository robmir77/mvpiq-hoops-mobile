// src/features/workouts/hooks/useTrackingEngine.ts
//
// FIX #7 — Shot detection migliorata:
//   - MADE richiede palla in discesa (vy > 0) + vicinanza al canestro
//   - MISS richiede traiettoria che ha superato il picco e si allontana
//   - shotConfirmedAt: debounce per evitare doppi rilevamenti
//
// FIX #8 — getState() esposto correttamente per il loop esterno
//
// FIX #9 — Filtro palleggio migliorato:
//   - risingFrames: la palla deve salire per almeno N frame consecutivi
//   - MIN_ARC_HEIGHT: l'arco deve essere abbastanza alto da escludere balzi a terra
//   - inFlight esposto nello state per l'overlay scia

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

// ── Soglie shot detection ──────────────────────────────────────────────────
// Velocità verticale minima (unità normalizzate/s) per considerare un tiro
const SHOT_LAUNCH_THRESHOLD  = 2.5
// Raggio normalizzato entro cui la palla deve passare per MADE
const HOOP_RADIUS_MADE       = 0.08
// Soglia discesa (vy > 0 = scende a schermo)
const DESCENDING_VY_THRESHOLD = 0.5
// Frame minimi prima di poter rilevare un tiro
const MIN_TRAJECTORY_FRAMES  = 6
// ms di cooldown tra un tiro e l'altro
const SHOT_COOLDOWN_MS       = 800

// ── Filtro palleggio ───────────────────────────────────────────────────────
// Frame consecutivi in salita richiesti prima di impostare inFlight = true
const MIN_RISING_FRAMES = 4
// Altezza minima dell'arco (coordinate normalizzate) per escludere palleggio
// Un dribble tipico fa rimbalzare la palla di ~5-8% dello schermo,
// un tiro reale sale di almeno il 12-15%
const MIN_ARC_HEIGHT = 0.12

export const useTrackingEngine = () => {
    const kalman     = useRef<KalmanState>({ ...INITIAL_KALMAN })
    const trajectory = useRef<Array<{ x: number; y: number; t: number }>>([])
    const state      = useRef<TrackingState>({
        ballPosition: null,
        ballVelocity: null,
        hoopPosition: null,
        shotDetected: false,
        shotResult: null,
        trajectory: [],
        confidence: 0,
        inFlight: false,
    })
    const lastFrameTs  = useRef<number>(0)
    const lastShotTs   = useRef<number>(0)
    const peakY        = useRef<number>(Infinity)   // min y = punto più alto
    const inFlight     = useRef<boolean>(false)

    // ── Filtro palleggio ──────────────────────────────────────
    /** Numero di frame consecutivi in cui la palla è risultata in salita */
    const risingFrames  = useRef<number>(0)
    /** Y al primo frame di salita — per misurare l'arco */
    const flightStartY  = useRef<number>(1.0)

    const kalmanUpdate = useCallback((measX: number, measY: number): { x: number; y: number } => {
        const k  = kalman.current
        const dt = Math.max(0.01, Math.min(0.1, (Date.now() - lastFrameTs.current) / 1000))

        const predX = k.x + k.vx * dt
        const predY = k.y + k.vy * dt

        const gx = k.px / (k.px + k.mx)
        const gy = k.py / (k.py + k.my)

        k.x  = predX + gx * (measX - predX)
        k.y  = predY + gy * (measY - predY)
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
        const now     = Date.now()

        // Debug: verifica se hoopPosition è impostato
        if (!current.hoopPosition && !hoopDetection) {
            console.log('[TrackingEngine] No hoop position set')
        }

        if (ballDetection && ballDetection.confidence > 0.05) {
            const smoothed = kalmanUpdate(ballDetection.x, ballDetection.y)
            current.ballPosition = smoothed
            current.ballVelocity = { vx: kalman.current.vx, vy: kalman.current.vy }
            current.confidence   = ballDetection.confidence

            trajectory.current.push({ x: smoothed.x, y: smoothed.y, t: frameTs })
            if (trajectory.current.length > 90) trajectory.current.shift()
            current.trajectory = [...trajectory.current]

            // Aggiorna picco (y minima = punto più alto dell'immagine)
            if (smoothed.y < peakY.current) peakY.current = smoothed.y
        }

        if (hoopDetection && hoopDetection.confidence > 0.5) {
            current.hoopPosition = { x: hoopDetection.x, y: hoopDetection.y }
        }

        // ── Filtro palleggio: contatore frame in salita ───────────────────
        const vel  = current.ballVelocity
        const ball = current.ballPosition

        if (vel && ball) {
            const isRising = vel.vy < -SHOT_LAUNCH_THRESHOLD

            if (isRising) {
                risingFrames.current++
                // Registra Y di partenza al primo frame in salita
                if (risingFrames.current === 1) {
                    flightStartY.current = ball.y
                }
            } else {
                // Non più in salita → azzera contatore
                risingFrames.current = 0
            }

            // Imposta inFlight solo se:
            //   • la palla è in salita da almeno MIN_RISING_FRAMES frame (esclude spike singoli del palleggio)
            //   • l'arco è già abbastanza alto (esclude rimbalzi a terra)
            //   • abbastanza frame nella traiettoria
            if (!inFlight.current && risingFrames.current >= MIN_RISING_FRAMES) {
                const arcSoFar = flightStartY.current - ball.y  // positivo = salita
                if (arcSoFar >= MIN_ARC_HEIGHT && trajectory.current.length >= MIN_TRAJECTORY_FRAMES) {
                    inFlight.current = true
                }
            }
        }

        current.inFlight = inFlight.current

        // ── Shot detection (MADE / MISS / AIRBALL) ────────────────────────
        const hoop       = current.hoopPosition
        const cooldownOk = (now - lastShotTs.current) > SHOT_COOLDOWN_MS

        if (vel && hoop && ball && cooldownOk && !current.shotDetected) {
            const descending = vel.vy > DESCENDING_VY_THRESHOLD

            if (inFlight.current && descending) {
                const dx   = ball.x - hoop.x
                const dy   = ball.y - hoop.y
                const dist = Math.sqrt(dx * dx + dy * dy)

                const descendingTowardHoop = dy > 0 && dist < HOOP_RADIUS_MADE * 2

                if (descendingTowardHoop && dist < HOOP_RADIUS_MADE) {
                    current.shotDetected = true
                    current.shotResult   = 'MADE'
                    lastShotTs.current   = now
                } else if (descendingTowardHoop && dist >= HOOP_RADIUS_MADE) {
                    current.shotDetected = true
                    current.shotResult   = 'MISS'
                    lastShotTs.current   = now
                } else if (descending && vel.vy > SHOT_LAUNCH_THRESHOLD * 2) {
                    current.shotDetected = true
                    current.shotResult   = dist < 0.25 ? 'MISS' : 'AIRBALL'
                    lastShotTs.current   = now
                }
            }
        }

        lastFrameTs.current = frameTs
        return { ...current }
    }, [kalmanUpdate])

    const resetShot = useCallback(() => {
        state.current.shotDetected = false
        state.current.shotResult   = null
        state.current.inFlight     = false
        trajectory.current         = []
        peakY.current              = Infinity
        inFlight.current           = false
        risingFrames.current       = 0
        flightStartY.current       = 1.0
    }, [])

    const resetAll = useCallback(() => {
        kalman.current      = { ...INITIAL_KALMAN }
        trajectory.current  = []
        peakY.current       = Infinity
        inFlight.current    = false
        risingFrames.current = 0
        flightStartY.current = 1.0
        lastShotTs.current  = 0
        state.current       = {
            ballPosition: null, ballVelocity: null, hoopPosition: null,
            shotDetected: false, shotResult: null, trajectory: [], confidence: 0,
            inFlight: false,
        }
    }, [])

    const setHoopFromCalibration = useCallback((hoopX: number, hoopY: number) => {
        state.current.hoopPosition = { x: hoopX, y: hoopY }
    }, [])

    const computeTrajectoryMetrics = useCallback((): {
        arcHeight: number; releaseAngle: number; smoothness: number
    } => {
        const traj = trajectory.current
        if (traj.length < MIN_TRAJECTORY_FRAMES) return { arcHeight: 0, releaseAngle: 0, smoothness: 0 }

        const minY       = Math.min(...traj.map(p => p.y))
        const startY     = traj[0].y
        const arcHeight  = Math.max(0, startY - minY)

        const n    = Math.max(2, Math.floor(traj.length * 0.3))
        const dx   = traj[n].x - traj[0].x
        const dy   = traj[n].y - traj[0].y
        const releaseAngle = Math.abs(Math.atan2(-dy, Math.abs(dx)) * (180 / Math.PI))

        let smoothness = 1.0
        if (traj.length >= 3) {
            const accels: number[] = []
            for (let i = 1; i < traj.length - 1; i++) {
                const ax = traj[i + 1].x - 2 * traj[i].x + traj[i - 1].x
                const ay = traj[i + 1].y - 2 * traj[i].y + traj[i - 1].y
                accels.push(Math.sqrt(ax * ax + ay * ay))
            }
            const mean     = accels.reduce((a, b) => a + b, 0) / accels.length
            const variance = accels.reduce((s, a) => s + (a - mean) ** 2, 0) / accels.length
            smoothness     = Math.max(0, Math.min(1, 1 - variance / 10))
        }

        return { arcHeight, releaseAngle, smoothness }
    }, [])

    // Ritorna sempre una copia fresca (include inFlight aggiornato)
    const getState = useCallback((): TrackingState => ({
        ...state.current,
        inFlight: inFlight.current,
    }), [])

    return {
        processFrame,
        resetShot,
        resetAll,
        setHoopFromCalibration,
        computeTrajectoryMetrics,
        getState,
    }
}
