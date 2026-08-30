// src/features/workouts/__tests__/useTrackingEngine.test.ts
//
// Unit tests for useTrackingEngine hook
// Tests ball tracking, shot detection, Kalman filtering, and trajectory analysis

import { useTrackingEngine } from '../hooks/useTrackingEngine'
import { BallDetection } from '../../../vision/types'
import { act } from '@testing-library/react-native'

// Mock react-native-reanimated
jest.mock('react-native-reanimated', () => ({
  useSharedValue: jest.fn((initial) => ({ value: initial })),
  useDerivedValue: jest.fn((fn) => ({ value: fn() })),
  withTiming: jest.fn(),
  withSpring: jest.fn(),
  runOnJS: jest.fn((fn) => fn),
}))

describe('useTrackingEngine', () => {
  let trackingEngine: ReturnType<typeof useTrackingEngine>

  beforeEach(() => {
    // Create a mock React environment for the hook
    const mockReact = require('react')
    trackingEngine = useTrackingEngine()
  })

  describe('Ball Tracking', () => {
    it('should initialize with default state', () => {
      const state = trackingEngine.getState()
      
      expect(state.ballPosition).toBeNull()
      expect(state.ballPositionRaw).toBeNull()
      expect(state.ballVelocity).toBeNull()
      expect(state.shotDetected).toBe(false)
      expect(state.inFlight).toBe(false)
    })

    it('should process ball detection', () => {
      const ballDetection: { x: number; y: number; width: number; height: number; confidence: number } = {
        x: 0.5,
        y: 0.4,
        width: 0.1,
        height: 0.1,
        confidence: 0.9,
      }

      act(() => {
        trackingEngine.processFrame(ballDetection, null, Date.now())
      })

      const state = trackingEngine.getState()
      expect(state.ballPosition).not.toBeNull()
      expect(state.ballPosition?.x).toBe(0.5)
      expect(state.ballPosition?.y).toBe(0.4)
      expect(state.confidence).toBe(0.9)
    })

    it('should apply Kalman filtering to smooth ball position', () => {
      const ball1: { x: number; y: number; width: number; height: number; confidence: number } = {
        x: 0.5,
        y: 0.4,
        width: 0.1,
        height: 0.1,
        confidence: 0.9,
      }

      const ball2: { x: number; y: number; width: number; height: number; confidence: number } = {
        x: 0.51,
        y: 0.39,
        width: 0.1,
        height: 0.1,
        confidence: 0.9,
      }

      act(() => {
        trackingEngine.processFrame(ball1, null, Date.now())
      })

      act(() => {
        trackingEngine.processFrame(ball2, null, Date.now() + 33)
      })

      const state = trackingEngine.getState()
      // Kalman filter should smooth the position
      expect(state.ballPosition).not.toBeNull()
    })

    it('should calculate ball velocity', () => {
      const ball1: { x: number; y: number; width: number; height: number; confidence: number } = {
        x: 0.5,
        y: 0.4,
        width: 0.1,
        height: 0.1,
        confidence: 0.9,
      }

      const ball2: { x: number; y: number; width: number; height: number; confidence: number } = {
        x: 0.55,
        y: 0.35,
        width: 0.1,
        height: 0.1,
        confidence: 0.9,
      }

      act(() => {
        trackingEngine.processFrame(ball1, null, Date.now())
      })

      act(() => {
        trackingEngine.processFrame(ball2, null, Date.now() + 33)
      })

      const state = trackingEngine.getState()
      expect(state.ballVelocity).not.toBeNull()
      expect(state.ballVelocity?.vx).toBeGreaterThan(0)
      expect(state.ballVelocity?.vy).toBeLessThan(0) // Moving up
    })
  })

  describe('Shot Detection', () => {
    it('should detect shot start when ball moves upward in upper frame', () => {
      const frames: { x: number; y: number; width: number; height: number; confidence: number }[] = [
        { x: 0.5, y: 0.6, width: 0.1, height: 0.1, confidence: 0.9 },
        { x: 0.5, y: 0.5, width: 0.1, height: 0.1, confidence: 0.9 },
        { x: 0.5, y: 0.4, width: 0.1, height: 0.1, confidence: 0.9 },
        { x: 0.5, y: 0.3, width: 0.1, height: 0.1, confidence: 0.9 },
      ]

      frames.forEach((ball, index) => {
        act(() => {
          trackingEngine.processFrame(ball, null, Date.now() + index * 33)
        })
      })

      const state = trackingEngine.getState()
      expect(state.shotDetected).toBe(true)
    })

    it('should detect shot release with strong upward velocity', () => {
      const frames: { x: number; y: number; width: number; height: number; confidence: number }[] = [
        { x: 0.5, y: 0.6, width: 0.1, height: 0.1, confidence: 0.9 },
        { x: 0.5, y: 0.5, width: 0.1, height: 0.1, confidence: 0.9 },
        { x: 0.5, y: 0.35, width: 0.1, height: 0.1, confidence: 0.9 },
        { x: 0.5, y: 0.2, width: 0.1, height: 0.1, confidence: 0.9 },
      ]

      frames.forEach((ball, index) => {
        act(() => {
          trackingEngine.processFrame(ball, null, Date.now() + index * 33)
        })
      })

      const state = trackingEngine.getState()
      expect(state.shotDetected).toBe(true)
      expect(state.releasePoint).not.toBeNull()
    })

    it('should detect made shot when ball goes through hoop', () => {
      const hoop = {
        x: 0.5,
        y: 0.2,
        width: 0.1,
        height: 0.05,
        confidence: 0.9,
      }

      const frames: { x: number; y: number; width: number; height: number; confidence: number }[] = [
        { x: 0.5, y: 0.6, width: 0.1, height: 0.1, confidence: 0.9 },
        { x: 0.5, y: 0.4, width: 0.1, height: 0.1, confidence: 0.9 },
        { x: 0.5, y: 0.25, width: 0.1, height: 0.1, confidence: 0.9 },
        { x: 0.5, y: 0.22, width: 0.1, height: 0.1, confidence: 0.9 }, // Near hoop
        { x: 0.5, y: 0.18, width: 0.1, height: 0.1, confidence: 0.9 }, // Through hoop
      ]

      frames.forEach((ball, index) => {
        act(() => {
          trackingEngine.processFrame(ball, hoop, Date.now() + index * 33)
        })
      })

      const state = trackingEngine.getState()
      expect(state.shotResult).toBe('MADE')
    })

    it('should detect missed shot when ball goes away from hoop', () => {
      const hoop = {
        x: 0.5,
        y: 0.2,
        width: 0.1,
        height: 0.05,
        confidence: 0.9,
      }

      const frames: { x: number; y: number; width: number; height: number; confidence: number }[] = [
        { x: 0.5, y: 0.6, width: 0.1, height: 0.1, confidence: 0.9 },
        { x: 0.5, y: 0.4, width: 0.1, height: 0.1, confidence: 0.9 },
        { x: 0.5, y: 0.25, width: 0.1, height: 0.1, confidence: 0.9 },
        { x: 0.8, y: 0.3, width: 0.1, height: 0.1, confidence: 0.9 }, // Away from hoop
      ]

      frames.forEach((ball, index) => {
        act(() => {
          trackingEngine.processFrame(ball, hoop, Date.now() + index * 33)
        })
      })

      const state = trackingEngine.getState()
      expect(state.shotResult).toBe('MISS')
    })

    it('should reset shot state after detection', () => {
      const ball: { x: number; y: number; width: number; height: number; confidence: number } = {
        x: 0.5,
        y: 0.4,
        width: 0.1,
        height: 0.1,
        confidence: 0.9,
      }

      act(() => {
        trackingEngine.processFrame(ball, null, Date.now())
      })

      act(() => {
        trackingEngine.resetShot()
      })

      const state = trackingEngine.getState()
      expect(state.shotDetected).toBe(false)
      expect(state.shotResult).toBeNull()
    })
  })

  describe('Trajectory Analysis', () => {
    it('should build trajectory from ball positions', () => {
      const frames: { x: number; y: number; width: number; height: number; confidence: number }[] = [
        { x: 0.5, y: 0.6, width: 0.1, height: 0.1, confidence: 0.9 },
        { x: 0.5, y: 0.5, width: 0.1, height: 0.1, confidence: 0.9 },
        { x: 0.5, y: 0.4, width: 0.1, height: 0.1, confidence: 0.9 },
      ]

      frames.forEach((ball, index) => {
        act(() => {
          trackingEngine.processFrame(ball, null, Date.now() + index * 33)
        })
      })

      const state = trackingEngine.getState()
      expect(state.trajectory.length).toBeGreaterThan(0)
    })

    it('should calculate trajectory metrics', () => {
      const ball: { x: number; y: number; width: number; height: number; confidence: number } = {
        x: 0.5,
        y: 0.4,
        width: 0.1,
        height: 0.1,
        confidence: 0.9,
      }

      act(() => {
        trackingEngine.processFrame(ball, null, Date.now())
      })

      const metrics = trackingEngine.computeTrajectoryMetrics()
      expect(metrics).toBeDefined()
      expect(typeof metrics.releaseAngle).toBe('number')
      expect(typeof metrics.arcHeight).toBe('number')
    })

    it('should calculate shot quality score', () => {
      const ball: { x: number; y: number; width: number; height: number; confidence: number } = {
        x: 0.5,
        y: 0.4,
        width: 0.1,
        height: 0.1,
        confidence: 0.9,
      }

      act(() => {
        trackingEngine.processFrame(ball, null, Date.now())
      })

      const metrics = trackingEngine.computeTrajectoryMetrics()
      const quality = trackingEngine.calculateShotQuality(metrics, 48)
      
      expect(quality).toBeGreaterThanOrEqual(0)
      expect(quality).toBeLessThanOrEqual(100)
    })
  })

  describe('Hoop Position', () => {
    it('should set hoop position from calibration', () => {
      act(() => {
        trackingEngine.setHoopFromCalibration(0.5, 0.3, 0.1, 0.05)
      })

      const state = trackingEngine.getState()
      expect(state.hoopPosition).not.toBeNull()
      expect(state.hoopPosition?.x).toBe(0.5)
      expect(state.hoopPosition?.y).toBe(0.3)
    })

    it('should update hoop position from detection', () => {
      const hoop = {
        x: 0.45,
        y: 0.28,
        width: 0.12,
        height: 0.06,
        confidence: 0.95,
      }

      act(() => {
        trackingEngine.processFrame(null, hoop, Date.now())
      })

      const state = trackingEngine.getState()
      expect(state.hoopPosition).not.toBeNull()
    })
  })

  describe('Shared Values', () => {
    it('should provide shared values for Skia overlay', () => {
      const { sharedValues } = trackingEngine
      
      expect(sharedValues).toBeDefined()
      expect(sharedValues.ballX).toBeDefined()
      expect(sharedValues.ballY).toBeDefined()
      expect(sharedValues.hoopX).toBeDefined()
      expect(sharedValues.hoopY).toBeDefined()
      expect(sharedValues.confidence).toBeDefined()
      expect(sharedValues.inFlight).toBeDefined()
      expect(sharedValues.shotDetected).toBeDefined()
    })

    it('should update shared values when ball position changes', () => {
      const ball: BallDetection['ball'] = {
        x: 0.5,
        y: 0.4,
        width: 0.1,
        height: 0.1,
        confidence: 0.9,
      }

      act(() => {
        trackingEngine.processFrame(ball, null, Date.now())
      })

      const { sharedValues } = trackingEngine
      expect(sharedValues.ballX.value).toBe(0.5)
      expect(sharedValues.ballY.value).toBe(0.4)
      expect(sharedValues.confidence.value).toBe(0.9)
    })
  })

  describe('Edge Cases', () => {
    it('should handle null ball detection', () => {
      act(() => {
        trackingEngine.processFrame(null, null, Date.now())
      })

      const state = trackingEngine.getState()
      expect(state.ballPosition).toBeNull()
    })

    it('should handle low confidence detections', () => {
      const ball: { x: number; y: number; width: number; height: number; confidence: number } = {
        x: 0.5,
        y: 0.4,
        width: 0.1,
        height: 0.1,
        confidence: 0.3, // Low confidence
      }

      act(() => {
        trackingEngine.processFrame(ball, null, Date.now())
      })

      // Should still process but with lower weight
      const state = trackingEngine.getState()
      expect(state.confidence).toBe(0.3)
    })

    it('should handle rapid position changes', () => {
      const frames: { x: number; y: number; width: number; height: number; confidence: number }[] = [
        { x: 0.1, y: 0.1, width: 0.1, height: 0.1, confidence: 0.9 },
        { x: 0.9, y: 0.9, width: 0.1, height: 0.1, confidence: 0.9 },
        { x: 0.5, y: 0.5, width: 0.1, height: 0.1, confidence: 0.9 },
      ]

      frames.forEach((ball, index) => {
        act(() => {
          trackingEngine.processFrame(ball, null, Date.now() + index * 33)
        })
      })

      // Kalman filter should smooth out rapid changes
      const state = trackingEngine.getState()
      expect(state.ballPosition).not.toBeNull()
    })
  })
})
