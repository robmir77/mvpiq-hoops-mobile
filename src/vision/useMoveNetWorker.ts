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
 * CPU-side crop/resample used with react-native-vision-camera-resizer V5.
 * V5 resize() only accepts the frame, so the frame is first resized to the
 * configured square and the player crop is then extracted from that tensor.
 * This keeps the implementation worklet-safe and avoids the deprecated V4 API.
 */
const cropResizedFloat32 = (
  source: Float32Array,
  sourceSize: number,
  frameWidth: number,
  frameHeight: number,
  crop: { cropX: number; cropY: number; cropWidth: number; cropHeight: number },
  outputSize: number,
): { output: Float32Array; squareCropX: number; squareCropY: number; cropSize: number } => {
  'worklet'

  const output = new Float32Array(outputSize * outputSize * 3)

  // The V5 resizer uses `contain`: the camera image is centered inside the
  // square tensor. Map the original-frame crop into that tensor first.
  const scale = Math.min(sourceSize / frameWidth, sourceSize / frameHeight)
  const contentWidth = frameWidth * scale
  const contentHeight = frameHeight * scale
  const offsetX = (sourceSize - contentWidth) * 0.5
  const offsetY = (sourceSize - contentHeight) * 0.5

  // Calculate the crop in the source (resized) image
  const sourceCropX = offsetX + crop.cropX * scale
  const sourceCropY = offsetY + crop.cropY * scale
  const sourceCropW = Math.max(1, crop.cropWidth * scale)
  const sourceCropH = Math.max(1, crop.cropHeight * scale)

  // Maintain aspect ratio: make the crop square by adding padding
  const cropSize = Math.max(sourceCropW, sourceCropH)
  const squareCropX = sourceCropX + (sourceCropW - cropSize) * 0.5
  const squareCropY = sourceCropY + (sourceCropH - cropSize) * 0.5

  for (let oy = 0; oy < outputSize; oy++) {
    const fy = squareCropY + ((oy + 0.5) / outputSize) * cropSize - 0.5
    const y0 = Math.max(0, Math.min(sourceSize - 1, Math.floor(fy)))
    const y1 = Math.max(0, Math.min(sourceSize - 1, y0 + 1))
    const wy = Math.max(0, Math.min(1, fy - Math.floor(fy)))

    for (let ox = 0; ox < outputSize; ox++) {
      const fx = squareCropX + ((ox + 0.5) / outputSize) * cropSize - 0.5
      const x0 = Math.max(0, Math.min(sourceSize - 1, Math.floor(fx)))
      const x1 = Math.max(0, Math.min(sourceSize - 1, x0 + 1))
      const wx = Math.max(0, Math.min(1, fx - Math.floor(fx)))

      const src00 = (y0 * sourceSize + x0) * 3
      const src01 = (y0 * sourceSize + x1) * 3
      const src10 = (y1 * sourceSize + x0) * 3
      const src11 = (y1 * sourceSize + x1) * 3
      const dst = (oy * outputSize + ox) * 3

      for (let c = 0; c < 3; c++) {
        const top = source[src00 + c] * (1 - wx) + source[src01 + c] * wx
        const bottom = source[src10 + c] * (1 - wx) + source[src11 + c] * wx
        output[dst + c] = top * (1 - wy) + bottom * wy
      }
    }
  }

  return { output, squareCropX, squareCropY, cropSize }
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

    if (!poseModelInstance || isProcessing.value || !enabled) {
      console.log('[MoveNet] Skip: modelReady=', !!poseModelInstance, 'isProcessing=', isProcessing.value, 'enabled=', enabled)
      return
    }

    // Throttle based on timing
    const now = Date.now()
    const timeSinceLast = lastInferenceAt.value > 0 ? now - lastInferenceAt.value : MOVENET_INTERVAL_MS
    if (timeSinceLast < MOVENET_INTERVAL_MS) {
      console.log('[MoveNet Throttle] Skip:', timeSinceLast, 'ms since last (need', MOVENET_INTERVAL_MS, 'ms)')
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

    const poseSource = hasValidPlayer ? "PLAYER_CROP" : "FULL_FRAME"

    console.log('[MoveNet CROP] source=', poseSource, 'bboxValid=', hasValidPlayer)
    if (!hasValidPlayer && bbox) {
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
    if (hasValidPlayer && bbox) {
      console.log('[MoveNet CROP] normalized bbox=', `x=${bbox.x.toFixed(3)} y=${bbox.y.toFixed(3)} w=${bbox.width.toFixed(3)} h=${bbox.height.toFixed(3)} conf=${bbox.confidence?.toFixed(3) ?? 'N/A'}`)
    }

    isProcessing.value = true

    let resized: any = null
    let cropInfo: PlayerCropResult | null = null

    try {
      const t0 = performance.now()
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

        cropRegion = { cropX, cropY, cropWidth, cropHeight }
        playerCropRegion.value = cropRegion

        console.log('[MoveNet CROP] pixelRect=', `x=${Math.round(cropX)} y=${Math.round(cropY)} w=${Math.round(cropWidth)} h=${Math.round(cropHeight)}`)
      } else {
        playerCropRegion.value = null
      }

      const tCropEnd = performance.now()
      const cropMs = tCropEnd - tCropStart

      const tResizeStart = performance.now()

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
            const tCpuCropStart = performance.now()
            let inputSource = floatSource

            if (cropRegion) {
              const cropResult = cropResizedFloat32(
                floatSource,
                poseInputSize,
                frame.width,
                frame.height,
                cropRegion,
                poseInputSize,
              )
              inputSource = cropResult.output
              
              // Calculate padding info for inverse transformation
              const scale = Math.min(poseInputSize / frame.width, poseInputSize / frame.height)
              const sourceCropW = Math.max(1, cropRegion.cropWidth * scale)
              const sourceCropH = Math.max(1, cropRegion.cropHeight * scale)
              const cropSize = Math.max(sourceCropW, sourceCropH)
              
              // Convert square crop coordinates back to frame space
              const squareCropX = (cropResult.squareCropX - (poseInputSize - frame.width * scale) * 0.5) / scale
              const squareCropY = (cropResult.squareCropY - (poseInputSize - frame.height * scale) * 0.5) / scale
              const squareCropSize = cropResult.cropSize / scale
              
              cropInfo = {
                cropX: cropRegion.cropX,
                cropY: cropRegion.cropY,
                cropWidth: cropRegion.cropWidth,
                cropHeight: cropRegion.cropHeight,
                isValid: true,
                isUsingLastBbox: false,
                squareCropX,
                squareCropY,
                squareCropSize,
              }
              
              console.log('[MoveNet CROP] CPU resample applied=', true, 'inputElements=', inputSource.length)
            } else {
              console.log('[MoveNet CROP] CPU resample applied=', false, 'source=FULL_FRAME')
            }

            const cpuCropMs = performance.now() - tCpuCropStart
            // cropMs includes crop-region calculation + actual CPU extraction.
            const totalCropMs = cropMs + cpuCropMs
          
            let maxVal = 0;
            for (let i = 0; i < inputSource.length; i+=100) {
              if (inputSource[i] > maxVal) maxVal = inputSource[i];
            }

            if (telemetryHasNewData.value === false) { // log occasionally
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

          const tRunStart = performance.now()
          const outputs = poseModelInstance!.runSync([inputBuffer])
          const tRunEnd = performance.now()
          const runMs = tRunEnd - tRunStart
          
          // The MoveNet INT8 model outputs a Float32 tensor for keypoints
          const output = new Float32Array(outputs[0] as ArrayBufferLike)

          // Log raw output length for diagnostics (should be 51 for 17 keypoints * 3 values)
          const outputLength = output.length
          console.log('[POSE RAW] outputLength=', outputLength)

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
          
          console.log('[POSE RESULT] keypoints=', keypointsCount, 'valid=', validKeypoints, 'avgConf=', avgConfidence.toFixed(2))

          // Transform keypoints from crop space back to frame space if crop was used
          let finalKeypoints = keypoints
          if (cropRegion && cropInfo && cropInfo.squareCropSize !== undefined) {
            // Log for debugging pose position issue
            const sampleKey = Object.keys(keypoints)[0] as keyof PoseKeypoints
            if (sampleKey && keypoints[sampleKey]) {
              console.log('[POSE TRANSFORM DEBUG] cropRegion:', `x=${cropRegion.cropX.toFixed(0)} y=${cropRegion.cropY.toFixed(0)} w=${cropRegion.cropWidth.toFixed(0)} h=${cropRegion.cropHeight.toFixed(0)}`)
              console.log('[POSE TRANSFORM DEBUG] squareCrop:', `x=${cropInfo.squareCropX?.toFixed(0)} y=${cropInfo.squareCropY?.toFixed(0)} size=${cropInfo.squareCropSize?.toFixed(0)}`)
              console.log('[POSE TRANSFORM DEBUG] frame size:', `${frame.width}x${frame.height}`)
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
                  x: pixelX / frame.width,
                  y: pixelY / frame.height,
                }
              }
            }
            
            if (sampleKey && finalKeypoints[sampleKey]) {
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

          isProcessing.value = false
          lastInferenceAt.value = Date.now()
          return
        }
      }

    } catch (error) {
      console.error('[MoveNetWorker] Error processing frame:', error)
    } finally {
      // Dispose GPUFrame to release GPU resources
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
  }, [poseModelInstance, rgbResizer, poseInputElements, enabled, fps, latestResultKeypoints, latestResultAngles, latestResultTimestamp, latestCropInfo, isProcessing, lastInferenceAt, playerBbox])

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
