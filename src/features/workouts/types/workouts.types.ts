// src/features/workouts/types/workouts.types.ts

/**
 * Modalità camera per il tracking
 */
export type CameraMode = 'LATERAL' | 'FRONTAL' | 'ANGLE_45'

/**
 * Tipo di campo
 */
export type CourtType = 'HALF_COURT' | 'FULL_COURT'

/**
 * Stato della sessione
 */
export type SessionStatus = 'ACTIVE' | 'PAUSED' | 'COMPLETED'

/**
 * Risultato del tiro
 */
export type ShotResult = 'MADE' | 'MISS'

/**
 * Zone del campo
 */
export type CourtZone = 'PAINT' | 'MID_RANGE' | 'THREE_POINT' | 'CORNER'

/**
 * Dati di calibrazione del campo
 */
export interface CalibrationData {
    homographyMatrix: number[]
    hoopCenter: {
        x: number
        y: number
    }
    freeThrowLine?: {
        x: number
        y: number
    }
    courtCorners?: {
        topLeft: { x: number; y: number }
        topRight: { x: number; y: number }
        bottomLeft: { x: number; y: number }
        bottomRight: { x: number; y: number }
    }
}

/**
 * Sessione di workout
 */
export interface WorkoutSession {
    id: string
    userId: string
    cameraMode: CameraMode
    courtType: CourtType
    status: SessionStatus
    startTime: string
    endTime?: string
    calibrationData?: string // JSON string
    totalShots: number
    madeShots: number
    missedShots: number
    shootingPercentage: number
    duration?: number // in seconds
}

/**
 * Payload per creare una sessione
 */
export interface CreateWorkoutSessionPayload {
    cameraMode: CameraMode
    courtType: CourtType
    calibrationData?: string
}

/**
 * Evento tiro
 */
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
    trackingData?: string // JSON string
    zone?: CourtZone
}

/**
 * Payload per aggiungere un tiro
 */
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

/**
 * Punto nello shot chart
 */
export interface ShotChartPoint {
    x: number
    y: number
    made: boolean
    distance: number
    zone: CourtZone
}

/**
 * Statistiche di una zona
 */
export interface ZoneStats {
    attempts: number
    made: number
    percentage: number
}

/**
 * Statistiche della sessione
 */
export interface SessionStats {
    totalShots: number
    madeShots: number
    missedShots: number
    shootingPercentage: number
    averageDistance: number
    bestZone: CourtZone
    worstZone: CourtZone
}

/**
 * Risposta shot chart
 */
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

/**
 * Statistiche zone
 */
export interface ZoneStatistics {
    zone: CourtZone
    attempts: number
    made: number
    missed: number
    percentage: number
    averageDistance: number
}

/**
 * Statistiche carriera
 */
export interface CareerStats {
    totalSessions: number
    totalShots: number
    totalMade: number
    totalMissed: number
    overallPercentage: number
    bestSessionPercentage: number
    averageSessionDuration: number
    favoriteZone: CourtZone
}
