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
        releasePoint: undefined,
        apexPoint: undefined,
        releaseAngle: undefined,
        shotQuality: undefined,
    })
    const lastFrameTs  = useRef<number>(0)
    const lastShotTs   = useRef<number>(0)
    const peakY        = useRef<number>(Infinity)   // min y = punto più alto
    const apexPoint    = useRef<{ x: number; y: number } | null>(null)  // memorizza apex point
    const inFlight     = useRef<boolean>(false)

    // ── Filtro palleggio ──────────────────────────────────────
    /** Numero di frame consecutivi in cui la palla è risultata in salita */
    const risingFrames  = useRef<number>(0)
    /** Y al primo frame di salita — per misurare l'arco */
    const flightStartY  = useRef<number>(1.0)

    const kalmanUpdate = useCallback((measX: number, measY: number, frameTs: number): { x: number; y: number } => {
        const k  = kalman.current
        const dt = Math.max(0.01, Math.min(0.1, (frameTs - lastFrameTs.current) / 1000))

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
        ballDetection: { x: number; y: number; width?: number; height?: number; confidence: number } | null,
        hoopDetection: { x: number; y: number; confidence: number } | null,
        frameTs: number
    ): TrackingState => {
        const current = state.current

        if (ballDetection && ballDetection.confidence > 0.05) {
            const smoothed = kalmanUpdate(ballDetection.x, ballDetection.y, frameTs)
            current.ballPosition = smoothed
            current.ballVelocity = { vx: kalman.current.vx, vy: kalman.current.vy }
            current.confidence   = ballDetection.confidence
            current.ballWidth    = ballDetection.width
            current.ballHeight   = ballDetection.height

            trajectory.current.push({ x: smoothed.x, y: smoothed.y, t: frameTs })
            if (trajectory.current.length > 90) trajectory.current.shift()
            // Only copy trajectory for UI every 5 frames when inFlight (reduces copies by ~95%)
            if (inFlight.current && trajectory.current.length % 5 === 0) {
                current.trajectory = [...trajectory.current]
            }

            // Aggiorna picco (y minima = punto più alto dell'immagine)
            if (smoothed.y < peakY.current) {
                peakY.current = smoothed.y
                apexPoint.current = { x: smoothed.x, y: smoothed.y }
            }
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
                    // Save release point when shot starts
                    current.releasePoint = { x: ball.x, y: ball.y }
                }
            }
        }

        current.inFlight = inFlight.current

        // ── Calculate trajectory metrics every 5 frames when inFlight ─────────
        let trajectoryMetrics = null
        if (inFlight.current && trajectory.current.length >= MIN_TRAJECTORY_FRAMES && trajectory.current.length % 5 === 0) {
            trajectoryMetrics = computeTrajectoryMetrics()
            current.releaseAngle = trajectoryMetrics.releaseAngle
        }

        // ── Use cached apex point instead of recalculating ─────────────────
        if (inFlight.current && apexPoint.current) {
            current.apexPoint = apexPoint.current
        }

        // ── Shot detection (MADE / MISS / AIRBALL) ────────────────────────
        const hoop       = current.hoopPosition
        const cooldownOk = (frameTs - lastShotTs.current) > SHOT_COOLDOWN_MS

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
                    lastShotTs.current   = frameTs
                    // Calculate shot quality score (reuse metrics and function)
                    const metrics = trajectoryMetrics || computeTrajectoryMetrics()
                    current.shotQuality = calculateShotQuality(metrics, current.releaseAngle)
                } else if (descendingTowardHoop && dist >= HOOP_RADIUS_MADE) {
                    current.shotDetected = true
                    current.shotResult   = 'MISS'
                    lastShotTs.current   = frameTs
                    // Calculate shot quality score (reuse metrics and function)
                    const metrics = trajectoryMetrics || computeTrajectoryMetrics()
                    current.shotQuality = calculateShotQuality(metrics, current.releaseAngle)
                } else if (descending && vel.vy > SHOT_LAUNCH_THRESHOLD * 2) {
                    current.shotDetected = true
                    current.shotResult   = dist < 0.25 ? 'MISS' : 'AIRBALL'
                    lastShotTs.current   = frameTs
                    // Calculate shot quality score (reuse metrics and function)
                    const metrics = trajectoryMetrics || computeTrajectoryMetrics()
                    current.shotQuality = calculateShotQuality(metrics, current.releaseAngle)
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
        state.current.releasePoint = undefined
        state.current.apexPoint    = undefined
        state.current.releaseAngle = undefined
        state.current.shotQuality = undefined
        trajectory.current         = []
        peakY.current              = Infinity
        apexPoint.current          = null
        inFlight.current           = false
        risingFrames.current       = 0
        flightStartY.current       = 1.0
    }, [])

    const resetAll = useCallback(() => {
        kalman.current      = { ...INITIAL_KALMAN }
        trajectory.current  = []
        peakY.current       = Infinity
        apexPoint.current  = null
        inFlight.current    = false
        risingFrames.current = 0
        flightStartY.current = 1.0
        lastShotTs.current  = 0
        state.current       = {
            ballPosition: null, ballVelocity: null, hoopPosition: null,
            shotDetected: false, shotResult: null, trajectory: [], confidence: 0,
            inFlight: false,
            releasePoint: undefined,
            apexPoint: undefined,
            releaseAngle: undefined,
            shotQuality: undefined,
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

        // Replace Math.min(...traj.map()) with loop for better performance
        let minY = Infinity
        for (const p of traj) {
            if (p.y < minY) minY = p.y
        }
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

    // Extract reusable shot quality calculation
    const calculateShotQuality = useCallback((
        metrics: { arcHeight: number; releaseAngle: number; smoothness: number },
        releaseAngle: number | undefined
    ): number => {
        const releaseAngleScore = releaseAngle
            ? (releaseAngle >= 45 && releaseAngle <= 55) ? 100
            : (releaseAngle >= 35 && releaseAngle <= 65) ? 70 : 30
            : 50
        const arcScore = Math.min(100, (metrics.arcHeight / 0.3) * 100)
        const smoothnessScore = metrics.smoothness * 100
        return releaseAngleScore * 0.4 + arcScore * 0.3 + smoothnessScore * 0.3
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
