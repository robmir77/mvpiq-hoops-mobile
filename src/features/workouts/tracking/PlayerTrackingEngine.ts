// PlayerTrackingEngine
// Phase 4.1: Extract player tracking logic from useTrackingEngine
// Pure algorithm without React dependencies
// Uses frameTs for temporal consistency with ball tracking

const PLAYER_TRACK_TTL_MS = 1000

interface PlayerPosition {
  x: number
  y: number
  width: number
  height: number
  confidence: number
}

export class PlayerTrackingEngine {
  private lastSeenAt = 0
  private trackingValid = false
  private updateCount = 0

  // Pure state (no SharedValue)
  private state: PlayerPosition = {
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    confidence: 0,
  }

  update(x: number, y: number, width: number, height: number, confidence: number, frameTs: number): void {
    this.state = { x, y, width, height, confidence }
    this.lastSeenAt = frameTs
    this.trackingValid = true
    this.updateCount++

    // TEMP diagnostic: log every 50 updates to verify player detection flow
    if (this.updateCount % 50 === 0) {
      console.log('[PLAYER][ENGINE]', `updates=${this.updateCount} confidence=${confidence.toFixed(3)} x=${x.toFixed(3)} y=${y.toFixed(3)} valid=${this.trackingValid}`)
    }
  }

  // Calculate player center from pose keypoints (from useTrackingEngine lines 271-282)
  updateFromPose(poseKeypoints: any): { x: number; y: number } | null {
    if (poseKeypoints) {
      const leftHip = poseKeypoints.leftHip
      const rightHip = poseKeypoints.rightHip
      if (leftHip && rightHip) {
        return {
          x: (leftHip.x + rightHip.x) / 2,
          y: (leftHip.y + rightHip.y) / 2
        }
      }
    }
    return null
  }

  predict(frameTs: number): PlayerPosition | null {
    const ageMs = frameTs - this.lastSeenAt
    if (ageMs > PLAYER_TRACK_TTL_MS) {
      this.trackingValid = false
      return null
    }

    // Return last known position
    return { ...this.state }
  }

  getState(): PlayerPosition {
    return { ...this.state }
  }

  reset(): void {
    this.state = {
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      confidence: 0,
    }
    this.trackingValid = false
    this.lastSeenAt = 0
  }

  isValid(): boolean {
    return this.trackingValid
  }
}
