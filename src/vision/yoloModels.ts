// src/vision/yoloModels.ts
//
// YOLO model registry.
// The asset imports are intentionally static because Metro/Expo cannot enumerate
// arbitrary files from assets/models at runtime.
//
// Run: node scripts/generate-yolo-models.mjs
// after adding/removing .tflite files in assets/models.

import * as FileSystem from 'expo-file-system/legacy'
import { Asset } from 'expo-asset'
import { MODEL_CONFIG } from '@/config/appConfig'

export interface MoveNetModelConfig {
  id: string
  fileName: string
  label: string
  inputSize: number
  outputKeypoints: number
  asset: any
  fileUri?: string
}

export interface YoloModelConfig {
  id: string
  fileName: string
  label: string
  inputSize: number
  outputDetections: number
  precision: 'float16'
  asset: any
  fileUri?: string
  fpsMin?: number
  fpsMax?: number
  epochs?: number
  usageMinutes?: number
  defaultCameraResolution?: { width: number; height: number }
}

// GENERATED ENTRIES - do not edit manually.
// Regenerate with scripts/generate-yolo-models.mjs.
export const YOLO_MODELS: YoloModelConfig[] = [
  {
    id: "best_320_float16",
    fileName: "best_320_float16.tflite",
    label: "best · 320 · FP16",
    inputSize: 320,
    outputDetections: 2100,
    precision: 'float16',
    asset: require("../../assets/models/best_320_float16.tflite"),
    fpsMin: 10,
    fpsMax: 37,
    epochs: 50,
    usageMinutes: 0,
    defaultCameraResolution: { width: 640, height: 360 },
  },
  {
    id: "best_384_float16",
    fileName: "best_384_float16.tflite",
    label: "best · 384 · FP16",
    inputSize: 384,
    outputDetections: 3024,
    precision: 'float16',
    asset: require("../../assets/models/best_384_float16.tflite"),
    fpsMin: 20,
    fpsMax: 21,
    epochs: 200,
    usageMinutes: 0,
    defaultCameraResolution: { width: 1280, height: 720 },
  },
  {
    id: "best_448_float16",
    fileName: "best_448_float16.tflite",
    label: "best · 448 · FP16",
    inputSize: 448,
    outputDetections: 4116,
    precision: 'float16',
    asset: require("../../assets/models/best_448_float16.tflite"),
    fpsMin: 12,
    fpsMax: 21,
    epochs: 50,
    usageMinutes: 0,
    defaultCameraResolution: { width: 1280, height: 720 },
  },
  {
    id: "best_512_float16",
    fileName: "best_512_float16.tflite",
    label: "best · 512 · FP16",
    inputSize: 512,
    outputDetections: 5376,
    precision: 'float16',
    asset: require("../../assets/models/best_512_float16.tflite"),
    fpsMin: 8,
    fpsMax: 10,
    epochs: 40,
    usageMinutes: 0,
    defaultCameraResolution: { width: 1280, height: 720 },
  },
  {
    id: "best_640_float16",
    fileName: "best_640_float16.tflite",
    label: "best · 640 · FP16",
    inputSize: 640,
    outputDetections: 8400,
    precision: 'float16',
    asset: require("../../assets/models/best_640_float16.tflite"),
    fpsMin: 5,
    fpsMax: 7,
    epochs: 65,
    usageMinutes: 0,
    defaultCameraResolution: { width: 1280, height: 720 },
  },
]

export const DEFAULT_YOLO_MODEL_ID = MODEL_CONFIG.DEFAULT_YOLO_MODEL_ID

// MoveNet model registry. Keep the model input size here so the camera
// resizer and the TFLite input buffer can never drift apart.
export const MOVENET_MODELS: MoveNetModelConfig[] = [
  {
    id: 'movenet_lightning_192_int8',
    fileName: 'movenet_lightning_192_int8.tflite',
    label: 'MoveNet Lightning · INT8 · 192',
    inputSize: 192,
    outputKeypoints: 17,
    asset: require('../../assets/models/movenet_lightning_192_int8.tflite'),
  },
]

export const DEFAULT_MOVENET_MODEL_ID = MODEL_CONFIG.DEFAULT_MOVENET_MODEL_ID

// MoveNet model URI - loaded separately
let moveNetModelUri: string | null = null
const moveNetModelCache = new Map<string, MoveNetModelConfig>()

// Cache for stable model references to prevent unnecessary reloads
const modelCache = new Map<string, YoloModelConfig>()

// Copy asset from bundle to file system and return file URI
async function copyAssetToFile(asset: any, fileName: string): Promise<string> {
  const assetObj = Asset.fromModule(asset)
  const destUri = (FileSystem as any).documentDirectory + fileName

  // Expo Asset exposes a bundled checksum; compare it with the cached file's
  // MD5 so a model update under the same filename refreshes the local copy.
  const expectedHash = typeof assetObj.hash === 'string' ? assetObj.hash.toLowerCase() : null
  const fileInfo = await FileSystem.getInfoAsync(destUri, { md5: true } as any)
  const cachedHash = fileInfo.exists && typeof (fileInfo as any).md5 === 'string'
    ? (fileInfo as any).md5.toLowerCase()
    : null

  if (fileInfo.exists && expectedHash && cachedHash && expectedHash === cachedHash) {
    console.log('[YoloModels] Cached model checksum matches bundle:', fileName, expectedHash)
    return destUri
  }

  if (fileInfo.exists && expectedHash && cachedHash && expectedHash !== cachedHash) {
    console.warn('[YoloModels] Cached model checksum differs from bundle; refreshing:', {
      fileName,
      cachedHash,
      expectedHash,
    })
  } else if (fileInfo.exists && (!expectedHash || !cachedHash)) {
    console.warn('[YoloModels] Cannot verify cached model checksum; refreshing:', {
      fileName,
      hasExpectedHash: Boolean(expectedHash),
      hasCachedHash: Boolean(cachedHash),
    })
  }

  // Resolve the bundled asset before replacing the cache.
  await assetObj.downloadAsync()
  const sourceUri = assetObj.localUri || assetObj.uri
  if (!sourceUri) {
    throw new Error(`[YoloModels] Bundled asset has no local URI: ${fileName}`)
  }

  if (fileInfo.exists) {
    await FileSystem.deleteAsync(destUri, { idempotent: true })
  }
  await FileSystem.copyAsync({ from: sourceUri, to: destUri })

  const copiedInfo = await FileSystem.getInfoAsync(destUri, { md5: true } as any)
  const copiedHash = typeof (copiedInfo as any).md5 === 'string'
    ? (copiedInfo as any).md5.toLowerCase()
    : null
  if (expectedHash && copiedHash && expectedHash !== copiedHash) {
    throw new Error(`[YoloModels] Model checksum mismatch after copy: ${fileName}`)
  }

  console.log('[YoloModels] Copied bundled model to cache:', {
    fileName,
    uri: destUri,
    expectedHash,
    copiedHash,
  })
  return destUri
}

// Preload all model assets - call this at app startup
export async function preloadModelAssets(): Promise<void> {
  console.log('[YoloModels] Preloading model assets...')

  for (const model of YOLO_MODELS) {
    try {
      console.log('[YoloModels] Loading model:', model.fileName)
      model.fileUri = await copyAssetToFile(model.asset, model.fileName)
      console.log('[YoloModels] Model loaded:', model.fileName, 'URI:', model.fileUri)
    } catch (error) {
      console.error('[YoloModels] Failed to copy model:', model.fileName, error)
      throw error // Re-throw to prevent silent failures
    }
  }

  // Preload MoveNet model
  try {
    const moveNetModel = getMoveNetModel()
    if (!moveNetModel) throw new Error('No MoveNet model configured')
    moveNetModelUri = await copyAssetToFile(moveNetModel.asset, moveNetModel.fileName)
    moveNetModel.fileUri = moveNetModelUri
    console.log('[YoloModels] MoveNet preloaded:', moveNetModelUri)
  } catch (error) {
    console.error('[YoloModels] Failed to copy MoveNet model:', error)
  }

  console.log('[YoloModels] All model assets preloaded')
}

// Get MoveNet model URI
export function getMoveNetModel(modelId?: string): MoveNetModelConfig | null {
  const targetId = modelId ?? DEFAULT_MOVENET_MODEL_ID
  const model = MOVENET_MODELS.find(m => m.id === targetId) ?? MOVENET_MODELS[0] ?? null
  if (!model) return null
  if (moveNetModelCache.has(model.id)) return moveNetModelCache.get(model.id)!
  moveNetModelCache.set(model.id, model)
  return model
}

export function getMoveNetModelUri(modelId?: string): string | null {
  const model = getMoveNetModel(modelId)
  return model?.fileUri ?? moveNetModelUri
}

export function getYoloModel(modelId?: string): YoloModelConfig | null {
  const targetId = modelId ?? DEFAULT_YOLO_MODEL_ID
  const model = YOLO_MODELS.find(m => m.id === targetId) ?? YOLO_MODELS[0] ?? null

  if (!model) return null

  // Return cached reference if available
  if (modelCache.has(model.id)) {
    return modelCache.get(model.id)!
  }

  // Cache the model reference
  modelCache.set(model.id, model)
  return model
}
