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
import { telemetryLogger } from './telemetry'
import { scheduleOnRN } from 'react-native-worklets'

const DEFAULT_POSE_INPUT_SIZE = 192 // Only 192 is currently available in the registry
const MOVENET_TARGET_FPS = 3 // Target 3 FPS for MoveNet
const MOVENET_INTERVAL_MS = 1000 / MOVENET_TARGET_FPS

interface PoseWorkerResult {
  keypoints: any
  angles: any
  timestamp: number
  cropInfo?: PlayerCropResult | null
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

  const playerBbox = useSharedValue<{ x: number; y: number; width: number; height: number } | null>(null)

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

    console.log('[MoveNet] Processing frame - bbox=', !!playerBbox.value)

    isProcessing.value = true

    let resized: any = null
    let cropInfo: PlayerCropResult | null = null

    try {
      const t0 = performance.now()
      const tResizeStart = performance.now()

      // Get player bbox from YOLO (now guaranteed to be valid when processFrame is called)
      const bbox = playerBbox.value

      if (!bbox) {
        console.warn('[MoveNet] No bbox available - skipping (should not happen with new architecture)')
        isProcessing.value = false
        return
      }

      // Use rgbResizer with float32 to avoid YUV-HardwareBuffer error
      // The resizer handles YUV→RGB conversion and resize to 192x192
      resized = rgbResizer?.resize(frame)
      const tResizeEnd = performance.now()
      const resizeMs = tResizeEnd - tResizeStart

      if (resized) {
        const pixelBuffer = resized.getPixelBuffer()

        // Convert to Float32Array (resizer outputs float32)
        const source = new Float32Array(pixelBuffer as unknown as ArrayBufferLike)

        if (source.length === poseInputElements) {
          // Pass buffer directly without slice() to avoid unnecessary copy
          const inputBuffer = source.buffer as ArrayBuffer

          const tRunStart = performance.now()
          const outputs = poseModelInstance!.runSync([inputBuffer])
          const tRunEnd = performance.now()
          const runMs = tRunEnd - tRunStart
          const output = new Float32Array(outputs[0] as ArrayBufferLike)

          const tParseStart = performance.now()
          const keypoints = parseMoveNetOutput(output, poseInputSize)
          const angles = computeJointAngles(keypoints)
          const tParseEnd = performance.now()
          const parseMs = tParseEnd - tParseStart

          // Since we're using full-frame resize (not crop), keypoints are already in normalized space
          const finalKeypoints = keypoints

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
          telemetryCropMs.value = 0 // No crop when using full-frame resize
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
  }, [latestResultKeypoints, latestResultAngles, latestResultTimestamp, latestCropInfo, lastInferenceAt, isProcessing, playerBbox])

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
