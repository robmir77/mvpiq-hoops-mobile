// src/vision/usePlayerCropManager.ts
//
// Player crop utility for MoveNet optimization
// Crops the frame around the player bbox with padding and smoothing
// Handles temporary player loss with bbox persistence
// Uses Reanimated SharedValues for worklet compatibility

import { useSharedValue } from 'react-native-reanimated'

// Import YOLO config for threshold
const YOLO_CONFIG = {
  PLAYER_CROP_MIN_CONFIDENCE: 0.01
}

export interface PlayerCropConfig {
  paddingPercent: number // Padding around bbox (default 0.15 = 15%)
  smoothingFactor: number // Smoothing factor for bbox (0-1, default 0.3)
  bboxTtlMs: number // Time-based TTL for bbox validity in milliseconds (default 750)
  minConfidence: number // Minimum confidence threshold for player detection (default 0.3)
  maxJumpThreshold: number // Maximum allowed bbox jump between frames (normalized, default 0.15)
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
  confidence?: number
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
  minConfidence: YOLO_CONFIG.PLAYER_CROP_MIN_CONFIDENCE,
  maxJumpThreshold: 0.15, // Reject bbox jumps larger than 15% of frame
}

/**
 * Linear interpolation (pure worklet function)
 */
const lerp = (a: number, b: number, t: number): number => {
  'worklet'
  return a + (b - a) * t
}

/**
 * Hook for managing player crop region with Reanimated SharedValues
 * All state is stored in SharedValues for worklet compatibility
 * Functions are pure worklet functions that operate on shared values
 */
export function usePlayerCropManager(config: Partial<PlayerCropConfig> = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...config }

  // Raw bbox from latest detection
  const bboxX = useSharedValue(0)
  const bboxY = useSharedValue(0)
  const bboxWidth = useSharedValue(0)
  const bboxHeight = useSharedValue(0)
  const bboxConfidence = useSharedValue(0)

  // Smoothed bbox (exponential moving average)
  const smoothedX = useSharedValue(0)
  const smoothedY = useSharedValue(0)
  const smoothedWidth = useSharedValue(0)
  const smoothedHeight = useSharedValue(0)
  const smoothedConfidence = useSharedValue(0)

  // Tracking state
  const lastSeenAt = useSharedValue(0)
  const detectedAt = useSharedValue(0)
  const hasBbox = useSharedValue(false)

  /**
   * Update player bbox with new detection
   * @param playerBbox - Current player detection from YOLO (normalized 0-1), null if not detected
   */
  const update = (playerBbox: BBox | null) => {
    'worklet'
    const now = Date.now()

    if (playerBbox) {
      // Apply confidence threshold filter
      const confidence = playerBbox.confidence ?? 1.0
      if (confidence < cfg.minConfidence) {
        // Low confidence detection - ignore but don't reset tracking
        if (__DEV__) {
          console.log('[PLAYER CROP] Rejected low confidence:', confidence.toFixed(6), 'threshold:', cfg.minConfidence)
        }
        return
      }

      // Apply jump threshold filter (stability check)
      if (hasBbox.value && smoothedX.value !== 0) {
        const dx = Math.abs(playerBbox.x - smoothedX.value)
        const dy = Math.abs(playerBbox.y - smoothedY.value)
        const jump = Math.sqrt(dx * dx + dy * dy)

        if (jump > cfg.maxJumpThreshold) {
          // Bbox jumped too much - reject as noise
          if (__DEV__) {
            console.log('[PLAYER CROP] Rejected large jump:', jump.toFixed(3), 'threshold:', cfg.maxJumpThreshold, 'from:', smoothedX.value.toFixed(3), smoothedY.value.toFixed(3), 'to:', playerBbox.x.toFixed(3), playerBbox.y.toFixed(3))
          }
          return
        }
      }

      // Player detected - update tracking state
      bboxX.value = playerBbox.x
      bboxY.value = playerBbox.y
      bboxWidth.value = playerBbox.width
      bboxHeight.value = playerBbox.height
      bboxConfidence.value = confidence
      detectedAt.value = now
      lastSeenAt.value = now
      hasBbox.value = true
    }
    // If playerBbox is null, we don't update lastSeenAt - let it expire naturally
  }

  /**
   * Get effective bbox for MoveNet processing
   * @param now - Current timestamp (Date.now())
   * @returns Tracked bbox with state information, or null if expired
   */
  const getEffectiveBbox = (now: number): TrackedPlayerBbox | null => {
    'worklet'
    if (!hasBbox.value || lastSeenAt.value === 0) {
      return null
    }

    const ageMs = now - lastSeenAt.value
    const isStale = ageMs > cfg.bboxTtlMs
    const isUsingLastBbox = ageMs > 0

    if (isStale) {
      // BBox expired - reset tracking state
      hasBbox.value = false
      lastSeenAt.value = 0
      detectedAt.value = 0
      return null
    }

    // Apply smoothing to bbox
    if (smoothedX.value === 0 && smoothedY.value === 0) {
      // First detection - initialize smoothed values
      smoothedX.value = bboxX.value
      smoothedY.value = bboxY.value
      smoothedWidth.value = bboxWidth.value
      smoothedHeight.value = bboxHeight.value
      smoothedConfidence.value = bboxConfidence.value
    } else {
      // Apply exponential moving average
      smoothedX.value = lerp(smoothedX.value, bboxX.value, cfg.smoothingFactor)
      smoothedY.value = lerp(smoothedY.value, bboxY.value, cfg.smoothingFactor)
      smoothedWidth.value = lerp(smoothedWidth.value, bboxWidth.value, cfg.smoothingFactor)
      smoothedHeight.value = lerp(smoothedHeight.value, bboxHeight.value, cfg.smoothingFactor)
      smoothedConfidence.value = lerp(smoothedConfidence.value, bboxConfidence.value, cfg.smoothingFactor)
    }

    return {
      bbox: {
        x: smoothedX.value,
        y: smoothedY.value,
        width: smoothedWidth.value,
        height: smoothedHeight.value,
        confidence: smoothedConfidence.value,
      },
      detectedAt: detectedAt.value,
      lastSeenAt: lastSeenAt.value,
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
  const calculateCrop = (
    trackedBbox: TrackedPlayerBbox | null,
    frameWidth: number,
    frameHeight: number
  ): PlayerCropResult => {
    'worklet'
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

    // Convert normalized bbox (0-1) to pixel coordinates
    const pixelX = effectiveBbox.x * frameWidth
    const pixelY = effectiveBbox.y * frameHeight
    const pixelWidth = effectiveBbox.width * frameWidth
    const pixelHeight = effectiveBbox.height * frameHeight

    // Add padding (in pixels)
    const paddingX = pixelWidth * cfg.paddingPercent
    const paddingY = pixelHeight * cfg.paddingPercent

    let cropX = pixelX - paddingX
    let cropY = pixelY - paddingY
    let cropWidth = pixelWidth + 2 * paddingX
    let cropHeight = pixelHeight + 2 * paddingY

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
  const transformKeypointsToFrame = (
    keypoints: Array<{ x: number; y: number; confidence?: number }>,
    crop: PlayerCropResult,
    frameWidth: number,
    frameHeight: number
  ): Array<{ x: number; y: number; confidence?: number }> => {
    'worklet'
    return keypoints.map(kp => ({
      x: (crop.cropX + kp.x * crop.cropWidth) / frameWidth,
      y: (crop.cropY + kp.y * crop.cropHeight) / frameHeight,
      confidence: kp.confidence,
    }))
  }

  /**
   * Reset the crop manager state
   */
  const reset = () => {
    'worklet'
    hasBbox.value = false
    lastSeenAt.value = 0
    detectedAt.value = 0
    smoothedX.value = 0
    smoothedY.value = 0
    smoothedWidth.value = 0
    smoothedHeight.value = 0
    smoothedConfidence.value = 0
    bboxConfidence.value = 0
  }

  /**
   * Get current state (for debugging/telemetry)
   */
  const getState = (): {
    lastBbox: BBox | null
    smoothedBbox: BBox | null
    lastSeenAt: number
    detectedAt: number
    isStale: boolean
    ageMs: number
  } => {
    'worklet'
    const now = Date.now()
    const ageMs = lastSeenAt.value > 0 ? now - lastSeenAt.value : 0
    const isStale = ageMs > cfg.bboxTtlMs

    return {
      lastBbox: hasBbox.value
        ? { x: bboxX.value, y: bboxY.value, width: bboxWidth.value, height: bboxHeight.value, confidence: smoothedConfidence.value }
        : null,
      smoothedBbox: hasBbox.value
        ? { x: smoothedX.value, y: smoothedY.value, width: smoothedWidth.value, height: smoothedHeight.value, confidence: smoothedConfidence.value }
        : null,
      lastSeenAt: lastSeenAt.value,
      detectedAt: detectedAt.value,
      isStale,
      ageMs,
    }
  }

  return {
    update,
    getEffectiveBbox,
    calculateCrop,
    transformKeypointsToFrame,
    reset,
    getState,
  }
}
