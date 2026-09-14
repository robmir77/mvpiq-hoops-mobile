// src/vision/useMoveNetWorker.ts
//
// MoveNet Worker - processes frames immediately with independent timing
// Runs MoveNet inference at target FPS independently from YOLO
// No buffering - processes frames synchronously when they arrive

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

const DEFAULT_POSE_INPUT_SIZE = 192
const MOVENET_TARGET_FPS = 3 // Target 3 FPS for MoveNet
const MOVENET_INTERVAL_MS = 1000 / MOVENET_TARGET_FPS

interface PoseWorkerResult {
  keypoints: any
  angles: any
  timestamp: number
}

export const useMoveNetWorker = (
  enabled: boolean = true,
  poseDelegate?: AndroidDelegateOption | IosDelegateOption | null,
  moveNetModelId?: string
) => {
  // Latest result - use SharedValue for worklet access
  const latestResultKeypoints = useSharedValue<any>(null)
  const latestResultAngles = useSharedValue<any>(null)
  const latestResultTimestamp = useSharedValue(0)

  // Timing - use SharedValue for worklet access
  const lastInferenceAt = useSharedValue(0)
  const isProcessing = useSharedValue(false)

  // Shared values for UI
  const isReady = useSharedValue(false)
  const fps = useSharedValue(0)

  // Model setup
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

  // Update ready state
  useEffect(() => {
    isReady.value = poseModel.state === 'loaded' && poseModel.model != null
  }, [poseModel.state, poseModel.model, isReady])

  // Resizer config
  const poseResizerConfig = useMemo(
    () => ({
      width: poseInputSize,
      height: poseInputSize,
      channelOrder: 'rgb' as const,
      dataType: 'uint8' as const,
      pixelLayout: 'interleaved' as const,
      scaleMode: 'contain' as const,
    }),
    [poseInputSize]
  )

  const { resizer: poseResizer } = useResizer(poseResizerConfig)

  // Process frame immediately (no buffering)
  const processFrame = useCallback((frame: any, timestamp: number) => {
    'worklet'

    if (!poseModelInstance || isProcessing.value || !enabled) {
      return
    }

    // Throttle based on timing
    const now = Date.now()
    const timeSinceLast = lastInferenceAt.value > 0 ? now - lastInferenceAt.value : MOVENET_INTERVAL_MS
    if (timeSinceLast < MOVENET_INTERVAL_MS) {
      return
    }

    isProcessing.value = true

    let resized: any = null
    try {
      const t0 = performance.now()
      resized = poseResizer?.resize(frame)
      const t1 = performance.now()

      if (resized) {
        const pixelBuffer = resized.getPixelBuffer()
        
        // MoveNet uses uint8 input
        const source = new Uint8Array(pixelBuffer as unknown as ArrayBufferLike)

        if (source.length === poseInputElements) {
          const inputBuffer = source.buffer.slice(
            source.byteOffset,
            source.byteOffset + source.byteLength
          ) as ArrayBuffer

          const outputs = poseModelInstance!.runSync([inputBuffer])
          const output = new Float32Array(outputs[0] as ArrayBufferLike)

          const keypoints = parseMoveNetOutput(output, poseInputSize)
          const angles = computeJointAngles(keypoints)

          const t2 = performance.now()

          // Update latest result
          latestResultKeypoints.value = keypoints
          latestResultAngles.value = angles
          latestResultTimestamp.value = timestamp

          // Update FPS only if valid (greater than 0)
          const inferenceTime = t2 - t0
          const calculatedFps = 1000 / inferenceTime

          if (__DEV__) {
            console.log(`[MoveNetWorker] Processed frame in ${inferenceTime.toFixed(1)}ms, FPS: ${calculatedFps.toFixed(1)}`)
          }

          if (calculatedFps > 0) {
            fps.value = calculatedFps
          } else {
            if (__DEV__) {
              console.log(`[MoveNetWorker] FPS is 0, not updating. InferenceTime: ${inferenceTime.toFixed(1)}ms`)
            }
          }
        }
      }

    } catch (error) {
      console.error('[MoveNetWorker] Error processing frame:', error)
    } finally {
      // Dispose GPUFrame to release GPU resources
      if (resized) {
        resized.dispose()
      }
      isProcessing.value = false
      lastInferenceAt.value = Date.now()
    }
  }, [poseModelInstance, poseResizer, poseInputElements, enabled, fps, latestResultKeypoints, latestResultAngles, latestResultTimestamp, isProcessing, lastInferenceAt])

  // Get latest result (called from JS thread)
  const getLatestResult = useCallback((): PoseWorkerResult | null => {
    if (latestResultKeypoints.value === null && latestResultTimestamp.value === 0) {
      return null
    }
    return {
      keypoints: latestResultKeypoints.value,
      angles: latestResultAngles.value,
      timestamp: latestResultTimestamp.value
    }
  }, [latestResultKeypoints, latestResultAngles, latestResultTimestamp])

  // Reset
  const reset = useCallback(() => {
    latestResultKeypoints.value = null
    latestResultAngles.value = null
    latestResultTimestamp.value = 0
    lastInferenceAt.value = 0
    isProcessing.value = false
  }, [latestResultKeypoints, latestResultAngles, latestResultTimestamp, lastInferenceAt, isProcessing])

  return {
    processFrame,
    getLatestResult,
    reset,
    isReady,
    fps,
    latestResultKeypoints,
    latestResultAngles,
    latestResultTimestamp,
  }
}
