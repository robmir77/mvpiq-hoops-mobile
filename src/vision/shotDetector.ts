// src/vision/shotDetector.ts
//
// Shot detection logic from ball trajectory and pose
// Determines shot start, release, and result

import type { BallDetection, ShotEvent, ShotCandidate } from './types'

const SHOT_CANDIDATE_THRESHOLD_Y = 0.3 // Ball above 30% of frame height (normalized)
const SHOT_CANDIDATE_VELOCITY_Y = -0.5 // Ball moving upward (negative Y velocity, normalized units/s)
const SHOT_RELEASE_VELOCITY_THRESHOLD = -1.0 // Minimum upward velocity for release (normalized units/s)
const SHOT_APEX_DETECTION_THRESHOLD = 0.1 // Velocity near zero for apex (normalized units/s)
const MIN_STABLE_FRAMES = 5 // Minimum consecutive stable frames before shot start
const STABILITY_THRESHOLD = 0.05 // Maximum position change for stability (normalized)
const MIN_UPWARD_FRAMES = 3 // Minimum consecutive upward frames for release

export class ShotDetector {
  private trajectory: Array<{ x: number; y: number; t: number }> = []
  private shotStarted = false
  private shotReleased = false
  private shotMade = false
  private shotMiss = false
  private releasePoint?: { x: number; y: number }
  private releaseAngle?: number
  private releaseTime?: number
  private stableFrameCount = 0 // Count of consecutive stable frames
  private upwardFrameCount = 0 // Count of consecutive upward frames

  // Check if current ball position is a shot candidate
  isShotCandidate(ball: BallDetection['ball'], velocity: { vx: number; vy: number }): boolean {
    if (!ball) return false

    // Ball must be in upper part of frame (normalized coordinates)
    if (ball.y < SHOT_CANDIDATE_THRESHOLD_Y) return false

    // Ball must be moving upward
    if (velocity.vy > SHOT_CANDIDATE_VELOCITY_Y) return false

    return true
  }

  // Update trajectory with new ball position
  updateTrajectory(ball: BallDetection['ball']): void {
    if (!ball) return
    
    const centerX = ball.x + ball.width / 2
    const centerY = ball.y + ball.height / 2
    
    this.trajectory.push({ x: centerX, y: centerY, t: Date.now() })
    
    // Keep only last 30 points (1 second at 30fps)
    if (this.trajectory.length > 30) {
      this.trajectory.shift()
    }
  }

  // Calculate ball velocity from trajectory (normalized units per second)
  calculateVelocity(): { vx: number; vy: number } | null {
    if (this.trajectory.length < 3) return null

    const recent = this.trajectory.slice(-3)
    const dt = recent[2].t - recent[0].t
    if (dt === 0) return null

    const dx = recent[2].x - recent[0].x
    const dy = recent[2].y - recent[0].y

    return {
      vx: (dx / dt) * 1000, // normalized units per second
      vy: (dy / dt) * 1000,
    }
  }

  // Detect shot start
  detectShotStart(ball: BallDetection['ball']): boolean {
    if (this.shotStarted || !ball) return false

    const velocity = this.calculateVelocity()
    if (!velocity) return false

    // Check if ball is stable (not moving much)
    if (this.trajectory.length >= 2) {
      const last = this.trajectory[this.trajectory.length - 1]
      const prev = this.trajectory[this.trajectory.length - 2]
      const dx = Math.abs(last.x - prev.x)
      const dy = Math.abs(last.y - prev.y)

      if (dx < STABILITY_THRESHOLD && dy < STABILITY_THRESHOLD) {
        this.stableFrameCount++
      } else {
        this.stableFrameCount = 0
      }
    }

    // Only start shot if we have enough stable frames AND it's a candidate
    if (this.stableFrameCount >= MIN_STABLE_FRAMES && this.isShotCandidate(ball, velocity)) {
      this.shotStarted = true
      this.stableFrameCount = 0 // Reset for next shot
      return true
    }

    return false
  }

  // Detect shot release
  detectShotRelease(): boolean {
    if (!this.shotStarted || this.shotReleased) return false

    const velocity = this.calculateVelocity()
    if (!velocity) return false

    // Count consecutive upward frames
    if (velocity.vy < SHOT_CANDIDATE_VELOCITY_Y) {
      this.upwardFrameCount++
    } else {
      this.upwardFrameCount = 0
    }

    // Release when we have consecutive upward frames AND strong upward velocity
    if (this.upwardFrameCount >= MIN_UPWARD_FRAMES && velocity.vy < SHOT_RELEASE_VELOCITY_THRESHOLD) {
      this.shotReleased = true
      this.releasePoint = this.trajectory[this.trajectory.length - 1]
      this.releaseTime = Date.now()
      this.upwardFrameCount = 0 // Reset for next shot

      // Calculate release angle from trajectory
      if (this.trajectory.length >= 2) {
        const last = this.trajectory[this.trajectory.length - 1]
        const prev = this.trajectory[this.trajectory.length - 2]
        const dx = last.x - prev.x
        const dy = last.y - prev.y
        this.releaseAngle = Math.atan2(-dy, dx) * (180 / Math.PI)
      }

      return true
    }

    return false
  }

  // Detect shot made (ball going downward through rim area)
  detectShotMade(rim: { x: number; y: number; width: number; height: number } | null): boolean {
    if (!this.shotReleased || this.shotMade || this.shotMiss) return false

    const velocity = this.calculateVelocity()
    if (!velocity || !rim) return false

    // Ball must be moving downward
    if (velocity.vy > 0) {
      const lastPoint = this.trajectory[this.trajectory.length - 1]
      const rimCenterX = rim.x + rim.width / 2
      const rimCenterY = rim.y + rim.height / 2

      // Check if ball is near rim center (stricter threshold)
      const distance = Math.sqrt(
        Math.pow(lastPoint.x - rimCenterX, 2) +
        Math.pow(lastPoint.y - rimCenterY, 2)
      )

      // Require ball to be within 40% of rim width (stricter than 50%)
      if (distance < rim.width * 0.4) {
        // Also check that ball is actually descending toward rim
        if (this.trajectory.length >= 3) {
          const recent = this.trajectory.slice(-3)
          const isDescending = recent[2].y > recent[0].y // Moving down
          const isApproaching = Math.sqrt(
            Math.pow(recent[2].x - rimCenterX, 2) +
            Math.pow(recent[2].y - rimCenterY, 2)
          ) < Math.sqrt(
            Math.pow(recent[0].x - rimCenterX, 2) +
            Math.pow(recent[0].y - rimCenterY, 2)
          ) // Getting closer

          if (isDescending && isApproaching) {
            this.shotMade = true
            return true
          }
        }
      }
    }

    return false
  }

  // Detect shot miss (timeout after release without made detection)
  detectShotMiss(): boolean {
    if (!this.shotReleased || this.shotMade || this.shotMiss) return false
    if (!this.releaseTime) return false
    
    // Consider shot missed after 2 seconds from release without made detection
    const timeSinceRelease = Date.now() - this.releaseTime
    if (timeSinceRelease > 2000) {
      this.shotMiss = true
      return true
    }
    
    return false
  }

  // Get current shot event
  getShotEvent(): ShotEvent | null {
    if (!this.shotStarted) return null
    
    return {
      shotStarted: this.shotStarted,
      shotReleased: this.shotReleased,
      shotMade: this.shotMade,
      shotMiss: this.shotMiss,
      releasePoint: this.releasePoint,
      releaseAngle: this.releaseAngle,
      timestamp: Date.now(),
    }
  }

  // Reset shot detection
  reset(): void {
    this.trajectory = []
    this.shotStarted = false
    this.shotReleased = false
    this.shotMade = false
    this.shotMiss = false
    this.releasePoint = undefined
    this.releaseAngle = undefined
    this.releaseTime = undefined
    this.stableFrameCount = 0
    this.upwardFrameCount = 0
  }
}
