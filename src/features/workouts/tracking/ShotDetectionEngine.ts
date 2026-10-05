// ShotDetectionEngine
// Phase 4.2: Pure shot detection logic without React dependencies
// This replicates EXACTLY the original algorithm to maintain behavior
// Reference: useTrackingEngine.ts lines 466-556
// NO React Native / Reanimated dependencies - pure business logic

// Constants from useTrackingEngine
const SHOT_LAUNCH_THRESHOLD = 1.5
const DESCENDING_VY_THRESHOLD = 0.3
const MIN_TRAJECTORY_FRAMES = 4
const SHOT_COOLDOWN_MS = 600
const MIN_RISING_FRAMES = 3
const MIN_ARC_HEIGHT = 0.08

interface TrajectoryPoint {
  x: number
  y: number
  t: number
}

interface HoopPosition {
  x: number
  y: number
  width?: number
  height?: number
  confidence: number
}

interface BallVelocity {
  vx: number
  vy: number
}

interface BallPosition {
  x: number
  y: number
}

// Dynamic hoop radius calculation (from useTrackingEngine)
const getDynamicHoopRadius = (hoop: HoopPosition | null): number => {
  if (!hoop || !hoop.width || !hoop.height) return 0.1
  return Math.max(hoop.width, hoop.height) / 2 * 1.2
}

export class ShotDetectionEngine {
  // Ring buffer for trajectory (O(1) insert, no reallocation)
  private readonly MAX_POINTS = 90
  private trajectoryBuffer: Array<TrajectoryPoint | null> = new Array(this.MAX_POINTS).fill(null)
  private trajectoryHead = 0
  private trajectoryCount = 0

  // Shot detection state
  private lastShotTs = 0
  private peakY = Infinity
  private apexPoint: BallPosition | null = null
  private inFlight = false
  private releasePoint: BallPosition | null = null
  private shotDetected = false
  private shotResult: 'MADE' | 'MISS' | 'AIRBALL' | null = null

  // Dribble filter state
  private risingFrames = 0
  private flightStartY = 1.0

  // Get trajectory as ordered array from ring buffer
  private getTrajectory(): TrajectoryPoint[] {
    const result: TrajectoryPoint[] = []
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

  // Add point to trajectory ring buffer
  addTrajectoryPoint(x: number, y: number, frameTs: number): void {
    this.trajectoryBuffer[this.trajectoryHead] = { x, y, t: frameTs }
    this.trajectoryHead = (this.trajectoryHead + 1) % this.MAX_POINTS
    if (this.trajectoryCount < this.MAX_POINTS) this.trajectoryCount++

    // Update peak (min y = highest point)
    if (y < this.peakY) {
      this.peakY = y
      this.apexPoint = { x, y }
    }
  }

  // Process frame for shot detection (replicates useTrackingEngine logic)
  processFrame(
    ballPosition: BallPosition | null,
    ballVelocity: BallVelocity | null,
    hoopPosition: HoopPosition | null,
    frameTs: number
  ): {
    shotDetected: boolean
    shotResult: 'MADE' | 'MISS' | 'AIRBALL' | null
    inFlight: boolean
    releasePoint: BallPosition | null
    apexPoint: BallPosition | null
  } {
    const vel = ballVelocity
    const ball = ballPosition

    // Dribble filter: count rising frames (from useTrackingEngine lines 466-496)
    if (vel && ball) {
      const isRising = vel.vy < -SHOT_LAUNCH_THRESHOLD

      if (isRising) {
        this.risingFrames++
        // Record Y at first rising frame
        if (this.risingFrames === 1) {
          this.flightStartY = ball.y
        }
      } else {
        // Not rising anymore → reset counter
        this.risingFrames = 0
      }

      // Set inFlight if: rising for MIN_RISING_FRAMES + arc high enough + enough trajectory frames
      if (!this.inFlight && this.risingFrames >= MIN_RISING_FRAMES) {
        const arcSoFar = this.flightStartY - ball.y  // positivo = salita
        if (arcSoFar >= MIN_ARC_HEIGHT && this.trajectoryCount >= MIN_TRAJECTORY_FRAMES) {
          this.inFlight = true
          // Save release point
          this.releasePoint = { x: ball.x, y: ball.y }
        }
      }
    }

    // Shot detection (MADE / MISS / AIRBALL) - from useTrackingEngine lines 513-556
    const hoop = hoopPosition
    const cooldownOk = (frameTs - this.lastShotTs) > SHOT_COOLDOWN_MS

    if (vel && hoop && ball && cooldownOk && !this.shotDetected) {
      const descending = vel.vy > DESCENDING_VY_THRESHOLD
      const dynamicHoopRadius = getDynamicHoopRadius(hoop)

      if (this.inFlight && descending) {
        const dx = ball.x - hoop.x
        const dy = ball.y - hoop.y
        const dist = Math.sqrt(dx * dx + dy * dy)

        const descendingTowardHoop = dy > 0 && dist < dynamicHoopRadius * 2

        if (descendingTowardHoop && dist < dynamicHoopRadius) {
          this.shotDetected = true
          this.shotResult = 'MADE'
          this.lastShotTs = frameTs
        } else if (descendingTowardHoop && dist >= dynamicHoopRadius) {
          this.shotDetected = true
          this.shotResult = 'MISS'
          this.lastShotTs = frameTs
        } else if (descending && vel.vy > SHOT_LAUNCH_THRESHOLD * 2) {
          this.shotDetected = true
          this.shotResult = dist < 0.25 ? 'MISS' : 'AIRBALL'
          this.lastShotTs = frameTs
        }
      }
    }

    return {
      shotDetected: this.shotDetected,
      shotResult: this.shotResult,
      inFlight: this.inFlight,
      releasePoint: this.releasePoint,
      apexPoint: this.apexPoint,
    }
  }

  resetShot(): void {
    this.shotDetected = false
    this.shotResult = null
    this.inFlight = false
    this.releasePoint = null
    this.apexPoint = null
    this.risingFrames = 0
    this.flightStartY = 1.0
  }

  resetAll(): void {
    this.resetShot()
    this.trajectoryBuffer.fill(null)
    this.trajectoryHead = 0
    this.trajectoryCount = 0
    this.peakY = Infinity
    this.lastShotTs = 0
  }

  // Getters for current state
  isInFlight(): boolean {
    return this.inFlight
  }

  getShotResult(): 'MADE' | 'MISS' | 'AIRBALL' | null {
    return this.shotResult
  }

  getTrajectoryPoints(): TrajectoryPoint[] {
    return this.getTrajectory()
  }

  // Get current state for UI adapter
  getState(): {
    shotDetected: boolean
    shotResult: 'MADE' | 'MISS' | 'AIRBALL' | null
    inFlight: boolean
    releasePoint: BallPosition | null
    apexPoint: BallPosition | null
  } {
    return {
      shotDetected: this.shotDetected,
      shotResult: this.shotResult,
      inFlight: this.inFlight,
      releasePoint: this.releasePoint,
      apexPoint: this.apexPoint,
    }
  }
}
