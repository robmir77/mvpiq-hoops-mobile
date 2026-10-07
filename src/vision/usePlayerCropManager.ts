// src/vision/usePlayerCropManager.ts
//
// Player crop utility for MoveNet optimization
// Crops the frame around the player bbox with padding and smoothing
// Handles temporary player loss with bbox persistence
// Uses Reanimated SharedValues for worklet compatibility

import { useSharedValue } from 'react-native-reanimated'
import { YOLO_CONFIG } from '@/config/appConfig'
import { ENABLE_PLAYER_CROP_LOGS } from '@/config/debugConfig'

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
  // Padding info for aspect-ratio-preserving square crop
  squareCropX?: number
  squareCropY?: number
  squareCropSize?: number
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
  detectionId: number // ID of the YOLO detection that produced this bbox
}

const DEFAULT_CONFIG: PlayerCropConfig = {
  paddingPercent: 0.15,
  smoothingFactor: 0.1, // PASS 5H-B: reduced from 0.3 to test cost impact
  bboxTtlMs: 750,
  minConfidence: YOLO_CONFIG.PLAYER_CROP_MIN_CONFIDENCE,
  maxJumpThreshold: 0.15, // Reject bbox jumps larger than 15% of frame
}

const MAX_CONSECUTIVE_REJECTS = 3 // Safety net: force accept after N consecutive rejects

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
  const consecutiveRejects = useSharedValue(0) // Safety net: force accept after N consecutive rejects
  const detectionId = useSharedValue(0) // Incremented on each new YOLO detection
  const lastProcessedDetectionId = useSharedValue(0) // Last detectionId processed by frame processor

  // Internal profiling counters (for debugging frame processor cost)
  const updateCount = useSharedValue(0)
  const updateTimeMs = useSharedValue(0)
  const getEffectiveBboxCount = useSharedValue(0)
  const getEffectiveBboxTimeMs = useSharedValue(0)
  const sharedValueWrites = useSharedValue(0)

  // PASS 5D: Granular profiling for getEffectiveBbox() breakdown
  const getEffectiveBboxSvReadsMs = useSharedValue(0)
  const getEffectiveBboxAgeTtlMs = useSharedValue(0)
  const getEffectiveBboxDetectionIdMs = useSharedValue(0)
  const getEffectiveBboxSmoothingMs = useSharedValue(0)
  const getEffectiveBboxSvWritesMs = useSharedValue(0)
  const getEffectiveBboxResultMs = useSharedValue(0)

  // PASS 5E: Separate smoothing into reads/lerp/writes/result to close ~5ms gap
  const smoothingReadsMs = useSharedValue(0)
  const smoothingLerpMs = useSharedValue(0)
  const smoothingWritesMs = useSharedValue(0)
  const resultReadsMs = useSharedValue(0)
  const resultConstructionMs = useSharedValue(0)

  // PASS 5F: Measure Date.now() overhead and unaccounted time
  const dateNowOverheadMs = useSharedValue(0)
  const smoothingUnaccountedMs = useSharedValue(0)
  const resultUnaccountedMs = useSharedValue(0)

  /**
   * Update player bbox with new detection
   * @param playerBbox - Current player detection from YOLO (normalized 0-1), null if not detected
   */
  const update = (playerBbox: BBox | null) => {
    'worklet'
    const tStart = Date.now()
    const now = Date.now()

    if (playerBbox) {
      // Apply confidence threshold filter
      const confidence = playerBbox.confidence ?? 1.0
      if (confidence < cfg.minConfidence) {
        // Low confidence detection - ignore but don't reset tracking
        return
      }

      // Apply jump threshold filter (stability check)
      // Compare against last accepted raw bbox (bboxX/Y), not smoothed value
      // This prevents feedback loop where smoothed value lags behind and blocks legitimate updates
      if (hasBbox.value && bboxX.value !== 0) {
        const dx = Math.abs(playerBbox.x - bboxX.value)
        const dy = Math.abs(playerBbox.y - bboxY.value)
        const jump = Math.sqrt(dx * dx + dy * dy)

        if (jump > cfg.maxJumpThreshold) {
          // Safety net: force accept after N consecutive rejects to prevent permanent lockup
          consecutiveRejects.value += 1
          if (consecutiveRejects.value < MAX_CONSECUTIVE_REJECTS) {
            // Bbox jumped too much - reject as noise
            return
          }
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
      consecutiveRejects.value = 0 // Reset consecutive reject counter on successful accept
      detectionId.value += 1 // Increment detection ID for new YOLO detection

    }
    // If playerBbox is null, we don't update lastSeenAt - let it expire naturally

    // Update profiling counters
    updateCount.value += 1
    const tEnd = Date.now()
    updateTimeMs.value += (tEnd - tStart)
  }

  /**
   * Get effective bbox for MoveNet processing
   * @param now - Current timestamp (Date.now())
   * @returns Tracked bbox with state information, or null if expired
   */
  const getEffectiveBbox = (now: number): TrackedPlayerBbox | null => {
    'worklet'
    const tStart = Date.now()
    const tSvReadsStart = Date.now()
    if (!hasBbox.value || lastSeenAt.value === 0) {
      return null
    }
    const tSvReadsEnd = Date.now()
    getEffectiveBboxSvReadsMs.value += (tSvReadsEnd - tSvReadsStart)

    const tAgeTtlStart = Date.now()
    const ageMs = now - lastSeenAt.value
    const isStale = ageMs > cfg.bboxTtlMs
    const tAgeTtlEnd = Date.now()
    getEffectiveBboxAgeTtlMs.value += (tAgeTtlEnd - tAgeTtlStart)
    
    const tDetectionIdStart = Date.now()
    // Determine if this is a fresh YOLO detection or a persisted bbox
    // Fresh: detectionId changed since last frame (new YOLO detection)
    // Persisted: detectionId unchanged (reusing old bbox)
    const isNewDetection = detectionId.value !== lastProcessedDetectionId.value
    const isUsingLastBbox = !isNewDetection && ageMs > 0
    
    // Update lastProcessedDetectionId to mark this detection as processed
    if (isNewDetection) {
      lastProcessedDetectionId.value = detectionId.value
    }
    const tDetectionIdEnd = Date.now()
    getEffectiveBboxDetectionIdMs.value += (tDetectionIdEnd - tDetectionIdStart)

    if (isStale) {
      // BBox expired - reset tracking state
      hasBbox.value = false
      lastSeenAt.value = 0
      detectedAt.value = 0
      return null
    }

    // PASS 5F: Measure Date.now() overhead
    const tOverheadStart = Date.now()
    const tOverheadEnd = Date.now()
    dateNowOverheadMs.value += (tOverheadEnd - tOverheadStart)

    const tSmoothingStart = Date.now()
    // PASS 5E: Separate smoothing reads
    const tReadsStart = Date.now()
    const currentX = smoothedX.value
    const currentY = smoothedY.value
    const currentWidth = smoothedWidth.value
    const currentHeight = smoothedHeight.value
    const currentConfidence = smoothedConfidence.value
    const tReadsEnd = Date.now()
    smoothingReadsMs.value += (tReadsEnd - tReadsStart)

    // PASS 5E: Separate lerp calculation
    const tLerpStart = Date.now()
    let nextX: number, nextY: number, nextWidth: number, nextHeight: number, nextConfidence: number
    if (currentX === 0 && currentY === 0) {
      // First detection - initialize smoothed values
      nextX = bboxX.value
      nextY = bboxY.value
      nextWidth = bboxWidth.value
      nextHeight = bboxHeight.value
      nextConfidence = bboxConfidence.value
    } else {
      // Apply exponential moving average
      nextX = lerp(currentX, bboxX.value, cfg.smoothingFactor)
      nextY = lerp(currentY, bboxY.value, cfg.smoothingFactor)
      nextWidth = lerp(currentWidth, bboxWidth.value, cfg.smoothingFactor)
      nextHeight = lerp(currentHeight, bboxHeight.value, cfg.smoothingFactor)
      nextConfidence = lerp(currentConfidence, bboxConfidence.value, cfg.smoothingFactor)
    }
    const tLerpEnd = Date.now()
    smoothingLerpMs.value += (tLerpEnd - tLerpStart)

    // PASS 5E: Separate smoothing writes
    const tWritesStart = Date.now()
    smoothedX.value = nextX
    smoothedY.value = nextY
    smoothedWidth.value = nextWidth
    smoothedHeight.value = nextHeight
    smoothedConfidence.value = nextConfidence
    const tWritesEnd = Date.now()
    smoothingWritesMs.value += (tWritesEnd - tWritesStart)

    const tSmoothingEnd = Date.now()
    const smoothingMeasured = (tReadsEnd - tReadsStart) + (tLerpEnd - tLerpStart) + (tWritesEnd - tWritesStart)
    const smoothingTotal = tSmoothingEnd - tSmoothingStart
    smoothingUnaccountedMs.value += (smoothingTotal - smoothingMeasured)
    getEffectiveBboxSmoothingMs.value += smoothingTotal


    const tSvWritesStart = Date.now()
    // Count SharedValue writes (5 smoothing writes per call)
    sharedValueWrites.value += 5
    const tSvWritesEnd = Date.now()
    getEffectiveBboxSvWritesMs.value += (tSvWritesEnd - tSvWritesStart)

    const tResultStart = Date.now()
    // PASS 5G: Eliminate redundant SharedValue reads - use local variables from smoothing instead
    const tResultReadsStart = Date.now()
    // PASS 5G: No longer read from SharedValue - use next* variables directly
    // const resultX = smoothedX.value  // REDUNDANT - removed in PASS 5G
    // const resultY = smoothedY.value  // REDUNDANT - removed in PASS 5G
    // const resultWidth = smoothedWidth.value  // REDUNDANT - removed in PASS 5G
    // const resultHeight = smoothedHeight.value  // REDUNDANT - removed in PASS 5G
    // const resultConfidence = smoothedConfidence.value  // REDUNDANT - removed in PASS 5G
    const tResultReadsEnd = Date.now()
    resultReadsMs.value += (tResultReadsEnd - tResultReadsStart)

    // PASS 5G: Use local variables from smoothing instead of SharedValue reads
    const tConstructionStart = Date.now()
    const result = {
      bbox: {
        x: nextX,
        y: nextY,
        width: nextWidth,
        height: nextHeight,
        confidence: nextConfidence,
      },
      detectedAt: detectedAt.value,
      lastSeenAt: lastSeenAt.value,
      isStale,
      ageMs,
      isUsingLastBbox,
      detectionId: detectionId.value,
    }
    const tConstructionEnd = Date.now()
    resultConstructionMs.value += (tConstructionEnd - tConstructionStart)

    const tResultEnd = Date.now()
    const resultMeasured = (tResultReadsEnd - tResultReadsStart) + (tConstructionEnd - tConstructionStart)
    const resultTotal = tResultEnd - tResultStart
    resultUnaccountedMs.value += (resultTotal - resultMeasured)
    getEffectiveBboxResultMs.value += resultTotal

    // Update profiling counters
    getEffectiveBboxCount.value += 1
    const tEnd = Date.now()
    getEffectiveBboxTimeMs.value += (tEnd - tStart)

    return result
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
    detectionId.value = 0
    lastProcessedDetectionId.value = 0
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
    // Profiling counters
    updateCount,
    updateTimeMs,
    getEffectiveBboxCount,
    getEffectiveBboxTimeMs,
    sharedValueWrites,
    // PASS 5D: Granular getEffectiveBbox profiling
    getEffectiveBboxSvReadsMs,
    getEffectiveBboxAgeTtlMs,
    getEffectiveBboxDetectionIdMs,
    getEffectiveBboxSmoothingMs,
    getEffectiveBboxSvWritesMs,
    getEffectiveBboxResultMs,
    // PASS 5E: Smoothing reads/lerp/writes/result separation
    smoothingReadsMs,
    smoothingLerpMs,
    smoothingWritesMs,
    resultReadsMs,
    resultConstructionMs,
    // PASS 5F: Date.now() overhead and unaccounted time
    dateNowOverheadMs,
    smoothingUnaccountedMs,
    resultUnaccountedMs,
  }
}
