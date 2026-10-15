// ShotDetectionEngine.test.ts
// Phase 4.2: Deterministic equivalence tests for ShotDetectionEngine
// Verifies that the new engine produces identical results to legacy shot detection logic

import { ShotDetectionEngine } from '../ShotDetectionEngine'

describe('ShotDetectionEngine', () => {
  let engine: ShotDetectionEngine

  beforeEach(() => {
    engine = new ShotDetectionEngine()
  })

  describe('Dribble Filter', () => {
    it('should detect rising frames correctly', () => {
      const frameTs = 1000
      const MIN_RISING_FRAMES = 3
      
      // Add trajectory points
      for (let i = 0; i < 5; i++) {
        engine.addTrajectoryPoint(0.5, 0.5 - i * 0.03, frameTs + i * 16)
      }
      
      // Process frame with rising velocity
      const result = engine.processFrame(
        { x: 0.5, y: 0.35 },
        { vx: 0, vy: -2.0 },  // Rising (vy < -1.5)
        null,
        frameTs + 80
      )
      
      // Should be in flight after MIN_RISING_FRAMES
      expect(result.inFlight).toBe(true)
      expect(result.releasePoint).not.toBeNull()
    })

    it('should not trigger inFlight without enough arc height', () => {
      const frameTs = 1000
      const MIN_ARC_HEIGHT = 0.08
      
      // Add trajectory points with small arc
      for (let i = 0; i < 5; i++) {
        engine.addTrajectoryPoint(0.5, 0.5 - i * 0.01, frameTs + i * 16)
      }
      
      const result = engine.processFrame(
        { x: 0.5, y: 0.46 },
        { vx: 0, vy: -2.0 },
        null,
        frameTs + 80
      )
      
      // Arc height = 0.04 < 0.08, should not be in flight
      expect(result.inFlight).toBe(false)
    })

    it('should reset rising frames when not rising', () => {
      const frameTs = 1000
      
      engine.addTrajectoryPoint(0.5, 0.5, frameTs)
      engine.addTrajectoryPoint(0.5, 0.47, frameTs + 16)
      
      // Rising
      engine.processFrame(
        { x: 0.5, y: 0.44 },
        { vx: 0, vy: -2.0 },
        null,
        frameTs + 32
      )
      
      // Not rising anymore
      const result = engine.processFrame(
        { x: 0.5, y: 0.44 },
        { vx: 0, vy: 0.5 },  // Descending
        null,
        frameTs + 48
      )
      
      expect(result.inFlight).toBe(false)
    })
  })

  describe('Shot Detection - MADE', () => {
    it('should detect MADE when ball descends through hoop', () => {
      const frameTs = 1000
      
      // Build trajectory to trigger inFlight
      for (let i = 0; i < 5; i++) {
        engine.addTrajectoryPoint(0.5, 0.5 - i * 0.03, frameTs + i * 16)
      }
      
      // Trigger inFlight
      engine.processFrame(
        { x: 0.5, y: 0.35 },
        { vx: 0, vy: -2.0 },
        null,
        frameTs + 80
      )
      
      // Descend through hoop
      const result = engine.processFrame(
        { x: 0.5, y: 0.5 },  // Back down
        { vx: 0, vy: 1.0 },  // Descending
        { x: 0.5, y: 0.5, width: 0.1, height: 0.1, confidence: 0.9 },
        frameTs + 96
      )
      
      expect(result.shotDetected).toBe(true)
      expect(result.shotResult).toBe('MADE')
    })
  })

  describe('Shot Detection - MISS', () => {
    it('should detect MISS when ball descends past hoop but not through', () => {
      const frameTs = 1000
      
      // Build trajectory
      for (let i = 0; i < 5; i++) {
        engine.addTrajectoryPoint(0.5, 0.5 - i * 0.03, frameTs + i * 16)
      }
      
      // Trigger inFlight
      engine.processFrame(
        { x: 0.5, y: 0.35 },
        { vx: 0, vy: -2.0 },
        null,
        frameTs + 80
      )
      
      // Descend past hoop
      const result = engine.processFrame(
        { x: 0.7, y: 0.5 },  // Off-center
        { vx: 0, vy: 1.0 },
        { x: 0.5, y: 0.5, width: 0.1, height: 0.1, confidence: 0.9 },
        frameTs + 96
      )
      
      expect(result.shotDetected).toBe(true)
      expect(result.shotResult).toBe('MISS')
    })
  })

  describe('Shot Detection - AIRBALL', () => {
    it('should detect AIRBALL when ball descends far from hoop', () => {
      const frameTs = 1000
      
      // Build trajectory
      for (let i = 0; i < 5; i++) {
        engine.addTrajectoryPoint(0.5, 0.5 - i * 0.03, frameTs + i * 16)
      }
      
      // Trigger inFlight
      engine.processFrame(
        { x: 0.5, y: 0.35 },
        { vx: 0, vy: -2.0 },
        null,
        frameTs + 80
      )
      
      // Descend far from hoop
      const result = engine.processFrame(
        { x: 0.8, y: 0.5 },
        { vx: 0, vy: 4.0 },  // Fast descending
        { x: 0.5, y: 0.5, width: 0.1, height: 0.1, confidence: 0.9 },
        frameTs + 96
      )
      
      expect(result.shotDetected).toBe(true)
      expect(result.shotResult).toBe('AIRBALL')
    })
  })

  describe('Shot Cooldown', () => {
    it('should respect cooldown between shots', () => {
      const frameTs = 1000
      const SHOT_COOLDOWN_MS = 600
      
      // First shot
      for (let i = 0; i < 5; i++) {
        engine.addTrajectoryPoint(0.5, 0.5 - i * 0.03, frameTs + i * 16)
      }
      engine.processFrame({ x: 0.5, y: 0.35 }, { vx: 0, vy: -2.0 }, null, frameTs + 80)
      engine.processFrame({ x: 0.5, y: 0.5 }, { vx: 0, vy: 1.0 }, { x: 0.5, y: 0.5, width: 0.1, height: 0.1, confidence: 0.9 }, frameTs + 96)
      
      // Reset for second shot
      engine.resetShot()
      
      // Second shot within cooldown
      for (let i = 0; i < 5; i++) {
        engine.addTrajectoryPoint(0.5, 0.5 - i * 0.03, frameTs + 100 + i * 16)
      }
      engine.processFrame({ x: 0.5, y: 0.35 }, { vx: 0, vy: -2.0 }, null, frameTs + 180)
      const result = engine.processFrame({ x: 0.5, y: 0.5 }, { vx: 0, vy: 1.0 }, { x: 0.5, y: 0.5, width: 0.1, height: 0.1, confidence: 0.9 }, frameTs + 196)
      
      // Should not detect shot due to cooldown
      expect(result.shotDetected).toBe(false)
    })
  })

  describe('Trajectory Management', () => {
    it('should maintain trajectory ring buffer', () => {
      const frameTs = 1000
      const MAX_POINTS = 90
      
      // Add more points than MAX_POINTS
      for (let i = 0; i < 100; i++) {
        engine.addTrajectoryPoint(0.5 + i * 0.001, 0.5 - i * 0.001, frameTs + i * 16)
      }
      
      const trajectory = engine.getTrajectoryPoints()
      
      // Should have at most MAX_POINTS
      expect(trajectory.length).toBeLessThanOrEqual(MAX_POINTS)
    })

    it('should track apex point correctly', () => {
      const frameTs = 1000
      
      engine.addTrajectoryPoint(0.5, 0.5, frameTs)
      engine.addTrajectoryPoint(0.5, 0.4, frameTs + 16)
      engine.addTrajectoryPoint(0.5, 0.35, frameTs + 32)  // Apex (lowest y)
      engine.addTrajectoryPoint(0.5, 0.4, frameTs + 48)
      
      const result = engine.processFrame({ x: 0.5, y: 0.4 }, { vx: 0, vy: 1.0 }, null, frameTs + 64)
      
      expect(result.apexPoint).not.toBeNull()
      expect(result.apexPoint!.y).toBeCloseTo(0.35, 6)
    })
  })

  describe('State Management', () => {
    it('should reset shot correctly', () => {
      const frameTs = 1000
      
      // Build trajectory and detect shot
      for (let i = 0; i < 5; i++) {
        engine.addTrajectoryPoint(0.5, 0.5 - i * 0.03, frameTs + i * 16)
      }
      engine.processFrame({ x: 0.5, y: 0.35 }, { vx: 0, vy: -2.0 }, null, frameTs + 80)
      engine.processFrame({ x: 0.5, y: 0.5 }, { vx: 0, vy: 1.0 }, { x: 0.5, y: 0.5, width: 0.1, height: 0.1, confidence: 0.9 }, frameTs + 96)
      
      engine.resetShot()
      
      const result = engine.processFrame({ x: 0.5, y: 0.5 }, { vx: 0, vy: 0 }, null, frameTs + 112)
      
      expect(result.shotDetected).toBe(false)
      expect(result.shotResult).toBeNull()
      expect(result.inFlight).toBe(false)
    })

    it('should reset all correctly', () => {
      const frameTs = 1000
      
      for (let i = 0; i < 10; i++) {
        engine.addTrajectoryPoint(0.5, 0.5 - i * 0.01, frameTs + i * 16)
      }
      
      engine.resetAll()
      
      const trajectory = engine.getTrajectoryPoints()
      expect(trajectory.length).toBe(0)
    })
  })

  describe('Equivalence with Legacy', () => {
    it('should match legacy dribble filter logic', () => {
      // Reference: useTrackingEngine.ts lines 597-628
      const frameTs = 1000
      const MIN_RISING_FRAMES = 3
      const MIN_ARC_HEIGHT = 0.08
      
      // Simulate legacy behavior
      let risingFrames = 0
      let flightStartY = 1.0
      
      for (let i = 0; i < 5; i++) {
        const y = 0.5 - i * 0.03
        const vy = -2.0
        
        if (vy < -1.5) {
          risingFrames++
          if (risingFrames === 1) flightStartY = y
        } else {
          risingFrames = 0
        }
      }
      
      const arcSoFar = flightStartY - 0.35
      const legacyInFlight = risingFrames >= MIN_RISING_FRAMES && arcSoFar >= MIN_ARC_HEIGHT
      
      // Engine behavior
      for (let i = 0; i < 5; i++) {
        engine.addTrajectoryPoint(0.5, 0.5 - i * 0.03, frameTs + i * 16)
      }
      const result = engine.processFrame({ x: 0.5, y: 0.35 }, { vx: 0, vy: -2.0 }, null, frameTs + 80)
      
      expect(result.inFlight).toBe(legacyInFlight)
    })
  })
})
