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
  asset: any
  fileUri?: string
}

// GENERATED ENTRIES - do not edit manually.
// Regenerate with scripts/generate-yolo-models.mjs.
export const YOLO_MODELS: YoloModelConfig[] = [
  {
    id: 'ball_rimV8_320_float16',
    fileName: 'ball_rimV8_320_float16.tflite',
    label: 'YOLOv8 · 320 · FP16',
    inputSize: 320,
    outputDetections: 2100,
    asset: require('../../assets/models/ball_rimV8_320_float16.tflite'),
  },
  {
    id: 'ball_rimV8_512_float16',
    fileName: 'ball_rimV8_512_float16.tflite',
    label: 'YOLOv8 · 512 · FP16',
    inputSize: 512,
    outputDetections: 5376,
    asset: require('../../assets/models/ball_rimV8_512_float16.tflite'),
  },
  {
    id: 'ball_rimV8_640_float16',
    fileName: 'ball_rimV8_640_float16.tflite',
    label: 'YOLOv8 · 640 · FP16',
    inputSize: 640,
    outputDetections: 8400,
    asset: require('../../assets/models/ball_rimV8_640_float16.tflite'),
  },
]

export const DEFAULT_YOLO_MODEL_ID = 'ball_rimV8_512_float16'

// MoveNet model registry. Keep the model input size here so the camera
// resizer and the TFLite input buffer can never drift apart.
export const MOVENET_MODELS: MoveNetModelConfig[] = [
  {
    id: 'movenet_lightning_int8_192',
    fileName: 'movenet_lightning_int8.tflite',
    label: 'MoveNet Lightning · INT8 · 192',
    inputSize: 192,
    outputKeypoints: 17,
    asset: require('../../assets/models/movenet_lightning_int8.tflite'),
  },
]

export const DEFAULT_MOVENET_MODEL_ID = 'movenet_lightning_int8_192'

// MoveNet model URI - loaded separately
let moveNetModelUri: string | null = null
const moveNetModelCache = new Map<string, MoveNetModelConfig>()

// Cache for stable model references to prevent unnecessary reloads
const modelCache = new Map<string, YoloModelConfig>()

// Copy asset from bundle to file system and return file URI
async function copyAssetToFile(asset: any, fileName: string): Promise<string> {
  const assetObj = Asset.fromModule(asset)
  
  const destUri = (FileSystem as any).documentDirectory + fileName

  // Check if file already exists
  const fileInfo = await FileSystem.getInfoAsync(destUri)
  if (fileInfo.exists) {
    console.log('[YoloModels] File already exists:', destUri)
    return destUri
  }

  // Download asset from bundle to document directory
  await assetObj.downloadAsync()
  
  // Copy from downloaded local URI to destination
  await FileSystem.copyAsync({
    from: assetObj.localUri || assetObj.uri,
    to: destUri
  })

  console.log('[YoloModels] Copied asset to:', destUri)
  return destUri
}

// Preload all model assets - call this at app startup
export async function preloadModelAssets(): Promise<void> {
  console.log('[YoloModels] Preloading model assets...')

  for (const model of YOLO_MODELS) {
    try {
      model.fileUri = await copyAssetToFile(model.asset, model.fileName)
    } catch (error) {
      console.error('[YoloModels] Failed to copy model:', model.fileName, error)
    }
  }

  // Also preload MoveNet model
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
