// MoveNetPoseEstimator
// Pure class for MoveNet pose estimation parsing
// Worklet-safe, no React dependencies
// Extracted from poseParser.ts

const SCORE_THRESHOLD = 0.03
const EXPECTED_KEYPOINTS = 17

const KP_MAP: Record<number, string> = {
  5: 'leftShoulder',
  6: 'rightShoulder',
  7: 'leftElbow',
  8: 'rightElbow',
  9: 'leftWrist',
  10: 'rightWrist',
  11: 'leftHip',
  12: 'rightHip',
  13: 'leftKnee',
  14: 'rightKnee',
  15: 'leftAnkle',
  16: 'rightAnkle',
}

export interface Keypoint {
  x: number
  y: number
  confidence: number
}

export interface PoseResult {
  keypoints: Record<string, Keypoint>
  confidence: number
  validKeypointsCount: number
}

export class MoveNetPoseEstimator {
  private scoreThreshold: number

  constructor(scoreThreshold: number = SCORE_THRESHOLD) {
    this.scoreThreshold = scoreThreshold
  }

  // Parse MoveNet output to pose keypoints
  // Worklet-safe - marked with 'worklet' directive for Reanimated
  // MoveNet output shape: [1, 1, 17, 3] -> flat Float32Array of 51 elements
  // Each keypoint: [y, x, score]
  parseOutput(output: Float32Array, expectedKeypoints: number = EXPECTED_KEYPOINTS): PoseResult {
    'worklet'

    const keypoints: Record<string, Keypoint> = {}
    const scores: number[] = []

    for (let i = 0; i < expectedKeypoints; i++) {
      const offset = i * 3
      const yNorm = output[offset]
      const xNorm = output[offset + 1]
      const score = output[offset + 2]

      scores.push(score)

      if (score === undefined || score < this.scoreThreshold) continue

      const name = KP_MAP[i]
      if (name) {
        keypoints[name] = { x: xNorm, y: yNorm, confidence: score }
      }
    }

    // Calculate confidence statistics
    const validCount = scores.filter(s => s >= this.scoreThreshold).length
    const avgConf = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0

    return {
      keypoints,
      confidence: avgConf,
      validKeypointsCount: validCount,
    }
  }

  // Set score threshold
  setScoreThreshold(threshold: number): void {
    this.scoreThreshold = threshold
  }
}
