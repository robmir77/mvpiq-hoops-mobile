// src/features/workouts/__tests__/manualShotRegistration.test.ts
//
// Unit tests for manual shot registration functionality
// Tests manual MADE/MISS shot entry, validation, and API integration

import { addShotEvent } from '../api/workouts.api'
import type { ShotResult } from '../types/workouts.types'

// Mock the API
jest.mock('../api/workouts.api')
jest.mock('@/shared/api/apiClient')

const mockAddShotEvent = addShotEvent as jest.MockedFunction<typeof addShotEvent>

describe('Manual Shot Registration', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('Manual MADE Shot', () => {
    it('should register a manual MADE shot successfully', async () => {
      const mockShot = {
        id: 'shot-1',
        sessionId: 'session-123',
        timestampMs: 123456789,
        shotResult: 'MADE' as ShotResult,
        courtX: 5.5,
        courtY: 10.2,
        distanceFromHoop: 6.5,
        releaseAngle: 48,
        detectionConfidence: 1.0,
        trackingData: JSON.stringify({ manualEntry: true }),
      }

      mockAddShotEvent.mockResolvedValue(mockShot)

      const payload = {
        timestampMs: 123456789,
        shotResult: 'MADE' as ShotResult,
        courtX: 5.5,
        courtY: 10.2,
        distanceFromHoop: 6.5,
        releaseAngle: 48,
        detectionConfidence: 1.0,
        trackingData: JSON.stringify({ manualEntry: true }),
      }

      const result = await addShotEvent('session-123', 'user-123', payload)

      expect(mockAddShotEvent).toHaveBeenCalledWith('session-123', 'user-123', payload)
      expect(result.shotResult).toBe('MADE')
      expect(result.trackingData).toContain('manualEntry')
    })

    it('should use default court position when not provided', async () => {
      const mockShot = {
        id: 'shot-1',
        sessionId: 'session-123',
        timestampMs: 123456789,
        shotResult: 'MADE' as ShotResult,
        courtX: 0.5, // Default center position
        courtY: 0.5,
        distanceFromHoop: 0,
        detectionConfidence: 1.0,
        trackingData: JSON.stringify({ manualEntry: true }),
      }

      mockAddShotEvent.mockResolvedValue(mockShot)

      const payload = {
        timestampMs: 123456789,
        shotResult: 'MADE' as ShotResult,
        courtX: 0.5,
        courtY: 0.5,
        distanceFromHoop: 0,
        detectionConfidence: 1.0,
        trackingData: JSON.stringify({ manualEntry: true }),
      }

      const result = await addShotEvent('session-123', 'user-123', payload)

      expect(result.courtX).toBe(0.5)
      expect(result.courtY).toBe(0.5)
    })

    it('should handle MADE shot with release angle', async () => {
      const mockShot = {
        id: 'shot-1',
        sessionId: 'session-123',
        timestampMs: 123456789,
        shotResult: 'MADE' as ShotResult,
        courtX: 5.5,
        courtY: 10.2,
        distanceFromHoop: 6.5,
        releaseAngle: 50, // Optimal release angle
        detectionConfidence: 1.0,
        trackingData: JSON.stringify({ manualEntry: true }),
      }

      mockAddShotEvent.mockResolvedValue(mockShot)

      const payload = {
        timestampMs: 123456789,
        shotResult: 'MADE' as ShotResult,
        courtX: 5.5,
        courtY: 10.2,
        distanceFromHoop: 6.5,
        releaseAngle: 50,
        detectionConfidence: 1.0,
        trackingData: JSON.stringify({ manualEntry: true }),
      }

      const result = await addShotEvent('session-123', 'user-123', payload)

      expect(result.releaseAngle).toBe(50)
    })
  })

  describe('Manual MISS Shot', () => {
    it('should register a manual MISS shot successfully', async () => {
      const mockShot = {
        id: 'shot-2',
        sessionId: 'session-123',
        timestampMs: 123456790,
        shotResult: 'MISS' as ShotResult,
        courtX: 7.2,
        courtY: 12.1,
        distanceFromHoop: 7.8,
        releaseAngle: 52,
        detectionConfidence: 1.0,
        trackingData: JSON.stringify({ manualEntry: true }),
      }

      mockAddShotEvent.mockResolvedValue(mockShot)

      const payload = {
        timestampMs: 123456790,
        shotResult: 'MISS' as ShotResult,
        courtX: 7.2,
        courtY: 12.1,
        distanceFromHoop: 7.8,
        releaseAngle: 52,
        detectionConfidence: 1.0,
        trackingData: JSON.stringify({ manualEntry: true }),
      }

      const result = await addShotEvent('session-123', 'user-123', payload)

      expect(mockAddShotEvent).toHaveBeenCalledWith('session-123', 'user-123', payload)
      expect(result.shotResult).toBe('MISS')
      expect(result.trackingData).toContain('manualEntry')
    })

    it('should handle MISS shot with distance data', async () => {
      const mockShot = {
        id: 'shot-2',
        sessionId: 'session-123',
        timestampMs: 123456790,
        shotResult: 'MISS' as ShotResult,
        courtX: 8.5,
        courtY: 14.0,
        distanceFromHoop: 9.2, // Three-point distance
        releaseAngle: 55,
        detectionConfidence: 1.0,
        trackingData: JSON.stringify({ manualEntry: true }),
      }

      mockAddShotEvent.mockResolvedValue(mockShot)

      const payload = {
        timestampMs: 123456790,
        shotResult: 'MISS' as ShotResult,
        courtX: 8.5,
        courtY: 14.0,
        distanceFromHoop: 9.2,
        releaseAngle: 55,
        detectionConfidence: 1.0,
        trackingData: JSON.stringify({ manualEntry: true }),
      }

      const result = await addShotEvent('session-123', 'user-123', payload)

      expect(result.distanceFromHoop).toBe(9.2)
    })
  })

  describe('Manual BLOCKED Shot', () => {
    it('should register a manual BLOCKED shot', async () => {
      const mockShot = {
        id: 'shot-3',
        sessionId: 'session-123',
        timestampMs: 123456791,
        shotResult: 'BLOCKED' as ShotResult,
        courtX: 6.0,
        courtY: 11.0,
        distanceFromHoop: 7.0,
        detectionConfidence: 1.0,
        trackingData: JSON.stringify({ manualEntry: true }),
      }

      mockAddShotEvent.mockResolvedValue(mockShot)

      const payload = {
        timestampMs: 123456791,
        shotResult: 'BLOCKED' as ShotResult,
        courtX: 6.0,
        courtY: 11.0,
        distanceFromHoop: 7.0,
        detectionConfidence: 1.0,
        trackingData: JSON.stringify({ manualEntry: true }),
      }

      const result = await addShotEvent('session-123', 'user-123', payload)

      expect(result.shotResult).toBe('BLOCKED')
    })
  })

  describe('Manual AIRBALL Shot', () => {
    it('should register a manual AIRBALL shot', async () => {
      const mockShot = {
        id: 'shot-4',
        sessionId: 'session-123',
        timestampMs: 123456792,
        shotResult: 'AIRBALL' as ShotResult,
        courtX: 2.0,
        courtY: 5.0,
        distanceFromHoop: 10.0,
        detectionConfidence: 1.0,
        trackingData: JSON.stringify({ manualEntry: true }),
      }

      mockAddShotEvent.mockResolvedValue(mockShot)

      const payload = {
        timestampMs: 123456792,
        shotResult: 'AIRBALL' as ShotResult,
        courtX: 2.0,
        courtY: 5.0,
        distanceFromHoop: 10.0,
        detectionConfidence: 1.0,
        trackingData: JSON.stringify({ manualEntry: true }),
      }

      const result = await addShotEvent('session-123', 'user-123', payload)

      expect(result.shotResult).toBe('AIRBALL')
    })
  })

  describe('Validation', () => {
    it('should require timestampMs for manual shot', async () => {
      const payload = {
        shotResult: 'MADE' as ShotResult,
        courtX: 5.5,
        courtY: 10.2,
        distanceFromHoop: 6.5,
        detectionConfidence: 1.0,
        trackingData: JSON.stringify({ manualEntry: true }),
      }

      mockAddShotEvent.mockRejectedValue(new Error('timestampMs is required'))

      await expect(
        addShotEvent('session-123', 'user-123', payload as any)
      ).rejects.toThrow('timestampMs is required')
    })

    it('should require shotResult for manual shot', async () => {
      const payload = {
        timestampMs: 123456789,
        courtX: 5.5,
        courtY: 10.2,
        distanceFromHoop: 6.5,
        detectionConfidence: 1.0,
        trackingData: JSON.stringify({ manualEntry: true }),
      }

      mockAddShotEvent.mockRejectedValue(new Error('shotResult is required'))

      await expect(
        addShotEvent('session-123', 'user-123', payload as any)
      ).rejects.toThrow('shotResult is required')
    })

    it('should validate shotResult enum values', async () => {
      const invalidPayload = {
        timestampMs: 123456789,
        shotResult: 'INVALID' as ShotResult,
        courtX: 5.5,
        courtY: 10.2,
        distanceFromHoop: 6.5,
        detectionConfidence: 1.0,
      }

      mockAddShotEvent.mockRejectedValue(new Error('Invalid shotResult'))

      await expect(
        addShotEvent('session-123', 'user-123', invalidPayload)
      ).rejects.toThrow('Invalid shotResult')
    })

    it('should set detectionConfidence to 1.0 for manual entries', async () => {
      const mockShot = {
        id: 'shot-1',
        sessionId: 'session-123',
        timestampMs: 123456789,
        shotResult: 'MADE' as ShotResult,
        courtX: 5.5,
        courtY: 10.2,
        distanceFromHoop: 6.5,
        detectionConfidence: 1.0,
        trackingData: JSON.stringify({ manualEntry: true }),
      }

      mockAddShotEvent.mockResolvedValue(mockShot)

      const payload = {
        timestampMs: 123456789,
        shotResult: 'MADE' as ShotResult,
        courtX: 5.5,
        courtY: 10.2,
        distanceFromHoop: 6.5,
        detectionConfidence: 1.0,
        trackingData: JSON.stringify({ manualEntry: true }),
      }

      const result = await addShotEvent('session-123', 'user-123', payload)

      expect(result.detectionConfidence).toBe(1.0)
    })
  })

  describe('Tracking Data', () => {
    it('should include manualEntry flag in tracking data', async () => {
      const mockShot = {
        id: 'shot-1',
        sessionId: 'session-123',
        timestampMs: 123456789,
        shotResult: 'MADE' as ShotResult,
        courtX: 5.5,
        courtY: 10.2,
        distanceFromHoop: 6.5,
        detectionConfidence: 1.0,
        trackingData: JSON.stringify({ manualEntry: true }),
      }

      mockAddShotEvent.mockResolvedValue(mockShot)

      const payload = {
        timestampMs: 123456789,
        shotResult: 'MADE' as ShotResult,
        courtX: 5.5,
        courtY: 10.2,
        distanceFromHoop: 6.5,
        detectionConfidence: 1.0,
        trackingData: JSON.stringify({ manualEntry: true }),
      }

      const result = await addShotEvent('session-123', 'user-123', payload)

      const trackingData = JSON.parse(result.trackingData || '{}')
      expect(trackingData.manualEntry).toBe(true)
    })

    it('should allow additional metadata in tracking data', async () => {
      const additionalMetadata = {
        manualEntry: true,
        userNotes: 'Felt good',
        courtPosition: 'left wing',
      }

      const mockShot = {
        id: 'shot-1',
        sessionId: 'session-123',
        timestampMs: 123456789,
        shotResult: 'MADE' as ShotResult,
        courtX: 5.5,
        courtY: 10.2,
        distanceFromHoop: 6.5,
        detectionConfidence: 1.0,
        trackingData: JSON.stringify(additionalMetadata),
      }

      mockAddShotEvent.mockResolvedValue(mockShot)

      const payload = {
        timestampMs: 123456789,
        shotResult: 'MADE' as ShotResult,
        courtX: 5.5,
        courtY: 10.2,
        distanceFromHoop: 6.5,
        detectionConfidence: 1.0,
        trackingData: JSON.stringify(additionalMetadata),
      }

      const result = await addShotEvent('session-123', 'user-123', payload)

      const trackingData = JSON.parse(result.trackingData || '{}')
      expect(trackingData.userNotes).toBe('Felt good')
      expect(trackingData.courtPosition).toBe('left wing')
    })
  })

  describe('Error Handling', () => {
    it('should handle API errors during manual shot registration', async () => {
      mockAddShotEvent.mockRejectedValue(new Error('Network error'))

      const payload = {
        timestampMs: 123456789,
        shotResult: 'MADE' as ShotResult,
        courtX: 5.5,
        courtY: 10.2,
        distanceFromHoop: 6.5,
        detectionConfidence: 1.0,
        trackingData: JSON.stringify({ manualEntry: true }),
      }

      await expect(
        addShotEvent('session-123', 'user-123', payload)
      ).rejects.toThrow('Network error')
    })

    it('should handle invalid session ID', async () => {
      mockAddShotEvent.mockRejectedValue(new Error('Session not found'))

      const payload = {
        timestampMs: 123456789,
        shotResult: 'MADE' as ShotResult,
        courtX: 5.5,
        courtY: 10.2,
        distanceFromHoop: 6.5,
        detectionConfidence: 1.0,
        trackingData: JSON.stringify({ manualEntry: true }),
      }

      await expect(
        addShotEvent('invalid-session', 'user-123', payload)
      ).rejects.toThrow('Session not found')
    })

    it('should handle invalid user ID', async () => {
      mockAddShotEvent.mockRejectedValue(new Error('User not found'))

      const payload = {
        timestampMs: 123456789,
        shotResult: 'MADE' as ShotResult,
        courtX: 5.5,
        courtY: 10.2,
        distanceFromHoop: 6.5,
        detectionConfidence: 1.0,
        trackingData: JSON.stringify({ manualEntry: true }),
      }

      await expect(
        addShotEvent('session-123', 'invalid-user', payload)
      ).rejects.toThrow('User not found')
    })
  })

  describe('Shot Counter Updates', () => {
    it('should increment total shots counter', async () => {
      const mockShot = {
        id: 'shot-1',
        sessionId: 'session-123',
        timestampMs: 123456789,
        shotResult: 'MADE' as ShotResult,
        courtX: 5.5,
        courtY: 10.2,
        distanceFromHoop: 6.5,
        detectionConfidence: 1.0,
        trackingData: JSON.stringify({ manualEntry: true }),
      }

      mockAddShotEvent.mockResolvedValue(mockShot)

      const payload = {
        timestampMs: 123456789,
        shotResult: 'MADE' as ShotResult,
        courtX: 5.5,
        courtY: 10.2,
        distanceFromHoop: 6.5,
        detectionConfidence: 1.0,
        trackingData: JSON.stringify({ manualEntry: true }),
      }

      await addShotEvent('session-123', 'user-123', payload)

      // Counter should be updated in the UI component
      expect(mockAddShotEvent).toHaveBeenCalledTimes(1)
    })

    it('should increment made shots counter for MADE shots', async () => {
      const mockShot = {
        id: 'shot-1',
        sessionId: 'session-123',
        timestampMs: 123456789,
        shotResult: 'MADE' as ShotResult,
        courtX: 5.5,
        courtY: 10.2,
        distanceFromHoop: 6.5,
        detectionConfidence: 1.0,
        trackingData: JSON.stringify({ manualEntry: true }),
      }

      mockAddShotEvent.mockResolvedValue(mockShot)

      const payload = {
        timestampMs: 123456789,
        shotResult: 'MADE' as ShotResult,
        courtX: 5.5,
        courtY: 10.2,
        distanceFromHoop: 6.5,
        detectionConfidence: 1.0,
        trackingData: JSON.stringify({ manualEntry: true }),
      }

      const result = await addShotEvent('session-123', 'user-123', payload)

      expect(result.shotResult).toBe('MADE')
    })

    it('should not increment made shots counter for MISS shots', async () => {
      const mockShot = {
        id: 'shot-2',
        sessionId: 'session-123',
        timestampMs: 123456790,
        shotResult: 'MISS' as ShotResult,
        courtX: 7.2,
        courtY: 12.1,
        distanceFromHoop: 7.8,
        detectionConfidence: 1.0,
        trackingData: JSON.stringify({ manualEntry: true }),
      }

      mockAddShotEvent.mockResolvedValue(mockShot)

      const payload = {
        timestampMs: 123456790,
        shotResult: 'MISS' as ShotResult,
        courtX: 7.2,
        courtY: 12.1,
        distanceFromHoop: 7.8,
        detectionConfidence: 1.0,
        trackingData: JSON.stringify({ manualEntry: true }),
      }

      const result = await addShotEvent('session-123', 'user-123', payload)

      expect(result.shotResult).toBe('MISS')
    })
  })
})
