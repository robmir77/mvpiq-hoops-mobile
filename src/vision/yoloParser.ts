// src/vision/yoloParser.ts
//
// YOLO output parser - runs in Worklet
// Converts raw YOLO output to BallDetection interface
// NO image data, only coordinates
// Format: standard YOLOv8 TFLite [x, y, w, h, conf, cls] per detection
// Requires grid/stride decoding for proper coordinate extraction

const NMS_IOU_THRESHOLD = 0.4
const CONF_THRESHOLD = 0.00005  // Very low threshold - model outputs extremely low raw scores
const OUTPUT_CHANNELS = 7 // 4 box values + 3 class scores (basketball, rim, sports ball)

// Adaptive confidence threshold based on detected ball size.
//
// The size is normalized to the frame (0..1).
// Smaller balls require a more permissive threshold because
// distant balls contain fewer pixels and therefore tend to
// produce lower confidence scores.
//
// IMPORTANT:
// The threshold is continuous rather than using hard size bands,
// avoiding abrupt changes around 0.10 / 0.02.

function getAdaptiveThreshold(
  ballWidth: number,
  ballHeight: number,
  baseThreshold: number
): number {
  'worklet'; // eslint-disable-line

  const avgSize = (ballWidth + ballHeight) / 2

  // ----------------------------------------------------------
  // Large object
  // ----------------------------------------------------------
  if (avgSize >= 0.30) {
    return baseThreshold
  }

  // ----------------------------------------------------------
  // Small / distant object
  //
  // Interpolate between:
  //   0.30 -> baseThreshold
  //   0.02 -> minimum threshold
  // ----------------------------------------------------------

  const MIN_SIZE = 0.02
  const MAX_SIZE = 0.30

  const MIN_THRESHOLD = 0.006

  // Normalize size to 0..1
  let t = (avgSize - MIN_SIZE) / (MAX_SIZE - MIN_SIZE)

  // Clamp
  if (t < 0) {
    t = 0
  } else if (t > 1) {
    t = 1
  }

  // Smooth interpolation instead of linear interpolation.
  // This makes the threshold decrease more gradually for
  // distant balls.
  const smoothT = t * t * (3 - 2 * t)

  return MIN_THRESHOLD +
    (baseThreshold - MIN_THRESHOLD) * smoothT
}

// Validate bounding box geometry - reject suspicious aspect ratios
// A ball should have roughly equal width and height (aspect ratio close to 1)
// More permissive to handle occlusions (ball behind hand)
function isValidBallGeometry(width: number, height: number): { valid: boolean; aspectRatio: number } {
  'worklet'; // eslint-disable-line
  if (width <= 0 || height <= 0) {
    return { valid: false, aspectRatio: 0 }
  }

  const aspectRatio = width / height

  // Reject extremely wide or tall boxes (aspect ratio > 4.0 or < 0.25)
  // More permissive (was 3.0/0.33) to handle ball occlusions by hand
  // This filters out false positives with ratio 4.0-4.5 while allowing
  // distorted boxes from partial occlusions
  if (aspectRatio > 4.0 || aspectRatio < 0.25) {
    return { valid: false, aspectRatio }
  }

  return { valid: true, aspectRatio }
}

// YOLOv8 detection head strides for multi-scale feature pyramid
const STRIDES = [8, 16, 32]

// The ball detection produces very wide raw boxes, but the center is correct.
// Clamp to reasonable normalized size (max 70% of screen) for distant shots
// Increased from 0.5 to 0.7 to accommodate model output without proper grid/stride decoding
const MAX_BALL_BOX_SIZE = 0.7
// A ball smaller than this radius is below the reliable visual resolution
// for the current detector and is treated as noise. This is deliberately
// a radius threshold, not a minimum accepted ball size: above it, smaller
// balls are made progressively easier to accept via the adaptive threshold.
// 0.01 radius = 0.02 normalized diameter (~10 px at 512x512).
const MIN_BALL_RADIUS = 0.01
// For rim, keep a more conservative filter.
const MAX_RIM_BOX_SIZE = 0.8

// Parse YOLO output to BallDetection
// This runs in the Worklet - NO runOnJS here
// Detects both ball (cls 0) and rim (cls 1)
// Returns the ball with highest confidence and the rim with highest confidence
// Standard YOLOv8 TFLite format: (1, 7, num_anchors) where 7 = 4 coords + 3 class scores
// Layout: [xc, yc, w, h, basketball_score, rim_score, sports_ball_score] for each anchor
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
    let maxRawConfidence = 0
    let bestBall: { x: number; y: number; width: number; height: number; confidence: number } | null = null
    let bestRim: { x: number; y: number; width: number; height: number; confidence: number } | null = null

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

    // Simplified decoder - assume model outputs are already normalized [0,1]
    // This is common for TFLite exports with NMS included
    for (let i = 0; i < nDetections; i++) {
      // Read raw values
      const cxRaw = isQuantized ? output[i] / 255.0 : output[i]
      const cyRaw = isQuantized ? output[nDetections + i] / 255.0 : output[nDetections + i]
      const w  = isQuantized ? output[2 * nDetections + i] / 255.0 : output[2 * nDetections + i]
      const h  = isQuantized ? output[3 * nDetections + i] / 255.0 : output[3 * nDetections + i]
      const basketballScore = isQuantized ? output[4 * nDetections + i] / 255.0 : output[4 * nDetections + i]
      const rimScore  = isQuantized ? output[5 * nDetections + i] / 255.0 : output[5 * nDetections + i]
      const sportsBallScore = isQuantized ? output[6 * nDetections + i] / 255.0 : output[6 * nDetections + i]

      // New ballRim model outputs coordinates already normalized [0,1]
      // No coordinate inversion needed for this model
      const cx = cxRaw
      const cy = cyRaw

      // No axis swap needed
      const finalCx = cx
      const finalCy = cy

      // Use raw scores directly - sigmoid is too slow for 5376 calls per frame
      // Model outputs appear to be raw logits, so we use them directly with lower threshold
      const basketballProb = basketballScore
      const rimProb = rimScore
      const sportsBallProb = sportsBallScore

      // Unconditional — tracks the model's real signal regardless of
      // whether anything clears the threshold or the box-size filters
      // below. Without this, "maxConf" in the logs collapses to 0 the
      // moment nothing survives thresholding, making it impossible to
      // tell "the model sees nothing" apart from "close, but just under
      // threshold".
      const anchorMax = Math.max(basketballProb, rimProb, sportsBallProb)
      if (anchorMax > maxRawConfidence) {
        maxRawConfidence = anchorMax
      }

      // Skip invalid detections (zero size only)
      if (w <= 0.01 || h <= 0.01) continue

      // Validate bounding box geometry - reject suspicious aspect ratios
      const geometryCheck = isValidBallGeometry(w, h)
      const validGeometry = geometryCheck.valid
      const aspectRatio = geometryCheck.aspectRatio

      // Use adaptive threshold for ball detection based on apparent size.
      // Small/distant balls get a lower confidence requirement; extremely tiny
      // boxes are rejected as noise instead of lowering the threshold forever.
      const ballRadius = Math.min(w, h) / 2
      const ballTooSmall = ballRadius < MIN_BALL_RADIUS
      const ballAdaptiveThreshold = getAdaptiveThreshold(w, h, threshold)

      // Removed per-detection logging - too expensive with 8400 anchors

      // Accept when:
      // 1. Not too small (above noise floor)
      // 2. Valid geometry (aspect ratio not suspicious)
      // 3. Confidence clears adaptive threshold
      // 4. Box not absurdly large
      // Use basketball class (0) for ball detection
      if (!ballTooSmall && validGeometry && basketballProb >= ballAdaptiveThreshold && w <= MAX_BALL_BOX_SIZE && h <= MAX_BALL_BOX_SIZE) {
        const detection = {
          x: finalCx,
          y: finalCy,
          width: w,
          height: h,
          confidence: basketballProb,
        }
        if (!bestBall || detection.confidence > bestBall.confidence) {
          bestBall = detection
        }
      }

      // Add rim detection if score above threshold and box size is acceptable
      if (rimProb >= threshold && w <= MAX_RIM_BOX_SIZE && h <= MAX_RIM_BOX_SIZE) {
        const detection = {
          x: finalCx,
          y: finalCy,
          width: w,
          height: h,
          confidence: rimProb,
        }
        if (detection.y < 0.5 && (!bestRim || detection.confidence > bestRim.confidence)) {
          bestRim = detection
        }
      }
    }

    return { ball: bestBall, rim: bestRim, debug: { conf: maxRawConfidence } }

  } catch (error) {
    console.error('[YOLO PARSER ERROR]', error)
    return { ball: null, rim: null, debug: { conf: 0 } }
  }
}