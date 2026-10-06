// src/vision/useMoveNetWorker.ts
// MoveNet worker for pose detection with independent timing.

import { useRef, useCallback, useEffect, useMemo } from 'react'
import { useSharedValue } from 'react-native-reanimated'
import { useResizer } from 'react-native-vision-camera-resizer'
import { useTensorflowModel } from 'react-native-fast-tflite'
import { MoveNetPoseEstimator } from './engine/MoveNetPoseEstimator'
import { computeJointAngles } from './biomechanics'
import type { AndroidDelegateOption, IosDelegateOption } from './delegates'
import { DEFAULT_ANDROID_DELEGATE, DEFAULT_IOS_DELEGATE } from './delegates'
import { Platform } from 'react-native'
import { getMoveNetModel, getMoveNetModelUri, DEFAULT_MOVENET_MODEL_ID } from './yoloModels'
import type { PlayerCropResult } from './usePlayerCropManager'
import type { PoseKeypoints } from './types'
import { telemetryLogger } from './telemetry'
import { scheduleOnRN } from 'react-native-worklets'
import { ENABLE_MOVENET_LOGS } from '@/config/debugConfig'

const DEFAULT_POSE_INPUT_SIZE = 192 // Only 192 is currently available in the registry
const INTERMEDIATE_RESIZE_SIZE = 640 // Intermediate resize for crop optimization (reduces CPU crop work)
// Phase 4.4: Removed MOVENET_TARGET_FPS throttling - no temporal throttling per ARCHITECTURE.md

// DIAGNOSTIC FLAG: Disable MoveNet execution to measure YOLO + tracking + crop calculation performance
const ENABLE_MOVENET = true

// Validation thresholds for player bbox (worklet-safe inline checks)
// Aligned with YOLO_CONFIG.PLAYER_CROP_MIN_CONFIDENCE (5%)
const PLAYER_CONFIDENCE_THRESH = 0.05
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
  moveNetModelId?: string,
  // Performance tracking SharedValues (for PERF 1s diagnostic window)
  perfMoveNetRequested?: any,
  perfMoveNetExecuted?: any,
  perfMoveNetSkipped?: any,
  perfMoveNetInferenceTotal?: any,
  perfMoveNetInferenceMin?: any,
  perfMoveNetInferenceMax?: any,
  perfMoveNetWorkletPrepTotal?: any,
  perfMoveNetRnScheduleWaitTotal?: any,
  perfMoveNetCropTotal?: any,
  perfMoveNetQuantizationTotal?: any,
  // perfMoveNetResizeTotal removed - resize is now included in jsPreprocessMs
  perfMoveNetRunTotal?: any,
  perfMoveNetParseTotal?: any,
) => {
  // Pure MoveNet pose estimator instance (worklet-safe)
  const moveNetEstimatorRef = useRef(new MoveNetPoseEstimator(0.03))

  // TEMP: Commented to reduce log noise during performance investigation
  // console.log('[useMoveNetWorker] Received params:', {
  //     enabled,
  //     poseDelegate,
  //     moveNetModelId,
  // })
  const latestResultKeypoints = useSharedValue<any>(null)
  const latestResultAngles = useSharedValue<any>(null)
  const latestResultTimestamp = useSharedValue(0)
  const latestCropInfo = useSharedValue<PlayerCropResult | null>(null)

  const isProcessing = useSharedValue(false)
  const lastSubmitTimestamp = useSharedValue(0)

  // Cancellation token to prevent post-session inferences
  const isMountedRef = useRef(true)

  const executionCount = useSharedValue(0)
  const lastInferenceMs = useSharedValue(0)
  const lastCropMs = useSharedValue(0)
  const lastResizeMs = useSharedValue(0)
  const lastRunMs = useSharedValue(0)
  const lastParseMs = useSharedValue(0)

  // Profiling A→F timestamps (for detailed scheduling analysis)
  // Pipeline: WORKLET(A→B) → rnScheduleWait(B→C) → JS/RN(C→D→E→F)
  const profWorkletPrepMs = useSharedValue(0)  // A→B: worklet preprocessing (crop geometry + intermediate resize + buffer extraction)
  const profRnScheduleWaitMs = useSharedValue(0) // B→C: worklet → RN scheduling wait
  const profJsPreprocessMs = useSharedValue(0)  // C→D: JS preprocessing (CPU crop + quantization)
  const profInferenceMs = useSharedValue(0)     // D→E: TFLite inference (runSync)
  const profPostprocessMs = useSharedValue(0)   // E→F: postprocess/callback (parsing + SharedValue updates)

  const isReady = useSharedValue(false)
  const moveNetStartTime = useSharedValue(0)

  const playerBbox = useSharedValue<{ x: number; y: number; width: number; height: number; confidence?: number } | null>(null)
  const playerCropRegion = useSharedValue<{ cropX: number; cropY: number; cropWidth: number; cropHeight: number } | null>(null)

  // Telemetry SharedValues (worklet-safe)
  const telemetryInferenceTime = useSharedValue(0)
  const telemetryWorkletPrepMs = useSharedValue(0)
  const telemetryCropMs = useSharedValue(0)
  const telemetryResizeMs = useSharedValue(0)
  const telemetryQuantizationMs = useSharedValue(0)
  const telemetryRunMs = useSharedValue(0)
  const telemetryParseMs = useSharedValue(0)
  const telemetryKeypointsConfidence = useSharedValue(0)
  const telemetryHasNewData = useSharedValue(false)
  const telemetryDroppedBusy = useSharedValue(0)
  const telemetrySkipped = useSharedValue(0)
  const telemetryRequested = useSharedValue(0)
  const telemetryExecuted = useSharedValue(0)
  const telemetryScheduleWaitMs = useSharedValue(0)

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
    intermediateBuffer: Float32Array,
    intermediateWidth: number,
    intermediateHeight: number,
    cropRegion: { cropX: number; cropY: number; cropWidth: number; cropHeight: number } | null,
    cropInfo: PlayerCropResult | null,
    usingPlayerCrop: boolean,
    frameWidth: number,
    frameHeight: number,
    timestamp: number,
    tA: number,  // A: worklet start time
    tB: number,  // B: worklet end time (before scheduleOnRN)
    resized: any,
    bufferExtractMs: number  // Buffer extraction time (part of worklet prep)
  ) => {
    // Skip if unmounted
    if (!isMountedRef.current) {
      // Release GPUFrame if unmounted
      if (resized) {
        try {
          resized.dispose()
        } catch (e) {
        }
      }
      return
    }

    const tC = performance.now() // C: callback start (JS thread)

    telemetryLogger.recordRnMoveNetScheduled()

    try {
      // Profiling B→C: worklet → JS scheduling wait
      const scheduleWaitMs = tC - tB

      // Profiling A→B: worklet preprocessing (crop geometry + intermediate resize + buffer extraction)
      const workletPrepMs = (tB - tA) + bufferExtractMs

      telemetryLogger.recordRnMoveNetCallbackStart()

      // CPU crop + resize to final size (now on JS thread, not in worklet)
      const tCropCpuStart = performance.now() // Start of C→D: JS preprocessing (CPU crop)

      let inputSource: Float32Array
      let totalCropMs = 0
      let quantizationMs = 0
      let jsPreprocessMs = 0

      if (cropRegion && intermediateBuffer.length === intermediateWidth * intermediateHeight * 3) {
        // Scale crop region to intermediate dimensions
        const scale = INTERMEDIATE_RESIZE_SIZE / Math.max(frameWidth, frameHeight)
        const scaledCropX = cropRegion.cropX * scale
        const scaledCropY = cropRegion.cropY * scale
        const scaledCropWidth = cropRegion.cropWidth * scale
        const scaledCropHeight = cropRegion.cropHeight * scale

        // CPU crop + resize to final size
        inputSource = cropAndResizeFloat32(
          intermediateBuffer,
          intermediateWidth,
          intermediateHeight,
          scaledCropX,
          scaledCropY,
          scaledCropWidth,
          scaledCropHeight,
          poseInputSize
        )

        const tCropCpuEnd = performance.now()
        totalCropMs = tCropCpuEnd - tCropCpuStart
        jsPreprocessMs = tCropCpuEnd - tCropCpuStart // C→D: JS preprocessing time

        if (__DEV__) {
          console.log(
            '[MoveNet CROP] CPU crop on JS thread=',
            `intermediate=${intermediateWidth}x${intermediateHeight} `,
            `crop=${Math.round(scaledCropX)},${Math.round(scaledCropY)},${Math.round(scaledCropWidth)}x${Math.round(scaledCropHeight)} `,
            `cropTime=${(tCropCpuEnd - tCropCpuStart).toFixed(2)}ms`
          )
        }
      } else {
        // Fallback: resize from intermediate to final size using CPU
        usingPlayerCrop = false
        if (__DEV__) {
          console.log('[MoveNet CROP] FALLBACK to FULL FRAME - cropRegion=', cropRegion ? 'EXISTS' : 'NULL', 'bufferMatch=', intermediateBuffer.length === intermediateWidth * intermediateHeight * 3)
        }

        if (intermediateBuffer.length === intermediateWidth * intermediateHeight * 3) {
          inputSource = cropAndResizeFloat32(
            intermediateBuffer,
            intermediateWidth,
            intermediateHeight,
            0,
            0,
            intermediateWidth,
            intermediateHeight,
            poseInputSize
          )
        } else {
          // Fallback to direct resize if dimensions don't match
          inputSource = new Float32Array(poseInputElements)
          // Simple nearest neighbor resize
          const scaleX = intermediateWidth / poseInputSize
          const scaleY = intermediateHeight / poseInputSize
          for (let ty = 0; ty < poseInputSize; ty++) {
            for (let tx = 0; tx < poseInputSize; tx++) {
              const sx = Math.floor(tx * scaleX)
              const sy = Math.floor(ty * scaleY)
              const sourceIdx = (sy * intermediateWidth + sx) * 3
              const targetIdx = (ty * poseInputSize + tx) * 3
              if (sourceIdx + 2 < intermediateBuffer.length) {
                inputSource[targetIdx] = intermediateBuffer[sourceIdx]
                inputSource[targetIdx + 1] = intermediateBuffer[sourceIdx + 1]
                inputSource[targetIdx + 2] = intermediateBuffer[sourceIdx + 2]
              }
            }
          }
        }

        const tCropCpuEnd = performance.now()
        totalCropMs = tCropCpuEnd - tCropCpuStart
        jsPreprocessMs = tCropCpuEnd - tCropCpuStart // C→D: JS preprocessing time

        if (__DEV__) {
          console.log(
            '[MoveNet CROP] Fallback resize (no crop) on JS thread=',
            `intermediate=${intermediateWidth}x${intermediateHeight} `,
            `resizeTime=${(tCropCpuEnd - tCropCpuStart).toFixed(2)}ms`
          )
        }
      }

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

      if (__DEV__) {
        console.log(`[MoveNet Input] Model expects dataType: ${poseModelInstance!.inputs[0].dataType}, shape: ${poseModelInstance!.inputs[0].shape}`)
        console.log(`[MoveNet Input] floatSource max sample value: ${maxVal}`)
      }

      let inputBuffer: ArrayBuffer;
      const needsScaling = maxVal <= 1.0 && maxVal > 0;

      const tQuantStart = performance.now() // Start of quantization
      if (poseModelInstance!.inputs[0].dataType === 'uint8') {
        const uint8Source = new Uint8Array(inputSource.length)
        for (let i = 0; i < inputSource.length; i++) {
          uint8Source[i] = needsScaling ? inputSource[i] * 255.0 : inputSource[i];
        }
        inputBuffer = uint8Source.buffer as ArrayBuffer
      } else if (poseModelInstance!.inputs[0].dataType === 'int8') {
        const int8Source = new Int8Array(inputSource.length)
        for (let i = 0; i < inputSource.length; i++) {
          int8Source[i] = needsScaling ? (inputSource[i] * 255.0) - 128 : inputSource[i] - 128;
        }
        inputBuffer = int8Source.buffer as ArrayBuffer
      } else {
        inputBuffer = inputSource.buffer as ArrayBuffer
      }
      const tQuantEnd = performance.now()
      quantizationMs = tQuantEnd - tQuantStart

      if (__DEV__) {
        console.log(`[MoveNet QUANT] quantizationTime=${quantizationMs.toFixed(2)}ms`)
      }

      // C→D: JS preprocessing = CPU crop + quantization
      jsPreprocessMs = totalCropMs + quantizationMs

      const tD = performance.now() // D: inference start (after JS preprocessing)
      const outputs = await poseModelInstance!.run([inputBuffer])
      const tE = performance.now() // E: inference end
      const runMs = tE - tD // D→E: inference time

      // The MoveNet INT8 model outputs a Float32 tensor for keypoints
      const output = new Float32Array(outputs[0])

      // Log raw output length for diagnostics (should be 51 for 17 keypoints * 3 values)
      const outputLength = output.length
      if (ENABLE_MOVENET_LOGS) {
        console.log('[POSE RAW] outputLength=', outputLength)
      }

      const tParseStart = performance.now() // Start of E→F: postprocess
      const poseResult = moveNetEstimatorRef.current.parseOutput(output, 17)
      // Convert Record<string, Keypoint> to PoseKeypoints format expected by computeJointAngles
      const keypoints: PoseKeypoints = {
        leftShoulder: poseResult.keypoints.leftShoulder ? { x: poseResult.keypoints.leftShoulder.x, y: poseResult.keypoints.leftShoulder.y, score: poseResult.keypoints.leftShoulder.confidence } : undefined,
        rightShoulder: poseResult.keypoints.rightShoulder ? { x: poseResult.keypoints.rightShoulder.x, y: poseResult.keypoints.rightShoulder.y, score: poseResult.keypoints.rightShoulder.confidence } : undefined,
        leftElbow: poseResult.keypoints.leftElbow ? { x: poseResult.keypoints.leftElbow.x, y: poseResult.keypoints.leftElbow.y, score: poseResult.keypoints.leftElbow.confidence } : undefined,
        rightElbow: poseResult.keypoints.rightElbow ? { x: poseResult.keypoints.rightElbow.x, y: poseResult.keypoints.rightElbow.y, score: poseResult.keypoints.rightElbow.confidence } : undefined,
        leftWrist: poseResult.keypoints.leftWrist ? { x: poseResult.keypoints.leftWrist.x, y: poseResult.keypoints.leftWrist.y, score: poseResult.keypoints.leftWrist.confidence } : undefined,
        rightWrist: poseResult.keypoints.rightWrist ? { x: poseResult.keypoints.rightWrist.x, y: poseResult.keypoints.rightWrist.y, score: poseResult.keypoints.rightWrist.confidence } : undefined,
        leftHip: poseResult.keypoints.leftHip ? { x: poseResult.keypoints.leftHip.x, y: poseResult.keypoints.leftHip.y, score: poseResult.keypoints.leftHip.confidence } : undefined,
        rightHip: poseResult.keypoints.rightHip ? { x: poseResult.keypoints.rightHip.x, y: poseResult.keypoints.rightHip.y, score: poseResult.keypoints.rightHip.confidence } : undefined,
        leftKnee: poseResult.keypoints.leftKnee ? { x: poseResult.keypoints.leftKnee.x, y: poseResult.keypoints.leftKnee.y, score: poseResult.keypoints.leftKnee.confidence } : undefined,
        rightKnee: poseResult.keypoints.rightKnee ? { x: poseResult.keypoints.rightKnee.x, y: poseResult.keypoints.rightKnee.y, score: poseResult.keypoints.rightKnee.confidence } : undefined,
        leftAnkle: poseResult.keypoints.leftAnkle ? { x: poseResult.keypoints.leftAnkle.x, y: poseResult.keypoints.leftAnkle.y, score: poseResult.keypoints.leftAnkle.confidence } : undefined,
        rightAnkle: poseResult.keypoints.rightAnkle ? { x: poseResult.keypoints.rightAnkle.x, y: poseResult.keypoints.rightAnkle.y, score: poseResult.keypoints.rightAnkle.confidence } : undefined,
      }
      const angles = computeJointAngles(keypoints)
      const tParseEnd = performance.now()
      const parseMs = tParseEnd - tParseStart

      const tF = performance.now() // F: callback end
      const postprocessMs = tF - tE // E→F: postprocess/callback time

      // Enhanced logging with valid keypoints (single pass optimization)
      const keypointsCount = Object.keys(keypoints).length
      let validKeypoints = 0
      let confidenceSum = 0
      for (const kp of Object.values(keypoints) as any[]) {
        if (kp && kp.score > 0) {
          validKeypoints++
          confidenceSum += kp.score
        }
      }
      const avgConfidence = validKeypoints > 0 ? confidenceSum / validKeypoints : 0
      
      if (ENABLE_MOVENET_LOGS) {
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
        if (ENABLE_MOVENET_LOGS && sampleKey && keypoints[sampleKey]) {
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
            const normalizedX = pixelX / frameWidth
            const normalizedY = pixelY / frameHeight

            finalKeypoints[key] = {
              ...keypoints[key]!,
              x: normalizedX,
              y: normalizedY,
            }
          }
        }

        if (ENABLE_MOVENET_LOGS && sampleKey && finalKeypoints[sampleKey]) {
          console.log('[POSE TRANSFORM DEBUG] transformed keypoint:', `${sampleKey}= x=${finalKeypoints[sampleKey]!.x.toFixed(3)} y=${finalKeypoints[sampleKey]!.y.toFixed(3)}`)
        }
      }

      latestResultKeypoints.value = finalKeypoints
      latestResultAngles.value = angles
      latestResultTimestamp.value = timestamp
      latestCropInfo.value = cropInfo

      const inferenceTime = tF - tA // Total time from worklet start to callback end
      // theoreticalFps removed - it's latency-based, not throughput-based
      // Real throughput is calculated in telemetry based on executed / elapsed time

      // Update execution tracking shared values
      executionCount.value += 1
      lastInferenceMs.value = inferenceTime
      lastCropMs.value = totalCropMs
      lastResizeMs.value = 0 // No longer measured separately (included in jsPreprocessMs)
      lastRunMs.value = runMs
      lastParseMs.value = parseMs

      // Write telemetry to SharedValues (worklet-safe)
      telemetryInferenceTime.value = inferenceTime
      telemetryWorkletPrepMs.value = workletPrepMs
      telemetryScheduleWaitMs.value = scheduleWaitMs
      telemetryCropMs.value = totalCropMs
      telemetryResizeMs.value = 0 // No longer measured separately (included in jsPreprocessMs)
      telemetryQuantizationMs.value = quantizationMs
      telemetryRunMs.value = runMs
      telemetryParseMs.value = parseMs

      // Update profiling A→F timestamps
      profWorkletPrepMs.value = workletPrepMs
      profRnScheduleWaitMs.value = scheduleWaitMs
      profJsPreprocessMs.value = jsPreprocessMs
      profInferenceMs.value = runMs
      profPostprocessMs.value = postprocessMs
      // Single pass for keypoints confidence calculation
      let finalValidCount = 0
      let finalConfidenceSum = 0
      if (finalKeypoints) {
        for (const kp of Object.values(finalKeypoints) as any[]) {
          if (kp && kp.score > 0) {
            finalValidCount++
            finalConfidenceSum += kp.score
          }
        }
      }
      telemetryKeypointsConfidence.value = finalValidCount > 0 ? finalConfidenceSum / finalValidCount : 0
      telemetryHasNewData.value = true

      // Record MoveNet executed when inference completes
      telemetryExecuted.value += 1
      if (perfMoveNetExecuted) {
        perfMoveNetExecuted.value += 1
      }
      if (perfMoveNetInferenceTotal) {
        perfMoveNetInferenceTotal.value += inferenceTime
      }
      if (perfMoveNetInferenceMin) {
        perfMoveNetInferenceMin.value = perfMoveNetInferenceMin.value === 0 ? inferenceTime : Math.min(perfMoveNetInferenceMin.value, inferenceTime)
      }
      if (perfMoveNetInferenceMax) {
        perfMoveNetInferenceMax.value = Math.max(perfMoveNetInferenceMax.value, inferenceTime)
      }
      if (perfMoveNetWorkletPrepTotal) {
        perfMoveNetWorkletPrepTotal.value += workletPrepMs
      }
      if (perfMoveNetRnScheduleWaitTotal) {
        perfMoveNetRnScheduleWaitTotal.value += scheduleWaitMs
      }
      if (perfMoveNetCropTotal) {
        perfMoveNetCropTotal.value += totalCropMs
      }
      if (perfMoveNetQuantizationTotal) {
        perfMoveNetQuantizationTotal.value += quantizationMs
      }
      // perfMoveNetResizeTotal removed - resize is now included in jsPreprocessMs
      if (perfMoveNetRunTotal) {
        perfMoveNetRunTotal.value += runMs
      }
      if (perfMoveNetParseTotal) {
        perfMoveNetParseTotal.value += parseMs
      }

      // Release GPUFrame after async operation completes
      if (resized) {
        try {
          // Test 2: Log dispose timestamp to measure gap before next resize
          const disposeTime = Date.now()
          lastDisposeTimestamp.value = disposeTime
          if (ENABLE_MOVENET_LOGS) {
            console.log('[MoveNet DISPOSE] timestamp=', disposeTime)
          }
          resized.dispose()
        } catch (e) {
          // Ignore if already disposed
        }
      }

      isProcessing.value = false
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
    } finally {
      const tCallbackEnd = performance.now()
      const callbackExecutionMs = tCallbackEnd - tC
      telemetryLogger.recordRnMoveNetCallbackExecution(callbackExecutionMs)
    }
  }, [poseModelInstance, latestResultKeypoints, latestResultAngles, latestResultTimestamp, latestCropInfo, telemetryInferenceTime, telemetryCropMs, telemetryResizeMs, telemetryRunMs, telemetryParseMs, telemetryKeypointsConfidence, telemetryHasNewData, isProcessing, perfMoveNetWorkletPrepTotal, perfMoveNetRnScheduleWaitTotal])

  useEffect(() => {
    isReady.value = poseModel.state === 'loaded' && poseModel.model != null

    if (isReady.value) {
      telemetryLogger.setMoveNetModelInput(poseInputSize)
    }
  }, [poseModel.state, poseModel.model, isReady, poseInputSize])

  // Cleanup on unmount: cancel pending work
  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])

  // Configure intermediate resizer for crop optimization
  // Resize to intermediate size first, then CPU crop, then resize to final size
  // This reduces CPU crop work compared to cropping from full resolution
  // Use 640x360 to match 1280x720 aspect ratio (16:9), avoiding letterboxing
  const intermediateResizerConfig = useMemo(
    () => ({
      width: INTERMEDIATE_RESIZE_SIZE,
      height: Math.round(INTERMEDIATE_RESIZE_SIZE * (720 / 1280)), // 640x360 for 16:9
      channelOrder: 'rgb' as const,
      dataType: 'float32' as const,
      pixelLayout: 'interleaved' as const,
      scaleMode: 'contain' as const, // contain with matching aspect ratio = no letterboxing
    }),
    []
  )

  const { resizer: intermediateResizer } = useResizer(intermediateResizerConfig)

  /**
   * Optimized CPU crop from Float32 RGB interleaved buffer
   * Crops a region from source buffer and resizes to target size using nearest neighbor
   * This is much faster than the old approach because we work directly on Float32
   *
   * Optimizations:
   * - Pre-compute constants outside loop
   * - Use bitwise OR 0 instead of Math.floor for truncation
   * - Reduce variable lookups
   * - Single-pass per-pixel processing
   */
  const cropAndResizeFloat32 = (
    source: Float32Array,
    sourceWidth: number,
    sourceHeight: number,
    cropX: number,
    cropY: number,
    cropWidth: number,
    cropHeight: number,
    targetSize: number
  ): Float32Array => {
    'worklet'

    const target = new Float32Array(targetSize * targetSize * 3)

    // Pre-compute constants
    const sourceWidth3 = sourceWidth * 3
    const targetSize3 = targetSize * 3
    const sourceWidthMinus1 = sourceWidth - 1
    const sourceHeightMinus1 = sourceHeight - 1
    const scaleX = cropWidth / targetSize
    const scaleY = cropHeight / targetSize

    for (let ty = 0; ty < targetSize; ty++) {
      const targetRowOffset = ty * targetSize3
      const syBase = cropY + ty * scaleY

      for (let tx = 0; tx < targetSize; tx++) {
        // Source coordinates (nearest neighbor) - use bitwise OR 0 for faster truncation
        const sx = (cropX + tx * scaleX) | 0
        const sy = syBase | 0

        // Clamp to source bounds
        const clampedSx = sx < 0 ? 0 : (sx > sourceWidthMinus1 ? sourceWidthMinus1 : sx)
        const clampedSy = sy < 0 ? 0 : (sy > sourceHeightMinus1 ? sourceHeightMinus1 : sy)

        // Source index (RGB interleaved)
        const sourceIdx = clampedSy * sourceWidth3 + clampedSx * 3

        // Target index
        const targetIdx = targetRowOffset + tx * 3

        // Copy RGB
        target[targetIdx] = source[sourceIdx]
        target[targetIdx + 1] = source[sourceIdx + 1]
        target[targetIdx + 2] = source[sourceIdx + 2]
      }
    }

    return target
  }

  const recordTelemetry = useCallback((inferenceTime: number, keypoints: any, workletPrepMs?: number, cropMs?: number, resizeMs?: number, quantizationMs?: number, runMs?: number, parseMs?: number, scheduleWaitMs?: number, requested?: boolean, executed?: boolean) => {
    if (requested) telemetryLogger.recordMoveNetRequested()
    if (executed) telemetryLogger.recordMoveNetExecuted()
    telemetryLogger.recordMoveNetInference(inferenceTime)
    telemetryLogger.incrementPoseUpdates()
    if (workletPrepMs !== undefined) telemetryLogger.recordMoveNetWorkletPrep(workletPrepMs)
    if (cropMs !== undefined) telemetryLogger.recordMoveNetCrop(cropMs)
    if (resizeMs !== undefined) telemetryLogger.recordMoveNetResize(resizeMs)
    if (quantizationMs !== undefined) telemetryLogger.recordMoveNetQuantization(quantizationMs)
    if (runMs !== undefined) telemetryLogger.recordMoveNetRun(runMs)
    if (parseMs !== undefined) telemetryLogger.recordMoveNetParse(parseMs)
    if (scheduleWaitMs !== undefined) telemetryLogger.recordMoveNetScheduleWait(scheduleWaitMs)

    if (keypoints) {
      // Single pass for keypoints confidence calculation
      let validCount = 0
      let confidenceSum = 0
      for (const kp of Object.values(keypoints) as any[]) {
        if (kp && kp.score > 0) {
          validCount++
          confidenceSum += kp.score
        }
      }
      if (validCount > 0) {
        telemetryLogger.recordMoveNetKeypoints(confidenceSum / validCount)
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

      telemetryLogger.recordRnTelemetryUpdate()

      recordTelemetry(
        telemetryInferenceTime.value,
        null, // keypoints not needed, confidence already calculated
        telemetryWorkletPrepMs.value,
        telemetryCropMs.value,
        telemetryResizeMs.value,
        telemetryQuantizationMs.value,
        telemetryRunMs.value,
        telemetryParseMs.value,
        telemetryScheduleWaitMs.value,
        false, // requested - recorded separately below
        false  // executed - recorded separately below
      )
      telemetryLogger.recordMoveNetKeypoints(telemetryKeypointsConfidence.value)
      
      // Record requested/executed/dropped/skipped counts from SharedValues
      const requested = telemetryRequested.value
      const executed = telemetryExecuted.value
      const droppedBusy = telemetryDroppedBusy.value
      const skipped = telemetrySkipped.value
      
      for (let i = 0; i < requested; i++) {
        telemetryLogger.recordMoveNetRequested()
      }
      for (let i = 0; i < executed; i++) {
        telemetryLogger.recordMoveNetExecuted()
      }
      for (let i = 0; i < droppedBusy; i++) {
        telemetryLogger.recordMoveNetDroppedBusy()
      }
      for (let i = 0; i < skipped; i++) {
        telemetryLogger.recordMoveNetSkipped()
      }
      
      telemetryRequested.value = 0
      telemetryExecuted.value = 0
      telemetryDroppedBusy.value = 0
      telemetrySkipped.value = 0
      
      telemetryHasNewData.value = false
    }, 100)

    return () => clearInterval(interval)
  }, [recordTelemetry])

  // Process frame immediately (no buffering)
  // Phase 4.4: Removed FPS throttling - no temporal throttling per ARCHITECTURE.md
  const processFrame = useCallback((frame: any, timestamp: number) => {
    'worklet'

    const now = Date.now()
    const timeSinceLastSubmit = now - lastSubmitTimestamp.value

    // No FPS throttling - process every frame
    lastSubmitTimestamp.value = now

    // Gate 2: Single-flight - skip if busy to avoid any preprocessing work
    if (!poseModelInstance || isProcessing.value || !enabled || !ENABLE_MOVENET) {
      if (isProcessing.value) {
        telemetryDroppedBusy.value += 1
      }
      if (__DEV__) {
        console.log('[MoveNet] Skip: modelReady=', !!poseModelInstance, 'isProcessing=', isProcessing.value, 'enabled=', enabled, 'ENABLE_MOVENET=', ENABLE_MOVENET)
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

    // Skip MoveNet execution if player bbox is below threshold
    if (!hasValidPlayer) {
      telemetrySkipped.value += 1
      if (perfMoveNetSkipped) {
        perfMoveNetSkipped.value += 1
      }
      if (__DEV__ && bbox) {
        console.log('[MoveNet] Skip: bbox below threshold',
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
      return
    }

    // Record MoveNet requested when frame is accepted for processing
    telemetryRequested.value += 1
    if (perfMoveNetRequested) {
      perfMoveNetRequested.value += 1
    }

    const poseSource = "PLAYER_CROP_GEOMETRY"

    if (__DEV__) {
      console.log('[MoveNet CROP] source=', poseSource, 'bboxValid=', hasValidPlayer)
    }
    if (__DEV__ && hasValidPlayer && bbox) {
      console.log('[MoveNet CROP] normalized bbox=', `x=${bbox.x.toFixed(3)} y=${bbox.y.toFixed(3)} w=${bbox.width.toFixed(3)} h=${bbox.height.toFixed(3)} conf=${bbox.confidence?.toFixed(3) ?? 'N/A'}`)
    }

    isProcessing.value = true

    // Capture frame dimensions before async operation to avoid use-after-free
    const frameWidth = frame.width
    const frameHeight = frame.height

    let resized: any = null
    let cropInfo: PlayerCropResult | null = null
    let usingPlayerCrop = false
    const tA = performance.now() // A: worklet start (before any preparation)
    let cropGeometryMs = 0
    let bufferExtractMs = 0

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
      cropGeometryMs = tCropEnd - tCropStart
      const cropMs = cropGeometryMs

      const tResizeStart = performance.now()

      // Test 2: Log gap from last dispose to current resize
      const resizeStartTime = Date.now()
      const gapMs = lastDisposeTimestamp.value > 0 ? resizeStartTime - lastDisposeTimestamp.value : 0
      if (__DEV__ && gapMs > 0) {
        console.log('[MoveNet RESIZE] gap_from_dispose=', gapMs, 'ms')
      }

      // NEW APPROACH: Resize to intermediate size first, then CPU crop to final size
      // This reduces CPU crop work compared to cropping from full resolution
      resized = intermediateResizer?.resize(frame)
      const tResizeEnd = performance.now()
      const resizeMs = tResizeEnd - tResizeStart

      if (resized) {
        const tBufferStart = performance.now()
        const pixelBuffer = resized.getPixelBuffer()

        // Convert to Float32Array (resizer outputs float32 in range 0-255)
        const floatSource = new Float32Array(pixelBuffer as unknown as ArrayBufferLike)
        const tBufferEnd = performance.now()
        bufferExtractMs = tBufferEnd - tBufferStart

        // Calculate scale factor from original frame to intermediate size
        const scale = INTERMEDIATE_RESIZE_SIZE / Math.max(frameWidth, frameHeight)
        const intermediateWidth = Math.round(frameWidth * scale)
        const intermediateHeight = Math.round(frameHeight * scale)

        if (__DEV__) {
          console.log(
            '[MoveNet RESIZE] frame=',
            frameWidth,
            'x',
            frameHeight,
            'intermediate=',
            intermediateWidth,
            'x',
            intermediateHeight,
            'bufferSize=',
            floatSource.length,
            'expected=',
            intermediateWidth * intermediateHeight * 3
          )
        }

        // Prepare cropInfo for JS thread
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
          usingPlayerCrop = true
        } else {
          cropInfo = null
          usingPlayerCrop = false
        }

        // ASYNC: Pass intermediate buffer to JS thread for CPU crop + inference
        // CPU crop is now done on JS thread, NOT in worklet (frame processor)
        const tB = performance.now() // B: worklet end (before scheduleOnRN)

        scheduleOnRN(runMoveNetInference, floatSource, intermediateWidth, intermediateHeight, cropRegion, cropInfo, usingPlayerCrop, frameWidth, frameHeight, timestamp, tA, tB, resized, bufferExtractMs)
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
    }
  }, [poseModelInstance, intermediateResizer, poseInputElements, enabled, executionCount, lastInferenceMs, lastCropMs, lastResizeMs, lastRunMs, lastParseMs, latestResultKeypoints, latestResultAngles, latestResultTimestamp, latestCropInfo, isProcessing, lastSubmitTimestamp, playerBbox, runMoveNetInference, telemetryInferenceTime, telemetryScheduleWaitMs, telemetryCropMs, telemetryResizeMs, telemetryRunMs, telemetryParseMs, telemetryKeypointsConfidence, telemetryHasNewData, telemetryDroppedBusy, telemetrySkipped, telemetryRequested, telemetryExecuted, lastDisposeTimestamp, poseInputSize, perfMoveNetRequested, perfMoveNetExecuted, perfMoveNetSkipped, perfMoveNetInferenceTotal, perfMoveNetInferenceMin, perfMoveNetInferenceMax, perfMoveNetCropTotal, perfMoveNetRunTotal, perfMoveNetParseTotal])

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
    isProcessing.value = false
    lastSubmitTimestamp.value = 0
    playerBbox.value = null
    playerCropRegion.value = null
  }, [latestResultKeypoints, latestResultAngles, latestResultTimestamp, latestCropInfo, isProcessing, lastSubmitTimestamp, playerBbox, playerCropRegion])

  return {
    processFrame,
    getLatestResult,
    reset,
    isReady,
    executionCount,
    lastInferenceMs,
    lastCropMs,
    lastResizeMs,
    lastRunMs,
    lastParseMs,
    profWorkletPrepMs,
    profRnScheduleWaitMs,
    profJsPreprocessMs,
    profInferenceMs,
    profPostprocessMs,
    latestResultKeypoints,
    latestResultAngles,
    latestResultTimestamp,
    latestCropInfo,
    playerBbox,
  }
}
