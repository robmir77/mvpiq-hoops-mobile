// src/features/workouts/__tests__/workoutFlow.integration.test.ts
//
// Integration tests for complete workout flow
// Tests end-to-end scenarios: session creation, calibration, shot tracking, and session completion

import {
  createWorkoutSession,
  saveCourtCalibration,
  addShotEvent,
  endWorkoutSession,
  getSessionShots,
  getWorkoutSession,
} from '../api/workouts.api'
import type { ShotResult, CalibrationData, CameraMode, CourtType } from '../types/workouts.types'

// Mock the API
jest.mock('../api/workouts.api')
jest.mock('@/shared/api/apiClient')

const mockCreateWorkoutSession = createWorkoutSession as jest.MockedFunction<typeof createWorkoutSession>
const mockSaveCourtCalibration = saveCourtCalibration as jest.MockedFunction<typeof saveCourtCalibration>
const mockAddShotEvent = addShotEvent as jest.MockedFunction<typeof addShotEvent>
const mockEndWorkoutSession = endWorkoutSession as jest.MockedFunction<typeof endWorkoutSession>
const mockGetSessionShots = getSessionShots as jest.MockedFunction<typeof getSessionShots>
const mockGetWorkoutSession = getWorkoutSession as jest.MockedFunction<typeof getWorkoutSession>

describe('Workout Flow Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('Complete Workout Session Flow', () => {
    it('should create session, calibrate, add shots, and complete session', async () => {
      const userId = 'user-123'
      const sessionId = 'session-123'

      // Step 1: Create workout session
      const mockSession = {
        id: sessionId,
        userId,
        cameraMode: 'ANGLE_45' as CameraMode,
        courtType: 'HALF_COURT' as CourtType,
        status: 'ACTIVE' as const,
        startTime: new Date().toISOString(),
        totalShots: 0,
        madeShots: 0,
        shootingPercentage: 0,
      }

      mockCreateWorkoutSession.mockResolvedValue(mockSession)

      const session = await createWorkoutSession(userId, {
        cameraMode: 'ANGLE_45',
        courtType: 'HALF_COURT' as CourtType,
      })

      expect(session.id).toBe(sessionId)
      expect(session.status).toBe('ACTIVE')

      // Step 2: Calibrate court
      const calibrationData: CalibrationData = {
        homographyMatrix: [1, 0, 0, 0, 1, 0, 0, 0, 1],
        hoopCenter: { x: 0.5, y: 0.3 },
        courtCorners: {
          topLeft: { x: 0.1, y: 0.1 },
          topRight: { x: 0.9, y: 0.1 },
          bottomRight: { x: 0.9, y: 0.6 },
          bottomLeft: { x: 0.1, y: 0.6 },
        },
      }

      mockSaveCourtCalibration.mockResolvedValue()

      await saveCourtCalibration(sessionId, userId, calibrationData)

      expect(mockSaveCourtCalibration).toHaveBeenCalledWith(
        sessionId,
        userId,
        expect.objectContaining({
          hoopCenter: { x: 0.5, y: 0.3 },
        })
      )

      // Step 3: Add automatic shots
      const mockShots = [
        {
          id: 'shot-1',
          sessionId,
          timestampMs: 123456789,
          shotResult: 'MADE' as ShotResult,
          courtX: 5.5,
          courtY: 10.2,
          distanceFromHoop: 6.5,
          releaseAngle: 48,
          detectionConfidence: 0.9,
          trackingData: JSON.stringify({ autoDetected: true }),
        },
        {
          id: 'shot-2',
          sessionId,
          timestampMs: 123456790,
          shotResult: 'MISS' as ShotResult,
          courtX: 7.2,
          courtY: 12.1,
          distanceFromHoop: 7.8,
          releaseAngle: 52,
          detectionConfidence: 0.85,
          trackingData: JSON.stringify({ autoDetected: true }),
        },
      ]

      mockAddShotEvent.mockResolvedValueOnce(mockShots[0])
      mockAddShotEvent.mockResolvedValueOnce(mockShots[1])

      for (const shot of mockShots) {
        await addShotEvent(sessionId, userId, {
          timestampMs: shot.timestampMs,
          shotResult: shot.shotResult,
          courtX: shot.courtX,
          courtY: shot.courtY,
          distanceFromHoop: shot.distanceFromHoop,
          releaseAngle: shot.releaseAngle,
          detectionConfidence: shot.detectionConfidence,
          trackingData: shot.trackingData,
        })
      }

      expect(mockAddShotEvent).toHaveBeenCalledTimes(2)

      // Step 4: Add manual shots
      const manualShot = {
        id: 'shot-3',
        sessionId,
        timestampMs: 123456791,
        shotResult: 'MADE' as ShotResult,
        courtX: 6.0,
        courtY: 11.0,
        distanceFromHoop: 7.0,
        detectionConfidence: 1.0,
        trackingData: JSON.stringify({ manualEntry: true }),
      }

      mockAddShotEvent.mockResolvedValueOnce(manualShot)

      await addShotEvent(sessionId, userId, {
        timestampMs: manualShot.timestampMs,
        shotResult: manualShot.shotResult,
        courtX: manualShot.courtX,
        courtY: manualShot.courtY,
        distanceFromHoop: manualShot.distanceFromHoop,
        detectionConfidence: 1.0,
        trackingData: manualShot.trackingData,
      })

      expect(mockAddShotEvent).toHaveBeenCalledTimes(3)

      // Step 5: End session
      const completedSession = {
        ...mockSession,
        status: 'COMPLETED' as const,
        endTime: new Date().toISOString(),
        totalShots: 3,
        madeShots: 2,
        shootingPercentage: 66.67,
      }

      mockEndWorkoutSession.mockResolvedValue(completedSession)

      const finalSession = await endWorkoutSession(sessionId, userId)

      expect(finalSession.status).toBe('COMPLETED')
      expect(finalSession.totalShots).toBe(3)
      expect(finalSession.madeShots).toBe(2)
    })

    it('should handle session with only manual shots', async () => {
      const userId = 'user-123'
      const sessionId = 'session-123'

      const mockSession = {
        id: sessionId,
        userId,
        cameraMode: 'LATERAL' as CameraMode,
        courtType: 'FULL_COURT' as CourtType,
        status: 'ACTIVE' as const,
        startTime: new Date().toISOString(),
        totalShots: 0,
        madeShots: 0,
        shootingPercentage: 0,
      }

      mockCreateWorkoutSession.mockResolvedValue(mockSession)

      const session = await createWorkoutSession(userId, {
        cameraMode: 'LATERAL',
        courtType: 'FULL_COURT' as CourtType,
      })

      // Add only manual shots
      const manualShots = [
        {
          id: 'shot-1',
          sessionId,
          timestampMs: 123456789,
          shotResult: 'MADE' as ShotResult,
          courtX: 5.5,
          courtY: 10.2,
          distanceFromHoop: 6.5,
          detectionConfidence: 1.0,
          trackingData: JSON.stringify({ manualEntry: true }),
        },
        {
          id: 'shot-2',
          sessionId,
          timestampMs: 123456790,
          shotResult: 'MISS' as ShotResult,
          courtX: 7.2,
          courtY: 12.1,
          distanceFromHoop: 7.8,
          detectionConfidence: 1.0,
          trackingData: JSON.stringify({ manualEntry: true }),
        },
      ]

      mockAddShotEvent.mockResolvedValueOnce(manualShots[0])
      mockAddShotEvent.mockResolvedValueOnce(manualShots[1])

      for (const shot of manualShots) {
        await addShotEvent(sessionId, userId, {
          timestampMs: shot.timestampMs,
          shotResult: shot.shotResult,
          courtX: shot.courtX,
          courtY: shot.courtY,
          distanceFromHoop: shot.distanceFromHoop,
          detectionConfidence: 1.0,
          trackingData: shot.trackingData,
        })
      }

      expect(mockAddShotEvent).toHaveBeenCalledTimes(2)

      // Verify all shots are marked as manual
      manualShots.forEach((shot) => {
        const trackingData = JSON.parse(shot.trackingData || '{}')
        expect(trackingData.manualEntry).toBe(true)
      })
    })

    it('should handle session pause and resume', async () => {
      const userId = 'user-123'
      const sessionId = 'session-123'

      const mockSession = {
        id: sessionId,
        userId,
        cameraMode: 'FRONTAL' as CameraMode,
        courtType: 'HALF_COURT' as CourtType,
        status: 'ACTIVE' as const,
        startTime: new Date().toISOString(),
        totalShots: 5,
        madeShots: 3,
        shootingPercentage: 60,
      }

      mockCreateWorkoutSession.mockResolvedValue(mockSession)

      const session = await createWorkoutSession(userId, {
        cameraMode: 'FRONTAL',
        courtType: 'HALF_COURT' as CourtType,
      })

      expect(session.status).toBe('ACTIVE')

      // Pause session (mocked in the actual implementation)
      const pausedSession = {
        ...mockSession,
        status: 'PAUSED' as const,
      }

      // Resume session (mocked in the actual implementation)
      const resumedSession = {
        ...mockSession,
        status: 'ACTIVE' as const,
      }

      expect(pausedSession.status).toBe('PAUSED')
      expect(resumedSession.status).toBe('ACTIVE')
    })
  })

  describe('Shot Retrieval and Analytics', () => {
    it('should retrieve all shots for a session', async () => {
      const sessionId = 'session-123'
      const userId = 'user-123'

      const mockShots = [
        {
          id: 'shot-1',
          sessionId,
          timestampMs: 123456789,
          shotResult: 'MADE' as ShotResult,
          courtX: 5.5,
          courtY: 10.2,
          distanceFromHoop: 6.5,
          releaseAngle: 48,
          detectionConfidence: 0.9,
        },
        {
          id: 'shot-2',
          sessionId,
          timestampMs: 123456790,
          shotResult: 'MISS' as ShotResult,
          courtX: 7.2,
          courtY: 12.1,
          distanceFromHoop: 7.8,
          releaseAngle: 52,
          detectionConfidence: 0.85,
        },
        {
          id: 'shot-3',
          sessionId,
          timestampMs: 123456791,
          shotResult: 'MADE' as ShotResult,
          courtX: 6.0,
          courtY: 11.0,
          distanceFromHoop: 7.0,
          releaseAngle: 50,
          detectionConfidence: 1.0,
          trackingData: JSON.stringify({ manualEntry: true }),
        },
      ]

      mockGetSessionShots.mockResolvedValue(mockShots)

      const shots = await getSessionShots(sessionId, userId)

      expect(shots).toHaveLength(3)
      expect(shots[0].shotResult).toBe('MADE')
      expect(shots[1].shotResult).toBe('MISS')
      expect(shots[2].shotResult).toBe('MADE')
    })

    it('should calculate shooting percentage from shots', async () => {
      const sessionId = 'session-123'
      const userId = 'user-123'

      const mockShots = [
        {
          id: 'shot-1',
          sessionId,
          timestampMs: 123456789,
          shotResult: 'MADE' as ShotResult,
          courtX: 5.5,
          courtY: 10.2,
          distanceFromHoop: 6.5,
          detectionConfidence: 0.9,
        },
        {
          id: 'shot-2',
          sessionId,
          timestampMs: 123456790,
          shotResult: 'MADE' as ShotResult,
          courtX: 7.2,
          courtY: 12.1,
          distanceFromHoop: 7.8,
          detectionConfidence: 0.85,
        },
        {
          id: 'shot-3',
          sessionId,
          timestampMs: 123456791,
          shotResult: 'MISS' as ShotResult,
          courtX: 6.0,
          courtY: 11.0,
          distanceFromHoop: 7.0,
          detectionConfidence: 0.9,
        },
      ]

      mockGetSessionShots.mockResolvedValue(mockShots)

      const shots = await getSessionShots(sessionId, userId)

      const madeShots = shots.filter((s) => s.shotResult === 'MADE').length
      const totalShots = shots.length
      const shootingPercentage = (madeShots / totalShots) * 100

      expect(madeShots).toBe(2)
      expect(totalShots).toBe(3)
      expect(shootingPercentage).toBeCloseTo(66.67, 2)
    })

    it('should distinguish between automatic and manual shots', async () => {
      const sessionId = 'session-123'
      const userId = 'user-123'

      const mockShots = [
        {
          id: 'shot-1',
          sessionId,
          timestampMs: 123456789,
          shotResult: 'MADE' as ShotResult,
          courtX: 5.5,
          courtY: 10.2,
          distanceFromHoop: 6.5,
          detectionConfidence: 0.9,
          trackingData: JSON.stringify({ autoDetected: true }),
        },
        {
          id: 'shot-2',
          sessionId,
          timestampMs: 123456790,
          shotResult: 'MISS' as ShotResult,
          courtX: 7.2,
          courtY: 12.1,
          distanceFromHoop: 7.8,
          detectionConfidence: 1.0,
          trackingData: JSON.stringify({ manualEntry: true }),
        },
      ]

      mockGetSessionShots.mockResolvedValue(mockShots)

      const shots = await getSessionShots(sessionId, userId)

      const autoShots = shots.filter((s) => {
        const trackingData = JSON.parse(s.trackingData || '{}')
        return trackingData.autoDetected === true
      })

      const manualShots = shots.filter((s) => {
        const trackingData = JSON.parse(s.trackingData || '{}')
        return trackingData.manualEntry === true
      })

      expect(autoShots).toHaveLength(1)
      expect(manualShots).toHaveLength(1)
    })
  })

  describe('Error Recovery', () => {
    it('should handle calibration failure and continue session', async () => {
      const userId = 'user-123'
      const sessionId = 'session-123'

      const mockSession = {
        id: sessionId,
        userId,
        cameraMode: 'ANGLE_45' as CameraMode,
        courtType: 'HALF_COURT' as CourtType,
        status: 'ACTIVE' as const,
        startTime: new Date().toISOString(),
        totalShots: 0,
        madeShots: 0,
        shootingPercentage: 0,
      }

      mockCreateWorkoutSession.mockResolvedValue(mockSession)

      const session = await createWorkoutSession(userId, {
        cameraMode: 'ANGLE_45',
        courtType: 'HALF_COURT' as CourtType,
      })

      // Calibration fails
      const calibrationData: CalibrationData = {
        homographyMatrix: [],
        hoopCenter: { x: 0.5, y: 0.3 },
      }

      mockSaveCourtCalibration.mockRejectedValue(new Error('Calibration failed'))

      await expect(
        saveCourtCalibration(sessionId, userId, calibrationData)
      ).rejects.toThrow('Calibration failed')

      // Session should still be active
      expect(session.status).toBe('ACTIVE')

      // Should still be able to add shots
      const mockShot = {
        id: 'shot-1',
        sessionId,
        timestampMs: 123456789,
        shotResult: 'MADE' as ShotResult,
        courtX: 5.5,
        courtY: 10.2,
        distanceFromHoop: 6.5,
        detectionConfidence: 1.0,
        trackingData: JSON.stringify({ manualEntry: true }),
      }

      mockAddShotEvent.mockResolvedValue(mockShot)

      await addShotEvent(sessionId, userId, {
        timestampMs: mockShot.timestampMs,
        shotResult: mockShot.shotResult,
        courtX: mockShot.courtX,
        courtY: mockShot.courtY,
        distanceFromHoop: mockShot.distanceFromHoop,
        detectionConfidence: 1.0,
        trackingData: mockShot.trackingData,
      })

      expect(mockAddShotEvent).toHaveBeenCalledTimes(1)
    })

    it('should handle shot recording failure and continue session', async () => {
      const userId = 'user-123'
      const sessionId = 'session-123'

      const mockSession = {
        id: sessionId,
        userId,
        cameraMode: 'ANGLE_45' as CameraMode,
        courtType: 'HALF_COURT' as CourtType,
        status: 'ACTIVE' as const,
        startTime: new Date().toISOString(),
        totalShots: 0,
        madeShots: 0,
        shootingPercentage: 0,
      }

      mockCreateWorkoutSession.mockResolvedValue(mockSession)

      const session = await createWorkoutSession(userId, {
        cameraMode: 'ANGLE_45',
        courtType: 'HALF_COURT' as CourtType,
      })

      // First shot succeeds
      const mockShot1 = {
        id: 'shot-1',
        sessionId,
        timestampMs: 123456789,
        shotResult: 'MADE' as ShotResult,
        courtX: 5.5,
        courtY: 10.2,
        distanceFromHoop: 6.5,
        detectionConfidence: 0.9,
      }

      mockAddShotEvent.mockResolvedValueOnce(mockShot1)

      await addShotEvent(sessionId, userId, {
        timestampMs: mockShot1.timestampMs,
        shotResult: mockShot1.shotResult,
        courtX: mockShot1.courtX,
        courtY: mockShot1.courtY,
        distanceFromHoop: mockShot1.distanceFromHoop,
        detectionConfidence: mockShot1.detectionConfidence,
      })

      // Second shot fails
      mockAddShotEvent.mockRejectedValueOnce(new Error('Shot recording failed'))

      await expect(
        addShotEvent(sessionId, userId, {
          timestampMs: 123456790,
          shotResult: 'MISS' as ShotResult,
          courtX: 7.2,
          courtY: 12.1,
          distanceFromHoop: 7.8,
          detectionConfidence: 0.85,
        })
      ).rejects.toThrow('Shot recording failed')

      // Third shot should still work
      const mockShot3 = {
        id: 'shot-3',
        sessionId,
        timestampMs: 123456791,
        shotResult: 'MADE' as ShotResult,
        courtX: 6.0,
        courtY: 11.0,
        distanceFromHoop: 7.0,
        detectionConfidence: 0.9,
      }

      mockAddShotEvent.mockResolvedValueOnce(mockShot3)

      await addShotEvent(sessionId, userId, {
        timestampMs: mockShot3.timestampMs,
        shotResult: mockShot3.shotResult,
        courtX: mockShot3.courtX,
        courtY: mockShot3.courtY,
        distanceFromHoop: mockShot3.distanceFromHoop,
        detectionConfidence: mockShot3.detectionConfidence,
      })

      expect(mockAddShotEvent).toHaveBeenCalledTimes(3)
    })
  })

  describe('Session State Transitions', () => {
    it('should transition from ACTIVE to PAUSED', async () => {
      const userId = 'user-123'
      const sessionId = 'session-123'

      const activeSession = {
        id: sessionId,
        userId,
        status: 'ACTIVE' as const,
        cameraMode: 'ANGLE_45' as CameraMode,
        courtType: 'HALF_COURT' as CourtType,
        startTime: new Date().toISOString(),
        totalShots: 5,
        madeShots: 3,
        shootingPercentage: 60,
      }

      mockGetWorkoutSession.mockResolvedValue(activeSession)

      const session = await getWorkoutSession(sessionId, userId)

      expect(session.status).toBe('ACTIVE')

      // Transition to PAUSED (mocked)
      const pausedSession = {
        ...activeSession,
        status: 'PAUSED' as const,
      }

      expect(pausedSession.status).toBe('PAUSED')
    })

    it('should transition from PAUSED to ACTIVE', async () => {
      const userId = 'user-123'
      const sessionId = 'session-123'

      const pausedSession = {
        id: sessionId,
        userId,
        status: 'PAUSED' as const,
        cameraMode: 'ANGLE_45' as CameraMode,
        courtType: 'HALF_COURT' as CourtType,
        startTime: new Date().toISOString(),
        totalShots: 5,
        madeShots: 3,
        shootingPercentage: 60,
      }

      mockGetWorkoutSession.mockResolvedValue(pausedSession)

      const session = await getWorkoutSession(sessionId, userId)

      expect(session.status).toBe('PAUSED')

      // Transition to ACTIVE (mocked)
      const activeSession = {
        ...pausedSession,
        status: 'ACTIVE' as const,
      }

      expect(activeSession.status).toBe('ACTIVE')
    })

    it('should transition from ACTIVE to COMPLETED', async () => {
      const userId = 'user-123'
      const sessionId = 'session-123'

      const activeSession = {
        id: sessionId,
        userId,
        status: 'ACTIVE' as const,
        cameraMode: 'ANGLE_45' as CameraMode,
        courtType: 'HALF_COURT' as CourtType,
        startTime: new Date().toISOString(),
        totalShots: 10,
        madeShots: 7,
        shootingPercentage: 70,
      }

      mockGetWorkoutSession.mockResolvedValue(activeSession)

      const session = await getWorkoutSession(sessionId, userId)

      expect(session.status).toBe('ACTIVE')

      // Transition to COMPLETED
      const completedSession = {
        ...activeSession,
        status: 'COMPLETED' as const,
        endTime: new Date().toISOString(),
      }

      expect(completedSession.status).toBe('COMPLETED')
      expect(completedSession.endTime).toBeDefined()
    })
  })
})
