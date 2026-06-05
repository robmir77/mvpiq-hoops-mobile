// src/vision/poseParser.ts
//
// MoveNet output parser
// Converts raw MoveNet output to PoseKeypoints interface
// NO image data, only keypoints

const INPUT_SIZE = 192
const SCORE_THRESHOLD = 0.1

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

export function parseMoveNetOutput(outputData: Float32Array): {
  [key: string]: { x: number; y: number; score: number }
} {
  const keypoints: { [key: string]: { x: number; y: number; score: number } } = {}
  
  console.log('[PoseParser] Output data length:', outputData.length)
  console.log('[PoseParser] First few values:', outputData.slice(0, 10))
  
  // MoveNet output shape: [1, 1, 17, 3] -> flat Float32Array of 51 elements
  // Each keypoint: [y, x, score]
  for (let i = 0; i < 17; i++) {
    const offset = i * 3
    const yNorm = outputData[offset]
    const xNorm = outputData[offset + 1]
    const score = outputData[offset + 2]
    
    console.log(`[PoseParser] KP ${i}: y=${yNorm.toFixed(3)}, x=${xNorm.toFixed(3)}, score=${score.toFixed(3)}`)
    
    if (score < SCORE_THRESHOLD) continue
    
    const name = KP_MAP[i]
    if (name) {
      keypoints[name] = { x: xNorm, y: yNorm, score }
    }
  }
  
  console.log('[PoseParser] Keypoints after threshold:', Object.keys(keypoints).length)
  return keypoints
}
