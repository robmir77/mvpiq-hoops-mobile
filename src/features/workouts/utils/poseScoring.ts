// Pose Scoring Utility
// Calcola un punteggio di qualità della pose dai keypoints di MoveNet

import type { PoseKeypoints, RawPoseFrame } from '../types/workouts.types'

/**
 * Calcola il punteggio della pose per un singolo frame
 * Punteggio basato su: angolo gomito, allineamento spalle, stabilità
 */
function calculateFrameScore(keypoints: PoseKeypoints): number {
  let score = 100
  let factors = 0

  // 1. Angolo del gomito (ideale ~90° per tiro)
  if (keypoints.leftShoulder && keypoints.leftElbow && keypoints.leftWrist) {
    const elbowAngle = calculateAngle(
      keypoints.leftShoulder,
      keypoints.leftElbow,
      keypoints.leftWrist
    )
    const idealAngle = 90
    const angleDiff = Math.abs(elbowAngle - idealAngle)
    const elbowScore = Math.max(0, 100 - angleDiff * 2) // -2 punti per grado di differenza
    score = (score * factors + elbowScore) / (factors + 1)
    factors++
  }

  if (keypoints.rightShoulder && keypoints.rightElbow && keypoints.rightWrist) {
    const elbowAngle = calculateAngle(
      keypoints.rightShoulder,
      keypoints.rightElbow,
      keypoints.rightWrist
    )
    const idealAngle = 90
    const angleDiff = Math.abs(elbowAngle - idealAngle)
    const elbowScore = Math.max(0, 100 - angleDiff * 2)
    score = (score * factors + elbowScore) / (factors + 1)
    factors++
  }

  // 2. Allineamento spalle (devono essere orizzontali)
  if (keypoints.leftShoulder && keypoints.rightShoulder) {
    const shoulderAlignment = Math.abs(keypoints.leftShoulder.y - keypoints.rightShoulder.y)
    const alignmentScore = Math.max(0, 100 - shoulderAlignment * 500) // Penalizza disallineamento
    score = (score * factors + alignmentScore) / (factors + 1)
    factors++
  }

  // 3. Confidenza media dei keypoints
  const confidences = Object.values(keypoints).map(k => k?.score ?? 0).filter(s => s > 0)
  if (confidences.length > 0) {
    const avgConfidence = confidences.reduce((a, b) => a + b, 0) / confidences.length
    const confidenceScore = avgConfidence * 100
    score = (score * factors + confidenceScore) / (factors + 1)
    factors++
  }

  return Math.round(score)
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
