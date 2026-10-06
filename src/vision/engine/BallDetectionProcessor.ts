// BallDetectionProcessor
// Pure class for ball detection filtering and validation
// Worklet-safe, no React dependencies
// Extracted from yoloParserFloat16.ts

export interface BallDetection {
  x: number
  y: number
  width: number
  height: number
  confidence: number
}

export interface BallDetectionResult {
  detection: BallDetection | null
  sizeCategory: 'small' | 'medium' | 'large' | null
  adaptiveThreshold: number
  rejectionReason?: string
}

export class BallDetectionProcessor {
  private baseThreshold: number
  private minBallSize: number
  private maxBallSize: number

  constructor(
    baseThreshold: number = 0.005,
    minBallSize: number = 0.01,
    maxBallSize: number = 0.40
  ) {
    this.baseThreshold = baseThreshold
    this.minBallSize = minBallSize
    this.maxBallSize = maxBallSize
  }

  // Adaptive confidence threshold based on detected ball size
  private getAdaptiveThreshold(
    ballWidth: number,
    ballHeight: number,
    resolutionScale: number = 1.0
  ): number {
    const avgSize = (ballWidth + ballHeight) / 2

    // Large object (radius 0.2 = diameter 0.4 = avgSize 0.4)
    const MAX_SIZE = this.maxBallSize * resolutionScale
    if (avgSize >= MAX_SIZE) {
      return this.baseThreshold
    }

    // Small / distant object (radius 0.05 = diameter 0.1 = avgSize 0.1)
    const MIN_SIZE = this.minBallSize * resolutionScale
    const MIN_THRESHOLD = 0.01

    // Normalize size to 0..1
    let t = (avgSize - MIN_SIZE) / (MAX_SIZE - MIN_SIZE)

    // Clamp
    if (t < 0) t = 0
    else if (t > 1) t = 1

    // Smooth interpolation
    const smoothT = t * t * (3 - 2 * t)

    return MIN_THRESHOLD + (this.baseThreshold - MIN_THRESHOLD) * smoothT
  }

  // Validate bounding box geometry - reject suspicious aspect ratios
  private isValidBallGeometry(width: number, height: number): { valid: boolean; aspectRatio: number } {
    if (width <= 0 || height <= 0) {
      return { valid: false, aspectRatio: 0 }
    }

    const aspectRatio = width / height

    // Reject extremely wide or tall boxes (aspect ratio > 4.0 or < 0.25)
    if (aspectRatio > 4.0 || aspectRatio < 0.25) {
      return { valid: false, aspectRatio }
    }

    return { valid: true, aspectRatio }
  }

  // Determine ball size category based on average size
  private getBallSizeCategory(avgSize: number): 'small' | 'medium' | 'large' | null {
    if (avgSize < 0.10) return 'small'
    if (avgSize < 0.20) return 'medium'
    if (avgSize >= 0.20) return 'large'
    return null
  }

  // Process and validate a ball detection
  processDetection(
    detection: BallDetection,
    resolutionScale: number = 1.0
  ): BallDetectionResult {
    const avgSize = (detection.width + detection.height) / 2

    // Check minimum size
    if (avgSize < this.minBallSize * resolutionScale) {
      return {
        detection: null,
        sizeCategory: null,
        adaptiveThreshold: this.baseThreshold,
        rejectionReason: 'too_small',
      }
    }

    // Validate geometry
    const geometryCheck = this.isValidBallGeometry(detection.width, detection.height)
    if (!geometryCheck.valid) {
      return {
        detection: null,
        sizeCategory: null,
        adaptiveThreshold: this.baseThreshold,
        rejectionReason: 'invalid_geometry',
      }
    }

    // Apply adaptive threshold
    const adaptiveThreshold = this.getAdaptiveThreshold(
      detection.width,
      detection.height,
      resolutionScale
    )

    if (detection.confidence < adaptiveThreshold) {
      return {
        detection: null,
        sizeCategory: this.getBallSizeCategory(avgSize),
        adaptiveThreshold,
        rejectionReason: 'low_confidence',
      }
    }

    // Detection is valid
    return {
      detection,
      sizeCategory: this.getBallSizeCategory(avgSize),
      adaptiveThreshold,
    }
  }

  // Set base threshold
  setBaseThreshold(threshold: number): void {
    this.baseThreshold = threshold
  }

  // Set minimum ball size
  setMinBallSize(size: number): void {
    this.minBallSize = size
  }

  // Set maximum ball size
  setMaxBallSize(size: number): void {
    this.maxBallSize = size
  }
}
