// src/vision/types.ts
//
// Core types for the new zero-image-passing architecture
// Only processed data crosses Worklet → JS boundary

export interface BoundingBox {
  x: number
  y: number
  width: number
  height: number
}

export interface BallDetection {
  ball?: {
    x: number
    y: number
    width: number
    height: number
    confidence: number
  }
  timestamp: number
}

export interface PoseKeypoint {
  x: number
  y: number
  score: number
}

export interface PoseKeypoints {
  leftShoulder?: PoseKeypoint
  rightShoulder?: PoseKeypoint
  leftElbow?: PoseKeypoint
  rightElbow?: PoseKeypoint
  leftWrist?: PoseKeypoint
  rightWrist?: PoseKeypoint
  leftHip?: PoseKeypoint
  rightHip?: PoseKeypoint
  leftKnee?: PoseKeypoint
  rightKnee?: PoseKeypoint
  leftAnkle?: PoseKeypoint
  rightAnkle?: PoseKeypoint
}

export interface JointAngles {
  elbowAngle: number
  kneeAngle: number
  shoulderAngle: number
  wristAngle: number
}

export interface PoseResult {
  keypoints: PoseKeypoints
  angles: Partial<JointAngles>
  timestamp: number
}

export interface ShotCandidate {
  ballX: number
  ballY: number
  ballVelocityY: number
  timestamp: number
}

export interface ShotEvent {
  shotStarted: boolean
  shotReleased: boolean
  shotMade: boolean
  releasePoint?: { x: number; y: number }
  releaseAngle?: number
  timestamp: number
}
