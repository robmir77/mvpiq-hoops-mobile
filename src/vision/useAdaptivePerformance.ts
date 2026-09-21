// src/vision/useAdaptivePerformance.ts
//
// Adaptive performance management for YOLO and camera FPS
// Automatically scales down FPS and model complexity when performance degrades
// Automatically scales up when performance is good

import { useRef, useCallback, useEffect } from 'react'
import { useSharedValue } from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'
import { YOLO_MODELS, type YoloModelConfig } from './yoloModels'

// Performance tiers for YOLO models (ordered by complexity, high to low)
const YOLO_MODEL_TIERS: YoloModelConfig[] = [
  YOLO_MODELS.find(m => m.id === 'best_640_float16')!,
  YOLO_MODELS.find(m => m.id === 'best_512_float16')!,
  YOLO_MODELS.find(m => m.id === 'best_320_float16')!,
].filter(Boolean)

// FPS tiers (ordered by performance, high to low)
const FPS_TIERS = [30, 24, 20, 15]

// Performance thresholds
const TARGET_YOLO_FPS = 10 // Minimum acceptable YOLO FPS
const TARGET_YOLO_SUCCESS_RATE = 0.6 // Minimum successful inference rate (60%)
const ADAPTATION_WINDOW_MS = 3000 // Time window for performance evaluation
const MIN_ADAPTATION_INTERVAL_MS = 5000 // Minimum time between adaptations

interface AdaptivePerformanceConfig {
  initialFps: number
  initialModelId: string
  availableFps: number[] // Available FPS from device
}

interface PerformanceMetrics {
  yoloFps: number
  yoloSuccessRate: number
  avgInferenceTime: number
  framesProcessed: number
  framesFailed: number
}

export const useAdaptivePerformance = ({
  initialFps,
  initialModelId,
  availableFps = FPS_TIERS,
}: AdaptivePerformanceConfig) => {
  // Current state
  const currentFps = useSharedValue(initialFps)
  const currentModelIndex = useSharedValue(
    YOLO_MODEL_TIERS.findIndex(m => m.id === initialModelId)
  )
  const availableFpsList = useSharedValue(availableFps)

  // Performance tracking (useSharedValue for worklet access)
  const perfWindowStart = useSharedValue(Date.now())
  const perfYoloFpsSum = useSharedValue(0)
  const perfYoloFpsCount = useSharedValue(0)
  const perfFramesProcessed = useSharedValue(0)
  const perfFramesFailed = useSharedValue(0)
  const perfInferenceTimeSum = useSharedValue(0)

  const lastAdaptationAt = useRef(0)
  const isAdapting = useSharedValue(false)

  // Record YOLO performance (called from worklet)
  const recordYoloPerformance = useCallback((fps: number, success: boolean, inferenceTime: number) => {
    'worklet'

    const now = Date.now()

    // Reset window if expired
    if (now - perfWindowStart.value > ADAPTATION_WINDOW_MS) {
      perfWindowStart.value = now
      perfYoloFpsSum.value = 0
      perfYoloFpsCount.value = 0
      perfFramesProcessed.value = 0
      perfFramesFailed.value = 0
      perfInferenceTimeSum.value = 0
    }

    perfYoloFpsSum.value += fps
    perfYoloFpsCount.value++
    perfFramesProcessed.value++
    perfInferenceTimeSum.value += inferenceTime

    if (!success) {
      perfFramesFailed.value++
    }
  }, [])

  // Get current performance metrics
  const getPerformanceMetrics = useCallback((): PerformanceMetrics => {
    'worklet'

    const avgYoloFps = perfYoloFpsCount.value > 0
      ? perfYoloFpsSum.value / perfYoloFpsCount.value
      : 0

    const successRate = perfFramesProcessed.value > 0
      ? 1 - (perfFramesFailed.value / perfFramesProcessed.value)
      : 1

    const avgInferenceTime = perfYoloFpsCount.value > 0
      ? perfInferenceTimeSum.value / perfYoloFpsCount.value
      : 0

    return {
      yoloFps: avgYoloFps,
      yoloSuccessRate: successRate,
      avgInferenceTime,
      framesProcessed: perfFramesProcessed.value,
      framesFailed: perfFramesFailed.value,
    }
  }, [])

  // Check if we should scale down (performance is poor)
  const shouldScaleDown = useCallback((metrics: PerformanceMetrics): boolean => {
    'worklet'
    return metrics.yoloFps < TARGET_YOLO_FPS || metrics.yoloSuccessRate < TARGET_YOLO_SUCCESS_RATE
  }, [])

  // Check if we should scale up (performance is good)
  const shouldScaleUp = useCallback((metrics: PerformanceMetrics): boolean => {
    'worklet'
    return metrics.yoloFps >= TARGET_YOLO_FPS * 1.5 && metrics.yoloSuccessRate >= TARGET_YOLO_SUCCESS_RATE * 1.1
  }, [])

  // Scale down FPS
  const scaleDownFps = useCallback(() => {
    'worklet'

    const currentFpsVal = currentFps.value
    const fpsList = availableFpsList.value

    // Find current index
    const currentIndex = fpsList.indexOf(currentFpsVal)
    if (currentIndex === -1 || currentIndex >= fpsList.length - 1) {
      return false // Already at minimum or invalid
    }

    const newFps = fpsList[currentIndex + 1]
    currentFps.value = newFps

    return true
  }, [currentFps, availableFpsList])

  // Scale up FPS
  const scaleUpFps = useCallback(() => {
    'worklet'

    const currentFpsVal = currentFps.value
    const fpsList = availableFpsList.value

    // Find current index
    const currentIndex = fpsList.indexOf(currentFpsVal)
    if (currentIndex <= 0) {
      return false // Already at maximum
    }

    const newFps = fpsList[currentIndex - 1]
    currentFps.value = newFps

    return true
  }, [currentFps, availableFpsList])

  // Scale down model
  const scaleDownModel = useCallback(() => {
    'worklet'

    const currentIndex = currentModelIndex.value
    if (currentIndex >= YOLO_MODEL_TIERS.length - 1) {
      return false // Already at minimum
    }

    const newIndex = currentIndex + 1
    currentModelIndex.value = newIndex

    return true
  }, [currentModelIndex])

  // Scale up model
  const scaleUpModel = useCallback(() => {
    'worklet'

    const currentIndex = currentModelIndex.value
    if (currentIndex <= 0) {
      return false // Already at maximum
    }

    const newIndex = currentIndex - 1
    currentModelIndex.value = newIndex

    return true
  }, [currentModelIndex])

  // Main adaptation logic
  const evaluateAndAdapt = useCallback(() => {
    'worklet'

    if (isAdapting.value) return

    const now = Date.now()
    if (now - lastAdaptationAt.current < MIN_ADAPTATION_INTERVAL_MS) {
      return
    }

    const metrics = getPerformanceMetrics()

    // Log frame count for debugging
    console.log(`[AdaptivePerf] evaluateAndAdapt called: framesProcessed=${metrics.framesProcessed}, yoloFps=${metrics.yoloFps.toFixed(1)}`)

    // Need minimum samples to make decision
    if (metrics.framesProcessed < 30) {
      console.log(`[AdaptivePerf] Not enough frames (${metrics.framesProcessed} < 30), skipping adaptation`)
      return
    }

    isAdapting.value = true
    lastAdaptationAt.current = now

    // Log current state for debugging
    const currentFpsVal = currentFps.value
    const currentModelIndexVal = currentModelIndex.value
    console.log(`[AdaptivePerf] Current state: currentFps=${currentFpsVal}, modelIndex=${currentModelIndexVal}, yoloFps=${metrics.yoloFps.toFixed(1)}, successRate=${(metrics.yoloSuccessRate * 100).toFixed(1)}%`)

    if (shouldScaleDown(metrics)) {
      // First try to scale down FPS
      const fpsScaled = scaleDownFps()

      // If FPS is already at minimum, scale down model
      if (!fpsScaled) {
        scaleDownModel()
      }
    } else if (shouldScaleUp(metrics)) {
      // First try to scale up model
      const modelScaled = scaleUpModel()

      // If model is already at maximum, scale up FPS
      if (!modelScaled) {
        scaleUpFps()
      }
    }

    // Reset performance window after adaptation
    perfWindowStart.value = Date.now()
    perfYoloFpsSum.value = 0
    perfYoloFpsCount.value = 0
    perfFramesProcessed.value = 0
    perfFramesFailed.value = 0
    perfInferenceTimeSum.value = 0

    isAdapting.value = false
  }, [isAdapting, getPerformanceMetrics, shouldScaleDown, shouldScaleUp, scaleDownFps, scaleDownModel, scaleUpModel, scaleUpFps])

  // Get current state
  const getCurrentFps = useCallback(() => currentFps.value, [currentFps])
  const getCurrentModel = useCallback(() => YOLO_MODEL_TIERS[currentModelIndex.value], [currentModelIndex])

  return {
    recordYoloPerformance,
    evaluateAndAdapt,
    getCurrentFps,
    getCurrentModel,
    currentFps,
    currentModelIndex,
  }
}
