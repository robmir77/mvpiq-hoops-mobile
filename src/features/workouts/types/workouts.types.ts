// src/features/workouts/types/workouts.types.ts

export type CameraMode = 'LATERAL' | 'FRONTAL' | 'ANGLE_45'
export type CourtType = 'HALF_COURT' | 'FULL_COURT'
export type SessionStatus = 'ACTIVE' | 'PAUSED' | 'COMPLETED'
export type ShotResult = 'MADE' | 'MISS' | 'BLOCKED' | 'AIRBALL'
export type CourtZone = 'PAINT' | 'MID_RANGE' | 'THREE_POINT' | 'CORNER'

export interface CalibrationData {
    homographyMatrix: number[]
    hoopCenter: { x: number; y: number }
    freeThrowLine?: { x: number; y: number }
    courtCorners?: {
        topLeft: { x: number; y: number }
        topRight: { x: number; y: number }
        bottomLeft: { x: number; y: number }
        bottomRight: { x: number; y: number }
    }
}

export interface WorkoutSession {
    id: string
    // Il BE manda "playerId" (nuovo) — "userId" mantenuto per retrocompatibilità
    userId?: string
    playerId?: string
    cameraMode: CameraMode
    courtType: CourtType
    status: SessionStatus
    startTime: string
    endTime?: string
    totalShots: number
    madeShots: number
    // ✅ Fix: missedShots non è nel WorkoutSessionResponse BE — è optional
    // Usa getMissedShots() per accedervi in modo sicuro
    missedShots?: number
    shootingPercentage: number
    notes?: string
    averageShotDistance?: number
    workoutScore?: number
}

// ✅ Helper: calcola missedShots localmente se non presente nella risposta BE
export const getMissedShots = (session: WorkoutSession): number =>
    session.missedShots ?? ((session.totalShots ?? 0) - (session.madeShots ?? 0))

export interface CreateWorkoutSessionPayload {
    cameraMode: CameraMode
    courtType: CourtType
    calibrationData?: string
}

export interface ShotEvent {
    id: string
    sessionId: string
    timestampMs: number
    shotResult: ShotResult
    courtX: number
    courtY: number
    distanceFromHoop: number
    releaseAngle?: number
    releaseVelocity?: number
    detectionConfidence: number
    trackingData?: string
    zone?: CourtZone
    shotZone?: string
    releaseTimeMs?: number
}

export interface AddShotEventPayload {
    timestampMs: number
    shotResult: ShotResult
    courtX: number
    courtY: number
    distanceFromHoop: number
    releaseAngle?: number
    releaseVelocity?: number
    detectionConfidence: number
    trackingData?: string
}

export interface ShotChartPoint {
    x: number
    y: number
    made: boolean
    distance: number
    zone: string
}

export interface ZoneStats {
    attempts: number
    made: number
    percentage: number
}

export interface SessionStats {
    totalShots: number
    madeShots: number
    missedShots: number
    shootingPercentage: number
    averageDistance: number
    bestZone: string
    worstZone: string
}

export interface ShotChartResponse {
    shots: ShotChartPoint[]
    sessionStats: SessionStats
    zoneStats: {
        paint: ZoneStats
        midRange: ZoneStats
        threePoint: ZoneStats
        corner: ZoneStats
    }
}

export interface ZoneStatistics {
    zone: string
    attempts: number
    made: number
    missed: number
    percentage: number
    averageDistance: number
}

// ✅ Fix: allineato al CareerStatsDTO BE (non Map<String,Double>)
// I campi corrispondono esattamente a quelli serializzati dal DTO Java
export interface CareerStats {
    totalSessions: number
    totalShots: number
    totalMade: number
    totalMissed: number
    overallPercentage: number
    bestSessionPercentage: number
    favoriteZone: string
}
