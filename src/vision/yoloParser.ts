// src/vision/yoloParser.ts
//
// YOLO output parser - runs in Worklet
// Converts raw YOLO output to BallDetection interface
// NO image data, only coordinates

const INPUT_SIZE = 640
const NMS_IOU_THRESHOLD = 0.4
const CONF_THRESHOLD = 0.10
const N_ANCHORS = 8400
const NUM_CLASSES = 80 // COCO dataset classes
const SPORT_BALL_CLASS = 32 // Sport ball class in COCO

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
export function parseYoloOutput(output: Float32Array | Uint8Array | Int8Array): {
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
  // YOLO11 format: [class0, class1, ..., class79, cx, cy, w, h] for each anchor
  let maxScore = 0
  let maxScoreIdx = -1

  for (let i = 0; i < N_ANCHORS; i++) {
    // Get sport ball class score (class 32)
    const ballScore = getOutput(i * (NUM_CLASSES + 4) + SPORT_BALL_CLASS)

    // Get bbox coordinates (after all 80 class scores)
    const cx = getOutput(i * (NUM_CLASSES + 4) + 80)
    const cy = getOutput(i * (NUM_CLASSES + 4) + 81)
    const w = getOutput(i * (NUM_CLASSES + 4) + 82)
    const h = getOutput(i * (NUM_CLASSES + 4) + 83)

    if (ballScore > maxScore) {
      maxScore = ballScore
      maxScoreIdx = i
    }

    if (ballScore < CONF_THRESHOLD) continue

    raw.push([
      cx - w * 0.5,
      cy - h * 0.5,
      cx + w * 0.5,
      cy + h * 0.5,
      ballScore,
      SPORT_BALL_CLASS,
    ])
  }

  // Apply NMS
  const kept = nms(raw, NMS_IOU_THRESHOLD)

  // Keep only the ball with highest confidence
  let bestBall: { x: number; y: number; width: number; height: number; confidence: number } | null = null

  for (const [x1, y1, x2, y2, conf, cls] of kept) {
    const detection = {
      x: x1,
      y: y1,
      width: x2 - x1,
      height: y2 - y1,
      confidence: conf,
    }

    if (cls === SPORT_BALL_CLASS && (!bestBall || detection.confidence > bestBall.confidence)) {
      bestBall = detection
    }
  }

  return { ball: bestBall }
}
