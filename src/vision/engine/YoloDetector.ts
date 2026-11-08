// YoloDetector
// Pure class for YOLO detection parsing and filtering
// Worklet-safe, no React dependencies
// Extracted from yoloParserFloat16.ts

import { YOLO_CONFIG, VISION_CONFIG } from '@/config/appConfig'

const OUTPUT_CHANNELS = 7 // 4 box values + 3 class scores (ball, human, rim)
const STRIDES = [8, 16, 32]

// Shape/size priors (normalized to camera frame). Defaults mirror YOLO_CONFIG
// and only apply if a key is missing (e.g. partially mocked config in tests).
const GEO = {
  playerMinW: (YOLO_CONFIG as any).PLAYER_MIN_WIDTH ?? 0.05,
  playerMinH: (YOLO_CONFIG as any).PLAYER_MIN_HEIGHT ?? 0.1,
  playerMaxW: (YOLO_CONFIG as any).PLAYER_MAX_WIDTH ?? 0.6,
  playerMinAspect: (YOLO_CONFIG as any).PLAYER_MIN_ASPECT ?? 0.8,
  playerMaxAspect: (YOLO_CONFIG as any).PLAYER_MAX_ASPECT ?? 6.0,
  ballMinSize: (YOLO_CONFIG as any).BALL_MIN_SIZE ?? 0.008,
  ballMaxSide: (YOLO_CONFIG as any).BALL_MAX_SIDE ?? 0.15,
  ballMinAspect: (YOLO_CONFIG as any).BALL_MIN_ASPECT ?? 0.6,
  ballMaxAspect: (YOLO_CONFIG as any).BALL_MAX_ASPECT ?? 1.7,
  rimMinW: (YOLO_CONFIG as any).RIM_MIN_WIDTH ?? 0.015,
  rimMaxW: (YOLO_CONFIG as any).RIM_MAX_WIDTH ?? 0.25,
  rimMinAspect: (YOLO_CONFIG as any).RIM_MIN_ASPECT ?? 0.8,
  rimMaxAspect: (YOLO_CONFIG as any).RIM_MAX_ASPECT ?? 6.0,
}

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
  private playerConfThreshold: number
  private rimDetectionEnabled: boolean = VISION_CONFIG.RIM_DETECTION_ENABLED

  // Persistent rim detection state (for confidence-based replacement)
  private persistentRim: { x: number; y: number; width: number; height: number; confidence: number } | null = null

  // Adaptive confidence state
  private adaptiveEnabled: boolean
  private windowSize: number
  private minThreshold: number
  private maxThreshold: number
  private adjustmentFactor: number
  private highConfThreshold: number
  private lowConfThreshold: number

  // Detection history for adaptive threshold (sliding window)
  private ballDetectionHistory: boolean[] = [] // true = detected, false = not detected
  private playerDetectionHistory: boolean[] = []
  private rimDetectionHistory: boolean[] = []
  private ballConfidenceHistory: number[] = [] // confidence values for detected frames
  private playerConfidenceHistory: number[] = []
  private rimConfidenceHistory: number[] = []

  // Current adaptive thresholds
  private adaptiveBallThreshold: number
  private adaptivePlayerThreshold: number
  private adaptiveRimThreshold: number

  constructor(
    ballConfThreshold: number = YOLO_CONFIG.BALL_CONF_THRESHOLD,
    rimConfThreshold: number = YOLO_CONFIG.RIM_CONF_THRESHOLD
  ) {
    this.ballConfThreshold = ballConfThreshold
    this.rimConfThreshold = rimConfThreshold
    this.playerConfThreshold = YOLO_CONFIG.PLAYER_CONF_THRESHOLD

    // Adaptive configuration
    this.adaptiveEnabled = YOLO_CONFIG.ADAPTIVE_CONF.ENABLED
    this.windowSize = YOLO_CONFIG.ADAPTIVE_CONF.WINDOW_SIZE
    this.minThreshold = YOLO_CONFIG.ADAPTIVE_CONF.MIN_THRESHOLD
    this.maxThreshold = YOLO_CONFIG.ADAPTIVE_CONF.MAX_THRESHOLD
    this.adjustmentFactor = YOLO_CONFIG.ADAPTIVE_CONF.ADJUSTMENT_FACTOR
    this.highConfThreshold = YOLO_CONFIG.ADAPTIVE_CONF.HIGH_CONF_THRESHOLD
    this.lowConfThreshold = YOLO_CONFIG.ADAPTIVE_CONF.LOW_CONF_THRESHOLD

    // Initialize adaptive thresholds with defaults
    this.adaptiveBallThreshold = ballConfThreshold
    this.adaptivePlayerThreshold = this.playerConfThreshold
    this.adaptiveRimThreshold = rimConfThreshold
  }

  setRimDetectionEnabled(enabled: boolean): void {
    this.rimDetectionEnabled = enabled
    if (!enabled) {
      // Clear persistent rim when disabled
      this.persistentRim = null
      // Reset adaptive rim state when disabled
      this.rimDetectionHistory = []
      this.rimConfidenceHistory = []
      this.adaptiveRimThreshold = this.rimConfThreshold
    }
  }

  // Update detection history and adjust adaptive thresholds
  private updateAdaptiveThreshold(
    detected: boolean,
    confidence: number | null,
    history: boolean[],
    confidenceHistory: number[],
    currentThreshold: number,
    baseThreshold: number
  ): number {
    if (!this.adaptiveEnabled) {
      return baseThreshold
    }

    // Add to history
    history.push(detected)
    if (detected && confidence !== null) {
      confidenceHistory.push(confidence)
    }

    // Maintain window size
    if (history.length > this.windowSize) {
      history.shift()
      if (confidenceHistory.length > this.windowSize) {
        confidenceHistory.shift()
      }
    }

    // Calculate detection rate in window
    const detectionRate = history.filter(d => d).length / history.length

    // Calculate average confidence of detections
    let avgConfidence = 0
    if (confidenceHistory.length > 0) {
      avgConfidence = confidenceHistory.reduce((sum, c) => sum + c, 0) / confidenceHistory.length
    }

    // Adaptive logic:
    // - High detection rate + high confidence → raise threshold (reduce false positives)
    // - Low detection rate → lower threshold (increase sensitivity)
    let newThreshold = currentThreshold

    if (detectionRate > 0.7 && avgConfidence > this.highConfThreshold) {
      // High confidence detections → raise threshold
      const targetThreshold = Math.min(baseThreshold * 2, this.maxThreshold)
      newThreshold = currentThreshold + (targetThreshold - currentThreshold) * this.adjustmentFactor
    } else if (detectionRate < 0.3) {
      // Low detection rate → lower threshold
      const targetThreshold = Math.max(baseThreshold * 0.5, this.minThreshold)
      newThreshold = currentThreshold + (targetThreshold - currentThreshold) * this.adjustmentFactor
    } else if (avgConfidence > this.highConfThreshold && confidenceHistory.length > 5) {
      // High confidence but moderate detection rate → slight raise
      newThreshold = currentThreshold + (baseThreshold - currentThreshold) * this.adjustmentFactor * 0.5
    } else if (avgConfidence < this.lowConfThreshold && confidenceHistory.length > 5) {
      // Low confidence → slight lower
      newThreshold = currentThreshold + (baseThreshold * 0.5 - currentThreshold) * this.adjustmentFactor * 0.5
    }

    // Clamp to bounds
    newThreshold = Math.max(this.minThreshold, Math.min(this.maxThreshold, newThreshold))

    // Log adaptive threshold changes (gated to avoid spam - every 10 frames for now)
    if (Math.abs(newThreshold - currentThreshold) > 0.0001 && history.length % 10 === 0) {
      console.log('[YoloDetector] Adaptive threshold update', {
        detectionRate: detectionRate.toFixed(2),
        avgConfidence: avgConfidence.toFixed(3),
        oldThreshold: currentThreshold.toFixed(4),
        newThreshold: newThreshold.toFixed(4),
        baseThreshold: baseThreshold.toFixed(4),
      })
    }

    return newThreshold
  }

  // Reset adaptive state (call when starting new session)
  resetAdaptiveState(): void {
    this.ballDetectionHistory = []
    this.playerDetectionHistory = []
    this.rimDetectionHistory = []
    this.ballConfidenceHistory = []
    this.playerConfidenceHistory = []
    this.rimConfidenceHistory = []
    this.adaptiveBallThreshold = this.ballConfThreshold
    this.adaptivePlayerThreshold = this.playerConfThreshold
    this.adaptiveRimThreshold = this.rimConfThreshold
  }

  // Get current adaptive thresholds (for debugging)
  getAdaptiveThresholds(): { ball: number; player: number; rim: number } {
    return {
      ball: this.adaptiveBallThreshold,
      player: this.adaptivePlayerThreshold,
      rim: this.adaptiveRimThreshold,
    }
  }

  // Adaptive confidence threshold based on detected ball size
  private getAdaptiveThreshold(
    ballWidth: number,
    ballHeight: number,
    baseThreshold: number,
    resolutionScale: number = 1.0
  ): number {
    const avgSize = (ballWidth + ballHeight) / 2

    // Sizes are aligned with the ball shape prior: balls at or above half of the
    // max plausible side use the full base threshold; tiny/distant balls are
    // allowed to relax down to the configured floor.
    const MAX_SIZE = (GEO.ballMaxSide * 0.5) * resolutionScale
    if (avgSize >= MAX_SIZE) {
      return baseThreshold
    }
    const MIN_SIZE = GEO.ballMinSize * resolutionScale
    // Floor comes from config: small objects may be accepted at a lower
    // confidence, but never down into the noise range (was hard-coded 0.01).
    const MIN_THRESHOLD = Math.min(this.minThreshold, baseThreshold)

    // Normalize size to 0..1
    let t = (avgSize - MIN_SIZE) / (MAX_SIZE - MIN_SIZE)

    // Clamp
    if (t < 0) t = 0
    else if (t > 1) t = 1

    // Smooth interpolation
    const smoothT = t * t * (3 - 2 * t)

    return MIN_THRESHOLD + (baseThreshold - MIN_THRESHOLD) * smoothT
  }

  // Validate ball geometry: roughly square and within the plausible size range.
  private isValidBallGeometry(width: number, height: number, frameAspect: number = 1): { valid: boolean; aspectRatio: number } {
    if (width <= 0 || height <= 0) {
      return { valid: false, aspectRatio: 0 }
    }

    // Boxes are normalized per-axis, so on a 16:9 frame a square object has
    // w/h = 9/16. Aspect ratios must be evaluated in pixel space.
    const aspectRatio = (width / height) * frameAspect
    const avgSize = (width + height) / 2

    if (aspectRatio > GEO.ballMaxAspect || aspectRatio < GEO.ballMinAspect) {
      return { valid: false, aspectRatio }
    }
    if (avgSize < GEO.ballMinSize || avgSize > GEO.ballMaxSide) {
      return { valid: false, aspectRatio }
    }

    return { valid: true, aspectRatio }
  }

  // Player: standing person, taller than wide, not frame-sized
  private isValidPlayerGeometry(width: number, height: number, frameAspect: number = 1): boolean {
    if (width < GEO.playerMinW || height < GEO.playerMinH || width > GEO.playerMaxW) return false
    const aspect = height / (width * frameAspect)
    return aspect >= GEO.playerMinAspect && aspect <= GEO.playerMaxAspect
  }

  // Rim: small, wider than tall (seen from the side/front)
  private isValidRimGeometry(width: number, height: number, frameAspect: number = 1): boolean {
    if (width < GEO.rimMinW || width > GEO.rimMaxW) return false
    const aspect = (width / height) * frameAspect
    return aspect >= GEO.rimMinAspect && aspect <= GEO.rimMaxAspect
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
    const frameAspect = effectiveFrameWidth / effectiveFrameHeight
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

      // Exporters differ: legacy TFLite models can expose normalized xywh (0..1),
      // while ONNX -> onnx2tf commonly preserves xywh in input-pixel units (0..640).
      // Detect the unit convention from the box channels, not the confidence channels.
      let coordinateValuesOutsideNormalizedRange = 0
      const totalBoxCoordinateValues = nDetections * 4
      for (let i = 0; i < nDetections; i++) {
        if (Math.abs(output[i]) > 2) coordinateValuesOutsideNormalizedRange++
        if (Math.abs(output[nDetections + i]) > 2) coordinateValuesOutsideNormalizedRange++
        if (Math.abs(output[2 * nDetections + i]) > 2) coordinateValuesOutsideNormalizedRange++
        if (Math.abs(output[3 * nDetections + i]) > 2) coordinateValuesOutsideNormalizedRange++
      }
      // A single corrupt/outlier box must not switch the interpretation for the
      // whole tensor. Pixel-coordinate exports have many values outside [-2, 2].
      const coordinatesAreNormalized =
        coordinateValuesOutsideNormalizedRange / totalBoxCoordinateValues < 0.01
      const coordinateScale = coordinatesAreNormalized ? TENSOR_SIZE : 1

      // Normalize thresholds to reference resolution 512
      // Fixed to 1.0 since boxes are normalized on frame and don't depend on tensor size
      const resolutionScale = 1.0

      // Convert coordinates from tensor space to camera-normalized space
      const convertFromLetterbox = (cx: number, cy: number, w: number, h: number) => {
        const cx_px = cx * coordinateScale
        const cy_px = cy * coordinateScale
        const w_px = w * coordinateScale
        const h_px = h * coordinateScale

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

        // Modello legacy TFLite ha già sigmoid integrata, usiamo i valori direttamente
        const ballProb = ballScore
        const humanProb = humanScore
        const rimProb = rimScore

        if (cameraW <= 0.01 || cameraH <= 0.01) continue

        const geometryCheck = this.isValidBallGeometry(cameraW, cameraH, frameAspect)
        const ballAdaptiveThreshold = this.getAdaptiveThreshold(cameraW, cameraH, this.adaptiveBallThreshold, resolutionScale)

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

        // Rim detection pipeline (skip if disabled)
        if (this.rimDetectionEnabled) {
          const effectiveRimThreshold = this.adaptiveRimThreshold
          if (rimProb >= effectiveRimThreshold && this.isValidRimGeometry(cameraW, cameraH, frameAspect)) {
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

          // Rim persistence: keep previous rim if new detection has lower confidence
          if (this.persistentRim && (!bestRim || bestRim.confidence < this.persistentRim.confidence)) {
            bestRim = this.persistentRim
          }
        }

        // Player detection pipeline with debug counters
        if (humanProb > 0) {
          rawCandidates++
          if (humanProb > bestConfidence) {
            bestConfidence = humanProb
          }
        }

        if (humanProb >= this.adaptivePlayerThreshold) {
          confidencePassed++
          if (!this.isValidPlayerGeometry(cameraW, cameraH, frameAspect)) continue
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
          // Rejected by confidence - track best rejected confidence
          if (humanProb > rejectedConfidence) {
            rejectedConfidence = humanProb
          }
        }
      }

      const avgSize = bestBall ? (bestBall.width + bestBall.height) / 2 : 0
      const ballSizeCategory = this.getBallSizeCategory(avgSize)
      const adaptiveThreshold = bestBall ? this.getAdaptiveThreshold(bestBall.width, bestBall.height, this.adaptiveBallThreshold, resolutionScale) : undefined

      const playerDebug: YoloPlayerDebug = {
        rawCandidates,
        confidencePassed,
        sizePassed,
        accepted: bestPlayer ? 1 : 0,
        bestConfidence,
        rejectedConfidence,
      }

      // Update adaptive thresholds based on detection results
      this.adaptiveBallThreshold = this.updateAdaptiveThreshold(
        bestBall !== null,
        bestBall?.confidence || null,
        this.ballDetectionHistory,
        this.ballConfidenceHistory,
        this.adaptiveBallThreshold,
        this.ballConfThreshold
      )

      this.adaptivePlayerThreshold = this.updateAdaptiveThreshold(
        bestPlayer !== null,
        bestPlayer?.confidence || null,
        this.playerDetectionHistory,
        this.playerConfidenceHistory,
        this.adaptivePlayerThreshold,
        this.playerConfThreshold
      )

      this.adaptiveRimThreshold = this.updateAdaptiveThreshold(
        bestRim !== null,
        bestRim?.confidence || null,
        this.rimDetectionHistory,
        this.rimConfidenceHistory,
        this.adaptiveRimThreshold,
        this.rimConfThreshold
      )

      // Update persistent rim if we found a better one
      if (bestRim) {
        this.persistentRim = bestRim
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

  // Reset persistent rim (call when starting new session or recalibrating)
  resetPersistentRim(): void {
    this.persistentRim = null
  }

  // Reset all state (call when starting new session)
  reset(): void {
    this.resetPersistentRim()
    this.resetAdaptiveState()
  }
}
