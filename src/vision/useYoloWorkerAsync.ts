// src/vision/useYoloWorkerAsync.ts
// POC: Async YOLO worker with latest-frame gate
// Goal: Camera 30 FPS → lightweight frame processor → YOLO async 10 FPS
// Key fix: Extract frame data (resize + buffer) in worklet BEFORE frame is disposed
// Pass only extracted data to async, not the frame itself

import { useRef, useCallback, useEffect, useMemo } from 'react'
import { useSharedValue, SharedValue } from 'react-native-reanimated'
import { useResizer } from 'react-native-vision-camera-resizer'
import { useTensorflowModel } from 'react-native-fast-tflite'
import { YoloDetector } from './engine/YoloDetector'
import type { AndroidDelegateOption, IosDelegateOption } from './delegates'
import { DEFAULT_ANDROID_DELEGATE, DEFAULT_IOS_DELEGATE } from './delegates'
import { Platform } from 'react-native'
import { getYoloModel } from './yoloModels'
import { scheduleOnRN } from 'react-native-worklets'
import { TEST_CONFIG, YOLO_CONFIG } from '@/config/appConfig'
import { telemetryLogger } from './telemetry'

interface YoloWorkerResult {
  ball: { x: number; y: number; width: number; height: number; confidence: number } | null
  player: { x: number; y: number; width: number; height: number; confidence: number } | null
  rim: { x: number; y: number; width: number; height: number; confidence: number } | null
  debug: any
  timestamp: number
  inferenceMs?: number
  resizeMs?: number
  runMs?: number
  parseMs?: number
}

interface FrameData {
  inputBuffer: ArrayBuffer
  frameWidth: number
  frameHeight: number
  timestamp: number
  frameCounter: number
  resizeMs: number
  bufferExtractMs: number
  tA: number  // A: worklet start time
  tB: number  // B: worklet end time (before scheduleOnRN)
}

// Fixed YOLO target FPS - deterministic, no adaptation
// Benchmark: testing 15 FPS (up from 10 FPS baseline)
const YOLO_TARGET_FPS = 15

interface YoloWorkerReturn {
  submitFrame: (frame: any, timestamp: number, frameCounter?: number) => void
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
  latestResultBall: SharedValue<{ x: number; y: number; width: number; height: number; confidence: number } | null>
  latestResultPlayer: SharedValue<{ x: number; y: number; width: number; height: number; confidence: number } | null>
  latestResultRim: SharedValue<{ x: number; y: number; width: number; height: number; confidence: number } | null>
  latestResultDebug: SharedValue<any>
  latestResultTimestamp: SharedValue<number>
  yoloRequestedCount: SharedValue<number>
  yoloExecutedCount: SharedValue<number>
  yoloSkippedCount: SharedValue<number>
  onResultCallback: ((result: YoloWorkerResult) => void) | null
  // Profiling A→F timestamps
  // Pipeline: WORKLET(A→B) → scheduleWait(B→C) → JS/RN(C→D→E→F)
  profWorkletPrepMs: SharedValue<number>  // A→B: worklet preprocessing (resize + buffer extraction)
  profScheduleWaitMs: SharedValue<number> // B→C: worklet → JS scheduling wait
  profJsPreprocessMs: SharedValue<number>  // C→D: JS preprocessing (none for YOLO, resize is in worklet)
  profInferenceMs: SharedValue<number>     // D→E: TFLite inference (runSync)
  profPostprocessMs: SharedValue<number>   // E→F: postprocess/callback (parsing + SharedValue updates)
}

export const useYoloWorkerAsync = (
  enabled: boolean = true,
  yoloDelegate?: AndroidDelegateOption | IosDelegateOption | null,
  yoloModelId?: string,
  yoloScheduledCount?: { value: number },
  perfYoloScheduleWaitTotal?: SharedValue<number>,
  onResultCallback?: (result: YoloWorkerResult) => void
) => {
  // Pure YOLO detector instance (worklet-safe)
  const yoloDetectorRef = useRef(new YoloDetector(
    YOLO_CONFIG.BALL_CONF_THRESHOLD,
    YOLO_CONFIG.RIM_CONF_THRESHOLD
  ))

  const latestResultBall = useSharedValue<{ x: number; y: number; width: number; height: number; confidence: number } | null>(null)
  const latestResultPlayer = useSharedValue<{ x: number; y: number; width: number; height: number; confidence: number } | null>(null)
  const latestResultRim = useSharedValue<{ x: number; y: number; width: number; height: number; confidence: number } | null>(null)
  const latestResultDebug = useSharedValue<any>(null)
  const latestResultTimestamp = useSharedValue(0)

  const lastInferenceAt = useSharedValue(0)
  const isProcessing = useSharedValue(false)
  const lastSubmitTimestamp = useSharedValue(0)

  // Metrics counters
  const yoloRequestedCount = useSharedValue(0)
  const yoloExecutedCount = useSharedValue(0)
  const yoloSkippedCount = useSharedValue(0)

  // Latest-frame gate: flag to indicate if there's a pending frame
  // Note: True latest-frame-wins with frame buffer requires native queue architecture
  // Current implementation uses flag-based approach (worklet-safe)
  const hasPendingFrame = useSharedValue(false)

  // Cancellation token to prevent post-session inferences
  const isMountedRef = useRef(true)

  // Callback ref for result notification
  const onResultCallbackRef = useRef(onResultCallback || null)

  useEffect(() => {
    onResultCallbackRef.current = onResultCallback || null
  }, [onResultCallback])

  // Cleanup on unmount: cancel pending work
  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
      hasPendingFrame.value = false
    }
  }, [])

  const isReady = useSharedValue(false)
  const theoreticalFps = useSharedValue(0)
  const inferenceCount = useSharedValue(0)
  const throughputWindowStart = useSharedValue(0)
  const lastInferenceMs = useSharedValue(0)
  const lastResizeMs = useSharedValue(0)
  const lastRunMs = useSharedValue(0)
  const lastParseMs = useSharedValue(0)

  // Profiling A→F timestamps (for detailed scheduling analysis)
  // Pipeline: WORKLET(A→B) → scheduleWait(B→C) → JS/RN(C→D→E→F)
  const profWorkletPrepMs = useSharedValue(0)  // A→B: worklet preprocessing (resize + buffer extraction)
  const profScheduleWaitMs = useSharedValue(0) // B→C: worklet → JS scheduling wait
  const profJsPreprocessMs = useSharedValue(0)  // C→D: JS preprocessing (none for YOLO, resize is in worklet)
  const profInferenceMs = useSharedValue(0)     // D→E: TFLite inference (runSync)
  const profPostprocessMs = useSharedValue(0)   // E→F: postprocess/callback (parsing + SharedValue updates)
  const executionCount = useSharedValue(0)

  const selectedYoloModel = useMemo(() => getYoloModel(yoloModelId), [yoloModelId])
  const yoloInputSize = selectedYoloModel?.inputSize
  const yoloInputElements = yoloInputSize ? yoloInputSize * yoloInputSize * 3 : 0

  if (!yoloInputSize) {
    console.error('[YoloWorkerAsync] Invalid YOLO model configuration - no input size')
  }

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
        console.error('[YoloWorkerAsync] No valid YOLO model source available')
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
    console.log('[YoloWorkerAsync] MODEL STATE', {
      model: selectedYoloModel?.fileName,
      state: yoloModel.state,
      hasModel: !!yoloModel.model,
      error: yoloModel.state === 'error' ? yoloModel.error : null,
    })
  }, [yoloModel.state, yoloModel.model, selectedYoloModel?.fileName])

  useEffect(() => {
    const isLoaded = yoloModel.state === 'loaded' && yoloModel.model != null
    isReady.value = isLoaded
  }, [yoloModel.state, yoloModel.model, isReady])

  const yoloResizerConfig = useMemo(
    () => {
      if (!yoloInputSize) {
        console.error('[YoloWorkerAsync] Cannot configure resizer - invalid input size')
        return null
      }
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
    [yoloInputSize, yoloInputElements]
  )

  const { resizer: yoloResizer } = useResizer(yoloResizerConfig!)

  // POC: Async YOLO execution with latest-frame gate
  // This runs on JS thread via scheduleOnRN, NOT in frame processor worklet
  // Receives pre-extracted frame data (buffer + dimensions), not the frame itself
  const processYoloAsync = useCallback((frameData: FrameData) => {
    // Skip if unmounted
    if (!isMountedRef.current) {
      return
    }

    if (!yoloModelInstance || !enabled) {
      return
    }

    isProcessing.value = true
    telemetryLogger.recordYoloRequested()
    telemetryLogger.recordRnYoloScheduled()

    const tC = performance.now() // C: callback start (JS thread)

    try {
      const { inputBuffer, frameWidth, frameHeight, timestamp, frameCounter, resizeMs, bufferExtractMs, tA, tB } = frameData

      // Profiling B→C: worklet → JS scheduling wait
      const scheduleWaitMs = tC - tB

      // Profiling A→B: worklet preprocessing (resize + buffer extraction)
      const workletPrepMs = tB - tA

      telemetryLogger.recordRnYoloCallbackStart()

      // Detailed scheduling diagnostics (gated to reduce overhead)
      if (__DEV__ && frameCounter && frameCounter % 100 === 0) {
        console.log('[YoloWorkerAsync] scheduling diagnostics', {
          frameCounter,
          callbackStart: tC,
          scheduleWaitMs: scheduleWaitMs,
          queueDepth: scheduleWaitMs.toFixed(1) + 'ms'
        })
      }

      // Record schedule wait time if tracking is enabled
      if (perfYoloScheduleWaitTotal) {
        perfYoloScheduleWaitTotal.value += scheduleWaitMs
      }

      const tD = performance.now() // D: inference start (no JS preprocessing for YOLO)

      // Profiling C→D: JS preprocessing (none for YOLO, resize is in worklet)
      const jsPreprocessMs = 0

      const source = new Float32Array(inputBuffer)

      if (source.length === yoloInputElements) {
        const outputs = yoloModelInstance!.runSync([inputBuffer])
        const tE = performance.now() // E: inference end
        const runMs = tE - tD // D→E: inference time
        const rawOutput = outputs[0] as ArrayBufferLike

        const tParseStart = performance.now() // Start of E→F: postprocess
        const output = new Float32Array(rawOutput)
        const result = yoloDetectorRef.current.parseOutput(output, frameWidth, frameHeight)
        const ball = result.ball
        const player = result.player
        const rim = result.rim
        const debug = null // YoloDetector no longer returns debug info
        const tParseEnd = performance.now()
        const parseMs = tParseEnd - tParseStart

        const tF = performance.now() // F: callback end
        const postprocessMs = tF - tE // E→F: postprocess/callback time

        let validBall = null
        if (ball) {
          const bboxSizeNormalized = ball.width * ball.height

          const MIN_BBOX_SIZE_NORMALIZED = 0.0001
          const MAX_BBOX_SIZE_NORMALIZED = 0.06
          const COURT_MARGIN = 0.1

          const isValidSize = bboxSizeNormalized >= MIN_BBOX_SIZE_NORMALIZED && bboxSizeNormalized <= MAX_BBOX_SIZE_NORMALIZED
          const isInCourt = ball.x >= COURT_MARGIN && ball.x <= 1 - COURT_MARGIN &&
                          ball.y >= COURT_MARGIN && ball.y <= 1 - COURT_MARGIN

          if (isValidSize && isInCourt) {
            validBall = ball
            // Record ball detection telemetry
            telemetryLogger.recordBallDetection(validBall.confidence)
            telemetryLogger.recordBbox(validBall.x, validBall.y, validBall.width, validBall.height)

            // Record false positive reasons for filtering
            if (validBall.confidence < 0.3) {
              telemetryLogger.recordFalsePositive('low_confidence', validBall.confidence)
            }
          }
        }

        // Record player detection telemetry
        if (player) {
          telemetryLogger.recordPlayerDetection(player.confidence, {
            x: player.x,
            y: player.y,
            w: player.width,
            h: player.height
          })
        }

        // Record frame-level detection metrics (once per YOLO execution)
        if (validBall) {
          telemetryLogger.recordYoloFrameWithBall()
        }
        if (player) {
          telemetryLogger.recordYoloFrameWithPlayer()
        }

        latestResultBall.value = validBall
        latestResultPlayer.value = player
        latestResultRim.value = rim
        latestResultDebug.value = debug
        latestResultTimestamp.value = timestamp

        const inferenceTime = tF - tA // Total time from worklet start to callback end
        lastInferenceMs.value = inferenceTime
        lastResizeMs.value = resizeMs
        lastRunMs.value = runMs
        lastParseMs.value = parseMs
        executionCount.value += 1
        yoloExecutedCount.value += 1

        // Log to telemetry
        telemetryLogger.recordYoloExecuted()
        telemetryLogger.recordYoloProcessedFrame()
        telemetryLogger.recordYoloInference(inferenceTime)
        telemetryLogger.recordYoloResize(resizeMs)
        telemetryLogger.recordYoloRun(runMs)
        telemetryLogger.recordYoloParse(parseMs)
        telemetryLogger.recordYoloScheduleWait(scheduleWaitMs)

        // Update profiling A→F timestamps
        profWorkletPrepMs.value = workletPrepMs
        profScheduleWaitMs.value = scheduleWaitMs
        profJsPreprocessMs.value = jsPreprocessMs
        profInferenceMs.value = runMs
        profPostprocessMs.value = postprocessMs

        // Notify callback if provided
        if (onResultCallbackRef.current) {
          const result: YoloWorkerResult = {
            ball: validBall,
            player,
            rim,
            debug,
            timestamp,
            inferenceMs: inferenceTime,
            resizeMs,
            runMs,
            parseMs
          }
          onResultCallbackRef.current(result)
        }
        const calculatedFps = 1000 / inferenceTime
        if (calculatedFps > 0) {
          theoreticalFps.value = calculatedFps
        }

        // Note: Real throughput FPS is calculated by telemetryLogger based on executed / elapsed time
        // We don't maintain a separate throughput calculation here to avoid duplication
      }
    } catch (error) {
      console.error('[YoloWorkerAsync] Error processing frame:', error)
    } finally {
      const tCallbackEnd = performance.now()
      const callbackExecutionMs = tCallbackEnd - tC
      telemetryLogger.recordRnYoloCallbackExecution(callbackExecutionMs)

      isProcessing.value = false
      lastInferenceAt.value = Date.now()

      // Clear pending flag - the next frame from camera will be processed
      // (latest-frame-wins: we don't need to resubmit old frames)
      hasPendingFrame.value = false

      if (yoloScheduledCount) {
        yoloScheduledCount.value = 0
      }
    }
  }, [yoloModelInstance, yoloInputElements, enabled, theoreticalFps, latestResultBall, latestResultPlayer, latestResultRim, latestResultDebug, latestResultTimestamp, isProcessing, lastInferenceAt, yoloScheduledCount, hasPendingFrame])

  // Submit frame for async processing (called from frame processor)
  // Extracts frame data (resize + buffer) in worklet BEFORE frame is disposed
  const submitFrame = useCallback((frame: any, timestamp: number, frameCounter?: number) => {
    'worklet'

    if (!enabled || !yoloResizer || !yoloInputSize) {
      return
    }

    // Phase 4.4: Removed FPS throttling - no temporal throttling per ARCHITECTURE.md
    const now = Date.now()
    const timeSinceLastSubmit = now - lastSubmitTimestamp.value
    lastSubmitTimestamp.value = now

    // Gate 2: Single-flight - if processing, skip this frame (latest-frame-wins flag)
    if (isProcessing.value) {
      hasPendingFrame.value = true
      yoloSkippedCount.value += 1
      return
    }

    // Record requested
    yoloRequestedCount.value += 1
    hasPendingFrame.value = false

    // Extract frame data NOW (before frame is disposed)
    let resized: any = null
    let inputBuffer: ArrayBuffer | null = null
    let resizeMs = 0
    let bufferExtractMs = 0

    try {
      const tA = performance.now() // A: worklet start (A→B: worklet preprocessing)
      resized = yoloResizer.resize(frame)
      const t1 = performance.now()
      resizeMs = t1 - tA

      const tBufferStart = performance.now()
      if (resized) {
        const pixelBuffer = resized.getPixelBuffer()
        // Check buffer size directly without creating Float32Array copy
        const elementCount = (pixelBuffer as ArrayBufferLike).byteLength / Float32Array.BYTES_PER_ELEMENT

        if (elementCount === yoloInputElements) {
          inputBuffer = pixelBuffer as ArrayBuffer
        }
      }
      const tBufferEnd = performance.now()
      bufferExtractMs = tBufferEnd - tBufferStart

      if (inputBuffer) {
        // Create frame data object with extracted buffer
        const tB = performance.now() // B: worklet end (before scheduleOnRN)
        const frameData: FrameData = {
          inputBuffer,
          frameWidth: frame.width,
          frameHeight: frame.height,
          timestamp,
          frameCounter: frameCounter || 0,
          resizeMs,
          bufferExtractMs,
          tA,
          tB,
        }

        // Log worklet timing every 100 frames
        if (frameCounter && frameCounter % 100 === 0) {
          console.log('[YOLO WORKLET] timing:', {
            resize: resizeMs.toFixed(1),
            bufferExtract: bufferExtractMs.toFixed(1),
            totalWorklet: (resizeMs + bufferExtractMs).toFixed(1)
          })
        }

        // Mark as processing and submit to RN runtime
        isProcessing.value = true
        scheduleOnRN(processYoloAsync, frameData)
      }
    } catch (error) {
      console.error('[YoloWorkerAsync] Error extracting frame data:', error)
    } finally {
      // Dispose resized frame immediately (we have the buffer)
      if (resized) {
        try {
          resized.dispose()
        } catch (e) {
        }
      }
    }
  }, [enabled, yoloResizer, yoloInputElements, isProcessing, lastSubmitTimestamp, hasPendingFrame, yoloSkippedCount, processYoloAsync])

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
    lastSubmitTimestamp.value = 0
    hasPendingFrame.value = false
    yoloRequestedCount.value = 0
    yoloExecutedCount.value = 0
    yoloSkippedCount.value = 0
  }, [latestResultBall, latestResultPlayer, latestResultRim, latestResultTimestamp, lastInferenceAt, isProcessing, lastSubmitTimestamp, hasPendingFrame, yoloRequestedCount, yoloExecutedCount, yoloSkippedCount])

  return {
    submitFrame,
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
    profWorkletPrepMs,
    profScheduleWaitMs,
    profJsPreprocessMs,
    profInferenceMs,
    profPostprocessMs,
    latestResultBall,
    latestResultPlayer,
    latestResultRim,
    latestResultDebug,
    latestResultTimestamp,
    yoloRequestedCount,
    yoloExecutedCount,
    yoloSkippedCount,
    onResultCallback: onResultCallback || null,
  } as YoloWorkerReturn
}
