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
  // Large object (radius 0.2 = diameter 0.4 = avgSize 0.4)
  // ----------------------------------------------------------
  if (avgSize >= 0.40) {
    return baseThreshold
  }

  // ----------------------------------------------------------
  // Small / distant object (radius 0.05 = diameter 0.1 = avgSize 0.1)
  //
  // Interpolate between:
  //   0.40 -> baseThreshold (large ball, radius 0.2)
  //   0.10 -> minimum threshold (small ball, radius 0.05)
  // ----------------------------------------------------------

  const MIN_SIZE = 0.10
  const MAX_SIZE = 0.40

  // Lowered from 0.006 to 0.003 to be more permissive for very small balls
  const MIN_THRESHOLD = 0.003

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
// Clamp to reasonable normalized size (max 80% of screen) for distant shots
// Increased from 0.7 to 0.8 to accommodate larger detections
const MAX_BALL_BOX_SIZE = 0.8
// A ball smaller than this radius is below the reliable visual resolution
// for the current detector and is treated as noise. This is deliberately
// a radius threshold, not a minimum accepted ball size: above it, smaller
// balls are made progressively easier to accept via the adaptive threshold.
// 0.03 radius = 0.06 normalized diameter (~30 px at 512x512).
const MIN_BALL_RADIUS = 0.03
// For rim, keep a more conservative filter.
// Increased from 0.8 to 0.9 to accommodate larger rim detections
const MAX_RIM_BOX_SIZE = 0.9

// Parse YOLO output to BallDetection
// This runs in the Worklet - NO runOnJS here
// Detects both ball (cls 0) and rim (cls 1)
// Returns the ball with highest confidence and the rim with highest confidence
// Standard YOLOv8 TFLite format: (1, 7, num_anchors) where 7 = 4 coords + 3 class scores
// Layout: [xc, yc, w, h, basketball_score, rim_score, sports_ball_score] for each anchor
// Requires grid/stride decoding for proper coordinate extraction
//
// IMPORTANT: Coordinate system conversion
// The resizer uses scaleMode: 'contain' which letterboxes the 1280x720 camera image
// into the 512x512 YOLO tensor. We need to convert coordinates from the letterboxed
// tensor space back to the original camera aspect ratio.
//
// Camera: 1280x720 (16:9 aspect ratio)
// YOLO tensor: 512x512 (1:1 aspect ratio)
// Scale factor: min(512/1280, 512/720) = 0.4
// Resized image: 512x288
// Letterboxing: (512-288)/2 = 112px top and bottom
export function parseYoloOutput(
    output: Float32Array | Uint8Array | Int8Array,
    threshold: number = CONF_THRESHOLD,
    frameWidth?: number,
    frameHeight?: number
): {
  ball: { x: number; y: number; width: number; height: number; confidence: number } | null
  rim: { x: number; y: number; width: number; height: number; confidence: number } | null
  debug?: { conf: number; ballIndex?: number; rimIndex?: number; rejectedTooSmall: number; rejectedLowConfidence: number; rejectedGeometry: number; tooSmallSamples: Array<{ confidence: number; width: number; height: number; radius: number }>; lowConfidenceAccepted: { confidence: number; width: number; height: number; x: number; y: number } | null; maxBallScore: number; maxBallAnchor: { index: number; cx: number; cy: number; w: number; h: number; confidence: number } | null; maxBallAnchorRejection: string | null }
} {
  'worklet'; // eslint-disable-line

  // Letterboxing parameters for contain mode
  // Camera: 1280x720 (16:9), YOLO: dynamic (1:1)
  const CAMERA_ASPECT = 1280 / 720  // 1.777...
  let TENSOR_SIZE = 512 // Default, will be updated after nDetections is calculated

  try {
    let maxRawConfidence = 0
    let maxBallScore = 0
    let maxBallAnchor: { index: number; cx: number; cy: number; w: number; h: number; confidence: number } | null = null
    let bestBall: { x: number; y: number; width: number; height: number; confidence: number; index: number } | null = null
    let bestRim: { x: number; y: number; width: number; height: number; confidence: number; index: number } | null = null
    let bestBallRaw: { cxRaw: number; cyRaw: number; wRaw: number; hRaw: number; basketballScore: number; rimScore: number; sportsBallScore: number } | null = null

    // Diagnostic counters for ball loss analysis
    let rejectedTooSmall = 0
    let rejectedLowConfidence = 0
    let rejectedGeometry = 0
    let tooSmallSamples: Array<{ confidence: number; width: number; height: number; radius: number }> = []
    const MAX_SAMPLES = 5

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
    if (nDetections === 8400) TENSOR_SIZE = 640
    else if (nDetections === 2100) TENSOR_SIZE = 320
    else if (nDetections === 5376) TENSOR_SIZE = 512

    // Calculate letterboxing parameters based on dynamic TENSOR_SIZE
    const SCALE = Math.min(TENSOR_SIZE / 1280, TENSOR_SIZE / 720)
    const RESIZED_HEIGHT = 720 * SCALE
    const LETTERBOX_OFFSET = (TENSOR_SIZE - RESIZED_HEIGHT) / 2

    // Convert coordinates from letterboxed tensor space to camera-normalized space
    const convertFromLetterbox = (cx: number, cy: number, w: number, h: number) => {
      // Convert from normalized tensor coordinates to pixel tensor coordinates
      const cx_px = cx * TENSOR_SIZE
      const cy_px = cy * TENSOR_SIZE
      const w_px = w * TENSOR_SIZE
      const h_px = h * TENSOR_SIZE

      // Remove letterboxing offset
      const cy_no_letterbox = cy_px - LETTERBOX_OFFSET

      // Scale back to camera pixel space
      const cx_camera = cx_px / SCALE
      const cy_camera = cy_no_letterbox / SCALE
      const w_camera = w_px / SCALE
      const h_camera = h_px / SCALE

      // Normalize to camera space (0..1)
      return {
        cx: cx_camera / 1280,
        cy: cy_camera / 720,
        w: w_camera / 1280,
        h: h_camera / 720
      }
    }

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

      // Convert from letterboxed tensor space to camera-normalized space
      const converted = convertFromLetterbox(finalCx, finalCy, w, h)
      const cameraCx = converted.cx
      const cameraCy = converted.cy
      const cameraW = converted.w
      const cameraH = converted.h

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
      if (cameraW <= 0.01 || cameraH <= 0.01) continue

      // Validate bounding box geometry - reject suspicious aspect ratios
      const geometryCheck = isValidBallGeometry(cameraW, cameraH)
      const validGeometry = geometryCheck.valid
      const aspectRatio = geometryCheck.aspectRatio

      // Use adaptive threshold for ball detection based on apparent size.
      // Small/distant balls get a lower confidence requirement; extremely tiny
      // boxes are rejected as noise instead of lowering the threshold forever.
      const ballRadius = Math.min(cameraW, cameraH) / 2
      const ballTooSmall = ballRadius < MIN_BALL_RADIUS
      const ballAdaptiveThreshold = getAdaptiveThreshold(cameraW, cameraH, threshold)

      // Track max basketball score for frames without detection
      if (basketballProb > maxBallScore) {
        maxBallScore = basketballProb
        maxBallAnchor = { index: i, cx: cameraCx, cy: cameraCy, w: cameraW, h: cameraH, confidence: basketballProb }
      }
      if (ballTooSmall) {
        rejectedTooSmall++
        // Only sample if confidence is significant (> 0.01) to filter out noise
        if (tooSmallSamples.length < MAX_SAMPLES && basketballProb > 0.01) {
          tooSmallSamples.push({ confidence: basketballProb, width: cameraW, height: cameraH, radius: ballRadius })
        }
      } else if (!validGeometry) {
        rejectedGeometry++
      } else if (basketballProb < ballAdaptiveThreshold) {
        rejectedLowConfidence++
      }

      // Removed per-detection logging - too expensive with 8400 anchors

      // Accept when:
      // 1. Not too small (above noise floor)
      // 2. Valid geometry (aspect ratio not suspicious)
      // 3. Confidence clears adaptive threshold
      // 4. Box not absurdly large
      // Use basketball class (0) for ball detection
      if (!ballTooSmall && validGeometry && basketballProb >= ballAdaptiveThreshold && cameraW <= MAX_BALL_BOX_SIZE && cameraH <= MAX_BALL_BOX_SIZE) {
        const detection = {
          x: cameraCx,
          y: cameraCy,
          width: cameraW,
          height: cameraH,
          confidence: basketballProb,
          index: i,
        }
        if (!bestBall || detection.confidence > bestBall.confidence) {
          bestBall = detection
          bestBallRaw = { cxRaw, cyRaw, wRaw: w, hRaw: h, basketballScore, rimScore, sportsBallScore }
        }
      }

      // Add rim detection if score above threshold and box size is acceptable
      if (rimProb >= threshold && cameraW <= MAX_RIM_BOX_SIZE && cameraH <= MAX_RIM_BOX_SIZE) {
        const detection = {
          x: cameraCx,
          y: cameraCy,
          width: cameraW,
          height: cameraH,
          confidence: rimProb,
          index: i,
        }
        if (detection.y < 0.5 && (!bestRim || detection.confidence > bestRim.confidence)) {
          bestRim = detection
        }
      }
    }

    // Classify rejection reason for max ball anchor
    let maxBallAnchorRejection: string | null = null
    if (maxBallAnchor) {
      const ballRadius = Math.min(maxBallAnchor.w, maxBallAnchor.h) / 2
      const ballTooSmall = ballRadius < MIN_BALL_RADIUS
      const geometryCheck = isValidBallGeometry(maxBallAnchor.w, maxBallAnchor.h)
      const ballAdaptiveThreshold = getAdaptiveThreshold(maxBallAnchor.w, maxBallAnchor.h, threshold)
      const tooLarge = maxBallAnchor.w > MAX_BALL_BOX_SIZE || maxBallAnchor.h > MAX_BALL_BOX_SIZE
      
      if (maxBallAnchor.confidence < ballAdaptiveThreshold) {
        maxBallAnchorRejection = 'LOW_CONFIDENCE'
      } else if (ballTooSmall) {
        maxBallAnchorRejection = 'TOO_SMALL'
      } else if (!geometryCheck.valid) {
        maxBallAnchorRejection = 'BAD_GEOMETRY'
      } else if (tooLarge) {
        maxBallAnchorRejection = 'MAX_SIZE'
      } else {
        maxBallAnchorRejection = 'ACCEPTED'
      }
    }

    // Log raw values of best ball detection for diagnostic
    if (__DEV__ && bestBallRaw && bestBall) {
      console.log('[YOLO PARSER RAW] Best ball detection raw values:', {
        cxRaw: bestBallRaw.cxRaw?.toFixed(6) ?? 'undefined',
        cyRaw: bestBallRaw.cyRaw?.toFixed(6) ?? 'undefined',
        wRaw: bestBallRaw.wRaw?.toFixed(6) ?? 'undefined',
        hRaw: bestBallRaw.hRaw?.toFixed(6) ?? 'undefined',
        basketballScore: bestBallRaw.basketballScore?.toFixed(6) ?? 'undefined',
        rimScore: bestBallRaw.rimScore?.toFixed(6) ?? 'undefined',
        sportsBallScore: bestBallRaw.sportsBallScore?.toFixed(6) ?? 'undefined',
      })
      console.log('[YOLO PARSER PARSED] After letterbox mapping:', {
        x: bestBall.x.toFixed(6),
        y: bestBall.y.toFixed(6),
        width: bestBall.width.toFixed(6),
        height: bestBall.height.toFixed(6),
        confidence: bestBall.confidence.toFixed(6),
      })
    }

    return { ball: bestBall ? { x: bestBall.x, y: bestBall.y, width: bestBall.width, height: bestBall.height, confidence: bestBall.confidence } : null, rim: bestRim ? { x: bestRim.x, y: bestRim.y, width: bestRim.width, height: bestRim.height, confidence: bestRim.confidence } : null, debug: { conf: maxRawConfidence, ballIndex: bestBall?.index, rimIndex: bestRim?.index, rejectedTooSmall, rejectedLowConfidence, rejectedGeometry, tooSmallSamples, lowConfidenceAccepted: bestBall && bestBall.confidence <= 0.03 ? { confidence: bestBall.confidence, width: bestBall.width, height: bestBall.height, x: bestBall.x, y: bestBall.y } : null, maxBallScore, maxBallAnchor, maxBallAnchorRejection } }

  } catch (error) {
    console.error('[YOLO PARSER ERROR]', error)
    return { ball: null, rim: null, debug: { conf: 0, rejectedTooSmall: 0, rejectedLowConfidence: 0, rejectedGeometry: 0, tooSmallSamples: [], lowConfidenceAccepted: null, maxBallScore: 0, maxBallAnchor: null, maxBallAnchorRejection: null } }
  }
}