// src/vision/shotDetector.ts
//
// Shot detection logic from ball trajectory and pose
// Determines shot start, release, and result

import type { BallDetection, ShotEvent, ShotCandidate } from './types'

const SHOT_CANDIDATE_THRESHOLD_Y = 0.4 // Ball in upper part of frame (normalized 0-1)
const SHOT_CANDIDATE_VELOCITY_Y = -0.3 // Ball moving upward (normalized/sec)
const SHOT_RELEASE_VELOCITY_THRESHOLD = -1.0 // Minimum upward velocity for release (normalized/sec)
const SHOT_APEX_DETECTION_THRESHOLD = 0.1 // Velocity near zero for apex (normalized/sec)

export class ShotDetector {
  private trajectory: Array<{ x: number; y: number; t: number }> = []
  private shotStarted = false
  private shotReleased = false
  private shotMade = false
  private releasePoint?: { x: number; y: number }
  private releaseAngle?: number

  // Check if current ball position is a shot candidate
  isShotCandidate(ball: BallDetection['ball'], velocity: { vx: number; vy: number }): boolean {
    if (!ball) return false
    
    // Ball must be in upper part of frame (ball.y is already normalized 0-1)
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

  // Calculate ball velocity from trajectory
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
    
    if (this.isShotCandidate(ball, velocity)) {
      this.shotStarted = true
      return true
    }
    
    return false
  }

  // Detect shot release
  detectShotRelease(): boolean {
    if (!this.shotStarted || this.shotReleased) return false
    
    const velocity = this.calculateVelocity()
    if (!velocity) return false
    
    // Release when ball has strong upward velocity
    if (velocity.vy < SHOT_RELEASE_VELOCITY_THRESHOLD) {
      this.shotReleased = true
      this.releasePoint = this.trajectory[this.trajectory.length - 1]
      
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
    if (!this.shotReleased || this.shotMade) return false
    
    const velocity = this.calculateVelocity()
    if (!velocity || !rim) return false
    
    // Ball must be moving downward
    if (velocity.vy > 0) {
      const lastPoint = this.trajectory[this.trajectory.length - 1]
      const rimCenterX = rim.x + rim.width / 2
      const rimCenterY = rim.y + rim.height / 2
      
      // Check if ball is near rim center
      const distance = Math.sqrt(
        Math.pow(lastPoint.x - rimCenterX, 2) + 
        Math.pow(lastPoint.y - rimCenterY, 2)
      )
      
      if (distance < rim.width / 2) {
        this.shotMade = true
        return true
      }
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
    this.releasePoint = undefined
    this.releaseAngle = undefined
  }
}
