// src/vision/yoloModels.ts
//
// YOLO model registry.
// The asset imports are intentionally static because Metro/Expo cannot enumerate
// arbitrary files from assets/models at runtime.
//
// Run: node scripts/generate-yolo-models.mjs
// after adding/removing .tflite files in assets/models.

export interface YoloModelConfig {
  id: string
  fileName: string
  label: string
  inputSize: number
  outputDetections: number
  asset: any
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
    id: 'ball_rimV8_416_float16',
    fileName: 'ball_rimV8_416_float16.tflite',
    label: 'YOLOv8 · 416 · FP16',
    inputSize: 416,
    outputDetections: 3549,
    asset: require('../../assets/models/ball_rimV8_416_float16.tflite'),
  },
  {
    id: 'ball_rimV8_512_float16',
    fileName: 'ball_rimV8_512_float16.tflite',
    label: 'YOLOv8 · 512 · FP16',
    inputSize: 512,
    outputDetections: 5400,
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
  {
    id: 'ball_rimV8_720_float16',
    fileName: 'ball_rimV8_720_float16.tflite',
    label: 'YOLOv8 · 720 · FP16',
    inputSize: 720,
    outputDetections: 10654,
    asset: require('../../assets/models/ball_rimV8_720_float16.tflite'),
  },
]

export const DEFAULT_YOLO_MODEL_ID = YOLO_MODELS[0]?.id ?? ''

// Cache for stable model references to prevent unnecessary reloads
const modelCache = new Map<string, YoloModelConfig>()

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
