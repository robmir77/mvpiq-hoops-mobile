// src/vision/yoloParser.ts
//
// YOLO output parser - runs in Worklet
// Converts raw YOLO output to BallDetection interface
// NO image data, only coordinates

const INPUT_SIZE = 320
const NMS_IOU_THRESHOLD = 0.4
const CONF_THRESHOLD = 0.20
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
export function parseYoloOutput(output: Float32Array): {
  ball: { x: number; y: number; width: number; height: number; confidence: number } | null
} {
  'worklet'
  const raw: number[][] = []
  
  // Extract detections from YOLO output
  for (let i = 0; i < N_ANCHORS; i++) {
    const cx = output[i]
    const cy = output[N_ANCHORS + i]
    const w = output[N_ANCHORS * 2 + i]
    const h = output[N_ANCHORS * 3 + i]
    
    // Only check class 0 (ball)
    const score = output[N_ANCHORS * 4 + i]
    if (score < CONF_THRESHOLD) continue
    
    raw.push([
      (cx - w * 0.5) / INPUT_SIZE,
      (cy - h * 0.5) / INPUT_SIZE,
      (cx + w * 0.5) / INPUT_SIZE,
      (cy + h * 0.5) / INPUT_SIZE,
      score,
      0, // ball class
    ])
  }
  
  // Apply NMS
  const kept = nms(raw, NMS_IOU_THRESHOLD)
  
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
