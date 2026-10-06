// BallTrackingEngine
// Phase 4.1: Extract ball tracking logic from useTrackingEngine
// Pure algorithm without React dependencies
// Reference: useTrackingEngine.ts lines 149-189

import type {
  BallPosition,
  BallVelocity,
  BallTrackingState,
  KalmanState,
} from './BallTrackingState'
import { INITIAL_KALMAN } from './BallTrackingState'

const BALL_TRACK_TTL_MS = 500

interface BallTrackingCallbacks {
  onBallDetected?: () => void
  onBallPrediction?: (ageMs: number) => void
  onBallTrackingExpired?: () => void
}

export class BallTrackingEngine {
  private kalman: KalmanState = { ...INITIAL_KALMAN }
  private lastFrameTs = 0
  private ballLastSeenAt = Date.now()
  private ballTrackingValid = false
  private lastBallWasDetected = false
  private callbacks?: BallTrackingCallbacks

  // Pure state (no SharedValue)
  private state: BallTrackingState = {
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

  constructor(callbacks?: BallTrackingCallbacks) {
    this.callbacks = callbacks
  }

  // Kalman update (from useTrackingEngine lines 149-167)
  update(measX: number, measY: number, frameTs: number): BallPosition {
    const k = this.kalman
    const dt = Math.max(0.0001, Math.min(0.033, (frameTs - this.lastFrameTs) / 1000))

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

    this.lastFrameTs = frameTs
    this.ballLastSeenAt = frameTs
    this.ballTrackingValid = true
    this.lastBallWasDetected = true

    // Update pure state
    this.state.ballPosition = { x: k.x, y: k.y }
    this.state.ballPositionRaw = { x: measX, y: measY }
    this.state.ballVelocity = { vx: k.vx, vy: k.vy }
    this.state.trackState = 'DETECTED'
    this.state.trackAge = 0

    this.callbacks?.onBallDetected?.()

    return { x: k.x, y: k.y }
  }

  // Kalman predict (from useTrackingEngine lines 169-189)
  predict(frameTs: number): BallPosition | null {
    const k = this.kalman
    const dt = Math.max(0.0001, Math.min(0.033, (frameTs - this.lastFrameTs) / 1000))

    const ageMs = frameTs - this.ballLastSeenAt
    if (ageMs > BALL_TRACK_TTL_MS) {
      this.ballTrackingValid = false
      if (this.lastBallWasDetected) {
        this.callbacks?.onBallTrackingExpired?.()
        this.lastBallWasDetected = false
      }
      this.state.trackState = 'LOST'
      this.state.ballPosition = null
      this.state.ballVelocity = null
      return null
    }

    const predX = k.x + k.vx * dt
    const predY = k.y + k.vy * dt

    this.state.trackState = 'PREDICTED'
    this.state.trackAge = ageMs
    this.state.ballPosition = { x: predX, y: predY }
    this.callbacks?.onBallPrediction?.(ageMs)

    return { x: predX, y: predY }
  }

  getVelocity(): BallVelocity | null {
    if (!this.ballTrackingValid) return null
    return { vx: this.kalman.vx, vy: this.kalman.vy }
  }

  getPosition(): BallPosition | null {
    if (!this.ballTrackingValid) return null
    return { x: this.kalman.x, y: this.kalman.y }
  }

  getState(): BallTrackingState {
    return { ...this.state }
  }

  setRawDetection(x: number, y: number, width: number, height: number, confidence: number): void {
    this.state.ballPositionRaw = { x, y }
    this.state.ballWidth = width
    this.state.ballHeight = height
    this.state.confidence = confidence
  }

  setRejectionReason(reason: string): void {
    this.state.ballRejectionReason = reason
  }

  reset(): void {
    this.kalman = { ...INITIAL_KALMAN }
    this.lastFrameTs = 0
    this.ballTrackingValid = false
    this.state = {
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
  }
}
