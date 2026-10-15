// PlayerTrackingEngine.test.ts
// Phase 4.2: Deterministic equivalence tests for PlayerTrackingEngine
// Verifies that the new engine produces identical results to legacy player logic

import { PlayerTrackingEngine } from '../PlayerTrackingEngine'

describe('PlayerTrackingEngine', () => {
  let engine: PlayerTrackingEngine

  beforeEach(() => {
    engine = new PlayerTrackingEngine()
  })

  describe('Player Update', () => {
    it('should update state with detection data', () => {
      const frameTs = 1000
      
      engine.update(0.3, 0.2, 0.4, 0.6, 0.9, frameTs)
      
      const state = engine.getState()
      expect(state.x).toBe(0.3)
      expect(state.y).toBe(0.2)
      expect(state.width).toBe(0.4)
      expect(state.height).toBe(0.6)
      expect(state.confidence).toBe(0.9)
    })

    it('should track validity correctly', () => {
      const frameTs = 1000
      
      expect(engine.isValid()).toBe(false)
      
      engine.update(0.3, 0.2, 0.4, 0.6, 0.9, frameTs)
      
      expect(engine.isValid()).toBe(true)
    })
  })

  describe('Player Center from Pose', () => {
    it('should calculate center from hip keypoints', () => {
      const poseKeypoints = {
        leftHip: { x: 0.3, y: 0.5 },
        rightHip: { x: 0.35, y: 0.5 },
      }
      
      const center = engine.updateFromPose(poseKeypoints)
      
      expect(center).not.toBeNull()
      expect(center!.x).toBeCloseTo(0.325, 6)
      expect(center!.y).toBeCloseTo(0.5, 6)
    })

    it('should return null when keypoints missing', () => {
      const center1 = engine.updateFromPose(null)
      expect(center1).toBeNull()
      
      const center2 = engine.updateFromPose({})
      expect(center2).toBeNull()
      
      const center3 = engine.updateFromPose({ leftHip: { x: 0.3, y: 0.5 } })
      expect(center3).toBeNull()
    })
  })

  describe('Player Predict', () => {
    it('should return last known position before TTL', () => {
      const frameTs = 1000
      const PLAYER_TRACK_TTL_MS = 1000
      
      engine.update(0.3, 0.2, 0.4, 0.6, 0.9, frameTs)
      
      const prediction = engine.predict(frameTs + 500)
      expect(prediction).not.toBeNull()
      expect(prediction!.x).toBe(0.3)
      expect(prediction!.y).toBe(0.2)
    })

    it('should return null after TTL expires', () => {
      const frameTs = 1000
      const PLAYER_TRACK_TTL_MS = 1000
      
      engine.update(0.3, 0.2, 0.4, 0.6, 0.9, frameTs)
      
      const prediction = engine.predict(frameTs + PLAYER_TRACK_TTL_MS + 100)
      expect(prediction).toBeNull()
    })
  })

  describe('State Management', () => {
    it('should reset correctly', () => {
      const frameTs = 1000
      
      engine.update(0.3, 0.2, 0.4, 0.6, 0.9, frameTs)
      
      engine.reset()
      
      const state = engine.getState()
      expect(state.x).toBe(0)
      expect(state.y).toBe(0)
      expect(state.confidence).toBe(0)
      expect(engine.isValid()).toBe(false)
    })
  })

  describe('Equivalence with Legacy', () => {
    it('should match legacy player center calculation', () => {
      // Reference: useTrackingEngine.ts lines 317-323
      const poseKeypoints = {
        leftHip: { x: 0.3, y: 0.5 },
        rightHip: { x: 0.35, y: 0.5 },
      }
      
      const center = engine.updateFromPose(poseKeypoints)
      
      // Legacy: (leftHip.x + rightHip.x) / 2, (leftHip.y + rightHip.y) / 2
      const expectedX = (0.3 + 0.35) / 2
      const expectedY = (0.5 + 0.5) / 2
      
      expect(center!.x).toBeCloseTo(expectedX, 6)
      expect(center!.y).toBeCloseTo(expectedY, 6)
    })
  })
})
