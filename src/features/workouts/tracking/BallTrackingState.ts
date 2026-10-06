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
}

export interface KalmanState {
  x: number
  y: number
  vx: number
  vy: number
  px: number
  py: number
  mx: number
  my: number
}

export const INITIAL_KALMAN: KalmanState = {
  x: 0,
  y: 0,
  vx: 0,
  vy: 0,
  px: 0.1,     // Moderate confidence in prediction - balanced smoothing
  py: 0.1,     // Moderate confidence in prediction - balanced smoothing
  mx: 0.5,     // Moderate confidence in measurements - balanced smoothing
  my: 0.5,     // Moderate confidence in measurements - balanced smoothing
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
}
