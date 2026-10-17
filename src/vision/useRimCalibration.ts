// src/vision/useRimCalibration.ts
//
// Utility for rim calibration using YOLO detection
// Crops frame around selected hoop center, runs single YOLO inference
// Returns refined rim bbox or falls back to manual selection

import { useCallback, useRef, useMemo } from 'react'
import { VISION_CONFIG, YOLO_CONFIG } from '@/config/appConfig'
import { YoloDetector, type YoloDetection } from './engine/YoloDetector'
import { useTensorflowModel } from 'react-native-fast-tflite'
import { getYoloModel } from './yoloModels'
import type { AndroidDelegateOption, IosDelegateOption } from './delegates'
import { DEFAULT_ANDROID_DELEGATE, DEFAULT_IOS_DELEGATE } from './delegates'
import { Platform } from 'react-native'

export interface RimCalibrationConfig {
  roiSizePercent: number // ROI size as percentage of frame (e.g., 0.25 = 25%)
  minConfidence: number // Minimum confidence to accept detection
  maxDistanceFromCenter: number // Max normalized distance from selected center
}

export interface RimCalibrationResult {
  success: boolean
  bbox: { x: number; y: number; width: number; height: number } | null
  confidence: number
  method: 'yolo' | 'manual' | 'error'
  error?: string
}

export interface RoiRegion {
  x: number // Origin X in frame coordinates (pixels)
  y: number // Origin Y in frame coordinates (pixels)
  width: number // Width in pixels
  height: number // Height in pixels
}

const DEFAULT_CONFIG: RimCalibrationConfig = {
  roiSizePercent: VISION_CONFIG.RIM_CALIBRATION.ROI_SIZE_PERCENT,
  minConfidence: VISION_CONFIG.RIM_CALIBRATION.MIN_CONFIDENCE,
  maxDistanceFromCenter: VISION_CONFIG.RIM_CALIBRATION.MAX_DISTANCE_FROM_CENTER,
}

/**
 * Calculate ROI centered on selected point
 * @param centerX - Normalized center X (0-1)
 * @param centerY - Normalized center Y (0-1)
 * @param frameWidth - Frame width in pixels
 * @param frameHeight - Frame height in pixels
 * @param config - Calibration configuration
 * @returns ROI region in pixel coordinates
 */
export function calculateRoi(
  centerX: number,
  centerY: number,
  frameWidth: number,
  frameHeight: number,
  config: RimCalibrationConfig = DEFAULT_CONFIG
): RoiRegion {
  const roiSize = Math.min(frameWidth, frameHeight) * config.roiSizePercent
  const halfSize = roiSize / 2

  let x = centerX * frameWidth - halfSize
  let y = centerY * frameHeight - halfSize

  // Clamp to frame boundaries
  x = Math.max(0, x)
  y = Math.max(0, y)

  let width = roiSize
  let height = roiSize

  // Adjust if near edges
  if (x + width > frameWidth) {
    width = frameWidth - x
  }
  if (y + height > frameHeight) {
    height = frameHeight - y
  }

  // Ensure minimum size
  const minSize = Math.min(frameWidth, frameHeight) * 0.1
  width = Math.max(minSize, width)
  height = Math.max(minSize, height)

  return { x, y, width, height }
}

/**
 * Convert detection from crop space to original frame space
 * @param detection - Detection in normalized crop coordinates (0-1)
 * @param roi - ROI region used for crop
 * @param frameWidth - Original frame width
 * @param frameHeight - Original frame height
 * @returns Detection in normalized frame coordinates (0-1)
 */
export function convertCropToFrame(
  detection: YoloDetection,
  roi: RoiRegion,
  frameWidth: number,
  frameHeight: number
): YoloDetection {
  return {
    x: (roi.x + detection.x * roi.width) / frameWidth,
    y: (roi.y + detection.y * roi.height) / frameHeight,
    width: (detection.width * roi.width) / frameWidth,
    height: (detection.height * roi.height) / frameHeight,
    confidence: detection.confidence,
  }
}

/**
 * Select best rim detection from candidates
 * @param detections - All rim detections from YOLO
 * @param centerX - Selected center X (normalized)
 * @param centerY - Selected center Y (normalized)
 * @param config - Calibration configuration
 * @returns Best detection or null if none acceptable
 */
export function selectBestRimDetection(
  detections: YoloDetection[],
  centerX: number,
  centerY: number,
  config: RimCalibrationConfig = DEFAULT_CONFIG
): YoloDetection | null {
  if (detections.length === 0) return null

  // Filter by confidence
  const validDetections = detections.filter(d => d.confidence >= config.minConfidence)
  if (validDetections.length === 0) return null

  // Filter by distance from selected center
  const closeDetections = validDetections.filter(d => {
    const dx = d.x - centerX
    const dy = d.y - centerY
    const distance = Math.sqrt(dx * dx + dy * dy)
    return distance <= config.maxDistanceFromCenter
  })

  if (closeDetections.length === 0) return null

  // Select highest confidence among close detections
  return closeDetections.reduce((best, current) =>
    current.confidence > best.confidence ? current : best
  )
}

/**
 * Crop frame buffer to ROI
 * Note: This is a simplified implementation that assumes RGB interleaved format
 * For production use with vision camera, we need to handle the actual buffer format
 * @param buffer - Original frame buffer (Float32Array from resizer)
 * @param frameWidth - Frame width
 * @param frameHeight - Frame height
 * @param roi - ROI region to crop
 * @returns Cropped buffer
 */
export function cropFrameBuffer(
  buffer: Float32Array,
  frameWidth: number,
  frameHeight: number,
  roi: RoiRegion
): Float32Array {
  const croppedSize = roi.width * roi.height * 3 // RGB interleaved
  const cropped = new Float32Array(croppedSize)

  let croppedIndex = 0
  for (let y = roi.y; y < roi.y + roi.height; y++) {
    for (let x = roi.x; x < roi.x + roi.width; x++) {
      const srcIndex = (y * frameWidth + x) * 3
      cropped[croppedIndex++] = buffer[srcIndex]     // R
      cropped[croppedIndex++] = buffer[srcIndex + 1] // G
      cropped[croppedIndex++] = buffer[srcIndex + 2] // B
    }
  }

  return cropped
}

/**
 * Hook for rim calibration
 */
export function useRimCalibration(
  config: Partial<RimCalibrationConfig> = {},
  yoloModelId?: string,
  yoloDelegate?: AndroidDelegateOption | IosDelegateOption | null
) {
  const cfg = { ...DEFAULT_CONFIG, ...config }
  const yoloDetectorRef = useRef(new YoloDetector(
    YOLO_CONFIG.BALL_CONF_THRESHOLD,
    YOLO_CONFIG.RIM_CONF_THRESHOLD
  ))

  // Load YOLO model for single-shot inference
  const selectedYoloModel = useMemo(() => getYoloModel(yoloModelId), [yoloModelId])
  const yoloInputSize = selectedYoloModel?.inputSize
  const yoloInputElements = yoloInputSize ? yoloInputSize * yoloInputSize * 3 : 0

  const yoloDelegates = useMemo(
    () => {
      if (yoloDelegate !== undefined && yoloDelegate !== null) {
        return [yoloDelegate]
      }
      return Platform.OS === 'android'
        ? [DEFAULT_ANDROID_DELEGATE]
        : [DEFAULT_IOS_DELEGATE]
    },
    [yoloDelegate]
  )

  const yoloModelSource = useMemo(
    () => {
      if (!selectedYoloModel) {
        return undefined as any
      }
      return selectedYoloModel.fileUri
        ? { url: selectedYoloModel.fileUri } as any
        : selectedYoloModel.asset as any
    },
    [selectedYoloModel?.fileUri, selectedYoloModel?.asset]
  )

  const yoloModel = useTensorflowModel(yoloModelSource, yoloDelegates as any)
  const yoloModelInstance = yoloModel.state === 'loaded' && yoloModel.model != null
    ? yoloModel.model
    : null

  /**
   * Run YOLO inference on cropped frame
   * @param cropBuffer - Cropped frame buffer (Float32Array, RGB interleaved, already resized to YOLO input size)
   * @param cropWidth - Crop width in pixels (should equal yoloInputSize)
   * @param cropHeight - Crop height in pixels (should equal yoloInputSize)
   * @returns YOLO result with rim detection
   */
  const runYoloOnCrop = useCallback((
    cropBuffer: Float32Array,
    cropWidth: number,
    cropHeight: number
  ): YoloDetection | null => {
    if (!yoloModelInstance || !yoloInputSize) {
      return null
    }

    try {
      // Enable rim detection for calibration
      yoloDetectorRef.current.setRimDetectionEnabled(true)

      // Convert Float32Array to ArrayBuffer for TFLite
      const inputBuffer = cropBuffer.buffer.slice(
        cropBuffer.byteOffset,
        cropBuffer.byteOffset + cropBuffer.byteLength
      ) as ArrayBuffer

      // Run inference
      const outputs = yoloModelInstance.runSync([inputBuffer])
      const rawOutput = outputs[0] as ArrayBufferLike
      const output = new Float32Array(rawOutput)

      // Parse output
      const result = yoloDetectorRef.current.parseOutput(output, yoloInputSize, yoloInputSize)

      return result.rim
    } catch (error) {
      console.error('[useRimCalibration] YOLO inference error:', error)
      return null
    }
  }, [yoloModelInstance, yoloInputSize])

  /**
   * Perform rim calibration
   * @param frameBuffer - Frame buffer (Float32Array, already resized to YOLO input size)
   * @param frameWidth - Frame width (should equal yoloInputSize)
   * @param frameHeight - Frame height (should equal yoloInputSize)
   * @param centerX - Selected center X (normalized)
   * @param centerY - Selected center Y (normalized)
   * @returns Calibration result
   */
  const calibrateRim = useCallback(async (
    frameBuffer: Float32Array,
    frameWidth: number,
    frameHeight: number,
    centerX: number,
    centerY: number
  ): Promise<RimCalibrationResult> => {
    try {
      if (!yoloModelInstance || !yoloInputSize) {
        return {
          success: false,
          bbox: null,
          confidence: 0,
          method: 'manual',
          error: 'YOLO model not loaded',
        }
      }

      // Calculate ROI in YOLO input space
      const roi = calculateRoi(centerX, centerY, frameWidth, frameHeight, cfg)

      // Crop frame to ROI
      const cropBuffer = cropFrameBuffer(frameBuffer, frameWidth, frameHeight, roi)

      // Run YOLO inference on crop
      const rimDetection = runYoloOnCrop(cropBuffer, roi.width, roi.height)

      if (!rimDetection) {
        return {
          success: false,
          bbox: null,
          confidence: 0,
          method: 'manual',
          error: 'No rim detected',
        }
      }

      // Convert detection from crop space to frame space
      const frameDetection = convertCropToFrame(rimDetection, roi, frameWidth, frameHeight)

      // Select best detection (in this case, we only have one)
      const bestDetection = selectBestRimDetection([frameDetection], centerX, centerY, cfg)

      if (!bestDetection) {
        return {
          success: false,
          bbox: null,
          confidence: 0,
          method: 'manual',
          error: 'Detection does not meet criteria',
        }
      }

      return {
        success: true,
        bbox: {
          x: bestDetection.x,
          y: bestDetection.y,
          width: bestDetection.width,
          height: bestDetection.height,
        },
        confidence: bestDetection.confidence,
        method: 'yolo',
      }
    } catch (error) {
      return {
        success: false,
        bbox: null,
        confidence: 0,
        method: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }, [cfg, yoloModelInstance, yoloInputSize, runYoloOnCrop])

  return {
    calculateRoi,
    convertCropToFrame,
    selectBestRimDetection,
    calibrateRim,
    isModelReady: yoloModel.state === 'loaded',
  }
}
