// BallTrackingState
// Phase 4.1: Pure tracking state without React dependencies
// This separates algorithm from presentation (SharedValue)

export interface BallPosition {
  x: number
  y: number
}

export interface BallVelocity {
  vx: number
  vy: number
}

export interface KalmanDebugInfo {
  rawX: number
  rawY: number
  predX: number
  predY: number
  distance: number
  tolerance: number
  gain: number
  filteredX: number
  filteredY: number
  vx: number
  vy: number
  accepted: boolean
  dt: number
}

export interface BallTrackingState {
  ballPosition: BallPosition | null
  ballPositionRaw: BallPosition | null
  ballVelocity: BallVelocity | null
  ballWidth: number
  ballHeight: number
  confidence: number
  ballRejectionReason: string
  trackState: 'DETECTED' | 'PREDICTED' | 'LOST'
  trackAge: number
  kalmanDebug?: KalmanDebugInfo | null
}

export interface KalmanState {
  x: number
  y: number
  vx: number
  vy: number
}

export const INITIAL_KALMAN: KalmanState = {
  x: 0,
  y: 0,
  vx: 0,
  vy: 0,
}

// Kalman v2 Configuration - Adaptive gain + outlier detection
export const KALMAN_CONFIG = {
  // Minimum outlier distance (normalized coordinates)
  minOutlierDistance: 0.025,

  // How much tolerance increases with velocity
  velocityTolerance: 1.2,

  // How long to predict without detection (ms)
  predictionTtlMs: 150,

  // Adaptive gain thresholds
  // Distance as fraction of tolerance threshold
  perfectDetectionRatio: 0.2,   // < 20% of threshold → 95% gain
  goodDetectionRatio: 0.5,     // < 50% of threshold → 85% gain
  noisyDetectionRatio: 0.8,    // < 80% of threshold → 60% gain
  // >= 100% of threshold → outlier (0% gain)

  // Corresponding gains
  perfectGain: 0.95,
  goodGain: 0.85,
  noisyGain: 0.6,
}

export const INITIAL_BALL_TRACKING_STATE: BallTrackingState = {
  ballPosition: null,
  ballPositionRaw: null,
  ballVelocity: null,
  ballWidth: 0,
  ballHeight: 0,
  confidence: 0,
  ballRejectionReason: '',
  trackState: 'LOST',
  trackAge: 0,
  kalmanDebug: null,
}
