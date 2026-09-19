// src/vision/poseParser.ts
//
// MoveNet output parser
// Converts raw MoveNet output to PoseKeypoints interface
// NO image data, only keypoints

import type { PoseKeypoints } from './types'

const SCORE_THRESHOLD = 0.15

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

  // Log first few values to see the scale
  if (outputData.length > 0) {
    console.log(`[PoseParser] Raw values (0-8): ${outputData[0]?.toFixed(2)}, ${outputData[1]?.toFixed(2)}, ${outputData[2]?.toFixed(2)}, ${outputData[3]?.toFixed(2)}, ${outputData[4]?.toFixed(2)}, ${outputData[5]?.toFixed(2)}`)
  }

  // MoveNet output shape: [1, 1, 17, 3] -> flat Float32Array of 51 elements
  // Each keypoint: [y, x, score]
  // Apply same coordinate transformation as ball detection: x/y swap + horizontal flip
  for (let i = 0; i < expectedKeypoints; i++) {
    const offset = i * 3
    const yNorm = outputData[offset]
    const xNorm = outputData[offset + 1]
    const score = outputData[offset + 2]

    if (score === undefined || score < SCORE_THRESHOLD) continue

    const name = KP_MAP[i]
    if (name) {
      // MoveNet output: [y, x, score] - use coordinates directly
      (keypoints as any)[name] = { x: xNorm, y: yNorm, score }
    }
  }

  return keypoints
}
