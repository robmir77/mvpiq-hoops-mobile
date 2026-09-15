// src/vision/useYoloWorker.ts
//
// YOLO Worker - processes frames immediately with independent timing
// Runs YOLO inference at target FPS independently from MoveNet
// No buffering - processes frames synchronously when they arrive

import { useRef, useCallback, useEffect, useMemo } from 'react'
import { useSharedValue } from 'react-native-reanimated'
import { useResizer } from 'react-native-vision-camera-resizer'
import { useTensorflowModel } from 'react-native-fast-tflite'
import { parseYoloOutput } from './yoloParser'
import type { AndroidDelegateOption, IosDelegateOption } from './delegates'
import { DEFAULT_ANDROID_DELEGATE, DEFAULT_IOS_DELEGATE } from './delegates'
import { Platform } from 'react-native'
import { getYoloModel } from './yoloModels'
import { DEFAULT_YOLO_MODEL_ID } from './yoloModels'
import { telemetryLogger } from './telemetry'
import { scheduleOnRN } from 'react-native-worklets'

const YOLO_INPUT_SIZE = 512
const YOLO_TARGET_FPS = 10 // Target 10 FPS for YOLO
const YOLO_INTERVAL_MS = 1000 / YOLO_TARGET_FPS

interface YoloWorkerResult {
  ball: { x: number; y: number; width: number; height: number; confidence: number } | null
  rim: { x: number; y: number; width: number; height: number; confidence: number } | null
  timestamp: number
}

export const useYoloWorker = (
  enabled: boolean = true,
  yoloDelegate?: AndroidDelegateOption | IosDelegateOption | null,
  yoloModelId?: string
) => {
  // Latest result - use SharedValue for worklet access
  const latestResultBall = useSharedValue<{ x: number; y: number; width: number; height: number; confidence: number } | null>(null)
  const latestResultRim = useSharedValue<{ x: number; y: number; width: number; height: number; confidence: number } | null>(null)
  const latestResultTimestamp = useSharedValue(0)

  // Timing - use SharedValue for worklet access
  const lastInferenceAt = useSharedValue(0)
  const isProcessing = useSharedValue(false)

  // Shared values for UI
  const isReady = useSharedValue(false)
  const fps = useSharedValue(0)

  // JS-side callback for telemetry recording
  const recordTelemetry = useCallback((inferenceTime: number, ball: any) => {
    telemetryLogger.recordYoloInference(inferenceTime)
    if (ball) {
      telemetryLogger.recordBallDetection(ball.confidence)
      telemetryLogger.recordBbox(ball.x, ball.y, ball.width, ball.height)
      
      // False positive detection
      const bboxSize = ball.width * ball.height
      const MIN_BBOX_SIZE = 100
      const MAX_BBOX_SIZE = 50000
      
      if (bboxSize < MIN_BBOX_SIZE) {
        telemetryLogger.recordFalsePositive('small_bbox', ball.confidence)
      } else if (bboxSize > MAX_BBOX_SIZE) {
        telemetryLogger.recordFalsePositive('large_bbox', ball.confidence)
      }
      
      const COURT_MARGIN = 0.1
      if (ball.x < COURT_MARGIN || ball.x > 1 - COURT_MARGIN ||
          ball.y < COURT_MARGIN || ball.y > 1 - COURT_MARGIN) {
        telemetryLogger.recordFalsePositive('outside_court', ball.confidence)
      }
      
      if (ball.confidence < 0.3) {
        telemetryLogger.recordFalsePositive('low_confidence', ball.confidence)
      }
    }
  }, [])

  // Model setup
  const selectedYoloModel = useMemo(() => getYoloModel(yoloModelId), [yoloModelId])
  const yoloInputSize = selectedYoloModel?.inputSize ?? YOLO_INPUT_SIZE
  const yoloInputElements = yoloInputSize * yoloInputSize * 3

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
        console.error('[YoloWorker] No valid YOLO model source available')
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

  // Update ready state and log model metadata
  useEffect(() => {
    const isLoaded = yoloModel.state === 'loaded' && yoloModel.model != null
    isReady.value = isLoaded
    
    // Log model metadata when model loads
    if (isLoaded && selectedYoloModel) {
      const delegateName = Platform.OS === 'android' 
        ? (yoloDelegate as AndroidDelegateOption) || DEFAULT_ANDROID_DELEGATE
        : (yoloDelegate as IosDelegateOption) || DEFAULT_IOS_DELEGATE
      
      telemetryLogger.logModelMetadata({
        name: selectedYoloModel.fileName,
        inputSize: selectedYoloModel.inputSize,
        delegate: typeof delegateName === 'string' ? delegateName : 'unknown'
      })
    }
  }, [yoloModel.state, yoloModel.model, isReady, selectedYoloModel, yoloDelegate])

  // Resizer config
  const yoloResizerConfig = useMemo(
    () => ({
      width: yoloInputSize,
      height: yoloInputSize,
      channelOrder: 'rgb' as const,
      dataType: 'float32' as const,
      pixelLayout: 'interleaved' as const,
      scaleMode: 'contain' as const,
    }),
    [yoloInputSize]
  )

  const { resizer: yoloResizer } = useResizer(yoloResizerConfig)

  // Process frame immediately (no buffering)
  const processFrame = useCallback((frame: any, timestamp: number) => {
    'worklet'

    if (!yoloModelInstance || isProcessing.value || !enabled) {
      return
    }

    // Throttle based on timing
    const now = Date.now()
    const timeSinceLast = lastInferenceAt.value > 0 ? now - lastInferenceAt.value : YOLO_INTERVAL_MS
    if (timeSinceLast < YOLO_INTERVAL_MS) {
      return
    }

    isProcessing.value = true

    let resized: any = null
    try {
      const t0 = performance.now()
      resized = yoloResizer?.resize(frame)
      const t1 = performance.now()

      if (resized) {
        const pixelBuffer = resized.getPixelBuffer()

        const source = new Float32Array(pixelBuffer as unknown as ArrayBufferLike)

        if (source.length === yoloInputElements) {
          const inputBuffer = source.buffer.slice(
            source.byteOffset,
            source.byteOffset + source.byteLength
          ) as ArrayBuffer

          const outputs = yoloModelInstance!.runSync([inputBuffer])
          const output = new Float32Array(outputs[0] as ArrayBufferLike)

          // Log output shape for verification
          if (__DEV__) {
            console.log(`[YoloWorker] Output buffer length: ${output.length}`)
            console.log(`[YoloWorker] Expected detections (length/7): ${output.length / 7}`)
            console.log(`[YoloWorker] Frame size: ${frame.width}x${frame.height}`)
          }

          const { ball, rim } = parseYoloOutput(output, 0.01, frame.width, frame.height)

          const t2 = performance.now()
          
          // Update latest result
          latestResultBall.value = ball
          latestResultRim.value = rim
          latestResultTimestamp.value = timestamp
          
          // Update FPS only if valid (greater than 0)
          const inferenceTime = t2 - t0
          const calculatedFps = 1000 / inferenceTime
          if (calculatedFps > 0) {
            fps.value = calculatedFps
          }

          // Record telemetry via scheduleOnRN
          scheduleOnRN(recordTelemetry, inferenceTime, ball)

          if (__DEV__) {
            console.log(`[YoloWorker] Processed frame in ${inferenceTime.toFixed(1)}ms`)
          }
        }
      }

    } catch (error) {
      console.error('[YoloWorker] Error processing frame:', error)
    } finally {
      // Dispose GPUFrame to release GPU resources
      if (resized) {
        resized.dispose()
      }
      isProcessing.value = false
      lastInferenceAt.value = Date.now()
    }
  }, [yoloModelInstance, yoloResizer, yoloInputElements, enabled, fps, latestResultBall, latestResultRim, latestResultTimestamp, isProcessing, lastInferenceAt])

  // Get latest result (called from JS thread)
  const getLatestResult = useCallback((): YoloWorkerResult | null => {
    if (latestResultBall.value === null && latestResultTimestamp.value === 0) {
      return null
    }
    return {
      ball: latestResultBall.value,
      rim: latestResultRim.value,
      timestamp: latestResultTimestamp.value
    }
  }, [latestResultBall, latestResultRim, latestResultTimestamp])

  // Reset
  const reset = useCallback(() => {
    latestResultBall.value = null
    latestResultRim.value = null
    latestResultTimestamp.value = 0
    lastInferenceAt.value = 0
    isProcessing.value = false
  }, [latestResultBall, latestResultRim, latestResultTimestamp, lastInferenceAt, isProcessing])

  return {
    processFrame,
    getLatestResult,
    reset,
    isReady,
    fps,
    latestResultBall,
    latestResultRim,
    latestResultTimestamp,
  }
}
