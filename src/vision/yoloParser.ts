// src/vision/yoloParser.ts
//
// YOLO output parser - runs in Worklet
// Converts raw YOLO output to BallDetection interface
// NO image data, only coordinates
// Format: standard YOLOv8 TFLite [x, y, w, h, conf, cls] per detection
// Requires grid/stride decoding for proper coordinate extraction

const NMS_IOU_THRESHOLD = 0.4
const CONF_THRESHOLD = 0.0001  // Very low threshold - model outputs extremely low raw scores
const OUTPUT_CHANNELS = 6 // 4 box values + 2 class scores (ball, rim)

// Adaptive threshold based on ball size - smaller balls need lower threshold
function getAdaptiveThreshold(ballWidth: number, ballHeight: number, baseThreshold: number): number {
  'worklet'; // eslint-disable-line
  const avgSize = (ballWidth + ballHeight) / 2
  
  // Large balls (> 0.3): use standard threshold
  if (avgSize > 0.3) {
    return baseThreshold
  }
  // Medium balls (0.1-0.3): use medium threshold
  else if (avgSize > 0.1) {
    return baseThreshold * 0.3
  }
  // Small balls (< 0.1): use very low threshold for distant shots
  else {
    return baseThreshold * 0.1
  }
}

// YOLOv8 detection head strides for multi-scale feature pyramid
const STRIDES = [8, 16, 32]

// The ball detection produces very wide raw boxes, but the center is correct.
// Clamp to reasonable normalized size (max 70% of screen) for distant shots
// Increased from 0.5 to 0.7 to accommodate model output without proper grid/stride decoding
const MAX_BALL_BOX_SIZE = 0.7
// For rim, keep a more conservative filter.
const MAX_RIM_BOX_SIZE = 0.8

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
// Requires grid/stride decoding for proper coordinate extraction
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
  
  try {
    const raw: number[][] = []
    let maxRawConfidence = 0

  // Convert to float values if needed (for INT8 quantized output)
  const isQuantized = output instanceof Uint8Array || output instanceof Int8Array

  // Channel-major layout:
  // [cx..., cy..., w..., h..., ballScore..., rimScore...]
  //
  // IMPORTANT: do not hardcode 8400. YOLO output size depends on the selected
  // input resolution (e.g. 640 -> 8400, 416 -> 3549, 320 -> 2100).
  // Reading the actual output buffer makes the parser model-size agnostic.
  const nDetections = Math.floor(output.length / OUTPUT_CHANNELS)
  if (nDetections <= 0 || output.length % OUTPUT_CHANNELS !== 0) {
    return { ball: null, rim: null }
  }

  // Determine input size from number of detections
  // 512x512: 5376 anchors, 640x640: 8400 anchors, 320x320: 2100 anchors
  let inputSize = 512
  if (nDetections === 8400) inputSize = 640
  else if (nDetections === 2100) inputSize = 320
  else if (nDetections === 5376) inputSize = 512

  // Track the anchor with maximum confidence for debugging
  let maxAnchorIndex = -1
  let maxAnchorConf = -1
  let maxAnchorRaw: { cx: number; cy: number; w: number; h: number; ballScore: number; rimScore: number } | null = null

  // Simplified decoder - assume model outputs are already normalized [0,1]
  // This is common for TFLite exports with NMS included
  for (let i = 0; i < nDetections; i++) {
    // Read raw values
    const cxRaw = isQuantized ? output[i] / 255.0 : output[i]
    const cyRaw = isQuantized ? output[nDetections + i] / 255.0 : output[nDetections + i]
    const w  = isQuantized ? output[2 * nDetections + i] / 255.0 : output[2 * nDetections + i]
    const h  = isQuantized ? output[3 * nDetections + i] / 255.0 : output[3 * nDetections + i]
    const ballScore = isQuantized ? output[4 * nDetections + i] / 255.0 : output[4 * nDetections + i]
    const rimScore  = isQuantized ? output[5 * nDetections + i] / 255.0 : output[5 * nDetections + i]

    // Apply coordinate inversion for all balls
    // Model outputs inverted coordinates
    const cx = 1.0 - cxRaw
    const cy = 1.0 - cyRaw
    
    // No axis swap needed
    const finalCx = cx
    const finalCy = cy

    // Use raw scores directly - sigmoid is too slow for 5376 calls per frame
    // Model outputs appear to be raw logits, so we use them directly with lower threshold
    const ballProb = ballScore
    const rimProb = rimScore

    // Unconditional — tracks the model's real signal regardless of
    // whether anything clears the threshold or the box-size filters
    // below. Without this, "maxConf" in the logs collapses to 0 the
    // moment nothing survives thresholding, making it impossible to
    // tell "the model sees nothing" apart from "close, but just under
    // threshold".
    const anchorMax = ballProb > rimProb ? ballProb : rimProb
    if (anchorMax > maxRawConfidence) {
        maxRawConfidence = anchorMax
        maxAnchorIndex = i
        maxAnchorRaw = {
          cx: finalCx,
          cy: finalCy,
          w: w,
          h: h,
          ballScore,
          rimScore
        }
    }

    // Skip invalid detections (zero size only)
    if (w <= 0.01 || h <= 0.01) continue

    // Use adaptive threshold for ball detection based on size
    const ballAdaptiveThreshold = getAdaptiveThreshold(w, h, threshold)
    
    // Add ball detection if score above adaptive threshold and box size is acceptable
    if (ballProb >= ballAdaptiveThreshold && w <= MAX_BALL_BOX_SIZE && h <= MAX_BALL_BOX_SIZE) {
      raw.push([
        (finalCx - w * 0.5),
        (finalCy - h * 0.5),
        (finalCx + w * 0.5),
        (finalCy + h * 0.5),
        ballProb,
        0, // ball class
      ])
    }

    // Add rim detection if score above threshold and box size is acceptable
    if (rimProb >= threshold && w <= MAX_RIM_BOX_SIZE && h <= MAX_RIM_BOX_SIZE) {
      raw.push([
        (finalCx - w * 0.5),
        (finalCy - h * 0.5),
        (finalCx + w * 0.5),
        (finalCy + h * 0.5),
        rimProb,
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

  // DEV ONLY: Debug: log raw vs parsed for max anchor
  if (typeof __DEV__ !== 'undefined' && __DEV__ && maxAnchorRaw && maxAnchorIndex >= 0) {
    console.log('[YOLO PARSER DEBUG]', {
      anchorIndex: maxAnchorIndex,
      raw: maxAnchorRaw,
      parsedBall: bestBall ? {
        x: bestBall.x,
        y: bestBall.y,
        width: bestBall.width,
        height: bestBall.height,
        confidence: bestBall.confidence
      } : null,
      parsedRim: bestRim ? {
        x: bestRim.x,
        y: bestRim.y,
        width: bestRim.width,
        height: bestRim.height,
        confidence: bestRim.confidence
      } : null,
      threshold: threshold
    })
  }

  return { ball: bestBall, rim: bestRim, debug: { conf: maxRawConfidence } }
  
  } catch (error) {
    console.error('[YOLO PARSER ERROR]', error)
    return { ball: null, rim: null, debug: { conf: 0 } }
  }
}
