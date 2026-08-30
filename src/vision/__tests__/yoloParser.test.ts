// src/vision/__tests__/yoloParser.test.ts
//
// Unit tests for YOLO output parser
// Tests ball and rim detection from model outputs

import { parseYoloOutput } from '../yoloParser'

describe('parseYoloOutput', () => {
  const N_ANCHORS = 3549

  describe('ball detection', () => {
    it('should detect ball with high confidence', () => {
      // Simulate YOLO output with ball detection
      // Format: separate arrays for each parameter with N_ANCHORS elements
      const mockOutput = new Float32Array(N_ANCHORS * 6)
      const anchorIdx = 100
      mockOutput[anchorIdx] = 0.5 // cx
      mockOutput[N_ANCHORS + anchorIdx] = 0.5 // cy
      mockOutput[N_ANCHORS * 2 + anchorIdx] = 0.1 // w
      mockOutput[N_ANCHORS * 3 + anchorIdx] = 0.1 // h
      mockOutput[N_ANCHORS * 4 + anchorIdx] = 0.9 // ball score

      const threshold = 0.5
      const result = parseYoloOutput(mockOutput, threshold)

      expect(result.ball).toBeDefined()
      expect(result.ball?.confidence).toBeGreaterThan(threshold)
    })

    it('should filter low confidence detections', () => {
      const mockOutput = new Float32Array(N_ANCHORS * 6)
      const anchorIdx = 100
      mockOutput[anchorIdx] = 0.5
      mockOutput[N_ANCHORS + anchorIdx] = 0.5
      mockOutput[N_ANCHORS * 2 + anchorIdx] = 0.1
      mockOutput[N_ANCHORS * 3 + anchorIdx] = 0.1
      mockOutput[N_ANCHORS * 4 + anchorIdx] = 0.3 // Low confidence

      const threshold = 0.5
      const result = parseYoloOutput(mockOutput, threshold)

      expect(result.ball).toBeNull()
    })

    it('should return null when no ball detected', () => {
      const mockOutput = new Float32Array(N_ANCHORS * 6)
      const anchorIdx = 100
      mockOutput[anchorIdx] = 0.5
      mockOutput[N_ANCHORS + anchorIdx] = 0.5
      mockOutput[N_ANCHORS * 2 + anchorIdx] = 0.1
      mockOutput[N_ANCHORS * 3 + anchorIdx] = 0.1
      mockOutput[N_ANCHORS * 4 + anchorIdx] = 0.3 // Below threshold

      const threshold = 0.5
      const result = parseYoloOutput(mockOutput, threshold)

      expect(result.ball).toBeNull()
    })
  })

  describe('rim detection', () => {
    it('should detect rim with high confidence', () => {
      const mockOutput = new Float32Array(N_ANCHORS * 6)
      const anchorIdx = 100
      mockOutput[anchorIdx] = 0.4 // cx
      mockOutput[N_ANCHORS + anchorIdx] = 0.3 // cy
      mockOutput[N_ANCHORS * 2 + anchorIdx] = 0.15 // w
      mockOutput[N_ANCHORS * 3 + anchorIdx] = 0.15 // h
      mockOutput[N_ANCHORS * 5 + anchorIdx] = 0.85 // rim score

      const threshold = 0.5
      const result = parseYoloOutput(mockOutput, threshold)

      expect(result.rim).toBeDefined()
      expect(result.rim?.confidence).toBeGreaterThan(threshold)
    })

    it('should filter low confidence rim detections', () => {
      const mockOutput = new Float32Array(N_ANCHORS * 6)
      const anchorIdx = 100
      mockOutput[anchorIdx] = 0.4
      mockOutput[N_ANCHORS + anchorIdx] = 0.3
      mockOutput[N_ANCHORS * 2 + anchorIdx] = 0.15
      mockOutput[N_ANCHORS * 3 + anchorIdx] = 0.15
      mockOutput[N_ANCHORS * 5 + anchorIdx] = 0.4 // Low confidence

      const threshold = 0.5
      const result = parseYoloOutput(mockOutput, threshold)

      expect(result.rim).toBeNull()
    })
  })

  describe('multiple detections', () => {
    it('should handle both ball and rim in same output', () => {
      const mockOutput = new Float32Array(N_ANCHORS * 6)
      const ballIdx = 100
      const rimIdx = 200
      
      // Ball detection
      mockOutput[ballIdx] = 0.5
      mockOutput[N_ANCHORS + ballIdx] = 0.5
      mockOutput[N_ANCHORS * 2 + ballIdx] = 0.1
      mockOutput[N_ANCHORS * 3 + ballIdx] = 0.1
      mockOutput[N_ANCHORS * 4 + ballIdx] = 0.9
      
      // Rim detection
      mockOutput[rimIdx] = 0.4
      mockOutput[N_ANCHORS + rimIdx] = 0.3
      mockOutput[N_ANCHORS * 2 + rimIdx] = 0.15
      mockOutput[N_ANCHORS * 3 + rimIdx] = 0.15
      mockOutput[N_ANCHORS * 5 + rimIdx] = 0.85

      const threshold = 0.5
      const result = parseYoloOutput(mockOutput, threshold)

      expect(result.ball).toBeDefined()
      expect(result.rim).toBeDefined()
      expect(result.ball?.confidence).toBeGreaterThan(threshold)
      expect(result.rim?.confidence).toBeGreaterThan(threshold)
    })

    it('should select best ball detection when multiple present', () => {
      const mockOutput = new Float32Array(N_ANCHORS * 6)
      const ballIdx1 = 100
      const ballIdx2 = 200
      
      // Ball 1 (lower confidence)
      mockOutput[ballIdx1] = 0.5
      mockOutput[N_ANCHORS + ballIdx1] = 0.5
      mockOutput[N_ANCHORS * 2 + ballIdx1] = 0.1
      mockOutput[N_ANCHORS * 3 + ballIdx1] = 0.1
      mockOutput[N_ANCHORS * 4 + ballIdx1] = 0.7
      
      // Ball 2 (higher confidence)
      mockOutput[ballIdx2] = 0.6
      mockOutput[N_ANCHORS + ballIdx2] = 0.6
      mockOutput[N_ANCHORS * 2 + ballIdx2] = 0.1
      mockOutput[N_ANCHORS * 3 + ballIdx2] = 0.1
      mockOutput[N_ANCHORS * 4 + ballIdx2] = 0.9

      const threshold = 0.5
      const result = parseYoloOutput(mockOutput, threshold)

      expect(result.ball).toBeDefined()
      expect(result.ball?.confidence).toBeCloseTo(0.9)
    })
  })

  describe('edge cases', () => {
    it('should handle empty output', () => {
      const mockOutput = new Float32Array([])
      const threshold = 0.5
      const result = parseYoloOutput(mockOutput, threshold)

      expect(result.ball).toBeNull()
      expect(result.rim).toBeNull()
    })

    it('should handle output with only noise', () => {
      const mockOutput = new Float32Array(N_ANCHORS * 6)
      const noiseIdx1 = 100
      const noiseIdx2 = 200
      
      // Very low confidence detections
      mockOutput[noiseIdx1] = 0.1
      mockOutput[N_ANCHORS + noiseIdx1] = 0.1
      mockOutput[N_ANCHORS * 2 + noiseIdx1] = 0.05
      mockOutput[N_ANCHORS * 3 + noiseIdx1] = 0.05
      mockOutput[N_ANCHORS * 4 + noiseIdx1] = 0.1
      
      mockOutput[noiseIdx2] = 0.9
      mockOutput[N_ANCHORS + noiseIdx2] = 0.9
      mockOutput[N_ANCHORS * 2 + noiseIdx2] = 0.05
      mockOutput[N_ANCHORS * 3 + noiseIdx2] = 0.05
      mockOutput[N_ANCHORS * 5 + noiseIdx2] = 0.2

      const threshold = 0.5
      const result = parseYoloOutput(mockOutput, threshold)

      expect(result.ball).toBeNull()
      expect(result.rim).toBeNull()
    })
  })
})
