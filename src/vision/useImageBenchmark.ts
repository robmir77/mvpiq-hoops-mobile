// src/vision/useImageBenchmark.ts
// Hook for running TFLite inference on static images for benchmark comparison
// Purpose: Compare app TFLite results with Python benchmark results

import { useState, useCallback, useRef, useMemo } from 'react'
import { useTensorflowModel } from 'react-native-fast-tflite'
import { YoloDetector } from './engine/YoloDetector'
import { YOLO_CONFIG } from '@/config/appConfig'
import { getYoloModel } from './yoloModels'
import { Asset } from 'expo-asset'
import * as FileSystem from 'expo-file-system/legacy'
import { decode } from 'jpeg-js'
import { Platform } from 'react-native'
import { BENCHMARK_IMAGE_ASSETS } from './benchmarkImageAssets'

// Polyfill Buffer for jpeg-js in React Native
if (typeof (global as any).Buffer === 'undefined') {
  (global as any).Buffer = require('buffer').Buffer
}

export interface BenchmarkResult {
  frameIndex: number
  videoName: string
  ball: { x: number; y: number; width: number; height: number; confidence: number } | null
  player: { x: number; y: number; width: number; height: number; confidence: number } | null
  rim: { x: number; y: number; width: number; height: number; confidence: number } | null
  inferenceMs: number
}

interface BenchmarkSummary {
  totalFrames: number
  processedFrames: number
  ballDetections: number
  playerDetections: number
  rimDetections: number
  avgInferenceMs: number
  results: BenchmarkResult[]
}

export const useImageBenchmark = (yoloModelId?: string) => {
  const [isProcessing, setIsProcessing] = useState(false)
  const [progress, setProgress] = useState({ current: 0, total: 0 })
  const [results, setResults] = useState<BenchmarkResult[]>([])
  const [error, setError] = useState<string | null>(null)

  const yoloDetectorRef = useRef(new YoloDetector())

  // Load TFLite model
  const model = getYoloModel(yoloModelId)
  const modelSource = useMemo(() => {
    // react-native-fast-tflite requires the asset require(), not a file URI
    return model?.asset
  }, [model?.asset])
  const tflite = useTensorflowModel(modelSource, [])

  const loadImageAsBuffer = useCallback(async (assetUri: string): Promise<{ buffer: ArrayBuffer; width: number; height: number }> => {
    // Load image from file system (already cached)
    const base64 = await FileSystem.readAsStringAsync(assetUri, {
      encoding: FileSystem.EncodingType.Base64,
    })

    // Decode JPEG using jpeg-js with Buffer polyfill
    const binaryString = atob(base64)
    const uint8Array = new Uint8Array(binaryString.length)
    for (let i = 0; i < binaryString.length; i++) {
      uint8Array[i] = binaryString.charCodeAt(i)
    }

    const jpegData = decode(uint8Array)
    const { width, height, data } = jpegData

    // Convert RGBA to RGB and normalize to 0-1
    const rgbBuffer = new Float32Array(width * height * 3)
    for (let i = 0; i < width * height; i++) {
      const pixelIndex = i * 4
      const rgbIndex = i * 3
      rgbBuffer[rgbIndex] = data[pixelIndex] / 255.0     // R
      rgbBuffer[rgbIndex + 1] = data[pixelIndex + 1] / 255.0 // G
      rgbBuffer[rgbIndex + 2] = data[pixelIndex + 2] / 255.0 // B
    }

    return { buffer: rgbBuffer.buffer, width, height }
  }, [])

  const processImage = useCallback(async (imageUri: string, frameIndex: number, videoName: string): Promise<BenchmarkResult> => {
    if (!tflite.model) {
      throw new Error('TFLite model not loaded')
    }

    const startTime = performance.now()

    // Load image
    const { buffer, width, height } = await loadImageAsBuffer(imageUri)

    // Preprocess: resize and letterbox to model input size
    // This is a simplified version - in production use react-native-vision-camera-resizer
    const tensorSize = model?.inputSize || 640
    const scale = Math.min(tensorSize / width, tensorSize / height)
    const resizedWidth = Math.round(width * scale)
    const resizedHeight = Math.round(height * scale)

    // Simple resize (nearest neighbor for speed - not ideal for accuracy but OK for benchmark)
    const inputBuffer = new Float32Array(tensorSize * tensorSize * 3)
    const offsetX = Math.floor((tensorSize - resizedWidth) / 2)
    const offsetY = Math.floor((tensorSize - resizedHeight) / 2)

    // Fill with padding value (0)
    inputBuffer.fill(0)

    // Copy resized image to center
    const srcData = new Float32Array(buffer)
    for (let y = 0; y < resizedHeight; y++) {
      for (let x = 0; x < resizedWidth; x++) {
        const srcX = Math.floor(x / scale)
        const srcY = Math.floor(y / scale)
        const srcIdx = (srcY * width + srcX) * 3
        const dstIdx = ((y + offsetY) * tensorSize + (x + offsetX)) * 3
        inputBuffer[dstIdx] = srcData[srcIdx]
        inputBuffer[dstIdx + 1] = srcData[srcIdx + 1]
        inputBuffer[dstIdx + 2] = srcData[srcIdx + 2]
      }
    }

    // Run inference
    const inferenceStart = performance.now()
    const outputs = tflite.model.runSync([inputBuffer.buffer as any])
    const inferenceMs = performance.now() - inferenceStart

    // Parse output with YoloDetector
    const detector = yoloDetectorRef.current
    const rawOutput = outputs[0] as ArrayBufferLike
    const parsed = detector.parseOutput(
      new Float32Array(rawOutput),
      width,
      height
    )

    return {
      frameIndex,
      videoName,
      ball: parsed.ball,
      player: parsed.player,
      rim: parsed.rim,
      inferenceMs,
    }
  }, [tflite, loadImageAsBuffer])

  const runBenchmark = useCallback(async (imageUris: string[], videoName: string) => {
    if (!tflite.model) {
      setError('TFLite model not loaded')
      return null
    }

    console.log('[Benchmark] Starting benchmark for video:', videoName, 'images:', imageUris.length)
    setIsProcessing(true)
    setProgress({ current: 0, total: imageUris.length })
    setError(null)
    setResults([])

    const benchmarkResults: BenchmarkResult[] = []

    try {
      for (let i = 0; i < imageUris.length; i++) {
        console.log('[Benchmark] Processing frame', i + 1, '/', imageUris.length)
        const result = await processImage(imageUris[i], i, videoName)
        benchmarkResults.push(result)
        setResults([...benchmarkResults])
        setProgress({ current: i + 1, total: imageUris.length })

        // Small delay to prevent UI freeze
        await new Promise(resolve => setTimeout(resolve, 10))
      }

      const summary: BenchmarkSummary = {
        totalFrames: imageUris.length,
        processedFrames: benchmarkResults.length,
        ballDetections: benchmarkResults.filter(r => r.ball !== null).length,
        playerDetections: benchmarkResults.filter(r => r.player !== null).length,
        rimDetections: benchmarkResults.filter(r => r.rim !== null).length,
        avgInferenceMs: benchmarkResults.reduce((sum, r) => sum + r.inferenceMs, 0) / benchmarkResults.length,
        results: benchmarkResults,
      }

      console.log('[Benchmark] Benchmark complete:', summary)
      return summary
    } catch (err) {
      console.error('[Benchmark] Benchmark error:', err)
      setError(err instanceof Error ? err.message : String(err))
      return null
    } finally {
      setIsProcessing(false)
    }
  }, [tflite, processImage])

  const loadBenchmarkImages = useCallback(async (): Promise<{ imageUris: string[]; videoNames: string[] }> => {
    try {
      // Load manifest directly with require() - no Asset.fromModule needed
      const manifest = require('../../assets/benchmark-images/manifest.json')
      console.log('[Benchmark] Manifest loaded, videos:', manifest.videos?.length)

      // Build array of all static assets from the generated mapping
      const assetsToLoad: any[] = []
      const assetToKey: string[] = []

      for (const video of manifest.videos || []) {
        // Extract video name from output_dir, handling both / and \
        const videoName = video.output_dir.split(/[/\\]/).pop() || 'unknown'
        console.log('[Benchmark] Processing video:', videoName, 'frames:', video.frames?.length)

        for (const frame of video.frames || []) {
          const key = `${videoName}/${frame.filename}`
          const staticAsset = (BENCHMARK_IMAGE_ASSETS as Record<string, any>)[key]

          if (!staticAsset) {
            console.error('[Benchmark] Asset not found in mapping:', key)
            continue
          }

          assetsToLoad.push(staticAsset)
          assetToKey.push(key)
        }
      }

      console.log('[Benchmark] Assets to load:', assetsToLoad.length)

      // Load all assets at once using Asset.loadAsync
      const loadedAssets = await Asset.loadAsync(assetsToLoad)
      console.log('[Benchmark] Assets loaded:', loadedAssets.length)

      // Create cache directory
      const cacheDir = (FileSystem as any).documentDirectory + 'benchmark-images/'
      const dirInfo = await FileSystem.getInfoAsync(cacheDir)
      if (!dirInfo.exists) {
        await FileSystem.makeDirectoryAsync(cacheDir, { intermediates: true })
        console.log('[Benchmark] Created cache directory:', cacheDir)
      }

      const imageUris: string[] = []
      const videoNames: string[] = []

      // Associate loaded assets by index, not by object comparison
      for (let i = 0; i < loadedAssets.length; i++) {
        const key = assetToKey[i]
        const loaded = loadedAssets[i]

        if (!key) continue

        const [videoName, filename] = key.split('/')
        const videoDir = cacheDir + videoName + '/'
        const destUri = videoDir + filename

        // Create video directory if needed
        const videoDirInfo = await FileSystem.getInfoAsync(videoDir)
        if (!videoDirInfo.exists) {
          await FileSystem.makeDirectoryAsync(videoDir, { intermediates: true })
        }

        const fileInfo = await FileSystem.getInfoAsync(destUri)
        if (fileInfo.exists) {
          // Already cached
          imageUris.push(destUri)
          videoNames.push(videoName)
          continue
        }

        // Copy from loaded asset to cache
        try {
          const sourceUri = loaded.localUri || loaded.uri
          if (!sourceUri) {
            throw new Error(`Asset has no local URI: ${key}`)
          }

          await FileSystem.copyAsync({ from: sourceUri, to: destUri })
          imageUris.push(destUri)
          videoNames.push(videoName)
        } catch (copyErr) {
          console.error('[Benchmark] Failed to copy image:', key, copyErr)
        }
      }

      console.log('[Benchmark] Loaded image URIs:', imageUris.length)
      console.log('[Benchmark] Video names:', [...new Set(videoNames)])
      if (imageUris.length === 0) {
        setError('No images could be loaded. Check that benchmark images are included in the bundle.')
      }
      return { imageUris, videoNames }
    } catch (err) {
      console.error('[Benchmark] Error loading images:', err)
      setError(err instanceof Error ? err.message : String(err))
      return { imageUris: [], videoNames: [] }
    }
  }, [])

  const exportResults = useCallback((format: 'json' | 'csv' = 'json') => {
    if (format === 'json') {
      return JSON.stringify(results, null, 2)
    } else {
      // CSV format matching benchmark_yolo_videos.py output
      const headers = ['frame_index', 'video_name', 'ball_detected', 'ball_confidence', 'ball_x', 'ball_y', 'ball_width', 'ball_height', 'player_detected', 'player_confidence', 'player_x', 'player_y', 'player_width', 'player_height', 'inference_ms']
      const rows = results.map(r => [
        r.frameIndex,
        r.videoName,
        r.ball ? 'true' : 'false',
        r.ball?.confidence.toFixed(4) || '',
        r.ball?.x.toFixed(4) || '',
        r.ball?.y.toFixed(4) || '',
        r.ball?.width.toFixed(4) || '',
        r.ball?.height.toFixed(4) || '',
        r.player ? 'true' : 'false',
        r.player?.confidence.toFixed(4) || '',
        r.player?.x.toFixed(4) || '',
        r.player?.y.toFixed(4) || '',
        r.player?.width.toFixed(4) || '',
        r.player?.height.toFixed(4) || '',
        r.inferenceMs.toFixed(4),
      ])
      return [headers.join(','), ...rows.map(r => r.join(','))].join('\n')
    }
  }, [results])

  return {
    isProcessing,
    progress,
    results,
    error,
    modelLoaded: !!tflite.model,
    runBenchmark,
    loadBenchmarkImages,
    exportResults,
    reset: useCallback(() => {
      setResults([])
      setError(null)
      setProgress({ current: 0, total: 0 })
    }, []),
  }
}
