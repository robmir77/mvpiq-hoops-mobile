// src/features/workouts/utils/homography.ts
//
// Homography matrix calculation using DLT (Direct Linear Transform)
// Maps image coordinates (normalized 0-1) to court coordinates (meters)

export interface Point {
  x: number
  y: number
}

/**
 * Calculate homography matrix from 4 source points to 4 destination points
 * using the Direct Linear Transform (DLT) algorithm
 *
 * @param srcPoints - 4 source points (e.g., image coordinates, normalized 0-1)
 * @param dstPoints - 4 destination points (e.g., court coordinates in meters)
 * @returns 3x3 homography matrix as flat array [h11, h12, h13, h21, h22, h23, h31, h32, h33]
 */
export function calculateHomography(
  srcPoints: Point[],
  dstPoints: Point[]
): number[] {
  if (srcPoints.length !== 4 || dstPoints.length !== 4) {
    throw new Error('Homography requires exactly 4 point correspondences')
  }

  // Build the 8x8 matrix A for the DLT algorithm
  // For each point correspondence (x, y) -> (x', y'), we get 2 equations:
  // x' = (h11*x + h12*y + h13) / (h31*x + h32*y + h33)
  // y' = (h21*x + h22*y + h23) / (h31*x + h32*y + h33)
  //
  // Rearranged to linear form:
  // h11*x + h12*y + h13 - h31*x*x' - h32*y*x' - h33*x' = 0
  // h21*x + h22*y + h23 - h31*x*y' - h32*y*y' - h33*y' = 0
  //
  // We set h33 = 1 (scale normalization), leaving 8 unknowns

  const A: number[][] = []
  const b: number[] = []

  for (let i = 0; i < 4; i++) {
    const x = srcPoints[i].x
    const y = srcPoints[i].y
    const xp = dstPoints[i].x
    const yp = dstPoints[i].y

    // First equation for this point
    A.push([x, y, 1, 0, 0, 0, -x * xp, -y * xp])
    b.push(xp)

    // Second equation for this point
    A.push([0, 0, 0, x, y, 1, -x * yp, -y * yp])
    b.push(yp)
  }

  // Solve the linear system A * h = b Gaussian elimination
  const h = solveLinearSystem(A, b)

  // Return the 3x3 homography matrix with h33 = 1
  return [
    h[0], h[1], h[2],  // h11, h12, h13
    h[3], h[4], h[5],  // h21, h22, h23
    h[6], h[7], 1,      // h31, h32, h33
  ]
}

/**
 * Solve linear system A * x = b using Gaussian elimination with partial pivoting
 */
function solveLinearSystem(A: number[][], b: number[]): number[] {
  const n = A.length
  const m = A[0].length

  // Create augmented matrix [A | b]
  const aug: number[][] = []
  for (let i = 0; i < n; i++) {
    aug[i] = [...A[i], b[i]]
  }

  // Gaussian elimination with partial pivoting
  for (let col = 0; col < m; col++) {
    // Find pivot
    let maxRow = col
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(aug[row][col]) > Math.abs(aug[maxRow][col])) {
        maxRow = row
      }
    }

    // Swap rows
    [aug[col], aug[maxRow]] = [aug[maxRow], aug[col]]

    // Skip if pivot is zero (singular matrix)
    if (Math.abs(aug[col][col]) < 1e-10) {
      throw new Error('Singular matrix - cannot solve')
    }

    // Eliminate below
    for (let row = col + 1; row < n; row++) {
      const factor = aug[row][col] / aug[col][col]
      for (let j = col; j <= m; j++) {
        aug[row][j] -= factor * aug[col][j]
      }
    }
  }

  // Back substitution
  const x = new Array(m).fill(0)
  for (let i = n - 1; i >= 0; i--) {
    let sum = aug[i][m]
    for (let j = i + 1; j < m; j++) {
      sum -= aug[i][j] * x[j]
    }
    x[i] = sum / aug[i][i]
  }

  return x
}

/**
 * Get standard basketball court corner coordinates in meters
 * Assuming half-court calibration with hoop at one end
 *
 * @param courtWidthM - Court width in meters (default 15.24m for FIBA/NBA half-court)
 * @param courtHeightM - Court height in meters (default 28.65m for full court, use ~14m for half-court)
 * @returns 4 corner points in meters: [topLeft, topRight, bottomRight, bottomLeft]
 */
export function getCourtCornersMeters(
  courtWidthM: number = 15.24,
  courtHeightM: number = 28.65
): Point[] {
  return [
    { x: 0, y: 0 },                    // Top-left (near hoop baseline)
    { x: courtWidthM, y: 0 },          // Top-right (near hoop baseline)
    { x: courtWidthM, y: courtHeightM }, // Bottom-right (far baseline)
    { x: 0, y: courtHeightM },        // Bottom-left (far baseline)
  ]
}

/**
 * Apply homography transformation to a point
 *
 * @param point - Source point (normalized 0-1)
 * @param homographyMatrix - 3x3 homography matrix as flat array
 * @returns Transformed point in destination coordinates
 */
export function applyHomography(point: Point, homographyMatrix: number[]): Point {
  const H = homographyMatrix
  const x = point.x
  const y = point.y

  const wx = H[0] * x + H[1] * y + H[2]
  const wy = H[3] * x + H[4] * y + H[5]
  const wz = H[6] * x + H[7] * y + H[8]

  if (Math.abs(wz) < 1e-10) {
    throw new Error('Invalid homography transformation - division by zero')
  }

  return {
    x: wx / wz,
    y: wy / wz,
  }
}
