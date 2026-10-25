// src/vision/__tests__/yoloParser.test.ts
//
// Unit tests for YOLO output parser
// Tests ball and rim detection from model outputs

import { YoloDetector } from '../engine/YoloDetector'

jest.mock('@/config/appConfig', () => ({
  YOLO_CONFIG: {
    BALL_CONF_THRESHOLD: 0.001,
    RIM_CONF_THRESHOLD: 0.30,
    PLAYER_CONF_THRESHOLD: 0.03,
    PLAYER_CROP_MIN_CONFIDENCE: 0.05,
    NMS_IOU_THRESHOLD: 0.4,
    PLAYER_MIN_WIDTH: 0.05,
    PLAYER_MIN_HEIGHT: 0.1,
    BALL_MAX_BBOX_SIZE: 0.15,
    ADAPTIVE_CONF: {
      ENABLED: true,
      WINDOW_SIZE: 15,
      MIN_THRESHOLD: 0.0005,
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

      // New export convention: xywh are pixels in the 640x640 input tensor,
      // while class scores remain probabilities.
      mockOutput[idx] = 320
      mockOutput[anchors + idx] = 320
      mockOutput[anchors * 2 + idx] = 100
      mockOutput[anchors * 3 + idx] = 100
      mockOutput[anchors * 4 + idx] = 0.9
      mockOutput[anchors * 5 + idx] = 0.1
      mockOutput[anchors * 6 + idx] = 0.1

      const detector = new YoloDetector(0.001, 0.30)
      const result = detector.parseOutput(mockOutput, 1280, 720)

      expect(result.ball).not.toBeNull()
      expect(result.ball?.x).toBeCloseTo(0.5, 3)
      expect(result.ball?.y).toBeCloseTo(0.5, 3)
      expect(result.ball?.width).toBeCloseTo(0.15625, 3)
      expect(result.ball?.height).toBeCloseTo(0.27778, 3)
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

      const detector = new YoloDetector(0.001, 0.30)
      const result = detector.parseOutput(mockOutput, 1280, 720)

      expect(result.ball).toBeDefined()
      expect(result.ball?.confidence).toBeGreaterThan(0.001)
    })

    it('should filter low confidence detections', () => {
      const mockOutput = new Float32Array(N_ANCHORS * OUTPUT_CHANNELS)
      const anchorIdx = 100
      mockOutput[anchorIdx] = 0.5
      mockOutput[N_ANCHORS + anchorIdx] = 0.5
      mockOutput[N_ANCHORS * 2 + anchorIdx] = 0.1
      mockOutput[N_ANCHORS * 3 + anchorIdx] = 0.1
      mockOutput[N_ANCHORS * 4 + anchorIdx] = 0.0001 // Very low confidence (below 0.001 threshold)
      mockOutput[N_ANCHORS * 5 + anchorIdx] = 0.1
      mockOutput[N_ANCHORS * 6 + anchorIdx] = 0.1

      const detector = new YoloDetector(0.001, 0.30)
      const result = detector.parseOutput(mockOutput, 1280, 720)

      // Confidence 0.0001 is below threshold 0.001, should be filtered
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

      const detector = new YoloDetector(0.001, 0.30)
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

      const detector = new YoloDetector(0.001, 0.30)
      const result = detector.parseOutput(mockOutput, 1280, 720)

      expect(result.rim).toBeDefined()
      expect(result.rim?.confidence).toBeGreaterThan(0.30)
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
      mockOutput[N_ANCHORS * 6 + anchorIdx] = 0.2 // Low confidence (below 0.30 threshold)

      const detector = new YoloDetector(0.001, 0.30)
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

      const detector = new YoloDetector(0.001, 0.30)
      const result = detector.parseOutput(mockOutput, 1280, 720)

      expect(result.ball).toBeDefined()
      expect(result.rim).toBeDefined()
      expect(result.ball?.confidence).toBeGreaterThan(0.001)
      expect(result.rim?.confidence).toBeGreaterThan(0.30)
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

      const detector = new YoloDetector(0.001, 0.30)
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
      mockOutput[N_ANCHORS * 6 + noiseIdx1] = 0.1

      mockOutput[noiseIdx2] = 0.9
      mockOutput[N_ANCHORS + noiseIdx2] = 0.9
      mockOutput[N_ANCHORS * 2 + noiseIdx2] = 0.05
      mockOutput[N_ANCHORS * 3 + noiseIdx2] = 0.05
      mockOutput[N_ANCHORS * 4 + noiseIdx2] = 0.0001 // Below ball threshold
      mockOutput[N_ANCHORS * 5 + noiseIdx2] = 0.1
      mockOutput[N_ANCHORS * 6 + noiseIdx2] = 0.1 // Below rim threshold

      const detector = new YoloDetector(0.001, 0.30)
      const result = detector.parseOutput(mockOutput, 1280, 720)

      expect(result.ball).toBeNull()
      expect(result.rim).toBeNull()
    })
  })
})
