// src/vision/poseParser.ts
//
// MoveNet output parser
// Converts raw MoveNet output to PoseKeypoints interface
// NO image data, only keypoints

import type { PoseKeypoints } from './types'

const SCORE_THRESHOLD = 0.03

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

export function parseMoveNetOutput(outputData: Float32Array, expectedKeypoints = 17): PoseKeypoints {
  'worklet'

  const keypoints: PoseKeypoints = {}
  const scores: number[] = []

  // MoveNet output shape: [1, 1, 17, 3] -> flat Float32Array of 51 elements
  // Each keypoint: [y, x, score]
  for (let i = 0; i < expectedKeypoints; i++) {
    const offset = i * 3
    const yNorm = outputData[offset]
    const xNorm = outputData[offset + 1]
    const score = outputData[offset + 2]

    scores.push(score)

    if (score === undefined || score < SCORE_THRESHOLD) continue

    const name = KP_MAP[i]
    if (name) {
      // MoveNet output: [y, x, score] - use coordinates directly
      (keypoints as any)[name] = { x: xNorm, y: yNorm, score }
    }
  }

  // Calculate confidence statistics
  const validCount = scores.filter(s => s >= SCORE_THRESHOLD).length
  const avgConf = scores.reduce((a, b) => a + b, 0) / scores.length
  const minConf = Math.min(...scores)
  const maxConf = Math.max(...scores)

  console.log(`[PoseParser] minConf=${SCORE_THRESHOLD.toFixed(2)} valid=${validCount}/${expectedKeypoints} avgConf=${avgConf.toFixed(2)} min=${minConf.toFixed(2)} max=${maxConf.toFixed(2)}`)

  return keypoints
}
