// src/features/workouts/__tests__/homography.test.ts
//
// Unit tests for homography matrix calculation
// Tests DLT algorithm, coordinate transformation, and court corner utilities

import {
  calculateHomography,
  getCourtCornersMeters,
  applyHomography,
} from '../utils/homography'

describe('Homography Utilities', () => {
  describe('calculateHomography', () => {
    it('should calculate homography matrix for 4 point correspondences', () => {
      // Simple case: identity-like transformation
      const srcPoints = [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ]
      const dstPoints = [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ]

      const H = calculateHomography(srcPoints, dstPoints)

      expect(H).toHaveLength(9)
      expect(H[8]).toBe(1) // h33 should be 1 (scale normalization)
    })

    it('should throw error for insufficient points', () => {
      const srcPoints = [{ x: 0, y: 0 }, { x: 1, y: 0 }]
      const dstPoints = [{ x: 0, y: 0 }, { x: 10, y: 0 }]

      expect(() => calculateHomography(srcPoints, dstPoints)).toThrow(
        'Homography requires exactly 4 point correspondences'
      )
    })

    it('should handle perspective transformation', () => {
      // Simulate a perspective distortion
      const srcPoints = [
        { x: 0.1, y: 0.1 },  // Top-left
        { x: 0.9, y: 0.1 },  // Top-right
        { x: 0.9, y: 0.9 },  // Bottom-right
        { x: 0.1, y: 0.9 },  // Bottom-left
      ]
      const dstPoints = [
        { x: 0, y: 0 },
        { x: 15.24, y: 0 },
        { x: 15.24, y: 28.65 },
        { x: 0, y: 28.65 },
      ]

      const H = calculateHomography(srcPoints, dstPoints)

      expect(H).toHaveLength(9)
      // The matrix should not be identity for a non-trivial transformation
      const isIdentity = H[0] === 1 && H[4] === 1 && H[8] === 1 &&
                        H[1] === 0 && H[2] === 0 && H[3] === 0 &&
                        H[5] === 0 && H[6] === 0 && H[7] === 0
      expect(isIdentity).toBe(false)
    })

    it('should produce consistent results for same inputs', () => {
      const srcPoints = [
        { x: 0.1, y: 0.1 },
        { x: 0.9, y: 0.1 },
        { x: 0.9, y: 0.9 },
        { x: 0.1, y: 0.9 },
      ]
      const dstPoints = [
        { x: 0, y: 0 },
        { x: 15.24, y: 0 },
        { x: 15.24, y: 28.65 },
        { x: 0, y: 28.65 },
      ]

      const H1 = calculateHomography(srcPoints, dstPoints)
      const H2 = calculateHomography(srcPoints, dstPoints)

      expect(H1).toEqual(H2)
    })
  })

  describe('getCourtCornersMeters', () => {
    it('should return 4 corner points for default court dimensions', () => {
      const corners = getCourtCornersMeters()

      expect(corners).toHaveLength(4)
      expect(corners[0]).toEqual({ x: 0, y: 0 })
      expect(corners[1]).toEqual({ x: 15.24, y: 0 })
      expect(corners[2]).toEqual({ x: 15.24, y: 28.65 })
      expect(corners[3]).toEqual({ x: 0, y: 28.65 })
    })

    it('should use custom court dimensions when provided', () => {
      const corners = getCourtCornersMeters(10, 20)

      expect(corners).toHaveLength(4)
      expect(corners[0]).toEqual({ x: 0, y: 0 })
      expect(corners[1]).toEqual({ x: 10, y: 0 })
      expect(corners[2]).toEqual({ x: 10, y: 20 })
      expect(corners[3]).toEqual({ x: 0, y: 20 })
    })
  })

  describe('applyHomography', () => {
    it('should transform point using homography matrix', () => {
      // Identity-like transformation
      const H = [1, 0, 0, 0, 1, 0, 0, 0, 1]
      const point = { x: 0.5, y: 0.5 }

      const result = applyHomography(point, H)

      expect(result.x).toBeCloseTo(0.5)
      expect(result.y).toBeCloseTo(0.5)
    })

    it('should apply scaling transformation', () => {
      // Scale by 10 in x, 10 in y
      const H = [10, 0, 0, 0, 10, 0, 0, 0, 1]
      const point = { x: 0.5, y: 0.5 }

      const result = applyHomography(point, H)

      expect(result.x).toBeCloseTo(5)
      expect(result.y).toBeCloseTo(5)
    })

    it('should apply translation', () => {
      // Translate by 5 in x, 3 in y
      const H = [1, 0, 5, 0, 1, 3, 0, 0, 1]
      const point = { x: 0.5, y: 0.5 }

      const result = applyHomography(point, H)

      expect(result.x).toBeCloseTo(5.5)
      expect(result.y).toBeCloseTo(3.5)
    })

    it('should throw error for singular transformation', () => {
      // This matrix causes wz = 0 for the test point (division by zero)
      // wz = H[6]*x + H[7]*y + H[8] = 1*0.5 + 1*0.5 - 1 = 0
      const H = [1, 0, 0, 0, 1, 0, 1, 1, -1]
      const point = { x: 0.5, y: 0.5 }

      expect(() => applyHomography(point, H)).toThrow()
    })
  })

  describe('End-to-end calibration transformation', () => {
    it('should correctly transform normalized image coordinates to court meters', () => {
      // Simulate a calibration where user marks court corners
      const imageCorners = [
        { x: 0.1, y: 0.1 },  // Top-left in image
        { x: 0.9, y: 0.1 },  // Top-right in image
        { x: 0.9, y: 0.9 },  // Bottom-right in image
        { x: 0.1, y: 0.9 },  // Bottom-left in image
      ]

      const courtCorners = getCourtCornersMeters(15.24, 28.65)

      const H = calculateHomography(imageCorners, courtCorners)

      // Test that center of image maps to center of court
      const centerImage = { x: 0.5, y: 0.5 }
      const centerCourt = applyHomography(centerImage, H)

      expect(centerCourt.x).toBeCloseTo(7.62, 1) // Half of 15.24
      expect(centerCourt.y).toBeCloseTo(14.325, 1) // Half of 28.65
    })

    it('should handle non-uniform corner placement', () => {
      // Simulate a perspective view where corners are not uniformly placed
      const imageCorners = [
        { x: 0.15, y: 0.2 },   // Top-left (perspective)
        { x: 0.85, y: 0.15 },  // Top-right (perspective)
        { x: 0.9, y: 0.85 },   // Bottom-right
        { x: 0.1, y: 0.9 },    // Bottom-left
      ]

      const courtCorners = getCourtCornersMeters(15.24, 28.65)

      const H = calculateHomography(imageCorners, courtCorners)

      expect(H).toHaveLength(9)
      
      // Verify that corners map correctly
      imageCorners.forEach((src, i) => {
        const dst = applyHomography(src, H)
        expect(dst.x).toBeCloseTo(courtCorners[i].x, 0.5)
        expect(dst.y).toBeCloseTo(courtCorners[i].y, 0.5)
      })
    })
  })
})
