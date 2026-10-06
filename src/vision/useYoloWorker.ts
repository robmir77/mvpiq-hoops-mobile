// src/vision/useYoloWorker.ts
// YOLO worker for ball/hoop/player detection with independent timing.

import { useRef, useCallback, useEffect, useMemo } from 'react'
import { useSharedValue, SharedValue } from 'react-native-reanimated'
import { useResizer } from 'react-native-vision-camera-resizer'
import { useTensorflowModel } from 'react-native-fast-tflite'
import { parseYoloOutputFloat16 } from './yoloParserFloat16'
import type { AndroidDelegateOption, IosDelegateOption } from './delegates'
import { DEFAULT_ANDROID_DELEGATE, DEFAULT_IOS_DELEGATE } from './delegates'
import { Platform } from 'react-native'
import { getYoloModel } from './yoloModels'
import { DEFAULT_YOLO_MODEL_ID } from './yoloModels'
import { telemetryLogger } from './telemetry'
import { scheduleOnRN } from 'react-native-worklets'
import { VISION_CONFIG, TEST_CONFIG } from '@/config/appConfig'

const YOLO_INPUT_SIZE = 512

interface YoloWorkerResult {
  ball: { x: number; y: number; width: number; height: number; confidence: number } | null
  player: { x: number; y: number; width: number; height: number; confidence: number } | null
  rim: { x: number; y: number; width: number; height: number; confidence: number } | null
  debug: any
  timestamp: number
}

interface YoloWorkerReturn {
  processFrame: (frame: any, timestamp: number, frameCounter?: number) => void
  getLatestResult: () => YoloWorkerResult | null
  reset: () => void
  isReady: SharedValue<boolean>
  isProcessing: SharedValue<boolean>
  lastInferenceMs: SharedValue<number>
  lastResizeMs: SharedValue<number>
  lastRunMs: SharedValue<number>
  lastParseMs: SharedValue<number>
  executionCount: SharedValue<number>
  theoreticalFps: SharedValue<number>
  throughputFps: SharedValue<number>
  latestResultBall: SharedValue<{ x: number; y: number; width: number; height: number; confidence: number } | null>
  latestResultPlayer: SharedValue<{ x: number; y: number; width: number; height: number; confidence: number } | null>
  latestResultRim: SharedValue<{ x: number; y: number; width: number; height: number; confidence: number } | null>
  latestResultDebug: SharedValue<any>
  latestResultTimestamp: SharedValue<number>
}

export const useYoloWorker = (
  enabled: boolean = true,
  yoloDelegate?: AndroidDelegateOption | IosDelegateOption | null,
  yoloModelId?: string,
  yoloScheduledCount?: { value: number }, // Shared value for scheduler coordination
  perfYoloScheduleWaitTotal?: any // SharedValue for schedule wait tracking
) => {
  const latestResultBall = useSharedValue<{ x: number; y: number; width: number; height: number; confidence: number } | null>(null)
  const latestResultPlayer = useSharedValue<{ x: number; y: number; width: number; height: number; confidence: number } | null>(null)
  const latestResultRim = useSharedValue<{ x: number; y: number; width: number; height: number; confidence: number } | null>(null)
  const latestResultDebug = useSharedValue<any>(null)
  const latestResultTimestamp = useSharedValue(0)

  const lastInferenceAt = useSharedValue(0)
  const isProcessing = useSharedValue(false)

  // Phase 4.4: Removed adaptive FPS system - no temporal throttling per ARCHITECTURE.md
  // Legacy adaptive FPS code removed (was controlled by TEST_CONFIG.ENABLE_ADAPTIVE_FPS)

  const isReady = useSharedValue(false)
  const theoreticalFps = useSharedValue(0) // Theoretical FPS based on single inference time (latency capacity)
  const throughputFps = useSharedValue(0) // Actual throughput (inferences per second)
  const inferenceCount = useSharedValue(0)
  const throughputWindowStart = useSharedValue(0)
  // Last synchronous YOLO stage timings, exposed to the frame processor for 1s diagnostics.
  const lastInferenceMs = useSharedValue(0)
  const lastResizeMs = useSharedValue(0)
  const lastRunMs = useSharedValue(0)
  const lastParseMs = useSharedValue(0)
  const executionCount = useSharedValue(0)

  const recordTelemetry = useCallback((inferenceTime: number, ball: any, player: any, frameCounter?: number, resizeMs?: number, runMs?: number, parseMs?: number, requested?: boolean, executed?: boolean) => {
    if (requested) telemetryLogger.recordYoloRequested()
    if (executed) {
      telemetryLogger.recordYoloExecuted()
      telemetryLogger.recordYoloProcessedFrame()
    }
    telemetryLogger.recordYoloInference(inferenceTime)
    if (resizeMs !== undefined) telemetryLogger.recordYoloResize(resizeMs)
    if (runMs !== undefined) telemetryLogger.recordYoloRun(runMs)
    if (parseMs !== undefined) telemetryLogger.recordYoloParse(parseMs)

    if (ball) {
      telemetryLogger.recordBallDetection(ball.confidence)
      telemetryLogger.recordBbox(ball.x, ball.y, ball.width, ball.height)

      const bboxSizeNormalized = ball.width * ball.height
      const MIN_BBOX_SIZE_NORMALIZED = 0.0001
      const MAX_BBOX_SIZE_NORMALIZED = 0.06

      if (bboxSizeNormalized < MIN_BBOX_SIZE_NORMALIZED) {
        telemetryLogger.recordFalsePositive('small_bbox', ball.confidence)
      } else if (bboxSizeNormalized > MAX_BBOX_SIZE_NORMALIZED) {
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
    if (player) {
      telemetryLogger.recordPlayerDetection(player.confidence, {
        x: player.x,
        y: player.y,
        w: player.width,
        h: player.height
      })
    }
  }, [])

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

  // Debug log for model state
  useEffect(() => {
    console.log('[YoloWorker] MODEL STATE', {
      model: selectedYoloModel?.fileName,
      state: yoloModel.state,
      hasModel: !!yoloModel.model,
      error: yoloModel.state === 'error' ? yoloModel.error : null,
    })
  }, [yoloModel.state, yoloModel.model, selectedYoloModel?.fileName])

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

  const yoloResizerConfig = useMemo(
    () => {
      const config = {
        width: yoloInputSize,
        height: yoloInputSize,
        channelOrder: 'rgb' as const,
        dataType: 'float32' as const,
        pixelLayout: 'interleaved' as const,
        scaleMode: 'contain' as const,
      }
      return config
    },
    [yoloInputSize]
  )

  const { resizer: yoloResizer } = useResizer(yoloResizerConfig)

  // Run YOLO inference on JS thread (async) to measure RN scheduling contention
  const runYoloInference = useCallback(async (
    inputBuffer: ArrayBuffer,
    frameWidth: number,
    frameHeight: number,
    timestamp: number,
    t0: number,
    tScheduleStart: number,
    resizeMs: number,
    resized: any
  ) => {
    try {
      // Measure scheduling wait time (time from scheduleOnRN to actual execution)
      const tCallbackStart = performance.now()
      const scheduleWaitMs = tCallbackStart - tScheduleStart

      const tRunStart = performance.now()
      const outputs = yoloModelInstance!.runSync([inputBuffer])
      const tRunEnd = performance.now()
      const runMs = tRunEnd - tRunStart
      const rawOutput = outputs[0] as ArrayBufferLike

      // Parse YOLO output (Float16 only - INT8 models removed)
      const tParseStart = performance.now()
      const output = new Float32Array(rawOutput)
      const result = parseYoloOutputFloat16(output, 0.005, frameWidth, frameHeight, 0.005)
      const ball = result.ball
      const player = result.player
      const rim = result.rim
      const debug = result.debug
      const tParseEnd = performance.now()
      const parseMs = tParseEnd - tParseStart

      const t2 = performance.now()

      let validBall = null
      if (ball) {
        const bboxSizeNormalized = ball.width * ball.height
        const frameW = frameWidth || 1280
        const frameH = frameHeight || 720
        const frameArea = frameW * frameH
        const bboxSizePixels = bboxSizeNormalized * frameArea

        // Calculate thresholds based on actual frame resolution
        const MIN_BBOX_SIZE_NORMALIZED = 0.0001
        const MAX_BBOX_SIZE_NORMALIZED = 0.06
        const COURT_MARGIN = 0.1

        const isValidSize = bboxSizeNormalized >= MIN_BBOX_SIZE_NORMALIZED && bboxSizeNormalized <= MAX_BBOX_SIZE_NORMALIZED
        const isInCourt = ball.x >= COURT_MARGIN && ball.x <= 1 - COURT_MARGIN &&
                        ball.y >= COURT_MARGIN && ball.y <= 1 - COURT_MARGIN

        if (isValidSize && isInCourt) {
          validBall = ball
        }
      }

      latestResultBall.value = validBall
      latestResultPlayer.value = player
      latestResultRim.value = rim
      latestResultDebug.value = debug
      latestResultTimestamp.value = timestamp

      const inferenceTime = t2 - t0
      lastInferenceMs.value = inferenceTime
      lastResizeMs.value = resizeMs
      lastRunMs.value = runMs
      lastParseMs.value = parseMs
      executionCount.value += 1

      // Record schedule wait time if tracking is enabled
      if (perfYoloScheduleWaitTotal) {
        perfYoloScheduleWaitTotal.value += scheduleWaitMs
      }
      const calculatedFps = 1000 / inferenceTime
      if (calculatedFps > 0) {
        theoreticalFps.value = calculatedFps
        // Phase 4.4: Removed adaptive FPS throttling - no temporal throttling per ARCHITECTURE.md
      }

      // Calculate actual throughput (inferences per second over time window)
      const now = Date.now()
      if (throughputWindowStart.value === 0) {
        throughputWindowStart.value = now
        inferenceCount.value = 1
      } else {
        inferenceCount.value += 1
        const windowDuration = now - throughputWindowStart.value
        if (windowDuration >= 1000) { // Update every second
          throughputFps.value = (inferenceCount.value / windowDuration) * 1000
          throughputWindowStart.value = now
          inferenceCount.value = 0
        }
      }

      scheduleOnRN(recordTelemetry, inferenceTime, validBall, player, undefined, resizeMs, runMs, parseMs, true, true)

    } catch (error) {
      console.error('[YoloWorker] Async inference error:', error)
    } finally {
      // Dispose GPUFrame
      if (resized) {
        try {
          resized.dispose()
        } catch (e) {
        }
      }
      isProcessing.value = false
      lastInferenceAt.value = Date.now()
    }
  }, [yoloModelInstance, latestResultBall, latestResultPlayer, latestResultRim, latestResultDebug, latestResultTimestamp, lastInferenceMs, lastResizeMs, lastRunMs, lastParseMs, executionCount, theoreticalFps, throughputFps, throughputWindowStart, inferenceCount, isProcessing, lastInferenceAt, recordTelemetry, perfYoloScheduleWaitTotal])

  // Process frame in worklet, then schedule async inference on JS thread
  // Phase 4.4: Removed adaptive FPS throttling - no temporal throttling per ARCHITECTURE.md
  const processFrame = useCallback((frame: any, timestamp: number, frameCounter?: number) => {
    'worklet'

    if (!yoloModelInstance || isProcessing.value || !enabled) {
      return
    }

    isProcessing.value = true

    let resized: any = null
    try {
      const t0 = performance.now()
      resized = yoloResizer?.resize(frame)
      const t1 = performance.now()
      const resizeMs = t1 - t0

      if (resized) {
        const pixelBuffer = resized.getPixelBuffer()
        const source = new Float32Array(pixelBuffer as unknown as ArrayBufferLike)

        if (source.length === yoloInputElements) {
          // Pass buffer directly without slice() to avoid unnecessary copy
          const inputBuffer = source.buffer as ArrayBuffer
          const tScheduleStart = performance.now()

          // ASYNC: Pass buffer to JS thread for inference
          scheduleOnRN(runYoloInference, inputBuffer, frame.width, frame.height, timestamp, t0, tScheduleStart, resizeMs, resized)
        }
      }

    } catch (error) {
      console.error('[YoloWorker] Error processing frame:', error)

      // Release GPUFrame on error
      if (resized) {
        try {
          resized.dispose()
        } catch (e) {
        }
      }

      isProcessing.value = false
    }
  }, [yoloModelInstance, yoloResizer, yoloInputElements, enabled, theoreticalFps, latestResultBall, latestResultPlayer, latestResultRim, latestResultTimestamp, isProcessing, lastInferenceAt, runYoloInference])

  const getLatestResult = useCallback((): YoloWorkerResult | null => {
    if (latestResultBall.value === null && latestResultTimestamp.value === 0) {
      return null
    }
    return {
      ball: latestResultBall.value,
      player: latestResultPlayer.value,
      rim: latestResultRim.value,
      debug: latestResultDebug.value,
      timestamp: latestResultTimestamp.value
    }
  }, [latestResultBall, latestResultPlayer, latestResultRim, latestResultDebug, latestResultTimestamp])

  const reset = useCallback(() => {
    latestResultBall.value = null
    latestResultPlayer.value = null
    latestResultRim.value = null
    latestResultTimestamp.value = 0
    lastInferenceAt.value = 0
    isProcessing.value = false
  }, [latestResultBall, latestResultPlayer, latestResultRim, latestResultTimestamp, lastInferenceAt, isProcessing])

  return {
    processFrame,
    getLatestResult,
    reset,
    isReady,
    isProcessing,
    lastInferenceMs,
    lastResizeMs,
    lastRunMs,
    lastParseMs,
    executionCount,
    theoreticalFps,
    throughputFps,
    latestResultBall,
    latestResultPlayer,
    latestResultRim,
    latestResultDebug,
    latestResultTimestamp,
  } as YoloWorkerReturn
}
