// src/vision/yoloParser.ts
//
// YOLO output parser - runs in Worklet
// Converts raw YOLO output to BallDetection interface
// NO image data, only coordinates

const NMS_IOU_THRESHOLD = 0.4
const CONF_THRESHOLD = 0.10  // Lowered from 0.15 to detect distant/small objects even better
const N_ANCHORS = 3549

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
} {
  'worklet'; // eslint-disable-line
  const raw: number[][] = []

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
      // Map from crop to full frame
      x1 = ((cx - w * 0.5) * CROP_DIM + CROP_X) / frameWidth
      y1 = ((cy - h * 0.5) * CROP_DIM + CROP_Y) / frameHeight
      x2 = ((cx + w * 0.5) * CROP_DIM + CROP_X) / frameWidth
      y2 = ((cy + h * 0.5) * CROP_DIM + CROP_Y) / frameHeight
      wNorm = (x2 - x1)
      hNorm = (y2 - y1)
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

  // Log the highest confidence score and its anchor position for debugging (commented out for high-frequency performance)
  if (__DEV__) {
    console.log('[YOLO Parser] Max score:', maxScore.toFixed(4), 'at anchor:', maxScoreIdx)
    console.log('[YOLO Parser] Detections above threshold:', raw.length)
    console.log('[YOLO Parser] Crop params:', CROP_X, CROP_Y, CROP_DIM, 'Frame:', frameWidth, frameHeight)
  }

  // Apply NMS
  const kept = nms(raw, NMS_IOU_THRESHOLD)
  if (__DEV__) {
    console.log('[YOLO Parser] Detections after NMS:', kept.length)
  }

  // Keep only the ball with highest confidence and the rim with highest confidence
  let bestBall: { x: number; y: number; width: number; height: number; confidence: number } | null = null
  let bestRim: { x: number; y: number; width: number; height: number; confidence: number } | null = null

  for (const [x1, y1, x2, y2, conf, cls] of kept) {
    const detection = {
      x: 1 - (y1 + y2) / 2,
      y: (x1 + x2) / 2,
      width: (y2 - y1),
      height: (x2 - x1),
      confidence: conf,
    }

    if (__DEV__) {
      console.log('[YOLO Parser] Detection:', cls === 0 ? 'ball' : 'rim', 'at', detection.x.toFixed(3), detection.y.toFixed(3), 'conf:', conf.toFixed(3))
    }

    if (cls === 0 && (!bestBall || detection.confidence > bestBall.confidence)) {
      bestBall = detection
    }
    if (cls === 1 && detection.y < 0.5 && (!bestRim || detection.confidence > bestRim.confidence)) {
      bestRim = detection
    }
  }

  if (__DEV__) {
    console.log('[YOLO Parser] Best ball:', bestBall ? `conf=${bestBall.confidence.toFixed(3)} at (${bestBall.x.toFixed(3)}, ${bestBall.y.toFixed(3)})` : 'null')
    console.log('[YOLO Parser] Best rim:', bestRim ? `conf=${bestRim.confidence.toFixed(3)} at (${bestRim.x.toFixed(3)}, ${bestRim.y.toFixed(3)})` : 'null')
  }

  return { ball: bestBall, rim: bestRim }
}
