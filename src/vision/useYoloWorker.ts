// src/vision/useYoloWorker.ts
// YOLO worker for ball/hoop/player detection with independent timing.

import { useRef, useCallback, useEffect, useMemo } from 'react'
import { useSharedValue } from 'react-native-reanimated'
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

const YOLO_INPUT_SIZE = 512
// YOLO throttling removed - run on every frame as per ARCHITECTURE_CHANGE.md
// Adaptive performance system will handle scaling if performance degrades
// const YOLO_TARGET_FPS = 10 // Disabled: run every frame
// const YOLO_INTERVAL_MS = 1000 / YOLO_TARGET_FPS // Disabled

interface YoloWorkerResult {
  ball: { x: number; y: number; width: number; height: number; confidence: number } | null
  player: { x: number; y: number; width: number; height: number; confidence: number } | null
  rim: { x: number; y: number; width: number; height: number; confidence: number } | null
  debug: any
  timestamp: number
}

export const useYoloWorker = (
  enabled: boolean = true,
  yoloDelegate?: AndroidDelegateOption | IosDelegateOption | null,
  yoloModelId?: string
) => {
  const latestResultBall = useSharedValue<{ x: number; y: number; width: number; height: number; confidence: number } | null>(null)
  const latestResultPlayer = useSharedValue<{ x: number; y: number; width: number; height: number; confidence: number } | null>(null)
  const latestResultRim = useSharedValue<{ x: number; y: number; width: number; height: number; confidence: number } | null>(null)
  const latestResultDebug = useSharedValue<any>(null)
  const latestResultTimestamp = useSharedValue(0)

  const lastInferenceAt = useSharedValue(0)
  const isProcessing = useSharedValue(false)

  const isReady = useSharedValue(false)
  const fps = useSharedValue(0)

  const recordTelemetry = useCallback((inferenceTime: number, ball: any, player: any, frameCounter?: number, resizeMs?: number, runMs?: number, parseMs?: number, requested?: boolean, executed?: boolean) => {
    if (__DEV__) {
      console.log('[YoloWorker] recordTelemetry called', { frameCounter, requested, executed })
    }
    if (requested) telemetryLogger.recordYoloRequested()
    if (executed) {
      telemetryLogger.recordYoloExecuted()
      if (frameCounter !== undefined) telemetryLogger.recordYoloProcessedFrame(frameCounter)
    }
    telemetryLogger.recordYoloInference(inferenceTime)
    if (resizeMs !== undefined) telemetryLogger.recordYoloResize(resizeMs)
    if (runMs !== undefined) telemetryLogger.recordYoloRun(runMs)
    if (parseMs !== undefined) telemetryLogger.recordYoloParse(parseMs)

    if (ball) {
      telemetryLogger.recordBallDetection(ball.confidence, frameCounter)
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
      }, frameCounter)
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

  const processFrame = useCallback((frame: any, timestamp: number, frameCounter?: number) => {
    'worklet'

    if (__DEV__) {
      console.log('[YoloWorker] processFrame called', { frameCounter, isProcessing: isProcessing.value, enabled })
    }

    if (!yoloModelInstance || isProcessing.value || !enabled) {
      if (__DEV__) {
        console.log('[YoloWorker] processFrame skipped', { hasModel: !!yoloModelInstance, isProcessing: isProcessing.value, enabled })
      }
      return
    }

    // Throttling removed - run on every frame as per ARCHITECTURE_CHANGE.md
    // Adaptive performance system will handle scaling if performance degrades
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

          const tRunStart = performance.now()
          const outputs = yoloModelInstance!.runSync([inputBuffer])
          const tRunEnd = performance.now()
          const runMs = tRunEnd - tRunStart
          const rawOutput = outputs[0] as ArrayBufferLike


          // Parse YOLO output (Float16 only - INT8 models removed)
          const tParseStart = performance.now()
          const output = new Float32Array(rawOutput)
          const result = parseYoloOutputFloat16(output, 0.005, frame.width, frame.height, 0.005)
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
            const frameW = frame.width || 1280
            const frameH = frame.height || 720
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
          const calculatedFps = 1000 / inferenceTime
          if (calculatedFps > 0) {
            fps.value = calculatedFps
          }

          scheduleOnRN(recordTelemetry, inferenceTime, validBall, player, frameCounter, resizeMs, runMs, parseMs, true, true)

        }
      }

    } catch (error) {
      console.error('[YoloWorker] Error processing frame:', error)
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
  }, [yoloModelInstance, yoloResizer, yoloInputElements, enabled, fps, latestResultBall, latestResultPlayer, latestResultRim, latestResultTimestamp, isProcessing, lastInferenceAt])

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
    fps,
    latestResultBall,
    latestResultPlayer,
    latestResultRim,
    latestResultDebug,
    latestResultTimestamp,
  }
}
