// YoloDetector
// Pure class for YOLO detection parsing and filtering
// Worklet-safe, no React dependencies
// Extracted from yoloParserFloat16.ts

import { YOLO_CONFIG } from '@/config/appConfig'

const OUTPUT_CHANNELS = 7 // 4 box values + 3 class scores (ball, human, rim)
const STRIDES = [8, 16, 32]

export interface YoloDetection {
  x: number
  y: number
  width: number
  height: number
  confidence: number
}

export interface YoloPlayerDebug {
  rawCandidates: number      // Total anchors with humanProb > 0
  confidencePassed: number   // Anchors passing confidence threshold
  sizePassed: number         // Anchors passing size threshold
  accepted: number           // Final accepted player (0 or 1)
  bestConfidence: number     // Best confidence seen
  rejectedConfidence: number // Best confidence among rejected
}

export interface YoloResult {
  ball: YoloDetection | null
  player: YoloDetection | null
  rim: YoloDetection | null
  ballSizeCategory?: 'small' | 'medium' | 'large' | null
  adaptiveThreshold?: number
  playerDebug?: YoloPlayerDebug
}

export class YoloDetector {
  private ballConfThreshold: number
  private rimConfThreshold: number

  constructor(
    ballConfThreshold: number = YOLO_CONFIG.BALL_CONF_THRESHOLD,
    rimConfThreshold: number = YOLO_CONFIG.RIM_CONF_THRESHOLD
  ) {
    this.ballConfThreshold = ballConfThreshold
    this.rimConfThreshold = rimConfThreshold
  }

  // Adaptive confidence threshold based on detected ball size
  private getAdaptiveThreshold(
    ballWidth: number,
    ballHeight: number,
    baseThreshold: number,
    resolutionScale: number = 1.0
  ): number {
    const avgSize = (ballWidth + ballHeight) / 2

    // Large object (radius 0.2 = diameter 0.4 = avgSize 0.4)
    const MAX_SIZE = 0.40 * resolutionScale
    if (avgSize >= MAX_SIZE) {
      return baseThreshold
    }

    // Small / distant object (radius 0.05 = diameter 0.1 = avgSize 0.1)
    const MIN_SIZE = 0.10 * resolutionScale
    const MIN_THRESHOLD = 0.01

    // Normalize size to 0..1
    let t = (avgSize - MIN_SIZE) / (MAX_SIZE - MIN_SIZE)

    // Clamp
    if (t < 0) t = 0
    else if (t > 1) t = 1

    // Smooth interpolation
    const smoothT = t * t * (3 - 2 * t)

    return MIN_THRESHOLD + (baseThreshold - MIN_THRESHOLD) * smoothT
  }

  // Validate bounding box geometry - reject suspicious aspect ratios
  private isValidBallGeometry(width: number, height: number): { valid: boolean; aspectRatio: number } {
    if (width <= 0 || height <= 0) {
      return { valid: false, aspectRatio: 0 }
    }

    const aspectRatio = width / height

    // Reject extremely wide or tall boxes (aspect ratio > 4.0 or < 0.25)
    if (aspectRatio > 4.0 || aspectRatio < 0.25) {
      return { valid: false, aspectRatio }
    }

    return { valid: true, aspectRatio }
  }

  // Determine ball size category based on average size
  private getBallSizeCategory(avgSize: number): 'small' | 'medium' | 'large' | null {
    if (avgSize < 0.10) return 'small'
    if (avgSize < 0.20) return 'medium'
    if (avgSize >= 0.20) return 'large'
    return null
  }

  // Parse YOLO output to detections
  // Worklet-safe - marked with 'worklet' directive for Reanimated
  // Standard YOLOv8 TFLite format: (1, 7, num_anchors) where 7 = 4 coords + 3 class scores
  // Layout: [xc, yc, w, h, ball_score, human_score, rim_score] for each anchor
  parseOutput(
    output: Float32Array,
    frameWidth: number = 1280,
    frameHeight: number = 720
  ): YoloResult {
    'worklet'

    const effectiveFrameWidth = frameWidth || 1280
    const effectiveFrameHeight = frameHeight || 720
    let TENSOR_SIZE = 512

    try {
      let bestBall: { x: number; y: number; width: number; height: number; confidence: number } | null = null
      let bestPlayer: { x: number; y: number; width: number; height: number; confidence: number } | null = null
      let bestRim: { x: number; y: number; width: number; height: number; confidence: number } | null = null

      // Player debug counters
      let rawCandidates = 0
      let confidencePassed = 0
      let sizePassed = 0
      let bestConfidence = 0
      let rejectedConfidence = 0

      const nDetections = Math.floor(output.length / OUTPUT_CHANNELS)
      if (nDetections <= 0 || output.length % OUTPUT_CHANNELS !== 0) {
        return { ball: null, player: null, rim: null }
      }

      // Determine input size from number of detections
      if (nDetections === 8400) TENSOR_SIZE = 640
      else if (nDetections === 5376) TENSOR_SIZE = 512
      else if (nDetections === 4116) TENSOR_SIZE = 448
      else if (nDetections === 3024) TENSOR_SIZE = 384
      else if (nDetections === 2100) TENSOR_SIZE = 320

      // Calculate letterboxing parameters
      const SCALE = Math.min(TENSOR_SIZE / effectiveFrameWidth, TENSOR_SIZE / effectiveFrameHeight)
      const RESIZED_WIDTH = effectiveFrameWidth * SCALE
      const RESIZED_HEIGHT = effectiveFrameHeight * SCALE
      const LETTERBOX_OFFSET_X = RESIZED_WIDTH < TENSOR_SIZE ? (TENSOR_SIZE - RESIZED_WIDTH) / 2 : 0
      const LETTERBOX_OFFSET_Y = RESIZED_HEIGHT < TENSOR_SIZE ? (TENSOR_SIZE - RESIZED_HEIGHT) / 2 : 0

      // Normalize thresholds to reference resolution 512
      const resolutionScale = TENSOR_SIZE / 512

      // Convert coordinates from letterboxed tensor space to camera-normalized space
      const convertFromLetterbox = (cx: number, cy: number, w: number, h: number) => {
        const cx_px = cx * TENSOR_SIZE
        const cy_px = cy * TENSOR_SIZE
        const w_px = w * TENSOR_SIZE
        const h_px = h * TENSOR_SIZE

        const cx_no_letterbox = cx_px - LETTERBOX_OFFSET_X
        const cy_no_letterbox = cy_px - LETTERBOX_OFFSET_Y

        const cx_camera = cx_no_letterbox / SCALE
        const cy_camera = cy_no_letterbox / SCALE
        const w_camera = w_px / SCALE
        const h_camera = h_px / SCALE

        return {
          cx: cx_camera / effectiveFrameWidth,
          cy: cy_camera / effectiveFrameHeight,
          w: w_camera / effectiveFrameWidth,
          h: h_camera / effectiveFrameHeight
        }
      }

      for (let i = 0; i < nDetections; i++) {
        const cxRaw = output[i]
        const cyRaw = output[nDetections + i]
        const w = output[2 * nDetections + i]
        const h = output[3 * nDetections + i]
        const ballScore = output[4 * nDetections + i]
        const humanScore = output[5 * nDetections + i]
        const rimScore = output[6 * nDetections + i]

        const cx = cxRaw
        const cy = cyRaw

        const converted = convertFromLetterbox(cx, cy, w, h)
        const cameraCx = converted.cx
        const cameraCy = converted.cy
        const cameraW = converted.w
        const cameraH = converted.h

        const ballProb = ballScore
        const humanProb = humanScore
        const rimProb = rimScore

        if (cameraW <= 0.01 || cameraH <= 0.01) continue

        const geometryCheck = this.isValidBallGeometry(cameraW, cameraH)
        const ballAdaptiveThreshold = this.getAdaptiveThreshold(cameraW, cameraH, this.ballConfThreshold, resolutionScale)

        if (geometryCheck.valid && ballProb >= ballAdaptiveThreshold) {
          const detection = {
            x: cameraCx,
            y: cameraCy,
            width: cameraW,
            height: cameraH,
            confidence: ballProb,
          }
          if (!bestBall || detection.confidence > bestBall.confidence) {
            bestBall = detection
          }
        }

        const effectiveRimThreshold = this.rimConfThreshold
        if (rimProb >= effectiveRimThreshold) {
          const detection = {
            x: cameraCx,
            y: cameraCy,
            width: cameraW,
            height: cameraH,
            confidence: rimProb,
          }
          if (!bestRim || detection.confidence > bestRim.confidence) {
            bestRim = detection
          }
        }

        // Player detection pipeline with debug counters
        if (humanProb > 0) {
          rawCandidates++
          if (humanProb > bestConfidence) {
            bestConfidence = humanProb
          }
        }

        if (humanProb >= YOLO_CONFIG.PLAYER_CONF_THRESHOLD) {
          confidencePassed++
          if (cameraW > YOLO_CONFIG.PLAYER_MIN_WIDTH && cameraH > YOLO_CONFIG.PLAYER_MIN_HEIGHT) {
            sizePassed++
            const detection = {
              x: cameraCx,
              y: cameraCy,
              width: cameraW,
              height: cameraH,
              confidence: humanProb,
            }
            if (!bestPlayer || detection.confidence > bestPlayer.confidence) {
              bestPlayer = detection
            }
          } else {
            // Rejected by size - track best rejected confidence
            if (humanProb > rejectedConfidence) {
              rejectedConfidence = humanProb
            }
          }
        } else {
          // Rejected by confidence - track best rejected confidence
          if (humanProb > rejectedConfidence) {
            rejectedConfidence = humanProb
          }
        }
      }

      const avgSize = bestBall ? (bestBall.width + bestBall.height) / 2 : 0
      const ballSizeCategory = this.getBallSizeCategory(avgSize)
      const adaptiveThreshold = bestBall ? this.getAdaptiveThreshold(bestBall.width, bestBall.height, this.ballConfThreshold, resolutionScale) : undefined

      const playerDebug: YoloPlayerDebug = {
        rawCandidates,
        confidencePassed,
        sizePassed,
        accepted: bestPlayer ? 1 : 0,
        bestConfidence,
        rejectedConfidence,
      }

      return {
        ball: bestBall,
        player: bestPlayer,
        rim: bestRim,
        ballSizeCategory,
        adaptiveThreshold,
        playerDebug,
      }

    } catch (error) {
      console.error('[YoloDetector] parseOutput error:', error)
      return { ball: null, player: null, rim: null }
    }
  }

  // Set confidence thresholds
  setBallConfThreshold(threshold: number): void {
    this.ballConfThreshold = threshold
  }

  setRimConfThreshold(threshold: number): void {
    this.rimConfThreshold = threshold
  }
}
