// src/vision/playerCrop.ts
//
// Player crop utility for MoveNet optimization
// Crops the frame around the player bbox with padding and smoothing
// Handles temporary player loss with bbox persistence

export interface PlayerCropConfig {
  paddingPercent: number // Padding around bbox (default 0.15 = 15%)
  smoothingFactor: number // Smoothing factor for bbox (0-1, default 0.3)
  maxLostFrames: number // Max frames to use last bbox when player lost (default 5)
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

const DEFAULT_CONFIG: PlayerCropConfig = {
  paddingPercent: 0.15,
  smoothingFactor: 0.3,
  maxLostFrames: 5,
}

class PlayerCropManager {
  private config: PlayerCropConfig
  private lastBbox: BBox | null = null
  private smoothedBbox: BBox | null = null
  private lostFrameCount: number = 0

  constructor(config: Partial<PlayerCropConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * Calculate crop region from player bbox with padding and smoothing
   * @param playerBbox - Current player detection from YOLO (normalized 0-1)
   * @param frameWidth - Frame width in pixels
   * @param frameHeight - Frame height in pixels
   * @returns Crop region in pixel coordinates
   */
  calculateCrop(
    playerBbox: BBox | null,
    frameWidth: number,
    frameHeight: number
  ): PlayerCropResult {
    let effectiveBbox: BBox | null = playerBbox
    let isUsingLastBbox = false

    // Handle player loss - use last valid bbox
    if (!playerBbox) {
      if (this.lastBbox && this.lostFrameCount < this.config.maxLostFrames) {
        effectiveBbox = this.lastBbox
        this.lostFrameCount++
        isUsingLastBbox = true
      } else {
        // Player lost for too long - reset
        this.reset()
        return {
          cropX: 0,
          cropY: 0,
          cropWidth: frameWidth,
          cropHeight: frameHeight,
          isValid: false,
          isUsingLastBbox: false,
        }
      }
    } else {
      // Player found - reset lost counter
      this.lostFrameCount = 0
      this.lastBbox = playerBbox
    }

    if (!effectiveBbox) {
      return {
        cropX: 0,
        cropY: 0,
        cropWidth: frameWidth,
        cropHeight: frameHeight,
        isValid: false,
        isUsingLastBbox: false,
      }
    }

    // Apply smoothing to bbox
    if (this.smoothedBbox) {
      this.smoothedBbox = {
        x: this.lerp(this.smoothedBbox.x, effectiveBbox.x, this.config.smoothingFactor),
        y: this.lerp(this.smoothedBbox.y, effectiveBbox.y, this.config.smoothingFactor),
        width: this.lerp(this.smoothedBbox.width, effectiveBbox.width, this.config.smoothingFactor),
        height: this.lerp(this.smoothedBbox.height, effectiveBbox.height, this.config.smoothingFactor),
      }
    } else {
      this.smoothedBbox = effectiveBbox
    }

    const bbox = this.smoothedBbox!

    // Add padding
    const paddingX = bbox.width * this.config.paddingPercent
    const paddingY = bbox.height * this.config.paddingPercent

    let cropX = bbox.x - paddingX
    let cropY = bbox.y - paddingY
    let cropWidth = bbox.width + 2 * paddingX
    let cropHeight = bbox.height + 2 * paddingY

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
      isUsingLastBbox,
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
    this.lostFrameCount = 0
  }

  /**
   * Get current state
   */
  getState(): {
    lastBbox: BBox | null
    smoothedBbox: BBox | null
    lostFrameCount: number
  } {
    return {
      lastBbox: this.lastBbox,
      smoothedBbox: this.smoothedBbox,
      lostFrameCount: this.lostFrameCount,
    }
  }
}

// Singleton instance for global use
export const playerCropManager = new PlayerCropManager()

// Export class for testing/custom instances
export { PlayerCropManager }
