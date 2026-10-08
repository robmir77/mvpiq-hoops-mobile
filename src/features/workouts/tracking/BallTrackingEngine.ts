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
import { INITIAL_KALMAN, KALMAN_CONFIG } from './BallTrackingState'

const BALL_TRACK_TTL_MS = KALMAN_CONFIG.predictionTtlMs

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
  private enableKalmanDebug = false // Temporary diagnostic flag

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

  constructor(callbacks?: BallTrackingCallbacks, enableKalmanDebug = false) {
    this.callbacks = callbacks
    this.enableKalmanDebug = enableKalmanDebug
  }

  setKalmanDebug(enabled: boolean): void {
    this.enableKalmanDebug = enabled
  }

  // Kalman v2 update with adaptive gain and outlier detection
  update(measX: number, measY: number, frameTs: number): BallPosition {
    const k = this.kalman

    // First detection: initialize position, do NOT calculate velocity
    if (!this.ballTrackingValid) {
      k.x = measX
      k.y = measY
      k.vx = 0
      k.vy = 0

      this.lastFrameTs = frameTs
      this.ballLastSeenAt = frameTs
      this.ballTrackingValid = true
      this.lastBallWasDetected = true

      this.state.ballPosition = { x: measX, y: measY }
      this.state.ballPositionRaw = { x: measX, y: measY }
      this.state.ballVelocity = { vx: 0, vy: 0 }
      this.state.ballRejectionReason = ''
      this.state.trackState = 'DETECTED'
      this.state.trackAge = 0

      this.callbacks?.onBallDetected?.()

      return { x: measX, y: measY }
    }

    const dt = Math.max(
      0.001,
      Math.min(0.1, (frameTs - this.lastFrameTs) / 1000)
    )

    // Prediction
    const predX = k.x + k.vx * dt
    const predY = k.y + k.vy * dt

    const dx = measX - predX
    const dy = measY - predY

    const distance = Math.sqrt(dx * dx + dy * dy)

    const velocity = Math.sqrt(
      k.vx * k.vx +
      k.vy * k.vy
    )

    const tolerance =
      KALMAN_CONFIG.minOutlierDistance +
      velocity * KALMAN_CONFIG.velocityTolerance * dt

    // Outlier
    if (distance > tolerance) {
      k.x = predX
      k.y = predY

      this.lastFrameTs = frameTs
      // DO NOT update ballLastSeenAt on outlier - only on accepted detections
      // this.ballLastSeenAt = frameTs

      this.state.ballPosition = {
        x: k.x,
        y: k.y,
      }

      this.state.ballVelocity = {
        vx: k.vx,
        vy: k.vy,
      }

      this.state.ballRejectionReason =
        `Outlier: distance=${distance.toFixed(3)} > tolerance=${tolerance.toFixed(3)}`

      this.state.trackState = 'PREDICTED'
      this.state.trackAge = 0

      if (this.enableKalmanDebug) {
        this.state.kalmanDebug = {
          rawX: measX,
          rawY: measY,
          predX,
          predY,
          distance,
          tolerance,
          gain: 0,
          filteredX: k.x,
          filteredY: k.y,
          vx: k.vx,
          vy: k.vy,
          accepted: false,
          dt,
        }
      }

      return {
        x: k.x,
        y: k.y,
      }
    }

    // Detection accepted
    const ratio = tolerance > 0
      ? distance / tolerance
      : 0

    let gain = KALMAN_CONFIG.noisyGain

    if (ratio < KALMAN_CONFIG.perfectDetectionRatio) {
      gain = KALMAN_CONFIG.perfectGain
    } else if (ratio < KALMAN_CONFIG.goodDetectionRatio) {
      gain = KALMAN_CONFIG.goodGain
    }

    // Correct position
    const newX = predX + gain * dx
    const newY = predY + gain * dy

    // Observed velocity from accepted detection
    const measuredVx = (newX - k.x) / dt
    const measuredVy = (newY - k.y) / dt

    // Smooth velocity, but stay reactive
    const velocityAlpha = 0.75

    k.vx =
      k.vx * (1 - velocityAlpha) +
      measuredVx * velocityAlpha

    k.vy =
      k.vy * (1 - velocityAlpha) +
      measuredVy * velocityAlpha

    k.x = newX
    k.y = newY

    this.lastFrameTs = frameTs
    this.ballLastSeenAt = frameTs

    this.state.ballPosition = {
      x: k.x,
      y: k.y,
    }

    this.state.ballPositionRaw = {
      x: measX,
      y: measY,
    }

    this.state.ballVelocity = {
      vx: k.vx,
      vy: k.vy,
    }

    this.state.ballRejectionReason = ''
    this.state.trackState = 'DETECTED'
    this.state.trackAge = 0

    if (this.enableKalmanDebug) {
      this.state.kalmanDebug = {
        rawX: measX,
        rawY: measY,
        predX,
        predY,
        distance,
        tolerance,
        gain,
        filteredX: newX,
        filteredY: newY,
        vx: k.vx,
        vy: k.vy,
        accepted: true,
        dt,
      }
    }

    this.callbacks?.onBallDetected?.()

    return {
      x: k.x,
      y: k.y,
    }
  }

  // Kalman predict (from useTrackingEngine lines 169-189)
  predict(frameTs: number): BallPosition | null {
    const k = this.kalman
    const dt = Math.max(
      0.001,
      Math.min(0.1, (frameTs - this.lastFrameTs) / 1000)
    )

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
    this.ballLastSeenAt = Date.now()
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
      kalmanDebug: null,
    }
  }
}
