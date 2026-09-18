// src/vision/playerCrop.ts
//
// Player crop utility for MoveNet optimization
// Crops the frame around the player bbox with padding and smoothing
// Handles temporary player loss with bbox persistence

export interface PlayerCropConfig {
  paddingPercent: number // Padding around bbox (default 0.15 = 15%)
  smoothingFactor: number // Smoothing factor for bbox (0-1, default 0.3)
  bboxTtlMs: number // Time-based TTL for bbox validity in milliseconds (default 750)
}

export interface PlayerCropResult {
  cropX: number
  cropY: number
  cropWidth: number
  cropHeight: number
  isValid: boolean
  isUsingLastBbox: boolean
}

export interface BBox {
  x: number
  y: number
  width: number
  height: number
}

export interface TrackedPlayerBbox {
  bbox: BBox
  detectedAt: number
  lastSeenAt: number
  isStale: boolean
  ageMs: number
  isUsingLastBbox: boolean
}

const DEFAULT_CONFIG: PlayerCropConfig = {
  paddingPercent: 0.15,
  smoothingFactor: 0.3,
  bboxTtlMs: 750,
}

class PlayerCropManager {
  private config: PlayerCropConfig
  private lastBbox: BBox | null = null
  private smoothedBbox: BBox | null = null
  private lastSeenAt: number = 0
  private detectedAt: number = 0

  constructor(config: Partial<PlayerCropConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * Update player bbox with new detection
   * @param playerBbox - Current player detection from YOLO (normalized 0-1), null if not detected
   */
  update(playerBbox: BBox | null): void {
    const now = Date.now()
    
    if (playerBbox) {
      // Player detected - update tracking state
      this.lastBbox = playerBbox
      this.detectedAt = now
      this.lastSeenAt = now
    }
    // If playerBbox is null, we don't update lastSeenAt - let it expire naturally
  }

  /**
   * Get effective bbox for MoveNet processing
   * @param now - Current timestamp (Date.now())
 * @returns Tracked bbox with state information, or null if expired
   */
  getEffectiveBbox(now: number): TrackedPlayerBbox | null {
    if (!this.lastBbox) {
      return null
    }

    const ageMs = now - this.lastSeenAt
    const isStale = ageMs > this.config.bboxTtlMs
    const isUsingLastBbox = ageMs > 0

    if (isStale) {
      // BBox expired - reset tracking state
      this.reset()
      return null
    }

    // Apply smoothing to bbox
    if (this.smoothedBbox) {
      this.smoothedBbox = {
        x: this.lerp(this.smoothedBbox.x, this.lastBbox.x, this.config.smoothingFactor),
        y: this.lerp(this.smoothedBbox.y, this.lastBbox.y, this.config.smoothingFactor),
        width: this.lerp(this.smoothedBbox.width, this.lastBbox.width, this.config.smoothingFactor),
        height: this.lerp(this.smoothedBbox.height, this.lastBbox.height, this.config.smoothingFactor),
      }
    } else {
      this.smoothedBbox = this.lastBbox
    }

    return {
      bbox: this.smoothedBbox!,
      detectedAt: this.detectedAt,
      lastSeenAt: this.lastSeenAt,
      isStale,
      ageMs,
      isUsingLastBbox,
    }
  }

  /**
   * Calculate crop region from tracked bbox with padding
   * @param trackedBbox - Tracked bbox from getEffectiveBbox()
   * @param frameWidth - Frame width in pixels
   * @param frameHeight - Frame height in pixels
   * @returns Crop region in pixel coordinates
   */
  calculateCrop(
    trackedBbox: TrackedPlayerBbox | null,
    frameWidth: number,
    frameHeight: number
  ): PlayerCropResult {
    if (!trackedBbox) {
      return {
        cropX: 0,
        cropY: 0,
        cropWidth: frameWidth,
        cropHeight: frameHeight,
        isValid: false,
        isUsingLastBbox: false,
      }
    }

    const effectiveBbox = trackedBbox.bbox

    // Add padding
    const paddingX = effectiveBbox.width * this.config.paddingPercent
    const paddingY = effectiveBbox.height * this.config.paddingPercent

    let cropX = effectiveBbox.x - paddingX
    let cropY = effectiveBbox.y - paddingY
    let cropWidth = effectiveBbox.width + 2 * paddingX
    let cropHeight = effectiveBbox.height + 2 * paddingY

    // Clamp to frame boundaries
    cropX = Math.max(0, cropX)
    cropY = Math.max(0, cropY)
    cropWidth = Math.min(frameWidth - cropX, cropWidth)
    cropHeight = Math.min(frameHeight - cropY, cropHeight)

    // Ensure minimum crop size
    const minCropSize = Math.min(frameWidth, frameHeight) * 0.2
    cropWidth = Math.max(minCropSize, cropWidth)
    cropHeight = Math.max(minCropSize, cropHeight)

    return {
      cropX,
      cropY,
      cropWidth,
      cropHeight,
      isValid: true,
      isUsingLastBbox: trackedBbox.isUsingLastBbox,
    }
  }

  /**
   * Transform MoveNet keypoints from crop space back to original frame space
   * @param keypoints - Keypoints in normalized crop coordinates (0-1)
   * @param crop - Crop region used for MoveNet
   * @param frameWidth - Original frame width
   * @param frameHeight - Original frame height
   * @returns Keypoints in original frame coordinates (normalized 0-1)
   */
  transformKeypointsToFrame(
    keypoints: Array<{ x: number; y: number; confidence?: number }>,
    crop: PlayerCropResult,
    frameWidth: number,
    frameHeight: number
  ): Array<{ x: number; y: number; confidence?: number }> {
    return keypoints.map(kp => ({
      x: (crop.cropX + kp.x * crop.cropWidth) / frameWidth,
      y: (crop.cropY + kp.y * crop.cropHeight) / frameHeight,
      confidence: kp.confidence,
    }))
  }

  /**
   * Linear interpolation
   */
  private lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t
  }

  /**
   * Reset the crop manager state
   */
  reset(): void {
    this.lastBbox = null
    this.smoothedBbox = null
    this.lastSeenAt = 0
    this.detectedAt = 0
  }

  /**
   * Get current state
   */
  getState(): {
    lastBbox: BBox | null
    smoothedBbox: BBox | null
    lastSeenAt: number
    detectedAt: number
    isStale: boolean
    ageMs: number
  } {
    const now = Date.now()
    const ageMs = this.lastSeenAt > 0 ? now - this.lastSeenAt : 0
    const isStale = ageMs > this.config.bboxTtlMs
    
    return {
      lastBbox: this.lastBbox,
      smoothedBbox: this.smoothedBbox,
      lastSeenAt: this.lastSeenAt,
      detectedAt: this.detectedAt,
      isStale,
      ageMs,
    }
  }
}

// Singleton instance for global use
export const playerCropManager = new PlayerCropManager()

// Export class for testing/custom instances
export { PlayerCropManager }
