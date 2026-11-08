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
import { letterboxRgbToYoloInput } from './engine/yoloPreprocessing'

// Polyfill Buffer for jpeg-js in React Native
if (typeof (global as any).Buffer === 'undefined') {
  (global as any).Buffer = require('buffer').Buffer
}

// Temporary diagnostic functions for tensor comparison with Python benchmark
const getTensorStats = (data: Float32Array) => {
  let min = Infinity
  let max = -Infinity
  let sum = 0

  for (let i = 0; i < data.length; i++) {
    const value = data[i]
    if (value < min) min = value
    if (value > max) max = value
    sum += value
  }

  return {
    min,
    max,
    mean: sum / data.length,
    elements: data.length,
  }
}

const saveDebugTensor = async (
  filename: string,
  data: Float32Array
) => {
  const directory = `${FileSystem.documentDirectory}yolo-debug/`
  const info = await FileSystem.getInfoAsync(directory)

  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(directory, {
      intermediates: true,
    })
  }

  const bytes = new Uint8Array(
    data.buffer,
    data.byteOffset,
    data.byteLength
  )

  const base64 = (global as any).Buffer.from(bytes).toString('base64')

  await FileSystem.writeAsStringAsync(
    directory + filename,
    base64,
    { encoding: FileSystem.EncodingType.Base64 }
  )

  return directory + filename
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
      rgbBuffer[rgbIndex] = data[pixelIndex]         // R: preserve model input range 0..255
      rgbBuffer[rgbIndex + 1] = data[pixelIndex + 1] // G
      rgbBuffer[rgbIndex + 2] = data[pixelIndex + 2] // B
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

    // Match the Python benchmark: RGB float32 values in the model's 0..255 range,
    // bilinear resize, centered contain/letterbox padding.
    const tensorSize = model?.inputSize || 640
    const inputBuffer = letterboxRgbToYoloInput(
      new Float32Array(buffer), width, height, tensorSize
    )

    // Temporary diagnostic: capture input tensor for frame_000085.jpg
    const decodedImageUri = decodeURIComponent(imageUri)

    const isTargetFrame = decodedImageUri.includes(
      '/Tiro a centrocampo/frame_000085.jpg'
    )

    if (decodedImageUri.includes('frame_000085.jpg')) {
      console.log('[YOLO DEBUG] Frame 000085 detected', {
        imageUri,
        decodedImageUri,
        isTargetFrame,
        video: decodedImageUri.includes('Tiro Libero') ? 'Tiro Libero' : decodedImageUri.includes('Tiro a centrocampo') ? 'Tiro a centrocampo' : 'unknown',
      })
    }

    let inputStats: ReturnType<typeof getTensorStats> | null = null
    let inputFile: string | null = null

    if (isTargetFrame) {
      inputStats = getTensorStats(inputBuffer)
      inputFile = await saveDebugTensor(
        'frame_000085_android_input.f32',
        inputBuffer
      )

      console.log('[YOLO DEBUG] Android input', {
        width,
        height,
        tensorSize,
        ...inputStats,
        file: inputFile,
      })
    }

    // Run inference
    const inferenceStart = performance.now()
    const outputs = tflite.model.runSync([inputBuffer.buffer as any])
    const inferenceMs = performance.now() - inferenceStart

    // Parse output with YoloDetector
    const detector = yoloDetectorRef.current
    const rawOutput = outputs[0] as ArrayBufferLike

    // Temporary diagnostic: capture output tensor for frame_000085.jpg
    if (isTargetFrame) {
      const outputFloat32 = new Float32Array(rawOutput)
      const outputStats = getTensorStats(outputFloat32)

      const outputFile = await saveDebugTensor(
        'frame_000085_android_output.f32',
        outputFloat32
      )

      const metadata = {
        image: 'frame_000085.jpg',
        width,
        height,
        inputSize: tensorSize,
        input: inputStats,
        inputFile,
        output: outputStats,
        outputFile,
        outputShapeExpected: [1, 7, outputFloat32.length / 7],
        outputDtype: 'float32',
      }

      await FileSystem.writeAsStringAsync(
        `${FileSystem.documentDirectory}yolo-debug/frame_000085_metadata.json`,
        JSON.stringify(metadata, null, 2)
      )

      console.log('[YOLO DEBUG] Android output', metadata)
    }

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

        // Temporary diagnostic: log URI construction for frame_000085.jpg
        if (filename === 'frame_000085.jpg') {
          console.log('[YOLO DEBUG] URI construction', {
            key,
            videoName,
            filename,
            videoDir,
            destUri,
            sourceUri: loaded.localUri || loaded.uri,
          })
        }

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
