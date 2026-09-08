// src/vision/yoloParser.ts
//
// YOLO output parser - runs in Worklet
// Converts raw YOLO output to BallDetection interface
// NO image data, only coordinates
// Format: standard YOLOv8 [x, y, w, h, conf, cls] per detection

const NMS_IOU_THRESHOLD = 0.4
const CONF_THRESHOLD = 0.02  // Baseline threshold for this model (2% confidence)
const N_DETECTIONS = 3549

// The ball detection produces very wide raw boxes, but the center is correct.
// Clamp to reasonable normalized size (max 35% of screen) for distant shots
const MAX_BALL_BOX_SIZE = 0.35
// For rim, keep a more conservative filter.
const MAX_RIM_BOX_SIZE = 0.7

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
// Standard YOLOv8 TFLite format: (1, 6, num_anchors) where 6 = 4 coords + 2 class scores
// Layout: [xc, yc, w, h, ball_score, rim_score] for each anchor
export function parseYoloOutput(output: Float32Array | Uint8Array | Int8Array, threshold: number = CONF_THRESHOLD): {
  ball: { x: number; y: number; width: number; height: number; confidence: number } | null
  rim: { x: number; y: number; width: number; height: number; confidence: number } | null
} {
  'worklet'; // eslint-disable-line
  const raw: number[][] = []

  // Convert to float values if needed (for INT8 quantized output)
  const isQuantized = output instanceof Uint8Array || output instanceof Int8Array

  // Standard YOLOv8 format: 6 values per detection (xc, yc, w, h, ball_score, rim_score)
  const VALUES_PER_DETECTION = 6
  const numDetections = output.length / VALUES_PER_DETECTION

  for (let i = 0; i < numDetections; i++) {
    const offset = i * VALUES_PER_DETECTION
    const cx = isQuantized ? output[offset] / 255.0 : output[offset]
    const cy = isQuantized ? output[offset + 1] / 255.0 : output[offset + 1]
    const w  = isQuantized ? output[offset + 2] / 255.0 : output[offset + 2]
    const h  = isQuantized ? output[offset + 3] / 255.0 : output[offset + 3]
    const ballScore = isQuantized ? output[offset + 4] / 255.0 : output[offset + 4]
    const rimScore  = isQuantized ? output[offset + 5] / 255.0 : output[offset + 5]

    // Skip invalid detections (zero size only)
    if (w <= 0.01 || h <= 0.01) continue

    // Add ball detection if score above threshold and box size is acceptable
    if (ballScore >= threshold && w <= MAX_BALL_BOX_SIZE && h <= MAX_BALL_BOX_SIZE) {
      raw.push([
        (cx - w * 0.5),
        (cy - h * 0.5),
        (cx + w * 0.5),
        (cy + h * 0.5),
        ballScore,
        0, // ball class
      ])
    }

    // Add rim detection if score above threshold and box size is acceptable
    if (rimScore >= threshold && w <= MAX_RIM_BOX_SIZE && h <= MAX_RIM_BOX_SIZE) {
      raw.push([
        (cx - w * 0.5),
        (cy - h * 0.5),
        (cx + w * 0.5),
        (cy + h * 0.5),
        rimScore,
        1, // rim class
      ])
    }
  }

  // Apply NMS
  const kept = nms(raw, NMS_IOU_THRESHOLD)

  // Keep only the ball with highest confidence and the rim with highest confidence
  let bestBall: { x: number; y: number; width: number; height: number; confidence: number } | null = null
  let bestRim: { x: number; y: number; width: number; height: number; confidence: number } | null = null

  for (const [x1, y1, x2, y2, conf, cls] of kept) {
    const detection = {
      // Coordinate dirette senza inversione (per modello 640x640)
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

  return { ball: bestBall, rim: bestRim }
}
