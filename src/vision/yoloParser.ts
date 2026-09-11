// src/vision/yoloParser.ts
//
// YOLO output parser - runs in Worklet
// Converts raw YOLO output to BallDetection interface
// NO image data, only coordinates
// Format: YOLOv8 TFLite channel-major output [cx..., cy..., w..., h..., ball..., rim...]
// The selected model may use 320, 512 or 640 input pixels.
// Input resolution changes the number of anchors, but NOT the decoding formula.
// The number of anchors is therefore derived from the actual output buffer.

const NMS_IOU_THRESHOLD = 0.4
const CONF_THRESHOLD = 0.15  // Baseline threshold for this model (15% confidence)
const OUTPUT_CHANNELS = 6 // 4 box values + 2 class scores (ball, rim)

// The ball detection produces very wide raw boxes, but the center is correct.
// Clamp to reasonable normalized size (max 50% of screen) for distant shots
const MAX_BALL_BOX_SIZE = 0.5
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
// Selected models use the same YOLOv8 TFLite output contract: (1, 6, num_anchors).
// num_anchors is NOT hardcoded because it changes with the selected input size:
//   320 -> 2100
//   512 -> 5376
//   640 -> 8400
// Layout is channel-major: [cx...][cy...][w...][h...][ball...][rim...].
export function parseYoloOutput(
  output: Float32Array | Uint8Array | Int8Array,
  threshold: number = CONF_THRESHOLD,
  frameWidth?: number,
  frameHeight?: number
): {
  ball: { x: number; y: number; width: number; height: number; confidence: number } | null
  rim: { x: number; y: number; width: number; height: number; confidence: number } | null
  debug?: { conf: number }
} {
  'worklet'; // eslint-disable-line
  const raw: number[][] = []
  let maxRawConfidence = 0

  // Convert to float values if needed (for INT8 quantized output)
  const isQuantized = output instanceof Uint8Array || output instanceof Int8Array

  // Channel-major layout:
  // [cx..., cy..., w..., h..., ballScore..., rimScore...]
  //
  // IMPORTANT: do not hardcode the anchor count. It depends on the selected
  // input resolution (320 -> 2100, 512 -> 5376, 640 -> 8400).
  // Reading the actual output buffer makes the parser model-size agnostic.
  const nDetections = Math.floor(output.length / OUTPUT_CHANNELS)
  if (nDetections <= 0 || output.length % OUTPUT_CHANNELS !== 0) {
    return { ball: null, rim: null }
  }

  // Model coordinates are normalized to [0, 1].
  // The selected input size does not need to be passed here: once the output
  // buffer is produced, its length tells us the actual anchor count.
  // Coordinates therefore have the same interpretation for 320/512/640.
  for (let i = 0; i < nDetections; i++) {
    const cx = 1.0 - (isQuantized ? output[i] / 255.0 : output[i])
    const cy = 1.0 - (isQuantized ? output[nDetections + i] / 255.0 : output[nDetections + i])
    const w  = isQuantized ? output[2 * nDetections + i] / 255.0 : output[2 * nDetections + i]
    const h  = isQuantized ? output[3 * nDetections + i] / 255.0 : output[3 * nDetections + i]
    const ballScore = isQuantized ? output[4 * nDetections + i] / 255.0 : output[4 * nDetections + i]
    const rimScore  = isQuantized ? output[5 * nDetections + i] / 255.0 : output[5 * nDetections + i]

    // Unconditional — tracks the model's real signal regardless of
    // whether anything clears the threshold or the box-size filters
    // below. Without this, "maxConf" in the logs collapses to 0 the
    // moment nothing survives thresholding, making it impossible to
    // tell "the model sees nothing" apart from "close, but just under
    // threshold".
    const anchorMax = ballScore > rimScore ? ballScore : rimScore
    if (anchorMax > maxRawConfidence) {
        maxRawConfidence = anchorMax
    }

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
      // Coordinates are already normalized and independent of the selected input size
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

  return { ball: bestBall, rim: bestRim, debug: { conf: maxRawConfidence } }
}
