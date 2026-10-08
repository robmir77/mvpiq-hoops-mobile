// BallTrackingEngine.test.ts
// Kalman v2: Adaptive gain + outlier detection tests

import { BallTrackingEngine } from '../BallTrackingEngine'
import { KALMAN_CONFIG } from '../BallTrackingState'

describe('BallTrackingEngine - Kalman v2', () => {
  let engine: BallTrackingEngine

  beforeEach(() => {
    engine = new BallTrackingEngine()
  })

  describe('Perfect Detection', () => {
    it('should accept first detection unconditionally to initialize tracking', () => {
      const frameTs = 1000
      
      // First detection (no prior tracking)
      const result = engine.update(0.9, 0.8, frameTs)
      
      // Should accept even if far from initial (0,0) prediction
      expect(result.x).toBeCloseTo(0.9, 2)
      expect(result.y).toBeCloseTo(0.8, 2)
      
      const state = engine.getState()
      expect(state.trackState).toBe('DETECTED')
      expect(state.ballRejectionReason).toBe('')
    })

    it('should follow YOLO detection closely with high gain', () => {
      const frameTs = 1000
      
      // First detection establishes position
      engine.update(0.5, 0.4, frameTs)
      
      // Second detection very close to prediction (perfect detection)
      const result = engine.update(0.501, 0.401, frameTs + 16)
      
      // With perfect gain (0.95), should follow YOLO very closely
      expect(result.x).toBeCloseTo(0.501, 2)
      expect(result.y).toBeCloseTo(0.401, 2)
      
      const state = engine.getState()
      expect(state.trackState).toBe('DETECTED')
      expect(state.ballRejectionReason).toBe('')
    })
  })

  describe('Noisy Detection', () => {
    it('should apply moderate smoothing for noisy detections', () => {
      const frameTs = 1000
      
      // Establish position and velocity
      engine.update(0.5, 0.4, frameTs)
      engine.update(0.6, 0.3, frameTs + 16)
      
      // Noisy detection (moderate distance from prediction)
      const result = engine.update(0.65, 0.25, frameTs + 32)
      
      // Should smooth but still follow direction
      expect(result.x).toBeGreaterThan(0.6)
      expect(result.x).toBeLessThan(0.65)
      
      const state = engine.getState()
      expect(state.trackState).toBe('DETECTED')
    })
  })

  describe('Outlier Detection', () => {
    it('should reject outlier measurements', () => {
      const frameTs = 1000
      
      // Establish position
      engine.update(0.5, 0.4, frameTs)
      
      // Outlier detection (far from prediction)
      const result = engine.update(0.9, 0.8, frameTs + 16)
      
      // Should use prediction, not outlier
      expect(result.x).toBeLessThan(0.6)
      expect(result.y).toBeLessThan(0.5)
      
      const state = engine.getState()
      expect(state.trackState).toBe('PREDICTED')
      expect(state.ballRejectionReason).toContain('Outlier')
    })

    it('should set rejection reason with distance and tolerance', () => {
      const frameTs = 1000
      
      engine.update(0.5, 0.4, frameTs)
      engine.update(0.9, 0.8, frameTs + 16)
      
      const state = engine.getState()
      expect(state.ballRejectionReason).toMatch(/Outlier: distance=.* > tolerance=.*/)
    })
  })

  describe('Fast Shot Detection', () => {
    it('should allow rapid movement during shot with velocity-based tolerance', () => {
      const frameTs = 1000
      
      // Simulate fast upward shot
      engine.update(0.5, 0.4, frameTs)
      engine.update(0.5, 0.3, frameTs + 16)
      engine.update(0.5, 0.2, frameTs + 32)
      
      // Fast movement should be accepted due to velocity-based tolerance
      const result = engine.update(0.5, 0.1, frameTs + 48)
      
      expect(result.y).toBeLessThan(0.2)
      const state = engine.getState()
      expect(state.trackState).toBe('DETECTED')
    })
  })

  describe('Detection Lost and Recovery', () => {
    it('should predict for short period after detection lost', () => {
      const frameTs = 1000
      
      engine.update(0.5, 0.4, frameTs)
      
      // Predict shortly after detection
      const prediction = engine.predict(frameTs + 50)
      expect(prediction).not.toBeNull()
      
      const state = engine.getState()
      expect(state.trackState).toBe('PREDICTED')
      expect(state.trackAge).toBe(50)
    })

    it('should return null after TTL expires', () => {
      const frameTs = 1000
      
      engine.update(0.5, 0.4, frameTs)
      
      // Predict after TTL
      const prediction = engine.predict(frameTs + KALMAN_CONFIG.predictionTtlMs + 100)
      expect(prediction).toBeNull()
      
      const state = engine.getState()
      expect(state.trackState).toBe('LOST')
    })

    it('should recover tracking after outlier rejection', () => {
      const frameTs = 1000
      
      // Establish tracking
      engine.update(0.5, 0.4, frameTs)
      
      // Outlier
      engine.update(0.9, 0.8, frameTs + 16)
      
      // Valid detection near prediction
      const result = engine.update(0.51, 0.41, frameTs + 32)
      
      expect(result.x).toBeCloseTo(0.51, 2)
      const state = engine.getState()
      expect(state.trackState).toBe('DETECTED')
    })

    it('should NOT update ballLastSeenAt on outlier - TTL based on last accepted detection', () => {
      const frameTs = 1000
      
      // Establish tracking with valid detection
      engine.update(0.5, 0.4, frameTs)
      
      // Send multiple outliers over time
      engine.update(0.9, 0.8, frameTs + 16)  // Outlier
      engine.update(0.1, 0.1, frameTs + 32)  // Outlier
      engine.update(0.95, 0.9, frameTs + 48) // Outlier
      
      // Predict after TTL from the LAST ACCEPTED detection (frameTs)
      // The outliers should NOT extend the TTL
      const prediction = engine.predict(frameTs + KALMAN_CONFIG.predictionTtlMs + 100)
      
      // Should be null because TTL is measured from last ACCEPTED detection, not last update
      expect(prediction).toBeNull()
      
      const state = engine.getState()
      expect(state.trackState).toBe('LOST')
    })
  })

  describe('Velocity Calculation', () => {
    it('should calculate velocity correctly from consecutive detections', () => {
      const frameTs = 1000
      
      engine.update(0.5, 0.4, frameTs)
      engine.update(0.6, 0.3, frameTs + 16)
      
      const velocity = engine.getVelocity()
      expect(velocity).not.toBeNull()
      expect(velocity!.vx).toBeGreaterThan(0)  // Moving right
      expect(velocity!.vy).toBeLessThan(0)    // Moving up
    })

    it('should preserve velocity during outlier rejection', () => {
      const frameTs = 1000
      
      engine.update(0.5, 0.4, frameTs)
      engine.update(0.6, 0.3, frameTs + 16)
      
      const velocityBefore = engine.getVelocity()
      
      // Outlier - velocity should be preserved
      engine.update(0.9, 0.8, frameTs + 32)
      
      const velocityAfter = engine.getVelocity()
      expect(velocityAfter!.vx).toBeCloseTo(velocityBefore!.vx, 2)
      expect(velocityAfter!.vy).toBeCloseTo(velocityBefore!.vy, 2)
    })
  })

  describe('State Management', () => {
    it('should maintain raw detection separately', () => {
      const frameTs = 1000
      
      engine.update(0.5, 0.4, frameTs)
      engine.setRawDetection(0.5, 0.4, 0.1, 0.1, 0.95)
      
      const state = engine.getState()
      expect(state.ballPositionRaw).toEqual({ x: 0.5, y: 0.4 })
      expect(state.ballWidth).toBe(0.1)
      expect(state.ballHeight).toBe(0.1)
      expect(state.confidence).toBe(0.95)
    })

    it('should reset correctly', () => {
      const frameTs = 1000
      
      engine.update(0.5, 0.4, frameTs)
      engine.update(0.6, 0.3, frameTs + 16)
      
      engine.reset()
      
      const state = engine.getState()
      expect(state.ballPosition).toBeNull()
      expect(state.ballVelocity).toBeNull()
      expect(state.trackState).toBe('LOST')
      expect(state.ballRejectionReason).toBe('')
    })
  })

  describe('Callback Integration', () => {
    it('should call onBallDetected only for valid detections', () => {
      const onBallDetected = jest.fn()
      engine = new BallTrackingEngine({ onBallDetected })
      
      engine.update(0.5, 0.4, 1000)
      expect(onBallDetected).toHaveBeenCalledTimes(1)
      
      // Outlier should not trigger callback
      engine.update(0.9, 0.8, 1016)
      expect(onBallDetected).toHaveBeenCalledTimes(1)
      
      // Valid detection should trigger callback
      engine.update(0.51, 0.41, 1032)
      expect(onBallDetected).toHaveBeenCalledTimes(2)
    })

    it('should call onBallPrediction callback', () => {
      const onBallPrediction = jest.fn()
      engine = new BallTrackingEngine({ onBallPrediction })
      
      engine.update(0.5, 0.4, 1000)
      engine.predict(1050)
      
      expect(onBallPrediction).toHaveBeenCalled()
    })

    it('should call onBallTrackingExpired after TTL', () => {
      const onBallTrackingExpired = jest.fn()
      engine = new BallTrackingEngine({ onBallTrackingExpired })
      
      engine.update(0.5, 0.4, 1000)
      engine.predict(2000)
      
      expect(onBallTrackingExpired).toHaveBeenCalled()
    })
  })

  describe('Adaptive Gain Behavior', () => {
    it('should use perfect gain for very close detections', () => {
      const frameTs = 1000
      
      engine.update(0.5, 0.4, frameTs)
      const result = engine.update(0.501, 0.401, frameTs + 16)
      
      // Distance is very small, should use perfect gain (0.95)
      expect(result.x).toBeCloseTo(0.501, 2)
    })

    it('should use good gain for moderately close detections', () => {
      const frameTs = 1000
      
      engine.update(0.5, 0.4, frameTs)
      engine.update(0.6, 0.3, frameTs + 16)
      
      // Moderate distance, should use good gain (0.85)
      const result = engine.update(0.65, 0.25, frameTs + 32)
      expect(result.x).toBeGreaterThan(0.6)
      expect(result.x).toBeLessThan(0.65)
    })
  })
})
