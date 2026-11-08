// src/vision/__tests__/yoloParser.test.ts
//
// Unit tests for YOLO output parser
// Tests ball and rim detection from model outputs

import { YoloDetector } from '../engine/YoloDetector'

jest.mock('@/config/appConfig', () => ({
  VISION_CONFIG: { RIM_DETECTION_ENABLED: true },
  YOLO_CONFIG: {
    BALL_CONF_THRESHOLD: 0.05,
    RIM_CONF_THRESHOLD: 0.10,
    PLAYER_CONF_THRESHOLD: 0.01,
    PLAYER_CROP_MIN_CONFIDENCE: 0.05,
    NMS_IOU_THRESHOLD: 0.4,
    PLAYER_MIN_WIDTH: 0.05,
    PLAYER_MIN_HEIGHT: 0.1,
    PLAYER_MAX_WIDTH: 0.6,
    PLAYER_MIN_ASPECT: 0.8,
    PLAYER_MAX_ASPECT: 6.0,
    BALL_MIN_SIZE: 0.008,
    BALL_MAX_SIDE: 0.15,
    BALL_MAX_BBOX_SIZE: 0.15,
    BALL_MIN_ASPECT: 0.6,
    BALL_MAX_ASPECT: 1.7,
    RIM_MIN_WIDTH: 0.015,
    RIM_MAX_WIDTH: 0.25,
    RIM_MIN_ASPECT: 0.7,
    RIM_MAX_ASPECT: 6.0,
    ADAPTIVE_CONF: {
      ENABLED: true,
      WINDOW_SIZE: 15,
      MIN_THRESHOLD: 0.03,
      MAX_THRESHOLD: 0.50,
      ADJUSTMENT_FACTOR: 0.2,
      HIGH_CONF_THRESHOLD: 0.7,
      LOW_CONF_THRESHOLD: 0.2,
    },
  },
}))

describe('YoloDetector', () => {
  const N_ANCHORS = 3549
  const OUTPUT_CHANNELS = 7 // 4 box values + 3 class scores (ball, human, rim)

  describe('pixel-coordinate exports', () => {
    it('should parse ONNX-to-TFLite xywh values expressed in input pixels', () => {
      const anchors = 8400 // 640x640 YOLO output
      const mockOutput = new Float32Array(anchors * OUTPUT_CHANNELS)
      const idx = 100

      // Real pixel-unit exports have box values far outside [-2, 2] on most
      // anchors (the parser needs >1% of them to switch convention), so fill
      // every anchor with a pixel-scale box and zero scores.
      for (let a = 0; a < anchors; a++) {
        mockOutput[a] = 320
        mockOutput[anchors + a] = 320
        mockOutput[anchors * 2 + a] = 40
        mockOutput[anchors * 3 + a] = 40
      }

      // New export convention: xywh are pixels in the 640x640 input tensor,
      // while class scores remain probabilities.
      mockOutput[idx] = 320
      mockOutput[anchors + idx] = 320
      mockOutput[anchors * 2 + idx] = 40
      mockOutput[anchors * 3 + idx] = 40
      mockOutput[anchors * 4 + idx] = 0.9
      mockOutput[anchors * 5 + idx] = 0.1
      mockOutput[anchors * 6 + idx] = 0.1

      const detector = new YoloDetector(0.05, 0.10)
      const result = detector.parseOutput(mockOutput, 1280, 720)

      expect(result.ball).not.toBeNull()
      expect(result.ball?.x).toBeCloseTo(0.5, 3)
      expect(result.ball?.y).toBeCloseTo(0.5, 3)
      expect(result.ball?.width).toBeCloseTo(0.0625, 3)
      expect(result.ball?.height).toBeCloseTo(0.11111, 3)
    })
  })

  describe('ball detection', () => {
    it('should detect ball with high confidence', () => {
      // Simulate YOLO output with ball detection
      // Format: separate arrays for each parameter with N_ANCHORS elements
      // Layout: [cx, cy, w, h, ball_score, human_score, rim_score] for each anchor
      const mockOutput = new Float32Array(N_ANCHORS * OUTPUT_CHANNELS)
      const anchorIdx = 100
      mockOutput[anchorIdx] = 0.5 // cx
      mockOutput[N_ANCHORS + anchorIdx] = 0.5 // cy
      mockOutput[N_ANCHORS * 2 + anchorIdx] = 0.1 // w
      mockOutput[N_ANCHORS * 3 + anchorIdx] = 0.1 // h
      mockOutput[N_ANCHORS * 4 + anchorIdx] = 0.9 // ball score
      mockOutput[N_ANCHORS * 5 + anchorIdx] = 0.1 // human score
      mockOutput[N_ANCHORS * 6 + anchorIdx] = 0.1 // rim score

      const detector = new YoloDetector(0.05, 0.10)
      const result = detector.parseOutput(mockOutput, 1280, 720)

      expect(result.ball).toBeDefined()
      expect(result.ball?.confidence).toBeGreaterThan(0.05)
    })

    it('should filter low confidence detections', () => {
      const mockOutput = new Float32Array(N_ANCHORS * OUTPUT_CHANNELS)
      const anchorIdx = 100
      mockOutput[anchorIdx] = 0.5
      mockOutput[N_ANCHORS + anchorIdx] = 0.5
      mockOutput[N_ANCHORS * 2 + anchorIdx] = 0.1
      mockOutput[N_ANCHORS * 3 + anchorIdx] = 0.1
      mockOutput[N_ANCHORS * 4 + anchorIdx] = 0.0001 // Very low confidence (below threshold)
      mockOutput[N_ANCHORS * 5 + anchorIdx] = 0.1
      mockOutput[N_ANCHORS * 6 + anchorIdx] = 0.1

      const detector = new YoloDetector(0.05, 0.10)
      const result = detector.parseOutput(mockOutput, 1280, 720)

      // Confidence 0.0001 is below threshold, should be filtered
      expect(result.ball).toBeNull()
    })

    it('should return null when no ball detected', () => {
      const mockOutput = new Float32Array(N_ANCHORS * OUTPUT_CHANNELS)
      const anchorIdx = 100
      mockOutput[anchorIdx] = 0.5
      mockOutput[N_ANCHORS + anchorIdx] = 0.5
      mockOutput[N_ANCHORS * 2 + anchorIdx] = 0.1
      mockOutput[N_ANCHORS * 3 + anchorIdx] = 0.1
      mockOutput[N_ANCHORS * 4 + anchorIdx] = 0.0001 // Below threshold
      mockOutput[N_ANCHORS * 5 + anchorIdx] = 0.1
      mockOutput[N_ANCHORS * 6 + anchorIdx] = 0.1

      const detector = new YoloDetector(0.05, 0.10)
      const result = detector.parseOutput(mockOutput, 1280, 720)

      expect(result.ball).toBeNull()
    })
  })

  describe('rim detection', () => {
    it('should detect rim with high confidence', () => {
      const mockOutput = new Float32Array(N_ANCHORS * OUTPUT_CHANNELS)
      const anchorIdx = 100
      mockOutput[anchorIdx] = 0.4 // cx
      mockOutput[N_ANCHORS + anchorIdx] = 0.3 // cy
      mockOutput[N_ANCHORS * 2 + anchorIdx] = 0.15 // w
      mockOutput[N_ANCHORS * 3 + anchorIdx] = 0.15 // h
      mockOutput[N_ANCHORS * 4 + anchorIdx] = 0.1 // ball score
      mockOutput[N_ANCHORS * 5 + anchorIdx] = 0.1 // human score
      mockOutput[N_ANCHORS * 6 + anchorIdx] = 0.85 // rim score

      const detector = new YoloDetector(0.05, 0.10)
      const result = detector.parseOutput(mockOutput, 1280, 720)

      expect(result.rim).toBeDefined()
      expect(result.rim?.confidence).toBeGreaterThan(0.10)
    })

    it('should filter low confidence rim detections', () => {
      const mockOutput = new Float32Array(N_ANCHORS * OUTPUT_CHANNELS)
      const anchorIdx = 100
      mockOutput[anchorIdx] = 0.4
      mockOutput[N_ANCHORS + anchorIdx] = 0.3
      mockOutput[N_ANCHORS * 2 + anchorIdx] = 0.15
      mockOutput[N_ANCHORS * 3 + anchorIdx] = 0.15
      mockOutput[N_ANCHORS * 4 + anchorIdx] = 0.1
      mockOutput[N_ANCHORS * 5 + anchorIdx] = 0.1
      mockOutput[N_ANCHORS * 6 + anchorIdx] = 0.05 // Low confidence (below 0.10 threshold)

      const detector = new YoloDetector(0.05, 0.10)
      const result = detector.parseOutput(mockOutput, 1280, 720)

      expect(result.rim).toBeNull()
    })
  })

  describe('multiple detections', () => {
    it('should handle both ball and rim in same output', () => {
      const mockOutput = new Float32Array(N_ANCHORS * OUTPUT_CHANNELS)
      const ballIdx = 100
      const rimIdx = 200

      // Ball detection
      mockOutput[ballIdx] = 0.5
      mockOutput[N_ANCHORS + ballIdx] = 0.5
      mockOutput[N_ANCHORS * 2 + ballIdx] = 0.1
      mockOutput[N_ANCHORS * 3 + ballIdx] = 0.1
      mockOutput[N_ANCHORS * 4 + ballIdx] = 0.9
      mockOutput[N_ANCHORS * 5 + ballIdx] = 0.1
      mockOutput[N_ANCHORS * 6 + ballIdx] = 0.1

      // Rim detection
      mockOutput[rimIdx] = 0.4
      mockOutput[N_ANCHORS + rimIdx] = 0.3
      mockOutput[N_ANCHORS * 2 + rimIdx] = 0.15
      mockOutput[N_ANCHORS * 3 + rimIdx] = 0.15
      mockOutput[N_ANCHORS * 4 + rimIdx] = 0.1
      mockOutput[N_ANCHORS * 5 + rimIdx] = 0.1
      mockOutput[N_ANCHORS * 6 + rimIdx] = 0.85

      const detector = new YoloDetector(0.05, 0.10)
      const result = detector.parseOutput(mockOutput, 1280, 720)

      expect(result.ball).toBeDefined()
      expect(result.rim).toBeDefined()
      expect(result.ball?.confidence).toBeGreaterThan(0.05)
      expect(result.rim?.confidence).toBeGreaterThan(0.10)
    })

    it('should select best ball detection when multiple present', () => {
      const mockOutput = new Float32Array(N_ANCHORS * OUTPUT_CHANNELS)
      const ballIdx1 = 100
      const ballIdx2 = 200

      // Ball 1 (lower confidence)
      mockOutput[ballIdx1] = 0.5
      mockOutput[N_ANCHORS + ballIdx1] = 0.5
      mockOutput[N_ANCHORS * 2 + ballIdx1] = 0.1
      mockOutput[N_ANCHORS * 3 + ballIdx1] = 0.1
      mockOutput[N_ANCHORS * 4 + ballIdx1] = 0.7
      mockOutput[N_ANCHORS * 5 + ballIdx1] = 0.1
      mockOutput[N_ANCHORS * 6 + ballIdx1] = 0.1

      // Ball 2 (higher confidence)
      mockOutput[ballIdx2] = 0.6
      mockOutput[N_ANCHORS + ballIdx2] = 0.6
      mockOutput[N_ANCHORS * 2 + ballIdx2] = 0.1
      mockOutput[N_ANCHORS * 3 + ballIdx2] = 0.1
      mockOutput[N_ANCHORS * 4 + ballIdx2] = 0.9
      mockOutput[N_ANCHORS * 5 + ballIdx2] = 0.1
      mockOutput[N_ANCHORS * 6 + ballIdx2] = 0.1

      const detector = new YoloDetector(0.05, 0.10)
      const result = detector.parseOutput(mockOutput, 1280, 720)

      expect(result.ball).toBeDefined()
      expect(result.ball?.confidence).toBeCloseTo(0.9)
    })
  })

  describe('edge cases', () => {
    it('should handle empty output', () => {
      const mockOutput = new Float32Array([])
      const detector = new YoloDetector(0.5, 0.5)
      const result = detector.parseOutput(mockOutput, 1280, 720)

      expect(result.ball).toBeNull()
      expect(result.rim).toBeNull()
    })

    it('should handle output with only noise', () => {
      const mockOutput = new Float32Array(N_ANCHORS * OUTPUT_CHANNELS)
      const noiseIdx1 = 100
      const noiseIdx2 = 200

      // Very low confidence detections (below 0.001 threshold)
      mockOutput[noiseIdx1] = 0.1
      mockOutput[N_ANCHORS + noiseIdx1] = 0.1
      mockOutput[N_ANCHORS * 2 + noiseIdx1] = 0.05
      mockOutput[N_ANCHORS * 3 + noiseIdx1] = 0.05
      mockOutput[N_ANCHORS * 4 + noiseIdx1] = 0.0001 // Below ball threshold
      mockOutput[N_ANCHORS * 5 + noiseIdx1] = 0.1
      mockOutput[N_ANCHORS * 6 + noiseIdx1] = 0.05 // Below rim threshold

      mockOutput[noiseIdx2] = 0.9
      mockOutput[N_ANCHORS + noiseIdx2] = 0.9
      mockOutput[N_ANCHORS * 2 + noiseIdx2] = 0.05
      mockOutput[N_ANCHORS * 3 + noiseIdx2] = 0.05
      mockOutput[N_ANCHORS * 4 + noiseIdx2] = 0.0001 // Below ball threshold
      mockOutput[N_ANCHORS * 5 + noiseIdx2] = 0.1
      mockOutput[N_ANCHORS * 6 + noiseIdx2] = 0.05 // Below rim threshold

      const detector = new YoloDetector(0.05, 0.10)
      const result = detector.parseOutput(mockOutput, 1280, 720)

      expect(result.ball).toBeNull()
      expect(result.rim).toBeNull()
    })
  })

  describe('false-positive rejection', () => {
    const N = 3549 // unknown anchor count -> 512 tensor, 16:9 frame
    const put = (
      out: Float32Array,
      i: number,
      cx: number, cy: number, w: number, h: number,
      ball: number, human: number, rim: number
    ) => {
      out[i] = cx; out[N + i] = cy; out[2 * N + i] = w; out[3 * N + i] = h
      out[4 * N + i] = ball; out[5 * N + i] = human; out[6 * N + i] = rim
    }

    it('rejects a ball whose score is only noise-level (0.01 below 0.05 threshold)', () => {
      const out = new Float32Array(N * 7)
      put(out, 100, 0.5, 0.5, 0.1, 0.1, 0.01, 0, 0)
      expect(new YoloDetector(0.05, 0.10).parseOutput(out, 1280, 720).ball).toBeNull()
    })

    it('rejects a ball box that is far too elongated (e.g. a fence post)', () => {
      const out = new Float32Array(N * 7)
      put(out, 100, 0.5, 0.5, 0.03, 0.2, 0.9, 0, 0)
      expect(new YoloDetector(0.05, 0.10).parseOutput(out, 1280, 720).ball).toBeNull()
    })

    it('rejects a ball box that is larger than a plausible ball', () => {
      const out = new Float32Array(N * 7)
      put(out, 100, 0.5, 0.5, 0.35, 0.35, 0.9, 0, 0)
      expect(new YoloDetector(0.05, 0.10).parseOutput(out, 1280, 720).ball).toBeNull()
    })

    it('rejects a wide, short "player" box (tree line / wall) but accepts a standing person', () => {
      const wide = new Float32Array(N * 7)
      put(wide, 100, 0.5, 0.5, 0.3, 0.1, 0, 0.9, 0)
      expect(new YoloDetector(0.05, 0.10).parseOutput(wide, 1280, 720).player).toBeNull()

      const person = new Float32Array(N * 7)
      put(person, 100, 0.5, 0.5, 0.1, 0.45, 0, 0.9, 0)
      const res = new YoloDetector(0.05, 0.10).parseOutput(person, 1280, 720)
      expect(res.player).not.toBeNull()
      expect(res.player?.confidence).toBeCloseTo(0.9)
    })

    it('rejects a very tall, thin rim candidate (lamp post)', () => {
      const out = new Float32Array(N * 7)
      put(out, 100, 0.5, 0.2, 0.03, 0.4, 0, 0, 0.9)
      const det = new YoloDetector(0.05, 0.10)
      det.setRimDetectionEnabled(true)
      expect(det.parseOutput(out, 1280, 720).rim).toBeNull()
    })

    it('does not let the adaptive threshold relax into the noise range after many empty frames', () => {
      const det = new YoloDetector(0.05, 0.10)
      const empty = new Float32Array(N * 7)
      for (let i = 0; i < 60; i++) det.parseOutput(empty, 1280, 720)
      expect(det.getAdaptiveThresholds().ball).toBeGreaterThanOrEqual(0.03)
      expect(det.getAdaptiveThresholds().player).toBeGreaterThanOrEqual(0.03)

      const noise = new Float32Array(N * 7)
      put(noise, 100, 0.5, 0.5, 0.1, 0.1, 0.01, 0.005, 0.05)
      const res = det.parseOutput(noise, 1280, 720)
      expect(res.ball).toBeNull()
      expect(res.player).toBeNull()
    })
  })
})
