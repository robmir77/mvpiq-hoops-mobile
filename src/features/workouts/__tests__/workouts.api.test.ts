// src/features/workouts/__tests__/workouts.api.test.ts
//
// Unit tests for workout API functions
// Tests API calls for session management, shots, calibration, and analytics

import {
  createWorkoutSession,
  getWorkoutSession,
  getPlayerWorkoutSessions,
  deleteWorkoutSession,
  endWorkoutSession,
  pauseWorkoutSession,
  resumeWorkoutSession,
  getActiveWorkoutSession,
  getSessionShots,
  addShotEvent,
  saveCourtCalibration,
  saveFrameData,
  savePoseAnalysis,
} from '../api/workouts.api'
import apiClient from '@/shared/api/apiClient'
import { AddShotEventPayload } from '../types/workouts.types'

// Mock apiClient
jest.mock('@/shared/api/apiClient')
jest.mock('@react-native-async-storage/async-storage')
jest.mock('@/config/appConfig', () => ({
  API_BASE_URL: 'http://localhost:3000',
}))

const mockApi = apiClient as jest.Mocked<typeof apiClient>

describe('workouts.api', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('Session Management', () => {
    describe('createWorkoutSession', () => {
      it('should create a new workout session', async () => {
        const mockSession = {
          id: 'session-123',
          userId: 'user-123',
          cameraMode: 'ANGLE_45',
          courtType: 'HALF_COURT',
          status: 'ACTIVE',
          startTime: new Date().toISOString(),
          totalShots: 0,
          madeShots: 0,
          shootingPercentage: 0,
        }

        mockApi.post.mockResolvedValue({ data: mockSession })

        const result = await createWorkoutSession('user-123', {
          cameraMode: 'ANGLE_45',
          courtType: 'HALF_COURT',
        })

        expect(mockApi.post).toHaveBeenCalledWith(
          '/workouts/sessions?userId=user-123',
          { cameraMode: 'ANGLE_45', courtType: 'HALF_COURT' }
        )
        expect(result).toEqual(mockSession)
      })

      it('should handle API errors', async () => {
        mockApi.post.mockRejectedValue(new Error('Network error'))

        await expect(
          createWorkoutSession('user-123', {
            cameraMode: 'ANGLE_45',
            courtType: 'HALF_COURT',
          })
        ).rejects.toThrow('Network error')
      })
    })

    describe('getWorkoutSession', () => {
      it('should get a specific workout session', async () => {
        const mockSession = {
          id: 'session-123',
          userId: 'user-123',
          cameraMode: 'ANGLE_45',
          courtType: 'HALF_COURT',
          status: 'ACTIVE',
          startTime: new Date().toISOString(),
          totalShots: 10,
          madeShots: 7,
          shootingPercentage: 70,
        }

        mockApi.get.mockResolvedValue({ data: mockSession })

        const result = await getWorkoutSession('session-123', 'user-123')

        expect(mockApi.get).toHaveBeenCalledWith(
          '/workouts/sessions/session-123?userId=user-123'
        )
        expect(result).toEqual(mockSession)
      })
    })

    describe('getPlayerWorkoutSessions', () => {
      it('should get all sessions for a player', async () => {
        const mockSessions = [
          {
            id: 'session-1',
            userId: 'user-123',
            cameraMode: 'ANGLE_45',
            courtType: 'HALF_COURT',
            status: 'COMPLETED',
            startTime: new Date().toISOString(),
            totalShots: 10,
            madeShots: 7,
            shootingPercentage: 70,
          },
          {
            id: 'session-2',
            userId: 'user-123',
            cameraMode: 'LATERAL',
            courtType: 'FULL_COURT',
            status: 'ACTIVE',
            startTime: new Date().toISOString(),
            totalShots: 5,
            madeShots: 3,
            shootingPercentage: 60,
          },
        ]

        mockApi.get.mockResolvedValue({ data: mockSessions })

        const result = await getPlayerWorkoutSessions('user-123')

        expect(mockApi.get).toHaveBeenCalledWith('/workouts/sessions?userId=user-123')
        expect(result).toEqual(mockSessions)
      })
    })

    describe('deleteWorkoutSession', () => {
      it('should delete a workout session', async () => {
        ;(global as any).fetch = jest.fn(() =>
          Promise.resolve({
            ok: true,
          } as Response)
        ) as jest.Mock

        await deleteWorkoutSession('session-123', 'user-123')

        expect((global as any).fetch).toHaveBeenCalledWith(
          expect.stringContaining('/workouts/sessions/session-123?userId=user-123'),
          expect.objectContaining({
            method: 'DELETE',
          })
        )
      })
    })

    describe('endWorkoutSession', () => {
      it('should end a workout session', async () => {
        const mockSession = {
          id: 'session-123',
          userId: 'user-123',
          cameraMode: 'ANGLE_45',
          courtType: 'HALF_COURT',
          status: 'COMPLETED',
          startTime: new Date().toISOString(),
          endTime: new Date().toISOString(),
          totalShots: 10,
          madeShots: 7,
          shootingPercentage: 70,
        }

        mockApi.post.mockResolvedValue({ data: mockSession })

        const result = await endWorkoutSession('session-123', 'user-123')

        expect(mockApi.post).toHaveBeenCalledWith(
          '/workouts/sessions/session-123/end?userId=user-123'
        )
        expect(result).toEqual(mockSession)
      })
    })

    describe('pauseWorkoutSession', () => {
      it('should pause a workout session', async () => {
        const mockSession = {
          id: 'session-123',
          userId: 'user-123',
          cameraMode: 'ANGLE_45',
          courtType: 'HALF_COURT',
          status: 'PAUSED',
          startTime: new Date().toISOString(),
          totalShots: 10,
          madeShots: 7,
          shootingPercentage: 70,
        }

        mockApi.post.mockResolvedValue({ data: mockSession })

        const result = await pauseWorkoutSession('session-123', 'user-123')

        expect(mockApi.post).toHaveBeenCalledWith(
          '/workouts/sessions/session-123/pause?userId=user-123'
        )
        expect(result.status).toBe('PAUSED')
      })
    })

    describe('resumeWorkoutSession', () => {
      it('should resume a paused workout session', async () => {
        const mockSession = {
          id: 'session-123',
          userId: 'user-123',
          cameraMode: 'ANGLE_45',
          courtType: 'HALF_COURT',
          status: 'ACTIVE',
          startTime: new Date().toISOString(),
          totalShots: 10,
          madeShots: 7,
          shootingPercentage: 70,
        }

        mockApi.post.mockResolvedValue({ data: mockSession })

        const result = await resumeWorkoutSession('session-123', 'user-123')

        expect(mockApi.post).toHaveBeenCalledWith(
          '/workouts/sessions/session-123/resume?userId=user-123'
        )
        expect(result.status).toBe('ACTIVE')
      })
    })

    describe('getActiveWorkoutSession', () => {
      it('should get active session when exists', async () => {
        const mockSession = {
          id: 'session-123',
          userId: 'user-123',
          cameraMode: 'ANGLE_45',
          courtType: 'HALF_COURT',
          status: 'ACTIVE',
          startTime: new Date().toISOString(),
          totalShots: 10,
          madeShots: 7,
          shootingPercentage: 70,
        }

        mockApi.get.mockResolvedValue({ data: mockSession })

        const result = await getActiveWorkoutSession('user-123')

        expect(mockApi.get).toHaveBeenCalledWith('/workouts/sessions/active-session?userId=user-123')
        expect(result).toEqual(mockSession)
      })

      it('should return null when no active session exists', async () => {
        mockApi.get.mockRejectedValue({
          response: { status: 404 },
        })

        const result = await getActiveWorkoutSession('user-123')

        expect(result).toBeNull()
      })
    })
  })

  describe('Shot Management', () => {
    describe('getSessionShots', () => {
      it('should get all shots for a session', async () => {
        const mockShots = [
          {
            id: 'shot-1',
            sessionId: 'session-123',
            timestampMs: 123456789,
            shotResult: 'MADE',
            courtX: 5.5,
            courtY: 10.2,
            distanceFromHoop: 6.5,
            releaseAngle: 48,
            detectionConfidence: 0.9,
          },
          {
            id: 'shot-2',
            sessionId: 'session-123',
            timestampMs: 123456790,
            shotResult: 'MISS',
            courtX: 7.2,
            courtY: 12.1,
            distanceFromHoop: 7.8,
            releaseAngle: 52,
            detectionConfidence: 0.85,
          },
        ]

        mockApi.get.mockResolvedValue({ data: mockShots })

        const result = await getSessionShots('session-123', 'user-123')

        expect(mockApi.get).toHaveBeenCalledWith(
          '/workouts/sessions/session-123/shots?userId=user-123'
        )
        expect(result).toEqual(mockShots)
      })
    })

    describe('addShotEvent', () => {
      it('should add a new shot event', async () => {
        const mockShot = {
          id: 'shot-1',
          sessionId: 'session-123',
          timestampMs: 123456789,
          shotResult: 'MADE',
          courtX: 5.5,
          courtY: 10.2,
          distanceFromHoop: 6.5,
          releaseAngle: 48,
          detectionConfidence: 0.9,
        }

        const payload: AddShotEventPayload = {
          timestampMs: 123456789,
          shotResult: 'MADE',
          courtX: 5.5,
          courtY: 10.2,
          distanceFromHoop: 6.5,
          releaseAngle: 48,
          detectionConfidence: 0.9,
        }

        mockApi.post.mockResolvedValue({ data: mockShot })

        const result = await addShotEvent('session-123', 'user-123', payload)

        expect(mockApi.post).toHaveBeenCalledWith(
          '/workouts/sessions/session-123/shots?userId=user-123',
          payload
        )
        expect(result).toEqual(mockShot)
      })

      it('should handle manual shot entries', async () => {
        const mockShot = {
          id: 'shot-1',
          sessionId: 'session-123',
          timestampMs: 123456789,
          shotResult: 'MADE',
          courtX: 5.5,
          courtY: 10.2,
          distanceFromHoop: 6.5,
          detectionConfidence: 1.0,
          trackingData: JSON.stringify({ manualEntry: true }),
        }

        const payload: AddShotEventPayload = {
          timestampMs: 123456789,
          shotResult: 'MADE',
          courtX: 5.5,
          courtY: 10.2,
          distanceFromHoop: 6.5,
          detectionConfidence: 1.0,
          trackingData: JSON.stringify({ manualEntry: true }),
        }

        mockApi.post.mockResolvedValue({ data: mockShot })

        const result = await addShotEvent('session-123', 'user-123', payload)

        expect(result.trackingData).toContain('manualEntry')
      })
    })
  })

  describe('Calibration', () => {
    describe('saveCourtCalibration', () => {
      it('should save court calibration with hoop center', async () => {
        const calibrationData = {
          homographyMatrix: [],
          hoopCenter: { x: 0.5, y: 0.3 },
        }

        mockApi.post.mockResolvedValue({})

        await saveCourtCalibration('session-123', 'user-123', calibrationData)

        expect(mockApi.post).toHaveBeenCalledWith(
          '/workouts/sessions/session-123/calibration?userId=user-123',
          {
            hoopCenterX: 0.5,
            hoopCenterY: 0.3,
            homographyMatrix: null,
          }
        )
      })

      it('should save court calibration with homography matrix', async () => {
        const calibrationData = {
          homographyMatrix: [1, 0, 0, 0, 1, 0, 0, 0, 1],
          hoopCenter: { x: 0.5, y: 0.3 },
        }

        mockApi.post.mockResolvedValue({})

        await saveCourtCalibration('session-123', 'user-123', calibrationData)

        expect(mockApi.post).toHaveBeenCalledWith(
          '/workouts/sessions/session-123/calibration?userId=user-123',
          {
            hoopCenterX: 0.5,
            hoopCenterY: 0.3,
            homographyMatrix: [1, 0, 0, 0, 1, 0, 0, 0, 1],
          }
        )
      })

      it('should save court calibration with court corners', async () => {
        const calibrationData = {
          homographyMatrix: [1, 0, 0, 0, 1, 0, 0, 0, 1],
          hoopCenter: { x: 0.5, y: 0.3 },
          courtCorners: {
            topLeft: { x: 0.1, y: 0.1 },
            topRight: { x: 0.9, y: 0.1 },
            bottomRight: { x: 0.9, y: 0.9 },
            bottomLeft: { x: 0.1, y: 0.9 },
          },
        }

        mockApi.post.mockResolvedValue({})

        await saveCourtCalibration('session-123', 'user-123', calibrationData)

        expect(mockApi.post).toHaveBeenCalledWith(
          '/workouts/sessions/session-123/calibration?userId=user-123',
          expect.objectContaining({
            hoopCenterX: 0.5,
            hoopCenterY: 0.3,
            threePointLineTopX: 0.1,
            threePointLineTopY: 0.1,
            threePointLineRightX: 0.9,
            threePointLineRightY: 0.1,
            sidelineRightX: 0.9,
            sidelineRightY: 0.9,
            sidelineLeftX: 0.1,
            sidelineLeftY: 0.9,
          })
        )
      })
    })
  })

  describe('AI Tracking Data', () => {
    describe('saveFrameData', () => {
      it('should save frame data', async () => {
        const payload = {
          frameTimestamp: 123456789,
          ballX: 0.5,
          ballY: 0.4,
          ballConfidence: 0.9,
          hoopX: 0.3,
          hoopY: 0.2,
          hoopConfidence: 0.85,
          ballVelocityX: 0.1,
          ballVelocityY: -0.2,
          shotDetected: false,
        }

        mockApi.post.mockResolvedValue({})

        await saveFrameData('session-123', 'user-123', payload)

        expect(mockApi.post).toHaveBeenCalledWith(
          '/workouts/sessions/session-123/frames?userId=user-123',
          payload
        )
      })

      it('should handle errors gracefully (best-effort)', async () => {
        const payload = {
          frameTimestamp: 123456789,
          ballX: 0.5,
          ballY: 0.4,
        }

        mockApi.post.mockRejectedValue(new Error('Network error'))

        // Should not throw error
        await expect(
          saveFrameData('session-123', 'user-123', payload)
        ).resolves.toBeUndefined()
      })
    })

    describe('savePoseAnalysis', () => {
      it('should save pose analysis data', async () => {
        const payload = {
          shotEventId: 'shot-1',
          elbowAngle: 85,
          kneeAngle: 120,
          shoulderAngle: 90,
          releaseAngle: 48,
          releaseHeight: 2.1,
          shotSmoothness: 0.8,
        }

        mockApi.post.mockResolvedValue({})

        await savePoseAnalysis('session-123', 'user-123', payload)

        expect(mockApi.post).toHaveBeenCalledWith(
          '/workouts/sessions/session-123/pose-analysis?userId=user-123',
          payload
        )
      })

      it('should handle errors gracefully (best-effort)', async () => {
        const payload = {
          shotEventId: 'shot-1',
          elbowAngle: 85,
        }

        mockApi.post.mockRejectedValue(new Error('Network error'))

        // Should not throw error
        await expect(
          savePoseAnalysis('session-123', 'user-123', payload)
        ).resolves.toBeUndefined()
      })
    })
  })
})
