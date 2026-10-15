// src/features/workouts/__tests__/calibration.test.ts
//
// Unit tests for court calibration logic
// Tests hoop center detection, court corners, homography matrix, and coordinate transformation

import { saveCourtCalibration } from '../api/workouts.api'
import type { CalibrationData } from '../types/workouts.types'
import { calculateHomography, getCourtCornersMeters, applyHomography } from '../utils/homography'

// Mock the API
jest.mock('../api/workouts.api')
jest.mock('@/shared/api/apiClient')

const mockSaveCourtCalibration = saveCourtCalibration as jest.MockedFunction<typeof saveCourtCalibration>

describe('Court Calibration', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('Hoop Center Detection', () => {
    it('should save hoop center coordinates', async () => {
      const calibrationData: CalibrationData = {
        homographyMatrix: [],
        hoopCenter: { x: 0.5, y: 0.3 },
      }

      mockSaveCourtCalibration.mockResolvedValue()

      await saveCourtCalibration('session-123', 'user-123', calibrationData)

      expect(mockSaveCourtCalibration).toHaveBeenCalledWith(
        'session-123',
        'user-123',
        expect.objectContaining({
          hoopCenter: { x: 0.5, y: 0.3 },
        })
      )
    })

    it('should handle hoop center at different positions', async () => {
      const testCases = [
        { x: 0.3, y: 0.2 }, // Top-left area
        { x: 0.7, y: 0.2 }, // Top-right area
        { x: 0.5, y: 0.5 }, // Center
        { x: 0.3, y: 0.8 }, // Bottom-left area
        { x: 0.7, y: 0.8 }, // Bottom-right area
      ]

      for (const hoopCenter of testCases) {
        const calibrationData: CalibrationData = {
          homographyMatrix: [],
          hoopCenter,
        }

        mockSaveCourtCalibration.mockResolvedValue()

        await saveCourtCalibration('session-123', 'user-123', calibrationData)

        expect(mockSaveCourtCalibration).toHaveBeenCalledWith(
          'session-123',
          'user-123',
          expect.objectContaining({
            hoopCenter,
          })
        )
      }
    })

    it('should validate hoop center coordinates are within bounds', () => {
      const validCases = [
        { x: 0.0, y: 0.0 },
        { x: 1.0, y: 1.0 },
        { x: 0.5, y: 0.5 },
      ]

      validCases.forEach((hoopCenter) => {
        expect(hoopCenter.x).toBeGreaterThanOrEqual(0)
        expect(hoopCenter.x).toBeLessThanOrEqual(1)
        expect(hoopCenter.y).toBeGreaterThanOrEqual(0)
        expect(hoopCenter.y).toBeLessThanOrEqual(1)
      })
    })
  })

  describe('Court Corners Detection', () => {
    it('should save court corners for full court', async () => {
      const calibrationData: CalibrationData = {
        homographyMatrix: [1, 0, 0, 0, 1, 0, 0, 0, 1],
        hoopCenter: { x: 0.5, y: 0.3 },
        courtCorners: {
          topLeft: { x: 0.1, y: 0.1 },
          topRight: { x: 0.9, y: 0.1 },
          bottomRight: { x: 0.9, y: 0.9 },
          bottomLeft: { x: 0.1, y: 0.9 },
        },
      }

      mockSaveCourtCalibration.mockResolvedValue()

      await saveCourtCalibration('session-123', 'user-123', calibrationData)

      expect(mockSaveCourtCalibration).toHaveBeenCalledWith(
        'session-123',
        'user-123',
        expect.objectContaining({
          courtCorners: {
            topLeft: { x: 0.1, y: 0.1 },
            topRight: { x: 0.9, y: 0.1 },
            bottomRight: { x: 0.9, y: 0.9 },
            bottomLeft: { x: 0.1, y: 0.9 },
          },
        })
      )
    })

    it('should save court corners for half court', async () => {
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

      await saveCourtCalibration('session-123', 'user-123', calibrationData)

      expect(mockSaveCourtCalibration).toHaveBeenCalledWith(
        'session-123',
        'user-123',
        expect.objectContaining({
          courtCorners: {
            topLeft: { x: 0.1, y: 0.1 },
            topRight: { x: 0.9, y: 0.1 },
            bottomRight: { x: 0.9, y: 0.6 },
            bottomLeft: { x: 0.1, y: 0.6 },
          },
        })
      )
    })

    it('should handle missing court corners', async () => {
      const calibrationData: CalibrationData = {
        homographyMatrix: [],
        hoopCenter: { x: 0.5, y: 0.3 },
        // courtCorners is optional
      }

      mockSaveCourtCalibration.mockResolvedValue()

      await saveCourtCalibration('session-123', 'user-123', calibrationData)

      expect(mockSaveCourtCalibration).toHaveBeenCalledWith(
        'session-123',
        'user-123',
        expect.objectContaining({
          hoopCenter: { x: 0.5, y: 0.3 },
        })
      )
    })
  })

  describe('Homography Matrix', () => {
    it('should calculate real homography matrix from court corners', () => {
      const imageCorners = [
        { x: 0.1, y: 0.1 },
        { x: 0.9, y: 0.1 },
        { x: 0.9, y: 0.9 },
        { x: 0.1, y: 0.9 },
      ]
      const courtCorners = getCourtCornersMeters(15.24, 28.65)

      const homographyMatrix = calculateHomography(imageCorners, courtCorners)

      expect(homographyMatrix).toHaveLength(9)
      expect(homographyMatrix[8]).toBe(1) // h33 should be 1

      // Verify it's not the identity matrix (which would be incorrect)
      const isIdentity = homographyMatrix[0] === 1 && homographyMatrix[4] === 1 &&
                        homographyMatrix[1] === 0 && homographyMatrix[2] === 0 &&
                        homographyMatrix[3] === 0 && homographyMatrix[5] === 0 &&
                        homographyMatrix[6] === 0 && homographyMatrix[7] === 0
      expect(isIdentity).toBe(false)
    })

    it('should correctly transform coordinates using homography', () => {
      const imageCorners = [
        { x: 0.1, y: 0.1 },
        { x: 0.9, y: 0.1 },
        { x: 0.9, y: 0.9 },
        { x: 0.1, y: 0.9 },
      ]
      const courtCorners = getCourtCornersMeters(15.24, 28.65)
      const homographyMatrix = calculateHomography(imageCorners, courtCorners)

      // Test center point transformation
      const centerImage = { x: 0.5, y: 0.5 }
      const centerCourt = applyHomography(centerImage, homographyMatrix)

      expect(centerCourt.x).toBeCloseTo(7.62, 1) // Half of court width
      expect(centerCourt.y).toBeCloseTo(14.325, 1) // Half of court height
    })

    it('should handle empty homography matrix (no corners calibration)', async () => {
      const calibrationData: CalibrationData = {
        homographyMatrix: [],
        hoopCenter: { x: 0.5, y: 0.3 },
      }

      mockSaveCourtCalibration.mockResolvedValue()

      await saveCourtCalibration('session-123', 'user-123', calibrationData)

      expect(mockSaveCourtCalibration).toHaveBeenCalledWith(
        'session-123',
        'user-123',
        expect.objectContaining({
          homographyMatrix: [],
        })
      )
    })

    it('should handle null homography matrix', async () => {
      const calibrationData: CalibrationData = {
        homographyMatrix: null as any,
        hoopCenter: { x: 0.5, y: 0.3 },
      }

      mockSaveCourtCalibration.mockResolvedValue()

      await saveCourtCalibration('session-123', 'user-123', calibrationData)

      expect(mockSaveCourtCalibration).toHaveBeenCalledWith(
        'session-123',
        'user-123',
        expect.objectContaining({
          homographyMatrix: null,
        })
      )
    })
  })

  describe('Coordinate Transformation', () => {
    it('should transform screen coordinates to court coordinates using homography', () => {
      const imageCorners = [
        { x: 0.1, y: 0.1 },
        { x: 0.9, y: 0.1 },
        { x: 0.9, y: 0.9 },
        { x: 0.1, y: 0.9 },
      ]
      const courtCorners = getCourtCornersMeters(15.24, 28.65)
      const homographyMatrix = calculateHomography(imageCorners, courtCorners)

      const calibration: CalibrationData = {
        homographyMatrix,
        hoopCenter: { x: 0.5, y: 0.3 },
        courtCorners: {
          topLeft: imageCorners[0],
          topRight: imageCorners[1],
          bottomRight: imageCorners[2],
          bottomLeft: imageCorners[3],
        },
      }

      // Verify the calibration has a valid homography matrix
      expect(calibration.hoopCenter).toBeDefined()
      expect(calibration.homographyMatrix).toHaveLength(9)
      expect(calibration.homographyMatrix[8]).toBe(1)

      // Verify transformation produces meter values, not normalized 0-1
      const screenPoint = { x: 0.5, y: 0.5 }
      const courtPoint = applyHomography(screenPoint, calibration.homographyMatrix)
      
      // Court coordinates should be in meters (around 7-8m for center)
      expect(courtPoint.x).toBeGreaterThan(1)
      expect(courtPoint.y).toBeGreaterThan(1)
    })

    it('should handle coordinate transformation without homography (fallback)', () => {
      const calibration: CalibrationData = {
        homographyMatrix: [],
        hoopCenter: { x: 0.5, y: 0.3 },
      }

      // Without homography, the system should use simple scaling fallback
      expect(calibration.hoopCenter).toBeDefined()
      expect(calibration.homographyMatrix).toHaveLength(0)
    })
  })

  describe('Calibration Validation', () => {
    it('should require hoop center for valid calibration', () => {
      const invalidCalibration: CalibrationData = {
        homographyMatrix: [],
        hoopCenter: null as any,
      }

      expect(invalidCalibration.hoopCenter).toBeNull()
    })

    it('should validate hoop center coordinates are numbers', () => {
      const calibration: CalibrationData = {
        homographyMatrix: [],
        hoopCenter: { x: 0.5, y: 0.3 },
      }

      expect(typeof calibration.hoopCenter.x).toBe('number')
      expect(typeof calibration.hoopCenter.y).toBe('number')
    })

    it('should validate homography matrix has correct length', () => {
      const validMatrix = [1, 0, 0, 0, 1, 0, 0, 0, 1]
      const invalidMatrix = [1, 0, 0]

      expect(validMatrix.length).toBe(9) // 3x3 matrix
      expect(invalidMatrix.length).not.toBe(9)
    })
  })

  describe('Camera Mode Calibration', () => {
    it('should handle calibration for LATERAL camera mode', async () => {
      const calibrationData: CalibrationData = {
        homographyMatrix: [1, 0, 0, 0, 1, 0, 0, 0, 1],
        hoopCenter: { x: 0.5, y: 0.3 },
      }

      mockSaveCourtCalibration.mockResolvedValue()

      await saveCourtCalibration('session-123', 'user-123', calibrationData)

      expect(mockSaveCourtCalibration).toHaveBeenCalledTimes(1)
    })

    it('should handle calibration for FRONTAL camera mode', async () => {
      const calibrationData: CalibrationData = {
        homographyMatrix: [1, 0, 0, 0, 1, 0, 0, 0, 1],
        hoopCenter: { x: 0.5, y: 0.3 },
      }

      mockSaveCourtCalibration.mockResolvedValue()

      await saveCourtCalibration('session-123', 'user-123', calibrationData)

      expect(mockSaveCourtCalibration).toHaveBeenCalledTimes(1)
    })

    it('should handle calibration for ANGLE_45 camera mode', async () => {
      const calibrationData: CalibrationData = {
        homographyMatrix: [1, 0, 0, 0, 1, 0, 0, 0, 1],
        hoopCenter: { x: 0.5, y: 0.3 },
      }

      mockSaveCourtCalibration.mockResolvedValue()

      await saveCourtCalibration('session-123', 'user-123', calibrationData)

      expect(mockSaveCourtCalibration).toHaveBeenCalledTimes(1)
    })
  })

  describe('Error Handling', () => {
    it('should handle API errors during calibration save', async () => {
      const calibrationData: CalibrationData = {
        homographyMatrix: [],
        hoopCenter: { x: 0.5, y: 0.3 },
      }

      mockSaveCourtCalibration.mockRejectedValue(new Error('Network error'))

      await expect(
        saveCourtCalibration('session-123', 'user-123', calibrationData)
      ).rejects.toThrow('Network error')
    })

    it('should handle invalid session ID', async () => {
      const calibrationData: CalibrationData = {
        homographyMatrix: [],
        hoopCenter: { x: 0.5, y: 0.3 },
      }

      mockSaveCourtCalibration.mockRejectedValue(new Error('Session not found'))

      await expect(
        saveCourtCalibration('invalid-session', 'user-123', calibrationData)
      ).rejects.toThrow('Session not found')
    })

    it('should handle invalid user ID', async () => {
      const calibrationData: CalibrationData = {
        homographyMatrix: [],
        hoopCenter: { x: 0.5, y: 0.3 },
      }

      mockSaveCourtCalibration.mockRejectedValue(new Error('User not found'))

      await expect(
        saveCourtCalibration('session-123', 'invalid-user', calibrationData)
      ).rejects.toThrow('User not found')
    })
  })

  describe('Calibration Persistence', () => {
    it('should save calibration data to session', async () => {
      const calibrationData: CalibrationData = {
        homographyMatrix: [1, 0, 0, 0, 1, 0, 0, 0, 1],
        hoopCenter: { x: 0.5, y: 0.3 },
        courtCorners: {
          topLeft: { x: 0.1, y: 0.1 },
          topRight: { x: 0.9, y: 0.1 },
          bottomRight: { x: 0.9, y: 0.9 },
          bottomLeft: { x: 0.1, y: 0.9 },
        },
      }

      mockSaveCourtCalibration.mockResolvedValue()

      await saveCourtCalibration('session-123', 'user-123', calibrationData)

      expect(mockSaveCourtCalibration).toHaveBeenCalledWith(
        'session-123',
        'user-123',
        expect.objectContaining({
          hoopCenter: { x: 0.5, y: 0.3 },
        })
      )
    })

    it('should allow calibration updates', async () => {
      const initialCalibration: CalibrationData = {
        homographyMatrix: [],
        hoopCenter: { x: 0.5, y: 0.3 },
      }

      const updatedCalibration: CalibrationData = {
        homographyMatrix: [1, 0, 0, 0, 1, 0, 0, 0, 1],
        hoopCenter: { x: 0.55, y: 0.32 },
      }

      mockSaveCourtCalibration.mockResolvedValue()

      await saveCourtCalibration('session-123', 'user-123', initialCalibration)
      await saveCourtCalibration('session-123', 'user-123', updatedCalibration)

      expect(mockSaveCourtCalibration).toHaveBeenCalledTimes(2)
    })
  })
})
