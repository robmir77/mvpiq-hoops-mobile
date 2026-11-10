// YoloDetector
// Pure class for YOLO detection parsing and filtering
// Worklet-safe, no React dependencies
// Extracted from yoloParserFloat16.ts

import { YOLO_CONFIG } from '@/config/appConfig'

const OUTPUT_CHANNELS = 7 // 4 box values + 3 class scores (ball, human, rim)
const STRIDES = [8, 16, 32]

// Shape/size priors (normalized to camera frame). Defaults mirror YOLO_CONFIG
// and only apply if a key is missing (e.g. partially mocked config in tests).
const GEO = {
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
  // Match the Python reference: rim decoding is disabled by default.
  private rimDetectionEnabled: boolean = false

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

  // Inference counter for diagnostics
  private inferenceCounter: number = 0

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
    // Match the Python AppCompatibleDecoder reference.
    this.minThreshold = 0.0005
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

  // Exact port of Python _size_threshold().
  private getAdaptiveThreshold(
    boxWidth: number,
    boxHeight: number,
    baseThreshold: number,
    minSize: number,
    maxSize: number,
    resolutionScale: number = 1.0
  ): number {
    const avgSize = (boxWidth + boxHeight) / 2
    const scaledMaxSize = maxSize * resolutionScale
    const scaledMinSize = minSize * resolutionScale

    if (avgSize >= scaledMaxSize) return baseThreshold

    let t = (avgSize - scaledMinSize) / (scaledMaxSize - scaledMinSize)
    if (t < 0) t = 0
    else if (t > 1) t = 1

    const smoothT = t * t * (3 - 2 * t)
    return 0.01 + (baseThreshold - 0.01) * smoothT
  }

  // Match Python _valid_ball_geometry(): aspect ratio only, without size priors.
  private isValidBallGeometry(width: number, height: number): { valid: boolean; aspectRatio: number } {
    if (width <= 0 || height <= 0) return { valid: false, aspectRatio: 0 }

    const aspectRatio = width / height
    return {
      valid: aspectRatio >= 0.25 && aspectRatio <= 4.0,
      aspectRatio,
    }
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

  // Validate output tensor schema
  // Returns true if tensor matches expected YOLO11 export format
  private validateOutputSchema(output: Float32Array): { valid: boolean; tensorSize?: number; nDetections?: number; error?: string } {
    const nDetections = Math.floor(output.length / OUTPUT_CHANNELS)

    // Check basic divisibility
    if (output.length % OUTPUT_CHANNELS !== 0) {
      return {
        valid: false,
        nDetections,
        error: `Output length ${output.length} is not divisible by OUTPUT_CHANNELS (${OUTPUT_CHANNELS})`
      }
    }

    // Check if nDetections matches known YOLO11 grid sizes
    const knownSizes: { [key: number]: number } = {
      2100: 320,   // 40² + 20² + 10²
      3024: 384,   // 48² + 24² + 12²
      4116: 448,   // 56² + 28² + 14²
      5376: 512,   // 64² + 32² + 16²
      8400: 640,   // 80² + 40² + 20²
    }

    const tensorSize = knownSizes[nDetections]
    if (!tensorSize) {
      return {
        valid: false,
        nDetections,
        error: `Unknown detection count ${nDetections}. Expected one of: ${Object.keys(knownSizes).join(', ')}`
      }
    }

    return { valid: true, tensorSize, nDetections }
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

    try {
      // Validate output schema
      const validation = this.validateOutputSchema(output)
      if (!validation.valid) {
        console.error('[YoloDetector] Invalid output tensor:', validation.error)
        return { ball: null, player: null, rim: null }
      }

      const TENSOR_SIZE = validation.tensorSize!
      const nDetections = validation.nDetections!

      let bestBall: { x: number; y: number; width: number; height: number; confidence: number } | null = null
      let bestPlayer: { x: number; y: number; width: number; height: number; confidence: number } | null = null
      let bestRim: { x: number; y: number; width: number; height: number; confidence: number } | null = null

      // Player debug counters
      let rawCandidates = 0
      let confidencePassed = 0
      let sizePassed = 0
      let bestConfidence = 0
      let rejectedConfidence = 0

      // Calculate letterboxing parameters
      const SCALE = Math.min(TENSOR_SIZE / effectiveFrameWidth, TENSOR_SIZE / effectiveFrameHeight)
      const RESIZED_WIDTH = effectiveFrameWidth * SCALE
      const RESIZED_HEIGHT = effectiveFrameHeight * SCALE
      const LETTERBOX_OFFSET_X = RESIZED_WIDTH < TENSOR_SIZE ? (TENSOR_SIZE - RESIZED_WIDTH) / 2 : 0
      const LETTERBOX_OFFSET_Y = RESIZED_HEIGHT < TENSOR_SIZE ? (TENSOR_SIZE - RESIZED_HEIGHT) / 2 : 0

      // Log letterbox calculation to verify orientation handling (every 100 frames)
      if (__DEV__ && nDetections % 8400 === 0) {
        console.log('[YoloDetector] Letterbox calculation', {
          TENSOR_SIZE,
          effectiveFrameWidth,
          effectiveFrameHeight,
          frameAspect,
          SCALE,
          RESIZED_WIDTH,
          RESIZED_HEIGHT,
          LETTERBOX_OFFSET_X,
          LETTERBOX_OFFSET_Y,
          note: 'Compare with Python reference preprocessing to verify orientation handling'
        })
      }

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

      // Log coordinate detection to verify model output format
      if (__DEV__ && nDetections % 8400 === 0) {
        console.log('[YoloDetector] Coordinate detection', {
          nDetections,
          coordinateValuesOutsideNormalizedRange,
          totalBoxCoordinateValues,
          coordinatesAreNormalized,
          coordinateScale,
          note: 'True = normalized (0-1), False = pixel units (0-TENSOR_SIZE). Compare with Python reference.'
        })
      }

      // Normalize thresholds to reference resolution 512
      // Aligned with Python reference: tensor_size / 512
      const resolutionScale = TENSOR_SIZE / 512

      // Ball detection diagnostic counters
      let ballRawCandidates = 0
      let ballBestRawConfidence = 0
      let ballConfidencePassed = 0
      let ballGeometryPassed = 0
      let ballRejectedConfidence = 0
      let ballRejectedSize = 0
      let ballRejectedAspectRatio = 0
      let ballRejectedCoordinates = 0

      // DIAGNOSTIC: Track all candidates with score 1.0 for frame 85
      let ballCandidatesWithScore1: { index: number; confidence: number; x: number; y: number; width: number; height: number }[] = []

      // Inference counter for diagnostics (persist across calls)
      if (!this.inferenceCounter) {
        this.inferenceCounter = 0
      }
      this.inferenceCounter++

      // DIAGNOSTIC: Log adaptive threshold before parsing for frame 85
      if (__DEV__ && this.inferenceCounter === 85) {
        console.log('[YoloDetector] FRAME 85 DIAGNOSTIC - Before parsing', {
          inferenceCounter: this.inferenceCounter,
          adaptiveBallThreshold: this.adaptiveBallThreshold,
          adaptivePlayerThreshold: this.adaptivePlayerThreshold,
          baseBallThreshold: this.ballConfThreshold,
          ballDetectionHistory: this.ballDetectionHistory,
          ballConfidenceHistory: this.ballConfidenceHistory,
          note: 'Compare with Python decoder state after 84 frames'
        })
      }

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

        // Ball detection diagnostics
        if (ballProb > 0) {
          ballRawCandidates++
          if (ballProb > ballBestRawConfidence) {
            ballBestRawConfidence = ballProb
          }
        }

        if (cameraW <= 0.01 || cameraH <= 0.01) {
          ballRejectedCoordinates++
          continue
        }

        const geometryCheck = this.isValidBallGeometry(cameraW, cameraH)
        const ballAdaptiveThreshold = this.getAdaptiveThreshold(
          cameraW, cameraH, this.adaptiveBallThreshold, 0.10, 0.40, resolutionScale
        )

        if (!geometryCheck.valid) {
          if (geometryCheck.aspectRatio < 0.25 || geometryCheck.aspectRatio > 4.0) {
            ballRejectedAspectRatio++
          } else {
            ballRejectedSize++
          }
        }

        if (ballProb >= ballAdaptiveThreshold) {
          ballConfidencePassed++
          if (geometryCheck.valid) {
            ballGeometryPassed++
            const detection = {
              x: cameraCx,
              y: cameraCy,
              width: cameraW,
              height: cameraH,
              confidence: ballProb,
            }
            if (!bestBall || detection.confidence > bestBall.confidence) {
              bestBall = detection
              // DEBUG: Log anchor index when best ball is updated
              if (__DEV__ && i % 100 === 0) {
                console.log('[YoloDetector] Best ball updated', {
                  anchorIndex: i,
                  x: detection.x,
                  y: detection.y,
                  width: detection.width,
                  height: detection.height,
                  confidence: detection.confidence
                })
              }
            }

            // DIAGNOSTIC: Track candidates with score 1.0 for frame 85
            if (__DEV__ && this.inferenceCounter === 85 && ballProb >= 0.9999) {
              ballCandidatesWithScore1.push({
                index: i,
                confidence: ballProb,
                x: cameraCx,
                y: cameraCy,
                width: cameraW,
                height: cameraH
              })
            }
          }
        } else {
          if (ballProb > ballRejectedConfidence) {
            ballRejectedConfidence = ballProb
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
          // Python decoder applies no additional player geometry filter.
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

      // Python applies this second ball threshold only after choosing the best
      // candidate. If it fails, do not fall back to the runner-up.
      let finalBall = bestBall
      if (bestBall) {
        const postSelectionThreshold = this.getAdaptiveThreshold(
          bestBall.width, bestBall.height, 0.005, 0.01, 0.30, 1.0
        )
        if (bestBall.confidence < postSelectionThreshold) {
          finalBall = null
        }
      }

      const avgSize = finalBall ? (finalBall.width + finalBall.height) / 2 : 0
      const ballSizeCategory = this.getBallSizeCategory(avgSize)
      const adaptiveThreshold = bestBall
        ? this.getAdaptiveThreshold(bestBall.width, bestBall.height, this.adaptiveBallThreshold, 0.10, 0.40, resolutionScale)
        : undefined

      const playerDebug: YoloPlayerDebug = {
        rawCandidates,
        confidencePassed,
        sizePassed,
        accepted: bestPlayer ? 1 : 0,
        bestConfidence,
        rejectedConfidence,
      }

      // Ball detection diagnostics log (every 50 inferences to avoid spam)
      if (__DEV__ && this.inferenceCounter % 50 === 0) {
        console.log('[YoloDetector] Ball detection diagnostics', {
          inferenceCounter: this.inferenceCounter,
          anchorsAnalyzed: nDetections,
          ballRawCandidates,
          ballBestRawConfidence,
          ballConfidencePassed,
          ballGeometryPassed,
          ballRejectedConfidence,
          ballRejectedSize,
          ballRejectedAspectRatio,
          ballRejectedCoordinates,
          acceptedBall: bestBall ? 1 : 0,
          adaptiveBallThreshold: this.adaptiveBallThreshold,
          baseBallThreshold: this.ballConfThreshold,
          resolutionScale,
          bestBallWidth: bestBall?.width,
          bestBallHeight: bestBall?.height,
          bestBallAspectRatio: bestBall ? bestBall.width / bestBall.height : 0,
          note: 'Track where ball detections are rejected: confidence, size, aspect ratio, or coordinates'
        })
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

      // DEBUG: Log final ball coordinates
      if (__DEV__ && this.inferenceCounter % 100 === 0) {
        console.log('[YoloDetector] Final ball coordinates', {
          inferenceCounter: this.inferenceCounter,
          finalBall: finalBall,
          bestBall: bestBall,
          postSelectionThreshold: bestBall ? this.getAdaptiveThreshold(bestBall.width, bestBall.height, 0.005, 0.01, 0.30, 1.0) : null,
          note: 'Compare with Best ball updated log to see if post-selection threshold changed the anchor'
        })
      }

      // DIAGNOSTIC: Log frame 85 detailed results
      if (__DEV__ && this.inferenceCounter === 85) {
        console.log('[YoloDetector] FRAME 85 DIAGNOSTIC - After parsing', {
          inferenceCounter: this.inferenceCounter,
          finalBall: finalBall,
          bestBall: bestBall,
          bestPlayer: bestPlayer,
          ballCandidatesWithScore1: ballCandidatesWithScore1,
          ballCandidatesWithScore1Count: ballCandidatesWithScore1.length,
          postSelectionThreshold: bestBall ? this.getAdaptiveThreshold(bestBall.width, bestBall.height, 0.005, 0.01, 0.30, 1.0) : null,
          adaptiveBallThresholdAfter: this.adaptiveBallThreshold,
          note: 'Compare with Python decoder - check if same anchor wins with same adaptive threshold'
        })
      }

      return {
        ball: finalBall,
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
    this.inferenceCounter = 0
  }
}
