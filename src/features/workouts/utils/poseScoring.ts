// Pose Scoring Utility
// Calcola un punteggio di qualità della pose dai keypoints di MoveNet

import type { PoseKeypoints, RawPoseFrame, BackendPoseKeypoint } from '../types/workouts.types'

/**
 * Calcola il punteggio della pose per un singolo frame
 * Punteggio basato su: angolo gomito, allineamento spalle, stabilità
 */
function calculateFrameScore(keypoints: PoseKeypoints | BackendPoseKeypoint[]): number {
  let score = 100
  let factors = 0

  // Converti keypoints in formato array se necessario
  const kpArray = Array.isArray(keypoints) 
    ? keypoints 
    : convertToBackendFormat(keypoints)

  // Trova keypoints per indice (MoveNet ordina: 0=left_shoulder, 1=right_shoulder, 2=left_elbow, 3=right_elbow, 4=left_wrist, 5=right_wrist)
  const leftShoulder = kpArray[0]
  const rightShoulder = kpArray[1]
  const leftElbow = kpArray[2]
  const rightElbow = kpArray[3]
  const leftWrist = kpArray[4]
  const rightWrist = kpArray[5]

  // 1. Angolo del gomito (ideale ~90° per tiro)
  if (leftShoulder && leftElbow && leftWrist) {
    const elbowAngle = calculateAngle(
      { x: leftShoulder.x, y: leftShoulder.y },
      { x: leftElbow.x, y: leftElbow.y },
      { x: leftWrist.x, y: leftWrist.y }
    )
    const idealAngle = 90
    const angleDiff = Math.abs(elbowAngle - idealAngle)
    const elbowScore = Math.max(0, 100 - angleDiff * 2) // -2 punti per grado di differenza
    score = (score * factors + elbowScore) / (factors + 1)
    factors++
  }

  if (rightShoulder && rightElbow && rightWrist) {
    const elbowAngle = calculateAngle(
      { x: rightShoulder.x, y: rightShoulder.y },
      { x: rightElbow.x, y: rightElbow.y },
      { x: rightWrist.x, y: rightWrist.y }
    )
    const idealAngle = 90
    const angleDiff = Math.abs(elbowAngle - idealAngle)
    const elbowScore = Math.max(0, 100 - angleDiff * 2)
    score = (score * factors + elbowScore) / (factors + 1)
    factors++
  }

  // 2. Allineamento spalle (devono essere orizzontali)
  if (leftShoulder && rightShoulder) {
    const shoulderAlignment = Math.abs(leftShoulder.y - rightShoulder.y)
    const alignmentScore = Math.max(0, 100 - shoulderAlignment * 500) // Penalizza disallineamento
    score = (score * factors + alignmentScore) / (factors + 1)
    factors++
  }

  // 3. Confidenza media dei keypoints
  const confidences = kpArray.map(k => k?.confidence ?? 0).filter(s => s > 0)
  if (confidences.length > 0) {
    const avgConfidence = confidences.reduce((a, b) => a + b, 0) / confidences.length
    const confidenceScore = avgConfidence * 100
    score = (score * factors + confidenceScore) / (factors + 1)
    factors++
  }

  return Math.round(score)
}

/**
 * Converte il formato PoseKeypoints (oggetto con proprietà nominate) in formato array BackendPoseKeypoint
 */
function convertToBackendFormat(keypoints: PoseKeypoints): BackendPoseKeypoint[] {
  const result: BackendPoseKeypoint[] = []
  const keyMapping: { [key in keyof PoseKeypoints]: number } = {
    leftShoulder: 0,
    rightShoulder: 1,
    leftElbow: 2,
    rightElbow: 3,
    leftWrist: 4,
    rightWrist: 5,
    leftHip: 6,
    rightHip: 7,
    leftKnee: 8,
    rightKnee: 9,
    leftAnkle: 10,
    rightAnkle: 11,
  }

  for (const [key, value] of Object.entries(keypoints)) {
    if (value && typeof value === 'object') {
      const index = keyMapping[key as keyof PoseKeypoints]
      if (index !== undefined) {
        result[index] = {
          name: `keypoint_${index}`,
          x: value.x,
          y: value.y,
          confidence: value.score,
        }
      }
    }
  }

  return result
}

/**
 * Calcola l'angolo tra tre punti (in gradi)
 */
function calculateAngle(
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number }
): number {
  const radians = Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(a.y - b.y, a.x - b.x)
  let angle = Math.abs(radians * 180.0 / Math.PI)
  if (angle > 180.0) angle = 360 - angle
  return angle
}

/**
 * Calcola il punteggio medio della pose dai frame grezzi
 */
export function calculatePoseScore(rawPoseFrames: RawPoseFrame[]): number {
  if (!rawPoseFrames || rawPoseFrames.length === 0) {
    return 0
  }

  const scores = rawPoseFrames.map(frame => calculateFrameScore(frame.keypoints))
  const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length
  return Math.round(avgScore)
}
