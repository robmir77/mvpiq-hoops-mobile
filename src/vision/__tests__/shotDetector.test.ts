// src/vision/__tests__/shotDetector.test.ts
//
// Unit tests for ShotDetector class
// Tests shot detection logic with simulated ball trajectories

import { ShotDetector } from '../shotDetector'
import type { BallDetection } from '../types'

describe('ShotDetector', () => {
  let detector: ShotDetector

  beforeEach(() => {
    detector = new ShotDetector()
  })

  describe('detectShotStart', () => {
    it('should detect shot start when ball moves upward in upper frame', () => {
      const ball: BallDetection['ball'] = {
        x: 100,
        y: 200, // Upper part of frame (above 30% threshold)
        width: 20,
        height: 20,
        confidence: 0.8,
      }

      // Add trajectory points with upward velocity and proper timing
      const baseTime = Date.now()
      detector['trajectory'].push({ x: ball.x + 10, y: 220, t: baseTime })
      detector['trajectory'].push({ x: ball.x + 10, y: 200, t: baseTime + 33 })
      detector['trajectory'].push({ x: ball.x + 10, y: 180, t: baseTime + 66 })

      const result = detector.detectShotStart(ball)
      expect(result).toBe(true)
    })

    it('should not detect shot start when ball is in lower frame', () => {
      const ball: BallDetection['ball'] = {
        x: 100,
        y: 400, // Lower part of frame (below 30% threshold)
        width: 20,
        height: 20,
        confidence: 0.8,
      }

      detector.updateTrajectory(ball)
      const result = detector.detectShotStart(ball)
      expect(result).toBe(false)
    })

    it('should not detect shot start when ball moves downward', () => {
      const ball: BallDetection['ball'] = {
        x: 100,
        y: 200,
        width: 20,
        height: 20,
        confidence: 0.8,
      }

      // Add trajectory points with downward velocity
      detector.updateTrajectory(ball)
      detector.updateTrajectory({ ...ball, y: 220 })
      detector.updateTrajectory({ ...ball, y: 240 })

      const result = detector.detectShotStart(ball)
      expect(result).toBe(false)
    })
  })

  describe('detectShotRelease', () => {
    it('should detect shot release with strong upward velocity', () => {
      const ball: BallDetection['ball'] = {
        x: 100,
        y: 200,
        width: 20,
        height: 20,
        confidence: 0.8,
      }

      const baseTime = Date.now()
      // Start shot first
      detector['trajectory'].push({ x: ball.x + 10, y: 220, t: baseTime })
      detector['trajectory'].push({ x: ball.x + 10, y: 200, t: baseTime + 33 })
      detector['shotStarted'] = true

      // Add points with strong upward velocity
      detector['trajectory'].push({ x: ball.x + 10, y: 150, t: baseTime + 66 })
      detector['trajectory'].push({ x: ball.x + 10, y: 100, t: baseTime + 99 })
      detector['trajectory'].push({ x: ball.x + 10, y: 50, t: baseTime + 132 })

      const result = detector.detectShotRelease()
      expect(result).toBe(true)
    })

    it('should not detect release before shot start', () => {
      const ball: BallDetection['ball'] = {
        x: 100,
        y: 200,
        width: 20,
        height: 20,
        confidence: 0.8,
      }

      detector.updateTrajectory(ball)
      const result = detector.detectShotRelease()
      expect(result).toBe(false)
    })
  })

  describe('detectShotMade', () => {
    it('should detect shot made when ball goes through rim', () => {
      const ball: BallDetection['ball'] = {
        x: 100,
        y: 200,
        width: 20,
        height: 20,
        confidence: 0.8,
      }

      const rim = {
        x: 90,
        y: 50,
        width: 40,
        height: 40,
      }

      const baseTime = Date.now()
      // Start and release shot
      detector['trajectory'].push({ x: ball.x + 10, y: 220, t: baseTime })
      detector['trajectory'].push({ x: ball.x + 10, y: 200, t: baseTime + 33 })
      detector['shotStarted'] = true
      detector['trajectory'].push({ x: ball.x + 10, y: 150, t: baseTime + 66 })
      detector['shotReleased'] = true
      detector['releaseTime'] = baseTime + 66

      // Ball goes downward through rim (y increasing) - need 3 points for velocity
      detector['trajectory'].push({ x: 110, y: 50, t: baseTime + 99 }) // Near rim center
      detector['trajectory'].push({ x: 110, y: 60, t: baseTime + 132 }) // Moving down
      detector['trajectory'].push({ x: 110, y: 70, t: baseTime + 165 }) // Moving down

      const result = detector.detectShotMade(rim)
      expect(result).toBe(true)
    })

    it('should not detect made when ball is far from rim', () => {
      const ball: BallDetection['ball'] = {
        x: 100,
        y: 200,
        width: 20,
        height: 20,
        confidence: 0.8,
      }

      const rim = {
        x: 90,
        y: 50,
        width: 40,
        height: 40,
      }

      const baseTime = Date.now()
      detector['trajectory'].push({ x: ball.x + 10, y: 220, t: baseTime })
      detector['trajectory'].push({ x: ball.x + 10, y: 200, t: baseTime + 33 })
      detector['shotStarted'] = true
      detector['trajectory'].push({ x: ball.x + 10, y: 150, t: baseTime + 66 })
      detector['shotReleased'] = true
      detector['releaseTime'] = baseTime + 66

      // Ball far from rim
      detector['trajectory'].push({ x: 300, y: 60, t: baseTime + 99 })

      const result = detector.detectShotMade(rim)
      expect(result).toBe(false)
    })
  })

  describe('detectShotMiss', () => {
    it('should detect shot miss after timeout', () => {
      const ball: BallDetection['ball'] = {
        x: 100,
        y: 200,
        width: 20,
        height: 20,
        confidence: 0.8,
      }

      const baseTime = Date.now() - 3000 // 3 seconds ago
      // Start and release shot
      detector['trajectory'].push({ x: ball.x + 10, y: 220, t: baseTime })
      detector['trajectory'].push({ x: ball.x + 10, y: 200, t: baseTime + 33 })
      detector['shotStarted'] = true
      detector['trajectory'].push({ x: ball.x + 10, y: 150, t: baseTime + 66 })
      detector['shotReleased'] = true
      detector['releaseTime'] = baseTime + 66

      // Wait for timeout (2 seconds)
      jest.useFakeTimers()
      jest.advanceTimersByTime(2500)

      const result = detector.detectShotMiss()
      expect(result).toBe(true)

      jest.useRealTimers()
    })

    it('should not detect miss before timeout', () => {
      const ball: BallDetection['ball'] = {
        x: 100,
        y: 200,
        width: 20,
        height: 20,
        confidence: 0.8,
      }

      detector.updateTrajectory(ball)
      detector.detectShotStart(ball)
      detector.updateTrajectory({ ...ball, y: 150 })
      detector.detectShotRelease()

      // Wait less than timeout
      jest.useFakeTimers()
      jest.advanceTimersByTime(1000)

      const result = detector.detectShotMiss()
      expect(result).toBe(false)

      jest.useRealTimers()
    })
  })

  describe('reset', () => {
    it('should reset all shot detection state', () => {
      const ball: BallDetection['ball'] = {
        x: 100,
        y: 200,
        width: 20,
        height: 20,
        confidence: 0.8,
      }

      detector.updateTrajectory(ball)
      detector.detectShotStart(ball)
      detector.updateTrajectory({ ...ball, y: 150 })
      detector.detectShotRelease()

      detector.reset()

      const event = detector.getShotEvent()
      expect(event).toBeNull()
    })
  })

  describe('getShotEvent', () => {
    it('should return null when shot not started', () => {
      const event = detector.getShotEvent()
      expect(event).toBeNull()
    })

    it('should return event with shot data after release', () => {
      const ball: BallDetection['ball'] = {
        x: 100,
        y: 200,
        width: 20,
        height: 20,
        confidence: 0.8,
      }

      const baseTime = Date.now()
      detector['trajectory'].push({ x: ball.x + 10, y: 220, t: baseTime })
      detector['trajectory'].push({ x: ball.x + 10, y: 200, t: baseTime + 33 })
      detector['shotStarted'] = true
      detector['trajectory'].push({ x: ball.x + 10, y: 150, t: baseTime + 66 })
      detector['trajectory'].push({ x: ball.x + 10, y: 100, t: baseTime + 99 }) // Strong upward velocity
      detector['shotReleased'] = true
      detector['releaseTime'] = baseTime + 99
      detector['releasePoint'] = { x: ball.x + 10, y: 100 } // Set release point manually

      const event = detector.getShotEvent()
      expect(event).not.toBeNull()
      expect(event?.shotStarted).toBe(true)
      expect(event?.shotReleased).toBe(true)
      expect(event?.releasePoint).toBeDefined()
    })
  })
})
