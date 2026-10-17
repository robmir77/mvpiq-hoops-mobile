export type CameraMode = 'LATERAL' | 'FRONTAL' | 'ANGLE_45'
export type CourtType = 'HALF_COURT' | 'FULL_COURT'
export type SessionStatus = 'ACTIVE' | 'PAUSED' | 'COMPLETED'
export type ShotResult = 'MADE' | 'MISS' | 'BLOCKED' | 'AIRBALL' | 'UNCERTAIN'
export type CourtZone = 'PAINT' | 'MID_RANGE' | 'THREE_POINT' | 'CORNER'

// Visual tracking state for debugging
export type VisionTrackState = 'DETECTED' | 'PREDICTED' | 'LOST' | 'REJECTED'

// Session
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
    missedShots?: number  // not in BE response — use getMissedShots()
    shootingPercentage: number
    notes?: string
    averageShotDistance?: number
    workoutScore?: number
    // Calibration data (from backend)
    hoopCenterX?: number
    hoopCenterY?: number
    homographyMatrix?: number[]
    courtCorners?: {
        topLeft: { x: number; y: number }
        topRight: { x: number; y: number }
        bottomLeft: { x: number; y: number }
        bottomRight: { x: number; y: number }
    }
    courtWidth?: number
    courtHeight?: number
    // Vision configuration for session resume
    fps?: number
    cameraResolutionWidth?: number
    cameraResolutionHeight?: number
    poseResolution?: number
    yoloModelId?: string
    moveNetModelId?: string
    yoloDelegate?: string
    poseDelegate?: string
}

export const getMissedShots = (s: WorkoutSession): number =>
    s.missedShots ?? ((s.totalShots ?? 0) - (s.madeShots ?? 0))

export interface CreateWorkoutSessionPayload {
    cameraMode: CameraMode
    courtType: CourtType
    calibrationData?: string
    // Vision configuration for session
    fps?: number
    cameraResolutionWidth?: number
    cameraResolutionHeight?: number
    poseResolution?: number
    yoloModelId?: string
    moveNetModelId?: string
    yoloDelegate?: string
    poseDelegate?: string
}

// Punto di traiettoria per ShotEvent
export interface ShotPoint {
  x: number
  y: number
  timestampMs: number
  source: 'DETECTION' | 'PREDICTION'
  confidence?: number
}

// Keypoint nel formato del backend (usato anche nel frontend dopo conversione)
export interface BackendPoseKeypoint {
  name: string
  x: number
  y: number
  confidence: number
}

// Frame di posa grezza per ShotEvent
export interface RawPoseFrame {
  timestampMs: number
  keypoints: BackendPoseKeypoint[]  // Array di keypoints nel formato backend
  coordinateSpace: 'IMAGE_NORMALIZED' | 'IMAGE_PIXELS'
}

// Qualità della posizione sul campo
export type CourtPositionQuality = 'CALIBRATED' | 'APPROXIMATE' | 'UNAVAILABLE'

// Shots
export interface ShotEvent {
    id: string
    shotId: string  // UUID idempotente generato client-side
    sessionId: string
    timestampMs: number
    shotResult: ShotResult
    courtX: number | null
    courtY: number | null
    distanceFromHoop: number | null
    releaseAngle?: number
    releaseVelocity?: number
    detectionConfidence: number
    trackingData?: string
    zone?: CourtZone
    shotZone?: string
    releaseTimeMs?: number
    // Nuovi campi per completamento gestione tiri
    courtPositionQuality?: CourtPositionQuality
    trajectory?: ShotPoint[]
    rawPoseFrames?: RawPoseFrame[]
    schemaVersion: number
}

export interface AddShotEventPayload {
    shotId?: string  // UUID idempotente generato client-side
    timestampMs: number
    shotResult: ShotResult
    courtX: number | null
    courtY: number | null
    distanceFromHoop: number | null
    releaseAngle?: number
    releaseVelocity?: number
    detectionConfidence: number
    trackingData?: string
    // Nuovi campi per completamento gestione tiri
    courtPositionQuality?: CourtPositionQuality
    trajectory?: ShotPoint[]
    rawPoseFrames?: BackendRawPoseFrame[]  // Backend format (converted from RawPoseFrame[])
    schemaVersion?: number
}

// Calibration
export interface CalibrationData {
    homographyMatrix: number[]
    hoopCenter: { x: number; y: number }
    hoopBbox?: { x: number; y: number; width: number; height: number } // Rim bounding box from YOLO calibration
    cameraResolution?: { width: number; height: number }
    freeThrowLine?: { x: number; y: number }
    courtCorners?: {
        topLeft: { x: number; y: number }
        topRight: { x: number; y: number }
        bottomLeft: { x: number; y: number }
        bottomRight: { x: number; y: number }
    }
    courtLines?: Array<{ start: { x: number; y: number }; end: { x: number; y: number } }>
    // Court dimensions in meters (for accurate shot position calculation)
    courtWidth?: number
    courtHeight?: number
    // Vision parameters for session resume
    yoloModelId?: string
    moveNetModelId?: string
    fps?: number
    poseResolution?: number
    yoloDelegate?: string
    poseDelegate?: string
}

// AI Tracking
export interface DetectionResult {
    class: 'ball' | 'rim'
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
    hoopPosition: { x: number; y: number; width?: number; height?: number; confidence?: number } | null
    shotDetected: boolean
    shotResult: ShotResult | null
    shotId?: string // Stable UUID generated when shot is first detected
    trajectory: Array<{ x: number; y: number; t: number }>
    confidence: number
    // Shot flight state: true when ball starts parabola (rising + min arc), false after resetShot()
    inFlight: boolean
    // Biomechanical analysis
    releasePoint?: { x: number; y: number }
    apexPoint?: { x: number; y: number }
    releaseAngle?: number
    shotQuality?: number
    // Player position snapshot at shot release (for shot chart)
    playerPositionAtRelease?: {
        x: number
        y: number
        timestampMs: number
        isValid: boolean
    }
    // Pose frames captured at shot detection (for retry recovery)
    rawPoseFrames?: RawPoseFrame[]
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

// Backend-compatible format for pose keypoints
export interface BackendPoseKeypoint {
    name: string
    x: number
    y: number
    confidence: number
}

// Backend-compatible format for raw pose frame
export interface BackendRawPoseFrame {
    timestampMs: number
    keypoints: BackendPoseKeypoint[]
    coordinateSpace: 'IMAGE_NORMALIZED' | 'IMAGE_PIXELS'
}

export interface JointAngles {
    elbowAngle?: number
    shoulderAngle?: number
    kneeAngle?: number
}

export interface FrameDataPayload {
    frameTimestamp: number
    ballX?: number
    ballY?: number
    ballWidth?: number
    ballHeight?: number
    ballConfidence?: number
    hoopX?: number
    hoopY?: number
    hoopConfidence?: number
    poseData?: Record<string, any>
    trajectoryData?: {
        points: any[]
    }
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

// Realtime Stats (WebSocket)
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

// Analytics
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
    poseScore?: number  // Punteggio della pose (0-100), se disponibile
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
