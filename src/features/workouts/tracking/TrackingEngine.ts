// TrackingEngine - Pure class that coordinates Ball, Player, and Shot tracking
// Implements ITrackingEngine interface for Runtime integration
// Phase 4.5: Extract tracking logic from React hook to enable Runtime ownership

import type { ITrackingEngine } from '../runtime/WorkoutSessionRuntime.types'
import { BallTrackingEngine } from './BallTrackingEngine'
import { PlayerTrackingEngine } from './PlayerTrackingEngine'
import { ShotDetectionEngine } from './ShotDetectionEngine'
import { TrackingCoordinator } from './TrackingCoordinator'
import type { TrackingState } from '../types/workouts.types'

// Shot detection thresholds
const SHOT_LAUNCH_THRESHOLD = 1.5
const MIN_RISING_FRAMES = 3
const MIN_ARC_HEIGHT = 0.08
const MIN_TRAJECTORY_FRAMES = 4

export class TrackingEngine implements ITrackingEngine {
  private ballTrackingEngine: BallTrackingEngine
  private playerTrackingEngine: PlayerTrackingEngine
  private shotDetectionEngine: ShotDetectionEngine
  private trackingCoordinator: TrackingCoordinator

  // Trajectory buffer (ring buffer for O(1) insert)
  private readonly MAX_POINTS = 90
  private trajectoryBuffer: Array<{ x: number; y: number; t: number } | null>
  private trajectoryHead: number = 0
  private trajectoryCount: number = 0

  // State
  private state: TrackingState = {
    ballPosition: null,
    ballPositionRaw: null,
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
  }

  // Timing state
  private lastFrameTs: number = 0
  private lastShotTs: number = 0
  private peakY: number = Infinity
  private apexPoint: { x: number; y: number } | null = null
  private inFlight: boolean = false

  // Dribble filter state
  private risingFrames: number = 0
  private flightStartY: number = 1.0

  // Callbacks for telemetry
  private callbacks?: {
    onBallDetected?: () => void
    onBallPrediction?: (ageMs: number) => void
    onBallTrackingExpired?: () => void
    onPlayerDetected?: () => void
  }

  constructor(callbacks?: { onBallDetected?: () => void; onBallPrediction?: (ageMs: number) => void; onBallTrackingExpired?: () => void; onPlayerDetected?: () => void }) {
    this.ballTrackingEngine = new BallTrackingEngine(callbacks)
    this.playerTrackingEngine = new PlayerTrackingEngine()
    this.shotDetectionEngine = new ShotDetectionEngine()
    this.trackingCoordinator = new TrackingCoordinator()
    this.trajectoryBuffer = new Array(this.MAX_POINTS).fill(null)
    this.callbacks = callbacks
  }

  processFrame(
    ballDetection: { x: number; y: number; width?: number; height?: number; confidence: number } | null,
    hoopDetection: { x: number; y: number; width?: number; height?: number; confidence: number } | null,
    frameTs: number,
    poseKeypoints?: any,
    sizeCategory?: 'small' | 'medium' | 'large' | null,
    adaptThreshold?: number,
    rejectedBall?: { x: number; y: number; width?: number; height?: number; confidence: number } | null,
    playerDetection?: { x: number; y: number; width?: number; height?: number; confidence: number } | null
  ): TrackingState {
    // Player tracking: combine YOLO bbox (coarse detection) + MoveNet pose (articulated tracking)
    // Policy: YOLO provides bbox for state, Pose provides precise center for spatial constraints
    if (playerDetection) {
      this.playerTrackingEngine.update(
        playerDetection.x,
        playerDetection.y,
        playerDetection.width || 0,
        playerDetection.height || 0,
        playerDetection.confidence,
        frameTs
      )
      // Call telemetry callback for player detection
      this.callbacks?.onPlayerDetected?.()
    }

    // Player center calculation for spatial constraints
    // Priority: Pose (precise) > YOLO bbox center (fallback)
    let playerCenter: { x: number; y: number } | null = null
    if (poseKeypoints) {
      playerCenter = this.playerTrackingEngine.updateFromPose(poseKeypoints)
    } else if (playerDetection) {
      // Fallback: calculate center from YOLO bbox
      playerCenter = {
        x: playerDetection.x + (playerDetection.width || 0) / 2,
        y: playerDetection.y + (playerDetection.height || 0) / 2,
      }
    }

    // Apply spatial constraints via TrackingCoordinator
    if (!this.trackingCoordinator.shouldAcceptBallDetection(ballDetection, playerCenter, this.state.inFlight)) {
      ballDetection = null
    }

    // Process ball detection or prediction
    if (ballDetection) {
      const engineResult = this.ballTrackingEngine.update(ballDetection.x, ballDetection.y, frameTs)
      const engineState = this.ballTrackingEngine.getState()

      // Set raw detection data
      this.ballTrackingEngine.setRawDetection(
        ballDetection.x,
        ballDetection.y,
        ballDetection.width || 0,
        ballDetection.height || 0,
        ballDetection.confidence
      )

      // Use engine output as authoritative
      this.state.ballPosition = { x: engineResult.x, y: engineResult.y }
      this.state.ballPositionRaw = { x: ballDetection.x, y: ballDetection.y }
      this.state.ballVelocity = engineState.ballVelocity
      this.state.confidence = ballDetection.confidence
      this.state.ballWidth = ballDetection.width
      this.state.ballHeight = ballDetection.height

      // Call telemetry callback
      this.callbacks?.onBallDetected?.()

      // Ring buffer insert (O(1))
      this.trajectoryBuffer[this.trajectoryHead] = { x: engineResult.x, y: engineResult.y, t: frameTs }
      this.trajectoryHead = (this.trajectoryHead + 1) % this.MAX_POINTS
      if (this.trajectoryCount < this.MAX_POINTS) this.trajectoryCount++

      // Update trajectory in ShotDetectionEngine
      this.shotDetectionEngine.addTrajectoryPoint(engineResult.x, engineResult.y, frameTs)

      // Copy trajectory for UI every 5 frames when inFlight
      if (this.inFlight && this.trajectoryCount % 5 === 0) {
        this.state.trajectory = this.getTrajectory()
      }

      // Update peak (min y = highest point)
      if (engineResult.y < this.peakY) {
        this.peakY = engineResult.y
        this.apexPoint = { x: engineResult.x, y: engineResult.y }
      }
    } else if (this.state.ballPosition && this.lastFrameTs > 0) {
      // Prediction when no detection
      const enginePrediction = this.ballTrackingEngine.predict(frameTs)
      const engineState = this.ballTrackingEngine.getState()

      if (enginePrediction === null) {
        // TTL expired - invalidate tracking
        this.state.ballPosition = null
        this.state.ballVelocity = null
        this.state.ballPositionRaw = null
        this.state.confidence = 0
      } else {
        // Use engine prediction as authoritative
        this.state.ballPosition = { x: enginePrediction.x, y: enginePrediction.y }
        this.state.ballVelocity = engineState.ballVelocity

        // Call telemetry callback for prediction
        this.callbacks?.onBallPrediction?.(engineState.trackAge)

        // Add predicted point to trajectory
        this.trajectoryBuffer[this.trajectoryHead] = { x: enginePrediction.x, y: enginePrediction.y, t: frameTs }
        this.trajectoryHead = (this.trajectoryHead + 1) % this.MAX_POINTS
        if (this.trajectoryCount < this.MAX_POINTS) this.trajectoryCount++

        // Update trajectory in ShotDetectionEngine
        this.shotDetectionEngine.addTrajectoryPoint(enginePrediction.x, enginePrediction.y, frameTs)

        // Copy trajectory for UI every 5 frames when inFlight
        if (this.inFlight && this.trajectoryCount % 5 === 0) {
          this.state.trajectory = this.getTrajectory()
        }

        // Update peak with prediction
        if (enginePrediction.y < this.peakY) {
          this.peakY = enginePrediction.y
          this.apexPoint = { x: enginePrediction.x, y: enginePrediction.y }
        }
      }
    }

    // Process hoop detection
    if (hoopDetection && hoopDetection.confidence > 0.15) {
      this.state.hoopPosition = {
        x: hoopDetection.x,
        y: hoopDetection.y,
        width: hoopDetection.width,
        height: hoopDetection.height,
        confidence: hoopDetection.confidence,
      }
    }

    // Dribble filter: count rising frames
    const vel = this.state.ballVelocity
    const ball = this.state.ballPosition

    if (vel && ball) {
      const isRising = vel.vy < -SHOT_LAUNCH_THRESHOLD

      if (isRising) {
        this.risingFrames++
        if (this.risingFrames === 1) {
          this.flightStartY = ball.y
        }
      } else {
        this.risingFrames = 0
      }

      // Set inFlight if: rising for MIN_RISING_FRAMES + arc high enough + enough trajectory frames
      if (!this.inFlight && this.risingFrames >= MIN_RISING_FRAMES) {
        const arcSoFar = this.flightStartY - ball.y
        if (arcSoFar >= MIN_ARC_HEIGHT && this.trajectoryCount >= MIN_TRAJECTORY_FRAMES) {
          this.inFlight = true
          this.state.releasePoint = { x: ball.x, y: ball.y }
        }
      }
    }

    this.state.inFlight = this.inFlight

    // Calculate trajectory metrics every 5 frames when inFlight
    let trajectoryMetrics = null
    if (this.inFlight && this.trajectoryCount >= MIN_TRAJECTORY_FRAMES && this.trajectoryCount % 5 === 0) {
      trajectoryMetrics = this.computeTrajectoryMetrics()
      this.state.releaseAngle = trajectoryMetrics.releaseAngle
    }

    // Use cached apex point
    if (this.inFlight && this.apexPoint) {
      this.state.apexPoint = this.apexPoint
    }

    // Shot detection via ShotDetectionEngine
    const engineShotResult = this.shotDetectionEngine.processFrame(
      this.state.ballPosition,
      this.state.ballVelocity,
      this.state.hoopPosition ? {
        x: this.state.hoopPosition.x,
        y: this.state.hoopPosition.y,
        width: this.state.hoopPosition.width,
        height: this.state.hoopPosition.height,
        confidence: this.state.hoopPosition.confidence ?? 0,
      } : null,
      frameTs
    )

    // Apply engine shot detection results
    if (engineShotResult.shotDetected && !this.state.shotDetected) {
      this.state.shotDetected = engineShotResult.shotDetected
      this.state.shotResult = engineShotResult.shotResult
      this.lastShotTs = frameTs
      const metrics = trajectoryMetrics || this.computeTrajectoryMetrics()
      this.state.shotQuality = this.calculateShotQuality(metrics, this.state.releaseAngle)
    }

    // Update inFlight from engine
    this.inFlight = engineShotResult.inFlight
    this.state.inFlight = engineShotResult.inFlight

    this.lastFrameTs = frameTs
    return { ...this.state }
  }

  resetShot(): void {
    this.state.shotDetected = false
    this.state.shotResult = null
    this.state.inFlight = false
    this.state.releasePoint = undefined
    this.state.apexPoint = undefined
    this.state.releaseAngle = undefined
    this.state.shotQuality = undefined
    this.state.ballPositionRaw = null
    this.resetTrajectoryBuffer()
    this.peakY = Infinity
    this.apexPoint = null
    this.inFlight = false
    this.risingFrames = 0
    this.flightStartY = 1.0
    this.ballTrackingEngine.reset()
    this.playerTrackingEngine.reset()
    this.shotDetectionEngine.resetShot()
  }

  resetAll(): void {
    this.resetTrajectoryBuffer()
    this.peakY = Infinity
    this.apexPoint = null
    this.inFlight = false
    this.risingFrames = 0
    this.flightStartY = 1.0
    this.lastShotTs = 0
    this.ballTrackingEngine.reset()
    this.playerTrackingEngine.reset()
    this.shotDetectionEngine.resetAll()
    this.state = {
      ballPosition: null,
      ballPositionRaw: null,
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
    }
  }

  getState(): TrackingState {
    return { ...this.state, inFlight: this.inFlight }
  }

  getComparisonStats(): any {
    // Return stats from underlying engines for comparison/testing
    return {
      ball: this.ballTrackingEngine.getState(),
      player: this.playerTrackingEngine.getState(),
      shot: this.shotDetectionEngine.getState(),
    }
  }

  // Helper methods
  private getTrajectory(): Array<{ x: number; y: number; t: number }> {
    const result: Array<{ x: number; y: number; t: number }> = []
    const count = this.trajectoryCount
    const head = this.trajectoryHead
    const buffer = this.trajectoryBuffer

    for (let i = 0; i < count; i++) {
      const idx = (head - count + i + this.MAX_POINTS) % this.MAX_POINTS
      const point = buffer[idx]
      if (point) result.push(point)
    }
    return result
  }

  private resetTrajectoryBuffer(): void {
    this.trajectoryHead = 0
    this.trajectoryCount = 0
    this.trajectoryBuffer.fill(null)
  }

  private computeTrajectoryMetrics(): { arcHeight: number; releaseAngle: number; smoothness: number } {
    const traj = this.getTrajectory()
    if (traj.length < MIN_TRAJECTORY_FRAMES) return { arcHeight: 0, releaseAngle: 0, smoothness: 0 }

    let minY = Infinity
    for (const p of traj) {
      if (p.y < minY) minY = p.y
    }
    const startY = traj[0].y
    const arcHeight = Math.max(0, startY - minY)

    const n = Math.max(2, Math.floor(traj.length * 0.3))
    const dx = traj[n].x - traj[0].x
    const dy = traj[n].y - traj[0].y
    const releaseAngle = Math.abs(Math.atan2(-dy, Math.abs(dx)) * (180 / Math.PI))

    let smoothness = 1.0
    if (traj.length >= 3) {
      const accels: number[] = []
      for (let i = 1; i < traj.length - 1; i++) {
        const ax = traj[i + 1].x - 2 * traj[i].x + traj[i - 1].x
        const ay = traj[i + 1].y - 2 * traj[i].y + traj[i - 1].y
        accels.push(Math.sqrt(ax * ax + ay * ay))
      }
      const mean = accels.reduce((a, b) => a + b, 0) / accels.length
      const variance = accels.reduce((s, a) => s + (a - mean) ** 2, 0) / accels.length
      smoothness = Math.max(0, Math.min(1, 1 - variance / 10))
    }

    return { arcHeight, releaseAngle, smoothness }
  }

  private calculateShotQuality(
    metrics: { arcHeight: number; releaseAngle: number; smoothness: number },
    releaseAngle: number | undefined
  ): number {
    const releaseAngleScore = releaseAngle
      ? releaseAngle >= 45 && releaseAngle <= 55 ? 100
      : releaseAngle >= 35 && releaseAngle <= 65 ? 70 : 30
      : 50
    const arcScore = Math.min(100, (metrics.arcHeight / 0.3) * 100)
    const smoothnessScore = metrics.smoothness * 100
    return releaseAngleScore * 0.4 + arcScore * 0.3 + smoothnessScore * 0.3
  }

  // Additional methods for hoop calibration
  setHoopFromCalibration(x: number, y: number, width?: number, height?: number): void {
    this.state.hoopPosition = { x, y, width, height }
  }

  // Expose internal ShotDetectionEngine for Runtime integration
  // This avoids double ownership - Runtime uses the same instance that TrackingEngine owns
  getShotDetectionEngine(): ShotDetectionEngine {
    return this.shotDetectionEngine
  }
}
