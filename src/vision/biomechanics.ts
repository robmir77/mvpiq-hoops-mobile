// src/vision/biomechanics.ts
//
// Biomechanical analysis from pose keypoints
// Calculates joint angles for shot analysis

import type { PoseKeypoints, JointAngles } from './types'

function angleBetween(
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number }
): number {
  'worklet'

  const ba = { x: a.x - b.x, y: a.y - b.y }
  const bc = { x: c.x - b.x, y: c.y - b.y }
  const dot = ba.x * bc.x + ba.y * bc.y
  const magBA = Math.sqrt(ba.x ** 2 + ba.y ** 2)
  const magBC = Math.sqrt(bc.x ** 2 + bc.y ** 2)
  if (magBA < 1e-6 || magBC < 1e-6) return 0
  return Math.acos(Math.max(-1, Math.min(1, dot / (magBA * magBC)))) * (180 / Math.PI)
}

export function computeJointAngles(keypoints: PoseKeypoints): Partial<JointAngles> {
  'worklet'

  const angles: Partial<JointAngles> = {}
  
  // Elbow angle (shoulder-elbow-wrist)
  if (keypoints.rightShoulder && keypoints.rightElbow && keypoints.rightWrist) {
    angles.elbowAngle = angleBetween(
      keypoints.rightShoulder,
      keypoints.rightElbow,
      keypoints.rightWrist
    )
  }
  
  // Knee angle (hip-knee-ankle)
  if (keypoints.rightHip && keypoints.rightKnee && keypoints.rightAnkle) {
    angles.kneeAngle = angleBetween(
      keypoints.rightHip,
      keypoints.rightKnee,
      keypoints.rightAnkle
    )
  }
  
  // Shoulder angle (elbow-shoulder-hip)
  if (keypoints.rightElbow && keypoints.rightShoulder && keypoints.rightHip) {
    angles.shoulderAngle = angleBetween(
      keypoints.rightElbow,
      keypoints.rightShoulder,
      keypoints.rightHip
    )
  }
  
  // Wrist angle (relative to horizontal)
  if (keypoints.rightElbow && keypoints.rightWrist) {
    const dx = keypoints.rightWrist.x - keypoints.rightElbow.x
    const dy = keypoints.rightWrist.y - keypoints.rightElbow.y
    angles.wristAngle = Math.atan2(Math.abs(dy), Math.abs(dx)) * (180 / Math.PI)
  }
  
  return angles
}

export function calculateReleaseAngle(
  wrist: { x: number; y: number },
  elbow: { x: number; y: number }
): number {
  const dx = wrist.x - elbow.x
  const dy = wrist.y - elbow.y
  return Math.atan2(-dy, dx) * (180 / Math.PI) // Negative dy because y is inverted in image coords
}

export function calculateReleaseHeight(
  wrist: { x: number; y: number },
  hip: { x: number; y: number }
): number {
  // Height relative to hip (normalized 0-1)
  return hip.y - wrist.y // Inverted because y increases downward
}
