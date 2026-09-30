// src/vision/useGpuCapabilityTest.ts
//
// GPU Capability Test for YOLO models
// Tests multiple resolutions to determine which are supported by the device GPU
// NOTE: This is a diagnostic tool - use it to identify which resolutions work on your device

import { useState, useCallback, useRef } from 'react'
import { Platform } from 'react-native'
import { getYoloModel } from './yoloModels'

interface ResolutionTestResult {
  resolution: number
  modelId: string
  loadSuccess: boolean
  loadError: string | null
  inferenceSuccess: boolean
  inferenceError: string | null
  inferenceTime: number
  gpuDelegate: string
}

interface GpuCapabilityTestState {
  isRunning: boolean
  currentResolution: number | null
  results: ResolutionTestResult[]
  deviceInfo: string | null
}

const RESOLUTIONS_TO_TEST = [320, 352, 384, 416, 448, 480, 512, 544, 576, 608, 640]

export const useGpuCapabilityTest = () => {
  const [state, setState] = useState<GpuCapabilityTestState>({
    isRunning: false,
    currentResolution: null,
    results: [],
    deviceInfo: null,
  })

  const abortController = useRef<AbortController | null>(null)

  const getDeviceInfo = useCallback(() => {
    try {
      if (Platform.OS === 'android') {
        const constants = require('react-native').Platform.constants
        return `Android ${constants.Release} / ${constants.Model} / ${constants.Manufacturer}`
      } else if (Platform.OS === 'ios') {
        const constants = require('react-native').Platform.constants
        return `iOS ${constants.systemVersion} / ${constants.Model}`
      }
      return Platform.OS
    } catch (e) {
      return Platform.OS
    }
  }, [])

  const testResolution = useCallback(async (resolution: number): Promise<ResolutionTestResult> => {
    const modelId = `best_${resolution}_float16`
    const model = getYoloModel(modelId)

    console.log(`[GpuCapabilityTest] Testing resolution: ${resolution}`)

    const result: ResolutionTestResult = {
      resolution,
      modelId,
      loadSuccess: false,
      loadError: null,
      inferenceSuccess: false,
      inferenceError: null,
      inferenceTime: 0,
      gpuDelegate: Platform.OS === 'android' ? 'android-gpu' : 'ios-gpu',
    }

    if (!model) {
      result.loadError = `Model ${modelId} not found in registry`
      console.log(`[GpuCapabilityTest] ${result.loadError}`)
      return result
    }

    // Check if model file exists in assets
    try {
      if (!model.asset) {
        result.loadError = `Model ${modelId} has no asset reference`
        console.log(`[GpuCapabilityTest] ${result.loadError}`)
        return result
      }

      result.loadSuccess = true
      console.log(`[GpuCapabilityTest] Model ${resolution} asset found: ${model.asset}`)

      // Note: We cannot actually test inference here because useTensorflowModel is a React hook
      // This test only verifies that the model is registered and has a valid asset
      // The actual inference test must be done in the YOLO worker with real frames
      console.log(`[GpuCapabilityTest] Model ${resolution} validation complete (inference test requires worker)`)

    } catch (e: any) {
      result.loadError = e?.message || 'Unknown error'
      console.error(`[GpuCapabilityTest] Model ${resolution} validation failed:`, result.loadError)
    }

    return result
  }, [])

  const runTest = useCallback(async () => {
    if (state.isRunning) return

    abortController.current = new AbortController()

    setState({
      isRunning: true,
      currentResolution: RESOLUTIONS_TO_TEST[0],
      results: [],
      deviceInfo: getDeviceInfo(),
    })

    console.log('[GpuCapabilityTest] Starting GPU capability test')
    console.log('[GpuCapabilityTest] Device:', getDeviceInfo())
    console.log('[GpuCapabilityTest] Resolutions to test:', RESOLUTIONS_TO_TEST.join(', '))

    const results: ResolutionTestResult[] = []

    for (const resolution of RESOLUTIONS_TO_TEST) {
      if (abortController.current?.signal.aborted) {
        console.log('[GpuCapabilityTest] Test aborted')
        break
      }

      setState(prev => ({ ...prev, currentResolution: resolution }))

      const result = await testResolution(resolution)
      results.push(result)

      setState(prev => ({ ...prev, results: [...prev.results, result] }))

      // Small delay between tests
      await new Promise(resolve => setTimeout(resolve, 200))
    }

    setState({
      isRunning: false,
      currentResolution: null,
      results,
      deviceInfo: getDeviceInfo(),
    })

    console.log('[GpuCapabilityTest] Test complete')
    console.log('[GpuCapabilityTest] Summary:', results.map(r => ({
      resolution: r.resolution,
      asset: r.loadSuccess ? '✅' : '❌',
      error: r.loadError,
    })))
  }, [state.isRunning, getDeviceInfo, testResolution])

  const abortTest = useCallback(() => {
    abortController.current?.abort()
    setState(prev => ({ ...prev, isRunning: false, currentResolution: null }))
  }, [])

  const resetTest = useCallback(() => {
    setState({
      isRunning: false,
      currentResolution: null,
      results: [],
      deviceInfo: null,
    })
  }, [])

  return {
    state,
    runTest,
    abortTest,
    resetTest,
  }
}
