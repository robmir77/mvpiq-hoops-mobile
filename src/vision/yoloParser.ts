// src/vision/yoloParser.ts
//
// YOLO output parser - runs in Worklet
// Converts raw YOLO output to BallDetection interface
// NO image data, only coordinates

const NMS_IOU_THRESHOLD = 0.4
const N_ANCHORS = 3549

// Worklet-safe constant - must be defined inside the function scope for worklets
let CONF_THRESHOLD = 0.10

// Crop parameters for mapping coordinates from crop to full frame
let CROP_X = 0
let CROP_Y = 0
let CROP_DIM = 1

export function setCropParameters(cropX: number, cropY: number, cropDim: number) {
  'worklet'; // eslint-disable-line
  CROP_X = cropX
  CROP_Y = cropY
  CROP_DIM = cropDim
}

// Worklet-safe IOU calculation
function iou(a: number[], b: number[]): number {
  'worklet'; // eslint-disable-line
  const ix1 = Math.max(a[0], b[0])
  const iy1 = Math.max(a[1], b[1])
  const ix2 = Math.min(a[2], b[2])
  const iy2 = Math.min(a[3], b[3])
  const inter = Math.max(0, ix2 - ix1) * Math.max(0, iy2 - iy1)
  return inter / ((a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter + 1e-6)
}

// Worklet-safe NMS
function nms(dets: number[][], thr: number): number[][] {
  'worklet'; // eslint-disable-line
  const s = [...dets].sort((a, b) => b[4] - a[4])
  const kept: number[][] = []
  const skip = new Set<number>()
  for (let i = 0; i < s.length; i++) {
    if (skip.has(i)) continue
    kept.push(s[i])
    for (let j = i + 1; j < s.length; j++) {
      if (iou(s[i], s[j]) > thr) skip.add(j)
    }
  }
  return kept
}

// Parse YOLO output to BallDetection
// This runs in the Worklet - NO runOnJS here
// Detects both ball (cls 0) and rim (cls 1)
// Returns the ball with highest confidence and the rim with highest confidence
export function parseYoloOutput(output: Float32Array | Uint8Array | Int8Array, threshold: number = CONF_THRESHOLD, frameWidth: number = 1, frameHeight: number = 1): {
  ball: { x: number; y: number; width: number; height: number; confidence: number } | null
  rim: { x: number; y: number; width: number; height: number; confidence: number } | null
  debug?: { cx: number; cy: number; w: number; h: number; conf: number }
} {
  'worklet'; // eslint-disable-line
  const raw: number[][] = []
  let debugInfo: { cx: number; cy: number; w: number; h: number; conf: number } | undefined = undefined

  // Convert to float values if needed (for INT8 quantized output)
  const isQuantized = output instanceof Uint8Array || output instanceof Int8Array

  // Filter: reject detections larger than half screen (normalized coordinates)
  const MAX_BOX_SIZE = 0.85 // Increased from 0.7 to 0.85 to allow even more distant objects

  // Extract detections from YOLO output
  // Layout: separate arrays for each parameter
  // output[i] = cx, output[N_ANCHORS + i] = cy, output[N_ANCHORS * 2 + i] = w, output[N_ANCHORS * 3 + i] = h, output[N_ANCHORS * 4 + i] = score
  // For ball_rimV8 model: class 0 = ball, class 1 = rim
  // Class scores are at output[N_ANCHORS * 5 + i] for ball and output[N_ANCHORS * 6 + i] for rim
  let maxScore = 0
  let maxScoreIdx = -1

  const a2 = N_ANCHORS * 2
  const a3 = N_ANCHORS * 3
  const a4 = N_ANCHORS * 4
  const a5 = N_ANCHORS * 5

  for (let i = 0; i < N_ANCHORS; i++) {
    const cx = isQuantized ? output[i] / 255.0 : output[i]
    const cy = isQuantized ? output[N_ANCHORS + i] / 255.0 : output[N_ANCHORS + i]
    const w  = isQuantized ? output[a2 + i] / 255.0 : output[a2 + i]
    const h  = isQuantized ? output[a3 + i] / 255.0 : output[a3 + i]
    const ballScore = isQuantized ? output[a4 + i] / 255.0 : output[a4 + i]
    const rimScore  = isQuantized ? output[a5 + i] / 255.0 : output[a5 + i]

    // Track maximum score across both classes
    const maxClassScore = Math.max(ballScore, rimScore)
    if (maxClassScore > maxScore) {
      maxScore = maxClassScore
      maxScoreIdx = i
    }

    // Filter: reject detections with bounding box larger than half screen
    if (w > MAX_BOX_SIZE || h > MAX_BOX_SIZE) {
      continue
    }

    // Map coordinates from crop to full frame
    // Model outputs are normalized to [0,1] relative to the crop
    // When frameWidth/frameHeight are provided, map to full frame coordinates
    let x1, y1, x2, y2, wNorm, hNorm

    if (frameWidth > 1 && frameHeight > 1) {
      // Use crop parameters set via setCropParameters()
      // YOLO coordinates are normalized [0,1] relative to the crop
      // We need to map these to the original frame dimensions

      // Map from YOLO normalized coordinates to original frame using crop parameters
      const x1_crop = (cx - w * 0.5) * CROP_DIM + CROP_X
      const y1_crop = (cy - h * 0.5) * CROP_DIM + CROP_Y
      const x2_crop = (cx + w * 0.5) * CROP_DIM + CROP_X
      const y2_crop = (cy + h * 0.5) * CROP_DIM + CROP_Y

      // Normalize to full frame
      x1 = x1_crop / frameWidth
      y1 = y1_crop / frameHeight
      x2 = x2_crop / frameWidth
      y2 = y2_crop / frameHeight
      wNorm = (x2 - x1)
      hNorm = (y2 - y1)

      // Store debug info for the best detection
      if (!debugInfo && (ballScore > 0.1 || rimScore > 0.1)) {
        debugInfo = { cx, cy, w, h, conf: Math.max(ballScore, rimScore) }
      }
    } else {
      // Use normalized coordinates directly (relative to crop)
      x1 = cx - w * 0.5
      y1 = cy - h * 0.5
      x2 = cx + w * 0.5
      y2 = cy + h * 0.5
      wNorm = w
      hNorm = h
    }

    // Add ball detection if score above threshold
    if (ballScore >= threshold) {
      raw.push([
        x1,
        y1,
        x2,
        y2,
        ballScore,
        0, // ball class
      ])
    }

    // Add rim detection if score above threshold (controlled by external flag)
    if (rimScore >= threshold) {
      raw.push([
        x1,
        y1,
        x2,
        y2,
        rimScore,
        1, // rim class
      ])
    }
  }

  // NOTE: Do NOT add console.log here — this runs in a VisionCamera worklet thread
  // where console is not available. Use scheduleOnRN(() => console.log(...)) instead.

  // Apply NMS
  const kept = nms(raw, NMS_IOU_THRESHOLD)

  // Keep only the ball with highest confidence and the rim with highest confidence
  let bestBall: { x: number; y: number; width: number; height: number; confidence: number } | null = null
  let bestRim: { x: number; y: number; width: number; height: number; confidence: number } | null = null

  for (const [x1, y1, x2, y2, conf, cls] of kept) {
    const detection = {
      // Option 1: coordinate dirette senza swap X↔Y
      // Assumiamo che il frame arrivi già in portrait (o che il resizer gestisca la rotazione)
      x: (x1 + x2) / 2,
      y: (y1 + y2) / 2,
      width: (x2 - x1),
      height: (y2 - y1),
      confidence: conf,
    }


    if (cls === 0 && (!bestBall || detection.confidence > bestBall.confidence)) {
      bestBall = detection
    }
    if (cls === 1 && detection.y < 0.5 && (!bestRim || detection.confidence > bestRim.confidence)) {
      bestRim = detection
    }
  }


  return { ball: bestBall, rim: bestRim, debug: debugInfo }
}
