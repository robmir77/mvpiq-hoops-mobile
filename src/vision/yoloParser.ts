// src/vision/yoloParser.ts
//
// YOLO output parser - runs in Worklet
// Converts raw YOLO output to BallDetection interface
// NO image data, only coordinates

const INPUT_SIZE = 320
const NMS_IOU_THRESHOLD = 0.4
const CONF_THRESHOLD = 0.05
const N_ANCHORS = 2100

// Worklet-safe IOU calculation
function iou(a: number[], b: number[]): number {
  'worklet'
  const ix1 = Math.max(a[0], b[0])
  const iy1 = Math.max(a[1], b[1])
  const ix2 = Math.min(a[2], b[2])
  const iy2 = Math.min(a[3], b[3])
  const inter = Math.max(0, ix2 - ix1) * Math.max(0, iy2 - iy1)
  return inter / ((a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter + 1e-6)
}

// Worklet-safe NMS
function nms(dets: number[][], thr: number): number[][] {
  'worklet'
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
// Only detects ball, rim comes from calibration
// Returns only the ball with highest confidence
export function parseYoloOutput(output: Float32Array | Uint8Array | Int8Array, threshold: number = CONF_THRESHOLD): {
  ball: { x: number; y: number; width: number; height: number; confidence: number } | null
} {
  'worklet'
  const raw: number[][] = []

  // Convert to float values if needed (for INT8 quantized output)
  const getOutput = (idx: number): number => {
    if (output instanceof Uint8Array || output instanceof Int8Array) {
      return output[idx] / 255.0 // Normalize uint8/int8 to [0, 1]
    }
    return output[idx]
  }

  // Extract detections from YOLO output
  // Layout: separate arrays for each parameter
  // output[i] = cx, output[N_ANCHORS + i] = cy, output[N_ANCHORS * 2 + i] = w, output[N_ANCHORS * 3 + i] = h, output[N_ANCHORS * 4 + i] = score
  let maxScore = 0
  let maxScoreIdx = -1

  for (let i = 0; i < N_ANCHORS; i++) {
    const cx = getOutput(i)
    const cy = getOutput(N_ANCHORS + i)
    const w = getOutput(N_ANCHORS * 2 + i)
    const h = getOutput(N_ANCHORS * 3 + i)
    const score = getOutput(N_ANCHORS * 4 + i)

    if (score > maxScore) {
      maxScore = score
      maxScoreIdx = i
    }

    if (score < threshold) continue

    raw.push([
      (cx - w * 0.5) / INPUT_SIZE,
      (cy - h * 0.5) / INPUT_SIZE,
      (cx + w * 0.5) / INPUT_SIZE,
      (cy + h * 0.5) / INPUT_SIZE,
      score,
      0, // ball class
    ])
  }

  console.log('[YOLO Parser] Max score:', maxScore.toFixed(4), 'at anchor:', maxScoreIdx)
  console.log('[YOLO Parser] Detections above threshold:', raw.length)

  // Apply NMS
  const kept = nms(raw, NMS_IOU_THRESHOLD)
  console.log('[YOLO Parser] Detections after NMS:', kept.length)

  // Keep only the ball with highest confidence
  let bestBall: { x: number; y: number; width: number; height: number; confidence: number } | null = null

  for (const [x1, y1, x2, y2, conf, cls] of kept) {
    const detection = {
      x: x1 * INPUT_SIZE,
      y: y1 * INPUT_SIZE,
      width: (x2 - x1) * INPUT_SIZE,
      height: (y2 - y1) * INPUT_SIZE,
      confidence: conf,
    }

    if (cls === 0 && (!bestBall || detection.confidence > bestBall.confidence)) {
      bestBall = detection
    }
  }

  return { ball: bestBall }
}
