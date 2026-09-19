// src/vision/yoloParserInt8.ts
//
// YOLO output parser for INT8 quantized models - runs in Worklet
// Converts raw INT8 YOLO output to BallDetection interface
// NO image data, only coordinates
// Format: standard YOLOv8 TFLite [x, y, w, h, conf, cls] per detection
// Requires grid/stride decoding for proper coordinate extraction

const NMS_IOU_THRESHOLD = 0.4
const CONF_THRESHOLD = 0.003  // Minimum confidence threshold (0.3%) - lowered to detect more balls
const PLAYER_CONF_THRESHOLD = 0.001  // Minimum confidence threshold for player (0.1%) - slightly increased
const OUTPUT_CHANNELS = 7 // 4 box values + 3 class scores (ball, human, rim)

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
  baseThreshold: number,
  resolutionScale: number = 1.0
): number {
  'worklet'; // eslint-disable-line

  const avgSize = (ballWidth + ballHeight) / 2

  // ----------------------------------------------------------
  // Large object (radius 0.2 = diameter 0.4 = avgSize 0.4)
  // Normalized to reference resolution 512
  // ----------------------------------------------------------
  const MAX_SIZE = 0.40 * resolutionScale
  if (avgSize >= MAX_SIZE) {
    return baseThreshold
  }

  // ----------------------------------------------------------
  // Small / distant object (radius 0.05 = diameter 0.1 = avgSize 0.1)
  //
  // Interpolate between:
  //   MAX_SIZE -> baseThreshold (large ball, radius 0.2)
  //   MIN_SIZE -> minimum threshold (small ball, radius 0.05)
  // Normalized to reference resolution 512
  // ----------------------------------------------------------

  const MIN_SIZE = 0.10 * resolutionScale

  // Minimum threshold for very small balls - raised to 0.01 for new YOLO11 model
  const MIN_THRESHOLD = 0.01

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

// MAX_BALL_BOX_SIZE and MAX_RIM_BOX_SIZE filters removed - trust the model's output

// Parse YOLO output to BallDetection
// This runs in the Worklet - NO runOnJS here
// Detects both ball (cls 0) and rim (cls 2)
// Returns the ball with highest confidence and the rim with highest confidence
// Standard YOLOv8 TFLite format: (1, 7, num_anchors) where 7 = 4 coords + 3 class scores
// Layout: [xc, yc, w, h, ball_score, human_score, rim_score] for each anchor
// Requires grid/stride decoding for proper coordinate extraction
//
// IMPORTANT: Coordinate system conversion
// The resizer uses scaleMode: 'contain' which letterboxes the camera image
// into the 512x512 YOLO tensor. We need to convert coordinates from the letterboxed
// tensor space back to the original camera aspect ratio.
//
// Camera: dynamic resolution (e.g., 1280x720, 1920x1080, etc.)
// YOLO tensor: 512x512 (1:1 aspect ratio)
// Scale factor: calculated dynamically based on frame resolution
// Resized image: calculated dynamically
// Letterboxing: calculated dynamically
export function parseYoloOutputInt8(
    output: Float32Array,
    threshold: number = CONF_THRESHOLD,
    frameWidth?: number,
    frameHeight?: number,
    rimThreshold?: number
): {
  ball: { x: number; y: number; width: number; height: number; confidence: number } | null
  player: { x: number; y: number; width: number; height: number; confidence: number } | null
  rim: { x: number; y: number; width: number; height: number; confidence: number } | null
  debug?: { conf: number; ballIndex?: number; rimIndex?: number; rejectedTooSmall: number; rejectedLowConfidence: number; rejectedGeometry: number; tooSmallSamples: Array<{ confidence: number; width: number; height: number; radius: number }>; lowConfidenceAccepted: { confidence: number; width: number; height: number; x: number; y: number } | null; maxBallScore: number; maxBallAnchor: { index: number; cx: number; cy: number; w: number; h: number; confidence: number } | null; maxBallAnchorRejection: string | null; ballRejectionReason: string; rimRejectionReason: string }
} {
  'worklet'; // eslint-disable-line

  // Letterboxing parameters for contain mode
  // Camera: dynamic resolution, YOLO: dynamic (1:1)
  const effectiveFrameWidth = frameWidth || 1280
  const effectiveFrameHeight = frameHeight || 720
  const CAMERA_ASPECT = effectiveFrameWidth / effectiveFrameHeight
  let TENSOR_SIZE = 512 // Default, will be updated after nDetections is calculated

  try {
    let maxRawConfidence = 0
    let maxBallScore = 0
    let maxBallAnchor: { index: number; cx: number; cy: number; w: number; h: number; confidence: number } | null = null
    let bestBall: { x: number; y: number; width: number; height: number; confidence: number; index: number } | null = null
    let bestPlayer: { x: number; y: number; width: number; height: number; confidence: number; index: number } | null = null
    let bestRim: { x: number; y: number; width: number; height: number; confidence: number; index: number } | null = null
    let ballRejectionReason: string = ''
    let rimRejectionReason: string = ''
    let bestBallRaw: { cxRaw: number; cyRaw: number; wRaw: number; hRaw: number; ballScore: number; humanScore: number; rimScore: number } | null = null

    // Diagnostic counters for ball loss analysis
    let rejectedTooSmall = 0
    let rejectedLowConfidence = 0
    let rejectedGeometry = 0
    let tooSmallSamples: Array<{ confidence: number; width: number; height: number; radius: number }> = []
    const MAX_SAMPLES = 5

    // Channel-major layout:
    // [cx..., cy..., w..., h..., ballScore..., humanScore..., rimScore...]
    //
    // IMPORTANT: do not hardcode 8400. YOLO output size depends on the selected
    // input resolution (e.g. 640 -> 8400, 416 -> 3549, 320 -> 2100).
    // Reading the actual output buffer makes the parser model-size agnostic.
    const nDetections = Math.floor(output.length / OUTPUT_CHANNELS)
    if (nDetections <= 0 || output.length % OUTPUT_CHANNELS !== 0) {
      return { ball: null, player: null, rim: null }
    }

    // Determine input size from number of detections
    // 512x512: 5376 anchors, 640x640: 8400 anchors, 320x320: 2100 anchors
    if (nDetections === 8400) TENSOR_SIZE = 640
    else if (nDetections === 2100) TENSOR_SIZE = 320
    else if (nDetections === 5376) TENSOR_SIZE = 512
    else {
      if (__DEV__) {
        console.log('[YOLO PARSER] Unknown detection count:', nDetections, 'defaulting to 512')
      }
      TENSOR_SIZE = 512
    }
    
    if (__DEV__) {
      console.log('[YOLO PARSER] TENSOR_SIZE:', TENSOR_SIZE, 'nDetections:', nDetections)
    }

    // Calculate letterboxing parameters based on dynamic TENSOR_SIZE and frame resolution
    const SCALE = Math.min(TENSOR_SIZE / effectiveFrameWidth, TENSOR_SIZE / effectiveFrameHeight)
    const RESIZED_WIDTH = effectiveFrameWidth * SCALE
    const RESIZED_HEIGHT = effectiveFrameHeight * SCALE
    // Letterboxing is applied to the dimension that doesn't match the tensor size
    const LETTERBOX_OFFSET_X = RESIZED_WIDTH < TENSOR_SIZE ? (TENSOR_SIZE - RESIZED_WIDTH) / 2 : 0
    const LETTERBOX_OFFSET_Y = RESIZED_HEIGHT < TENSOR_SIZE ? (TENSOR_SIZE - RESIZED_HEIGHT) / 2 : 0

    // Normalize thresholds to reference resolution 512
    const resolutionScale = TENSOR_SIZE / 512

    // Convert coordinates from letterboxed tensor space to camera-normalized space
    const convertFromLetterbox = (cx: number, cy: number, w: number, h: number) => {
      // Convert from normalized tensor coordinates to pixel tensor coordinates
      const cx_px = cx * TENSOR_SIZE
      const cy_px = cy * TENSOR_SIZE
      const w_px = w * TENSOR_SIZE
      const h_px = h * TENSOR_SIZE

      // Remove letterboxing offset from both axes
      const cx_no_letterbox = cx_px - LETTERBOX_OFFSET_X
      const cy_no_letterbox = cy_px - LETTERBOX_OFFSET_Y

      // Scale back to camera pixel space
      const cx_camera = cx_no_letterbox / SCALE
      const cy_camera = cy_no_letterbox / SCALE
      const w_camera = w_px / SCALE
      const h_camera = h_px / SCALE

      // Normalize to camera space (0..1)
      return {
        cx: cx_camera / effectiveFrameWidth,
        cy: cy_camera / effectiveFrameHeight,
        w: w_camera / effectiveFrameWidth,
        h: h_camera / effectiveFrameHeight
      }
    }

    // Simplified decoder - read Float32 values directly
    // Model outputs Float32 tensors despite the 'int8' filename
    for (let i = 0; i < nDetections; i++) {
      // Read Float32 values directly (no dequantization needed)
      const cxRaw = output[i]
      const cyRaw = output[nDetections + i]
      const w = output[2 * nDetections + i]
      const h = output[3 * nDetections + i]
      const ballScore = output[4 * nDetections + i]
      const humanScore = output[5 * nDetections + i]
      const rimScore = output[6 * nDetections + i]

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
      const ballProb = ballScore
      const humanProb = humanScore
      const rimProb = rimScore

      // Unconditional — tracks the model's real signal regardless of
      // whether anything clears the threshold or the box-size filters
      // below. Without this, "maxConf" in the logs collapses to 0 the
      // moment nothing survives thresholding, making it impossible to
      // tell "the model sees nothing" apart from "close, but just under
      // threshold".
      const anchorMax = Math.max(ballProb, humanProb, rimProb)
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
      // Small/distant balls get a lower confidence requirement
      const ballAdaptiveThreshold = getAdaptiveThreshold(cameraW, cameraH, threshold, resolutionScale)

      // Track max ball score for frames without detection
      if (ballProb > maxBallScore) {
        maxBallScore = ballProb
        maxBallAnchor = { index: i, cx: cameraCx, cy: cameraCy, w: cameraW, h: cameraH, confidence: ballProb }
        // Track rejection reason for the best ball candidate
        if (!validGeometry) {
          ballRejectionReason = 'geometry'
        } else if (ballProb < ballAdaptiveThreshold) {
          ballRejectionReason = 'conf'
        }
      }
      if (!validGeometry) {
        rejectedGeometry++
      } else if (ballProb < ballAdaptiveThreshold) {
        rejectedLowConfidence++
      }

      // Removed per-detection logging - too expensive with 8400 anchors

      // Accept when:
      // 1. Valid geometry (aspect ratio not suspicious)
      // 2. Confidence clears adaptive threshold
      // Use ball class (0) for ball detection
      if (validGeometry && ballProb >= ballAdaptiveThreshold) {
        const detection = {
          x: cameraCx,
          y: cameraCy,
          width: cameraW,
          height: cameraH,
          confidence: ballProb,
          index: i,
        }
        if (!bestBall || detection.confidence > bestBall.confidence) {
          bestBall = detection
          bestBallRaw = { cxRaw, cyRaw, wRaw: w, hRaw: h, ballScore, humanScore, rimScore }
        }
      }

      // Add rim detection if score above rim threshold (or default threshold)
      const effectiveRimThreshold = rimThreshold ?? threshold
      if (rimProb >= effectiveRimThreshold) {
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
        } else if (detection.y >= 0.5 && (!bestRim || detection.confidence > (bestRim?.confidence ?? 0))) {
          // Track rejection reason for rim in wrong position
          rimRejectionReason = 'position'
        }
      } else if (!bestRim || rimProb > (bestRim?.confidence ?? 0)) {
        // Track rejection reason for rim with low confidence
        rimRejectionReason = 'conf'
      }

      // Add player detection if score above threshold
      // Player (human) detection - less strict size constraints than ball
      if (humanProb >= PLAYER_CONF_THRESHOLD && cameraW > 0.05 && cameraH > 0.1) {
        const detection = {
          x: cameraCx,
          y: cameraCy,
          width: cameraW,
          height: cameraH,
          confidence: humanProb,
          index: i,
        }
        if (!bestPlayer || detection.confidence > bestPlayer.confidence) {
          bestPlayer = detection
        }
      }
    }

    // Classify rejection reason for max ball anchor
    let maxBallAnchorRejection: string | null = null
    if (maxBallAnchor) {
      const geometryCheck = isValidBallGeometry(maxBallAnchor.w, maxBallAnchor.h)
      const ballAdaptiveThreshold = getAdaptiveThreshold(maxBallAnchor.w, maxBallAnchor.h, threshold, resolutionScale)

      if (maxBallAnchor.confidence < ballAdaptiveThreshold) {
        maxBallAnchorRejection = 'LOW_CONFIDENCE'
      } else if (!geometryCheck.valid) {
        maxBallAnchorRejection = 'BAD_GEOMETRY'
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
        ballScore: bestBallRaw.ballScore?.toFixed(6) ?? 'undefined',
        humanScore: bestBallRaw.humanScore?.toFixed(6) ?? 'undefined',
        rimScore: bestBallRaw.rimScore?.toFixed(6) ?? 'undefined',
      })
      console.log('[YOLO PARSER PARSED] After letterbox mapping:', {
        x: bestBall.x.toFixed(6),
        y: bestBall.y.toFixed(6),
        width: bestBall.width.toFixed(6),
        height: bestBall.height.toFixed(6),
        confidence: bestBall.confidence.toFixed(6),
      })
    }

    // Log player geometry for diagnostic
    if (__DEV__ && bestPlayer) {
      const aspectRatio = bestPlayer.height / bestPlayer.width
      console.log('[PLAYER GEOMETRY]', {
        conf: bestPlayer.confidence.toFixed(6),
        w: bestPlayer.width.toFixed(6),
        h: bestPlayer.height.toFixed(6),
        aspect: aspectRatio.toFixed(2),
      })
    }
    
    if (__DEV__) {
      console.log('[YOLO PARSER RESULT]', {
        ball: bestBall ? `x=${bestBall.x.toFixed(3)} y=${bestBall.y.toFixed(3)} conf=${bestBall.confidence.toFixed(3)}` : 'null',
        player: bestPlayer ? `x=${bestPlayer.x.toFixed(3)} y=${bestPlayer.y.toFixed(3)} conf=${bestPlayer.confidence.toFixed(3)}` : 'null',
        rim: bestRim ? `x=${bestRim.x.toFixed(3)} y=${bestRim.y.toFixed(3)} conf=${bestRim.confidence.toFixed(3)}` : 'null',
        maxRawConfidence: maxRawConfidence.toFixed(3),
        maxBallScore: maxBallScore.toFixed(3),
        rejectedTooSmall,
        rejectedLowConfidence,
        rejectedGeometry
      })

      // Diagnostic logging to understand output format (raw logits vs probabilities)
      const sigmoid = (x: number) => 1 / (1 + Math.exp(-x))
      console.log('[YOLO SCORE DIAGNOSTIC]', {
        ballRawMin: maxBallScore.toFixed(6),
        ballRawMax: maxBallScore.toFixed(6),
        ballSigmoid: sigmoid(maxBallScore).toFixed(6),
        humanRawMin: bestPlayer ? bestPlayer.confidence.toFixed(6) : 'N/A',
        humanRawMax: bestPlayer ? bestPlayer.confidence.toFixed(6) : 'N/A',
        humanSigmoid: bestPlayer ? sigmoid(bestPlayer.confidence).toFixed(6) : 'N/A',
        rimRawMin: bestRim ? bestRim.confidence.toFixed(6) : 'N/A',
        rimRawMax: bestRim ? bestRim.confidence.toFixed(6) : 'N/A',
        rimSigmoid: bestRim ? sigmoid(bestRim.confidence).toFixed(6) : 'N/A'
      })

      if (bestPlayer) {
        console.log('[YOLO HUMAN BEST]', {
          raw: bestPlayer.confidence.toFixed(6),
          sigmoid: sigmoid(bestPlayer.confidence).toFixed(6),
          bbox: `x=${bestPlayer.x.toFixed(3)} y=${bestPlayer.y.toFixed(3)} w=${bestPlayer.width.toFixed(3)} h=${bestPlayer.height.toFixed(3)}`
        })
      }
    }

    return { ball: bestBall ? { x: bestBall.x, y: bestBall.y, width: bestBall.width, height: bestBall.height, confidence: bestBall.confidence } : null, player: bestPlayer ? { x: bestPlayer.x, y: bestPlayer.y, width: bestPlayer.width, height: bestPlayer.height, confidence: bestPlayer.confidence } : null, rim: bestRim ? { x: bestRim.x, y: bestRim.y, width: bestRim.width, height: bestRim.height, confidence: bestRim.confidence } : null, debug: { conf: maxRawConfidence, ballIndex: bestBall?.index, rimIndex: bestRim?.index, rejectedTooSmall, rejectedLowConfidence, rejectedGeometry, tooSmallSamples, lowConfidenceAccepted: bestBall && bestBall.confidence <= 0.03 ? { confidence: bestBall.confidence, width: bestBall.width, height: bestBall.height, x: bestBall.x, y: bestBall.y } : null, maxBallScore, maxBallAnchor, maxBallAnchorRejection, ballRejectionReason, rimRejectionReason } }

  } catch (error) {
    console.error('[YOLO PARSER ERROR]', error)
    return { ball: null, player: null, rim: null, debug: { conf: 0, rejectedTooSmall: 0, rejectedLowConfidence: 0, rejectedGeometry: 0, tooSmallSamples: [], lowConfidenceAccepted: null, maxBallScore: 0, maxBallAnchor: null, maxBallAnchorRejection: null, ballRejectionReason: '', rimRejectionReason: '' } }
  }
}