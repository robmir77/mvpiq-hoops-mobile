// src/vision/useMoveNetWorker.ts
// MoveNet worker for pose detection with independent timing.

import { useRef, useCallback, useEffect, useMemo } from 'react'
import { useSharedValue } from 'react-native-reanimated'
import { useResizer } from 'react-native-vision-camera-resizer'
import { useTensorflowModel } from 'react-native-fast-tflite'
import { parseMoveNetOutput } from './poseParser'
import { computeJointAngles } from './biomechanics'
import type { AndroidDelegateOption, IosDelegateOption } from './delegates'
import { DEFAULT_ANDROID_DELEGATE, DEFAULT_IOS_DELEGATE } from './delegates'
import { Platform } from 'react-native'
import { getMoveNetModel, getMoveNetModelUri, DEFAULT_MOVENET_MODEL_ID } from './yoloModels'
import type { PlayerCropResult } from './usePlayerCropManager'
import type { PoseKeypoints } from './types'
import { telemetryLogger } from './telemetry'
import { scheduleOnRN } from 'react-native-worklets'

const DEFAULT_POSE_INPUT_SIZE = 192 // Only 192 is currently available in the registry
const MOVENET_TARGET_FPS = 3 // Target 3 FPS for MoveNet
const MOVENET_INTERVAL_MS = 1000 / MOVENET_TARGET_FPS

// DIAGNOSTIC FLAG: Disable MoveNet execution to measure YOLO + tracking + crop calculation performance
const ENABLE_MOVENET = true

// Validation thresholds for player bbox (worklet-safe inline checks)
// Aligned with YOLO_CONFIG.PLAYER_CROP_MIN_CONFIDENCE
const PLAYER_CONFIDENCE_THRESH = 0.005
const PLAYER_MIN_WIDTH = 0.05
const PLAYER_MAX_WIDTH = 0.80
const PLAYER_MIN_HEIGHT = 0.1
const PLAYER_MAX_HEIGHT = 0.95

interface PoseWorkerResult {
  keypoints: any
  angles: any
  timestamp: number
  cropInfo?: PlayerCropResult | null
}


/**
 * Converts the calculated player crop into a square crop.
 *
 * IMPORTANT:
 * This function only calculates geometry.
 * It does NOT perform image cropping/resizing.
 *
 * The actual native crop+resize will be implemented in the next phase,
 * after verifying the real VisionCamera V5 API available in this project.
 */
const makeSquareCrop = (
  crop: {
    cropX: number
    cropY: number
    cropWidth: number
    cropHeight: number
  },
  frameWidth: number,
  frameHeight: number,
) => {
  'worklet'

  const size = Math.min(
    Math.max(crop.cropWidth, crop.cropHeight),
    frameWidth,
    frameHeight,
  )

  let x = crop.cropX + (crop.cropWidth - size) * 0.5
  let y = crop.cropY + (crop.cropHeight - size) * 0.5

  x = Math.max(0, Math.min(frameWidth - size, x))
  y = Math.max(0, Math.min(frameHeight - size, y))

  return {
    cropX: x,
    cropY: y,
    cropWidth: size,
    cropHeight: size,
  }
}

export const useMoveNetWorker = (
  enabled: boolean = true,
  poseDelegate?: AndroidDelegateOption | IosDelegateOption | null,
  moveNetModelId?: string
) => {
  const latestResultKeypoints = useSharedValue<any>(null)
  const latestResultAngles = useSharedValue<any>(null)
  const latestResultTimestamp = useSharedValue(0)
  const latestCropInfo = useSharedValue<PlayerCropResult | null>(null)

  const lastInferenceAt = useSharedValue(0)
  const isProcessing = useSharedValue(false)

  const isReady = useSharedValue(false)
  const fps = useSharedValue(0)

  const playerBbox = useSharedValue<{ x: number; y: number; width: number; height: number; confidence?: number } | null>(null)
  const playerCropRegion = useSharedValue<{ cropX: number; cropY: number; cropWidth: number; cropHeight: number } | null>(null)

  // Telemetry SharedValues (worklet-safe)
  const telemetryInferenceTime = useSharedValue(0)
  const telemetryCropMs = useSharedValue(0)
  const telemetryResizeMs = useSharedValue(0)
  const telemetryRunMs = useSharedValue(0)
  const telemetryParseMs = useSharedValue(0)
  const telemetryKeypointsConfidence = useSharedValue(0)
  const telemetryHasNewData = useSharedValue(false)

  // Test 2: Track last dispose timestamp to measure gap before next resize
  const lastDisposeTimestamp = useSharedValue(0)

  const selectedMoveNetModel = useMemo(
    () => getMoveNetModel(moveNetModelId ?? DEFAULT_MOVENET_MODEL_ID),
    [moveNetModelId]
  )
  const poseInputSize = selectedMoveNetModel?.inputSize ?? DEFAULT_POSE_INPUT_SIZE
  const poseInputElements = poseInputSize * poseInputSize * 3

  const moveNetUri = getMoveNetModelUri(moveNetModelId)
  const poseModelSource = useMemo(
    () => moveNetUri
      ? { url: moveNetUri } as any
      : selectedMoveNetModel?.asset as any,
    [moveNetUri, selectedMoveNetModel?.asset]
  )

  const poseDelegates = useMemo(
    () => {
      if (poseDelegate !== undefined && poseDelegate !== null) {
        return [poseDelegate]
      }
      return Platform.OS === 'android'
        ? [DEFAULT_ANDROID_DELEGATE]
        : [DEFAULT_IOS_DELEGATE]
    },
    [poseDelegate]
  )

  const poseModel = useTensorflowModel(poseModelSource, poseDelegates as any)
  const poseModelInstance = poseModel.state === 'loaded' && poseModel.model != null
    ? poseModel.model
    : null

  // Run MoveNet inference on JS thread (Promises are not worklet-safe)
  const runMoveNetInference = useCallback(async (
    inputBuffer: ArrayBuffer,
    cropInfo: PlayerCropResult | null,
    cropRegion: { cropX: number; cropY: number; cropWidth: number; cropHeight: number } | null,
    usingPlayerCrop: boolean,
    frameWidth: number,
    frameHeight: number,
    timestamp: number,
    t0: number,
    totalCropMs: number,
    resizeMs: number,
    resized: any
  ) => {
    try {
      const tRunStart = performance.now()
      const outputs = await poseModelInstance!.run([inputBuffer])
      const tRunEnd = performance.now()
      const runMs = tRunEnd - tRunStart
      
      // The MoveNet INT8 model outputs a Float32 tensor for keypoints
      const output = new Float32Array(outputs[0])

      // Log raw output length for diagnostics (should be 51 for 17 keypoints * 3 values)
      const outputLength = output.length
      if (__DEV__) {
        console.log('[POSE RAW] outputLength=', outputLength)
      }

      const tParseStart = performance.now()
      const keypoints = parseMoveNetOutput(output, 17)
      const angles = computeJointAngles(keypoints)
      const tParseEnd = performance.now()
      const parseMs = tParseEnd - tParseStart

      // Enhanced logging with valid keypoints
      const keypointsCount = Object.keys(keypoints).length
      const validKeypoints = Object.values(keypoints).filter((kp: any) => kp && kp.score > 0).length
      const avgConfidence = validKeypoints > 0 
        ? Object.values(keypoints).filter((kp: any) => kp && kp.score > 0).reduce((sum: number, kp: any) => sum + kp.score, 0) / validKeypoints 
        : 0
      
      if (__DEV__) {
        console.log('[POSE RESULT] keypoints=', keypointsCount, 'valid=', validKeypoints, 'avgConf=', avgConfidence.toFixed(2))
      }

      // Transform keypoints from crop space back to frame space if crop was used
      let finalKeypoints = keypoints
      if (
        usingPlayerCrop &&
        cropRegion &&
        cropInfo &&
        cropInfo.squareCropSize !== undefined
      ) {
        // Log for debugging pose position issue
        const sampleKey = Object.keys(keypoints)[0] as keyof PoseKeypoints
        if (__DEV__ && sampleKey && keypoints[sampleKey]) {
          console.log('[POSE TRANSFORM DEBUG] cropRegion:', `x=${cropRegion.cropX.toFixed(0)} y=${cropRegion.cropY.toFixed(0)} w=${cropRegion.cropWidth.toFixed(0)} h=${cropRegion.cropHeight.toFixed(0)}`)
          console.log('[POSE TRANSFORM DEBUG] squareCrop:', `x=${cropInfo.squareCropX?.toFixed(0)} y=${cropInfo.squareCropY?.toFixed(0)} size=${cropInfo.squareCropSize?.toFixed(0)}`)
          console.log('[POSE TRANSFORM DEBUG] frame size:', `${frameWidth}x${frameHeight}`)
          console.log('[POSE TRANSFORM DEBUG] raw keypoint:', `${sampleKey}= x=${keypoints[sampleKey]!.x.toFixed(3)} y=${keypoints[sampleKey]!.y.toFixed(3)}`)
        }
        
        // PoseKeypoints is an object with named properties, not an array
        // Transform from square crop space (with padding) back to frame space
        finalKeypoints = {} as PoseKeypoints
        const keyNames = Object.keys(keypoints) as Array<keyof PoseKeypoints>
        for (const key of keyNames) {
          if (keypoints[key]) {
            // First: map from 0-1 (square crop) to pixel coordinates in square crop
            const squareCropX = cropInfo.squareCropX || 0
            const squareCropY = cropInfo.squareCropY || 0
            const squareCropSize = cropInfo.squareCropSize || cropRegion.cropWidth
            
            const pixelX = squareCropX + keypoints[key]!.x * squareCropSize
            const pixelY = squareCropY + keypoints[key]!.y * squareCropSize
            
            // Then: normalize to frame space
            finalKeypoints[key] = {
              ...keypoints[key]!,
              x: pixelX / frameWidth,
              y: pixelY / frameHeight,
            }
          }
        }
        
        if (__DEV__ && sampleKey && finalKeypoints[sampleKey]) {
          console.log('[POSE TRANSFORM DEBUG] transformed keypoint:', `${sampleKey}= x=${finalKeypoints[sampleKey]!.x.toFixed(3)} y=${finalKeypoints[sampleKey]!.y.toFixed(3)}`)
        }
      }

      const t2 = performance.now()

      latestResultKeypoints.value = finalKeypoints
      latestResultAngles.value = angles
      latestResultTimestamp.value = timestamp
      latestCropInfo.value = cropInfo

      const inferenceTime = t2 - t0
      const calculatedFps = 1000 / inferenceTime

      if (calculatedFps > 0) {
        fps.value = calculatedFps
      }

      // Write telemetry to SharedValues (worklet-safe)
      telemetryInferenceTime.value = inferenceTime
      telemetryCropMs.value = totalCropMs
      telemetryResizeMs.value = resizeMs
      telemetryRunMs.value = runMs
      telemetryParseMs.value = parseMs
      telemetryKeypointsConfidence.value = finalKeypoints ? Object.values(finalKeypoints).filter((kp: any) => kp && kp.score > 0).reduce((sum: number, kp: any) => sum + kp.score, 0) / Object.values(finalKeypoints).filter((kp: any) => kp && kp.score > 0).length : 0
      telemetryHasNewData.value = true

      // Release GPUFrame after async operation completes
      if (resized) {
        try {
          // Test 2: Log dispose timestamp to measure gap before next resize
          const disposeTime = Date.now()
          lastDisposeTimestamp.value = disposeTime
          if (__DEV__) {
            console.log('[MoveNet DISPOSE] timestamp=', disposeTime)
          }
          resized.dispose()
        } catch (e) {
          // Ignore if already disposed
        }
      }

      isProcessing.value = false
      // lastInferenceAt already updated at dispatch start (fix throttling bug)
    } catch (error) {
      console.error('[MoveNetWorker] Async inference error:', error)
      
      // Release GPUFrame on error
      if (resized) {
        try {
          resized.dispose()
        } catch (e) {
          // Ignore if already disposed
        }
      }
      
      isProcessing.value = false
      lastInferenceAt.value = Date.now()
    }
  }, [poseModelInstance, latestResultKeypoints, latestResultAngles, latestResultTimestamp, latestCropInfo, fps, telemetryInferenceTime, telemetryCropMs, telemetryResizeMs, telemetryRunMs, telemetryParseMs, telemetryKeypointsConfidence, telemetryHasNewData, isProcessing, lastInferenceAt])

  useEffect(() => {
    isReady.value = poseModel.state === 'loaded' && poseModel.model != null

    if (isReady.value) {
      telemetryLogger.setMoveNetModelInput(poseInputSize)
    }
  }, [poseModel.state, poseModel.model, isReady, poseInputSize])

  // Configure resizer with float32 to avoid YUV-HardwareBuffer error on Android
  const rgbResizerConfig = useMemo(
    () => ({
      width: poseInputSize,
      height: poseInputSize,
      channelOrder: 'rgb' as const,
      dataType: 'float32' as const, // Use float32 to avoid YUV-HardwareBuffer error
      pixelLayout: 'interleaved' as const,
      scaleMode: 'contain' as const,
    }),
    [poseInputSize]
  )

  const { resizer: rgbResizer } = useResizer(rgbResizerConfig)

  const recordTelemetry = useCallback((inferenceTime: number, keypoints: any, cropMs?: number, resizeMs?: number, runMs?: number, parseMs?: number, requested?: boolean, executed?: boolean) => {
    if (requested) telemetryLogger.recordMoveNetRequested()
    if (executed) telemetryLogger.recordMoveNetExecuted()
    telemetryLogger.recordMoveNetInference(inferenceTime)
    telemetryLogger.incrementPoseUpdates()
    if (cropMs !== undefined) telemetryLogger.recordMoveNetCrop(cropMs)
    if (resizeMs !== undefined) telemetryLogger.recordMoveNetResize(resizeMs)
    if (runMs !== undefined) telemetryLogger.recordMoveNetRun(runMs)
    if (parseMs !== undefined) telemetryLogger.recordMoveNetParse(parseMs)

    if (keypoints) {
      const keypointValues = Object.values(keypoints).filter((kp: any) => kp && kp.score > 0)
      if (keypointValues.length > 0) {
        const avgConfidence = keypointValues.reduce((sum: number, kp: any) => sum + kp.score, 0) / keypointValues.length
        telemetryLogger.recordMoveNetKeypoints(avgConfidence)
      }
    }

  }, [])

  // Read telemetry from SharedValues on the JS thread.
  // IMPORTANT: do not put SharedValue.value in a React dependency array:
  // reading .value while React renders triggers Reanimated's strict warning.
  // SharedValues do not cause React renders, so poll the flag instead.
  useEffect(() => {
    const interval = setInterval(() => {
      if (!telemetryHasNewData.value) return

      recordTelemetry(
        telemetryInferenceTime.value,
        null, // keypoints not needed, confidence already calculated
        telemetryCropMs.value,
        telemetryResizeMs.value,
        telemetryRunMs.value,
        telemetryParseMs.value,
        true, // requested
        true  // executed
      )
      telemetryLogger.recordMoveNetKeypoints(telemetryKeypointsConfidence.value)
      telemetryHasNewData.value = false
    }, 100)

    return () => clearInterval(interval)
  }, [recordTelemetry])

  // Process frame immediately (no buffering)
  const processFrame = useCallback((frame: any, timestamp: number) => {
    'worklet'

    if (!poseModelInstance || isProcessing.value || !enabled || !ENABLE_MOVENET) {
      if (__DEV__) {
        console.log('[MoveNet] Skip: modelReady=', !!poseModelInstance, 'isProcessing=', isProcessing.value, 'enabled=', enabled, 'ENABLE_MOVENET=', ENABLE_MOVENET)
      }
      return
    }

    // Throttle based on timing
    const now = Date.now()
    const timeSinceLast = lastInferenceAt.value > 0 ? now - lastInferenceAt.value : MOVENET_INTERVAL_MS
    if (timeSinceLast < MOVENET_INTERVAL_MS) {
      if (__DEV__) {
        console.log('[MoveNet Throttle] Skip:', timeSinceLast, 'ms since last (need', MOVENET_INTERVAL_MS, 'ms)')
      }
      return
    }

    // Get player bbox from YOLO (center coordinates)
    const bboxRaw = playerBbox.value
    
    // Convert center coordinates to top-left for validation and crop calculation
    // YOLO provides center (cx, cy), but validation and crop need top-left
    const bbox = bboxRaw ? {
      x: bboxRaw.x - bboxRaw.width / 2,
      y: bboxRaw.y - bboxRaw.height / 2,
      width: bboxRaw.width,
      height: bboxRaw.height,
      confidence: bboxRaw.confidence,
    } : null

    // Inline validation (worklet-safe - no external function calls)
    // Allow slight out-of-bounds (up to 5%) since crop will be clamped anyway
    const BOUNDARY_TOLERANCE = 0.05
    const hasValidPlayer =
      bbox != null &&
      bbox.confidence != null &&
      bbox.confidence >= PLAYER_CONFIDENCE_THRESH &&
      bbox.width >= PLAYER_MIN_WIDTH &&
      bbox.width <= PLAYER_MAX_WIDTH &&
      bbox.height >= PLAYER_MIN_HEIGHT &&
      bbox.height <= PLAYER_MAX_HEIGHT &&
      bbox.x >= -BOUNDARY_TOLERANCE &&
      bbox.y >= -BOUNDARY_TOLERANCE &&
      bbox.x + bbox.width <= 1 + BOUNDARY_TOLERANCE &&
      bbox.y + bbox.height <= 1 + BOUNDARY_TOLERANCE

    const poseSource = hasValidPlayer ? "PLAYER_CROP_GEOMETRY" : "FULL_FRAME"

    if (__DEV__) {
      console.log('[MoveNet CROP] source=', poseSource, 'bboxValid=', hasValidPlayer)
    }
    if (__DEV__ && !hasValidPlayer && bbox) {
      console.log('[MoveNet CROP] Rejection reason:', 
        bbox.confidence == null ? 'no_confidence' :
        bbox.confidence < PLAYER_CONFIDENCE_THRESH ? `conf_too_low (${bbox.confidence.toFixed(4)} < ${PLAYER_CONFIDENCE_THRESH})` :
        bbox.width < PLAYER_MIN_WIDTH ? `width_too_small (${bbox.width.toFixed(3)} < ${PLAYER_MIN_WIDTH})` :
        bbox.width > PLAYER_MAX_WIDTH ? `width_too_large (${bbox.width.toFixed(3)} > ${PLAYER_MAX_WIDTH})` :
        bbox.height < PLAYER_MIN_HEIGHT ? `height_too_small (${bbox.height.toFixed(3)} < ${PLAYER_MIN_HEIGHT})` :
        bbox.height > PLAYER_MAX_HEIGHT ? `height_too_large (${bbox.height.toFixed(3)} > ${PLAYER_MAX_HEIGHT})` :
        bbox.x < 0 ? `x_negative (${bbox.x.toFixed(3)})` :
        bbox.y < 0 ? `y_negative (${bbox.y.toFixed(3)})` :
        bbox.x + bbox.width > 1 ? `x_out_of_bounds (${(bbox.x + bbox.width).toFixed(3)} > 1)` :
        bbox.y + bbox.height > 1 ? `y_out_of_bounds (${(bbox.y + bbox.height).toFixed(3)} > 1)` :
        'unknown')
    }
    if (__DEV__ && hasValidPlayer && bbox) {
      console.log('[MoveNet CROP] normalized bbox=', `x=${bbox.x.toFixed(3)} y=${bbox.y.toFixed(3)} w=${bbox.width.toFixed(3)} h=${bbox.height.toFixed(3)} conf=${bbox.confidence?.toFixed(3) ?? 'N/A'}`)
    }

    isProcessing.value = true

    // Fix throttling bug: Update lastInferenceAt at dispatch start, not at async completion
    // This aligns the internal clock with the external clock in useShotTracker
    lastInferenceAt.value = Date.now()

    // Capture frame dimensions before async operation to avoid use-after-free
    const frameWidth = frame.width
    const frameHeight = frame.height

    let resized: any = null
    let cropInfo: PlayerCropResult | null = null
    let usingPlayerCrop = false
    const t0 = performance.now()

    try {
      const tCropStart = performance.now()

      // Calculate crop region when bbox is valid
      let cropRegion: { cropX: number; cropY: number; cropWidth: number; cropHeight: number } | null = null
      if (hasValidPlayer && bbox) {
        // Convert normalized bbox to pixel coordinates (bbox is already top-left)
        const pixelX = bbox.x * frame.width
        const pixelY = bbox.y * frame.height
        const pixelWidth = bbox.width * frame.width
        const pixelHeight = bbox.height * frame.height

        // Add 15% padding
        const paddingPercent = 0.15
        const paddingX = pixelWidth * paddingPercent
        const paddingY = pixelHeight * paddingPercent

        let cropX = pixelX - paddingX
        let cropY = pixelY - paddingY
        let cropWidth = pixelWidth + 2 * paddingX
        let cropHeight = pixelHeight + 2 * paddingY

        // Clamp to frame boundaries
        cropX = Math.max(0, cropX)
        cropY = Math.max(0, cropY)
        cropWidth = Math.min(frame.width - cropX, cropWidth)
        cropHeight = Math.min(frame.height - cropY, cropHeight)

        // Ensure minimum crop size
        const minCropSize = Math.min(frame.width, frame.height) * 0.2
        cropWidth = Math.max(minCropSize, cropWidth)
        cropHeight = Math.max(minCropSize, cropHeight)

        const squareCrop = makeSquareCrop(
          {
            cropX,
            cropY,
            cropWidth,
            cropHeight,
          },
          frame.width,
          frame.height,
        )

        cropRegion = squareCrop
        playerCropRegion.value = squareCrop

        if (__DEV__) {
          console.log(
            '[MoveNet CROP] squareRect=',
            `x=${Math.round(squareCrop.cropX)} ` +
            `y=${Math.round(squareCrop.cropY)} ` +
            `w=${Math.round(squareCrop.cropWidth)} ` +
            `h=${Math.round(squareCrop.cropHeight)}`
          )
        }
      } else {
        playerCropRegion.value = null
      }

      const tCropEnd = performance.now()
      const cropMs = tCropEnd - tCropStart

      const tResizeStart = performance.now()

      // Test 2: Log gap from last dispose to current resize
      const resizeStartTime = Date.now()
      const gapMs = lastDisposeTimestamp.value > 0 ? resizeStartTime - lastDisposeTimestamp.value : 0
      if (__DEV__ && gapMs > 0) {
        console.log('[MoveNet RESIZE] gap_from_dispose=', gapMs, 'ms')
      }

      // V5 accepts only resize(frame). We therefore resize the full frame first
      // and perform the player crop/resample CPU-side on the Float32 tensor.
      resized = rgbResizer?.resize(frame)
      const tResizeEnd = performance.now()
      const resizeMs = tResizeEnd - tResizeStart

      if (resized) {
        const pixelBuffer = resized.getPixelBuffer()

        // Convert to Float32Array (resizer outputs float32 in range 0-255)
        const floatSource = new Float32Array(pixelBuffer as unknown as ArrayBufferLike)

        if (floatSource.length === poseInputElements) {
          const inputSource = floatSource

          if (cropRegion) {
            cropInfo = {
              cropX: cropRegion.cropX,
              cropY: cropRegion.cropY,
              cropWidth: cropRegion.cropWidth,
              cropHeight: cropRegion.cropHeight,
              isValid: true,
              isUsingLastBbox: false,
              squareCropX: cropRegion.cropX,
              squareCropY: cropRegion.cropY,
              squareCropSize: cropRegion.cropWidth,
            }

            if (__DEV__) {
              console.log(
                '[MoveNet CROP] geometry prepared=',
                `x=${Math.round(cropRegion.cropX)} ` +
                `y=${Math.round(cropRegion.cropY)} ` +
                `size=${Math.round(cropRegion.cropWidth)}`
              )
            }
          }

          if (__DEV__) {
            console.log(
              '[MoveNet CROP] geometryOnly=',
              !!cropRegion,
              'nativeCropApplied=',
              usingPlayerCrop,
              'inputElements=',
              inputSource.length,
            )
          }

          const totalCropMs = cropMs

          // Buffer size validation
          if (inputSource.length !== poseInputElements) {
            console.error(
              '[MoveNet Input] Invalid input length:',
              inputSource.length,
              'expected:',
              poseInputElements,
            )

            resized.dispose()
            resized = null
            isProcessing.value = false
            return
          }

          let maxVal = 0;
          for (let i = 0; i < inputSource.length; i+=100) {
            if (inputSource[i] > maxVal) maxVal = inputSource[i];
          }

          if (__DEV__ && telemetryHasNewData.value === false) { // log occasionally
            console.log(`[MoveNet Input] Model expects dataType: ${poseModelInstance!.inputs[0].dataType}, shape: ${poseModelInstance!.inputs[0].shape}`)
            console.log(`[MoveNet Input] floatSource max sample value: ${maxVal}`)
          }

          let inputBuffer: ArrayBuffer;
          const needsScaling = maxVal <= 1.0 && maxVal > 0;

          if (poseModelInstance!.inputs[0].dataType === 'uint8') {
            const uint8Source = new Uint8Array(inputSource.length)
            for (let i = 0; i < inputSource.length; i++) {
              uint8Source[i] = needsScaling ? inputSource[i] * 255.0 : inputSource[i];
            }
            inputBuffer = uint8Source.buffer as ArrayBuffer
          } else if (poseModelInstance!.inputs[0].dataType === 'int8') {
            const int8Source = new Int8Array(inputSource.length)
            for (let i = 0; i < inputSource.length; i++) {
              let val = needsScaling ? inputSource[i] * 255.0 : inputSource[i];
              int8Source[i] = val - 128
            }
            inputBuffer = int8Source.buffer as ArrayBuffer
          } else {
            inputBuffer = inputSource.buffer as ArrayBuffer
          }

          // ASYNC: Run inference on JS thread (Promises are not worklet-safe)
          scheduleOnRN(runMoveNetInference, inputBuffer, cropInfo, cropRegion, usingPlayerCrop, frameWidth, frameHeight, timestamp, t0, totalCropMs, resizeMs, resized)
        }
      }

    } catch (error) {
      console.error('[MoveNetWorker] Error processing frame:', error)
      
      // Release GPUFrame on sync error (before async)
      if (resized) {
        try {
          resized.dispose()
        } catch (e) {
          // Ignore if already disposed
        }
      }

      isProcessing.value = false
      // lastInferenceAt already updated at dispatch start (fix throttling bug)
    }
  }, [poseModelInstance, rgbResizer, poseInputElements, enabled, fps, latestResultKeypoints, latestResultAngles, latestResultTimestamp, latestCropInfo, isProcessing, lastInferenceAt, playerBbox, runMoveNetInference, telemetryInferenceTime, telemetryCropMs, telemetryResizeMs, telemetryRunMs, telemetryParseMs, telemetryKeypointsConfidence, telemetryHasNewData, lastDisposeTimestamp])

  // Get latest result (called from JS thread)
  const getLatestResult = useCallback((): PoseWorkerResult | null => {
    if (latestResultKeypoints.value === null && latestResultTimestamp.value === 0) {
      return null
    }
    return {
      keypoints: latestResultKeypoints.value,
      angles: latestResultAngles.value,
      timestamp: latestResultTimestamp.value,
      cropInfo: latestCropInfo.value,
    }
  }, [latestResultKeypoints, latestResultAngles, latestResultTimestamp, latestCropInfo])

  // Reset
  const reset = useCallback(() => {
    latestResultKeypoints.value = null
    latestResultAngles.value = null
    latestResultTimestamp.value = 0
    latestCropInfo.value = null
    lastInferenceAt.value = 0
    isProcessing.value = false
    playerBbox.value = null
    playerCropRegion.value = null
  }, [latestResultKeypoints, latestResultAngles, latestResultTimestamp, latestCropInfo, lastInferenceAt, isProcessing, playerBbox, playerCropRegion])

  return {
    processFrame,
    getLatestResult,
    reset,
    isReady,
    fps,
    latestResultKeypoints,
    latestResultAngles,
    latestResultTimestamp,
    latestCropInfo,
    playerBbox,
  }
}
