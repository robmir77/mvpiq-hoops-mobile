// Vision Pipeline Types
// Defines the contract for the workout vision pipeline

import type { SharedValue } from 'react-native-reanimated'
import type { BallDetection, PoseResult } from '@/vision'

export interface VisionSharedValues {
  ballX: SharedValue<number>
  ballY: SharedValue<number>
  ballWidth: SharedValue<number>
  ballHeight: SharedValue<number>
  ballXRaw: SharedValue<number>
  ballYRaw: SharedValue<number>
  hoopX: SharedValue<number>
  hoopY: SharedValue<number>
  hoopWidth: SharedValue<number>
  hoopHeight: SharedValue<number>
  confidence: SharedValue<number>
  playerX: SharedValue<number>
  playerY: SharedValue<number>
  playerWidth: SharedValue<number>
  playerHeight: SharedValue<number>
  playerConfidence: SharedValue<number>
  ballRejectionReason: SharedValue<string>
  rimRejectionReason: SharedValue<string>
  inFlight: SharedValue<boolean>
  shotDetected: SharedValue<boolean>
  showShotTrail: SharedValue<boolean>
  shotResult: SharedValue<string | null>
  releasePointX: SharedValue<number>
  releasePointY: SharedValue<number>
  apexPointX: SharedValue<number>
  apexPointY: SharedValue<number>
  ballTrackState: SharedValue<'DETECTED' | 'PREDICTED' | 'LOST'>
  ballTrackAge: SharedValue<number>
  playerTrackState: SharedValue<'DETECTED' | 'PREDICTED' | 'LOST'>
  playerTrackAge: SharedValue<number>
  rimTrackState: SharedValue<'DETECTED' | 'PREDICTED' | 'LOST'>
  rimTrackAge: SharedValue<number>
  trajectoryPoints: SharedValue<Float32Array>
  trajectoryPointCount: SharedValue<number>
  ballSizeCategory: SharedValue<string | null>
  adaptiveThreshold: SharedValue<number>
}

export type DetectionCallback = (detection: BallDetection) => void
export type PoseCallback = (result: PoseResult) => void
export type RimDetectionCallback = (rim: {
  x: number
  y: number
  width: number
  height: number
  confidence: number
}) => void

export interface VisionPipelineConfig {
  enabled: boolean
  poseEnabled: boolean
  ballEnabled: boolean
  rimEnabled: boolean
  yoloDelegate?: any
  poseDelegate?: any
  yoloModelId?: string
  moveNetModelId?: string
  selectedResolution?: { width: number; height: number }
  selectedFps?: number
  selectedPoseResolution?: number
  rimFromCalibration?: {
    x: number
    y: number
    width: number
    height: number
  } | null
}

export interface WorkoutVisionPipeline {
  start(): void
  stop(): void
  getSharedValues(): VisionSharedValues
  onBallDetection(callback: DetectionCallback): () => void
  onPoseResult(callback: PoseCallback): () => void
  onRimDetection?(callback: RimDetectionCallback): () => void
  resetShotTracking(): void
  getFpsMetrics(): {
    yoloFps: SharedValue<number>
    moveNetFps: SharedValue<number>
    actualCameraFps: SharedValue<number>
  }
}
