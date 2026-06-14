// src/features/workouts/types/workouts.types.ts

export type CameraMode = 'LATERAL' | 'FRONTAL' | 'ANGLE_45'
export type CourtType = 'HALF_COURT' | 'FULL_COURT'
export type SessionStatus = 'ACTIVE' | 'PAUSED' | 'COMPLETED'
export type ShotResult = 'MADE' | 'MISS' | 'BLOCKED' | 'AIRBALL'
export type CourtZone = 'PAINT' | 'MID_RANGE' | 'THREE_POINT' | 'CORNER'

// ─── Sessione ─────────────────────────────────────────────────
export interface WorkoutSession {
    id: string
    userId?: string
    playerId?: string
    cameraMode: CameraMode
    courtType: CourtType
    status: SessionStatus
    startTime: string
    endTime?: string
    totalShots: number
    madeShots: number
    missedShots?: number      // non nel BE response — usa getMissedShots()
    shootingPercentage: number
    notes?: string
    averageShotDistance?: number
    workoutScore?: number
}

export const getMissedShots = (s: WorkoutSession): number =>
    s.missedShots ?? ((s.totalShots ?? 0) - (s.madeShots ?? 0))

export interface CreateWorkoutSessionPayload {
    cameraMode: CameraMode
    courtType: CourtType
    calibrationData?: string
}

// ─── Tiri ─────────────────────────────────────────────────────
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

// ─── Calibrazione ─────────────────────────────────────────────
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
    courtLines?: Array<{ start: { x: number; y: number }; end: { x: number; y: number } }>
}

// ─── AI Tracking ──────────────────────────────────────────────
export interface DetectionResult {
    class: 'basketball' | 'rim'
    confidence: number
    bbox: { x: number; y: number; width: number; height: number }
    centerX: number
    centerY: number
}

export interface TrackingState {
    ballPosition: { x: number; y: number } | null
    ballPositionRaw: { x: number; y: number } | null
    ballVelocity: { vx: number; vy: number } | null
    ballWidth?: number
    ballHeight?: number
    hoopPosition: { x: number; y: number; width?: number; height?: number } | null
    shotDetected: boolean
    shotResult: ShotResult | null
    trajectory: Array<{ x: number; y: number; t: number }>
    confidence: number
    // ─── Shot flight state ──────────────────────────────────────
    /** true dal momento in cui la palla inizia la parabola (sale + arco minimo),
     *  false dopo resetShot() — guida l'overlay scia */
    inFlight: boolean
    // ─── Biomechanical analysis ─────────────────────────────────
    releasePoint?: { x: number; y: number }
    apexPoint?: { x: number; y: number }
    releaseAngle?: number
    shotQuality?: number
}

export interface PoseKeypoints {
    leftShoulder?: { x: number; y: number; score: number }
    rightShoulder?: { x: number; y: number; score: number }
    leftElbow?: { x: number; y: number; score: number }
    rightElbow?: { x: number; y: number; score: number }
    leftWrist?: { x: number; y: number; score: number }
    rightWrist?: { x: number; y: number; score: number }
    leftHip?: { x: number; y: number; score: number }
    rightHip?: { x: number; y: number; score: number }
    leftKnee?: { x: number; y: number; score: number }
    rightKnee?: { x: number; y: number; score: number }
    leftAnkle?: { x: number; y: number; score: number }
    rightAnkle?: { x: number; y: number; score: number }
}

export interface FrameDataPayload {
    frameTimestamp: number
    ballX?: number
    ballY?: number
    ballConfidence?: number
    hoopX?: number
    hoopY?: number
    hoopConfidence?: number
    poseData?: Record<string, any>
    trajectoryData?: Record<string, any>
    ballVelocityX?: number
    ballVelocityY?: number
    shotDetected?: boolean
}

export interface PoseAnalysisPayload {
    shotEventId?: string
    elbowAngle?: number
    kneeAngle?: number
    shoulderAngle?: number
    wristAngle?: number
    releaseHeight?: number
    releaseAngle?: number
    releaseVelocity?: number
    shotSmoothness?: number
    followThroughScore?: number
    balanceScore?: number
}

// ─── Realtime Stats (WebSocket) ───────────────────────────────
export interface RealtimeStats {
    sessionId: string
    shotCount: number
    fieldGoalPercentage: number
    shotStreak: number
    releaseAngleAvg: number
    releaseVelocityAvg: number
    heatZones: Record<string, number>
    recentShots: Array<{
        courtX: number
        courtY: number
        result: ShotResult
        timestamp: number
    }>
    sessionDuration: number
}

// ─── Analytics ────────────────────────────────────────────────
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

export interface ShotChartPoint {
    x: number; y: number; made: boolean; distance: number; zone: string
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
    zone: string; attempts: number; made: number; missed: number
    percentage: number; averageDistance: number
}

export interface CareerStats {
    totalSessions: number
    totalShots: number
    totalMade: number
    totalMissed: number
    overallPercentage: number
    bestSessionPercentage: number
    favoriteZone: string
}
