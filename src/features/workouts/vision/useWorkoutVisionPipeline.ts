// useWorkoutVisionPipeline
// Phase 2: Cleaner interface for vision pipeline
// Wraps existing useCameraPipeline with a cleaner API
// This is a stepping stone to full extraction

import { useMemo } from 'react'
import { useCameraPipeline } from '@/vision'
import { useDerivedValue } from 'react-native-reanimated'
import type { BallDetection, PoseResult, ShotEvent } from '@/vision'
import type { AndroidDelegateOption, IosDelegateOption } from '@/vision/delegates'
import type { VisionPipelineConfig } from './WorkoutVisionPipeline.types'

export interface UseWorkoutVisionPipelineResult {
  // Camera
  device: any
  hasPermission: boolean
  isActive: boolean
  requestPermission: () => Promise<boolean>
  setIsActive: (v: boolean) => void
  frameOutput: any

  // Vision state
  isModelReady: boolean

  // Actions
  start(): void
  stop(): void
  resetShotTracking(): void

  // FPS metrics (SharedValues - use .value only in worklets or via useAnimatedReaction)
  fpsMetrics: {
    yoloFps: any
    moveNetFps: any
    actualCameraFps: any
  }

  // Shared values for overlay
  sharedValues: any
}

export const useWorkoutVisionPipeline = (
  config: VisionPipelineConfig,
  onBallDetection: (detection: BallDetection) => void,
  onPoseResult: (result: PoseResult) => void,
  onShotEvent?: (event: ShotEvent) => void,
  onRimDetection?: (rim: { x: number; y: number; width: number; height: number; confidence: number }) => void,
  onPlayerDetection?: (player: { x: number; y: number; width: number; height: number; confidence: number }) => void,
  runtimeActive: boolean = false, // Parameter kept for API compatibility, but not used (Decision 29 reverted)
): UseWorkoutVisionPipelineResult => {
  const {
    device,
    hasPermission,
    isActive,
    requestPermission,
    setIsActive,
    frameOutput,
    isModelReady,
    resetShotTracking,
    yoloFps,
    moveNetFps,
    actualCameraFps,
    actualYoloFps,
    actualMoveNetFps,
    sharedValues,
  } = useCameraPipeline(
    onBallDetection,
    onPoseResult,
    onShotEvent,
    onRimDetection,
    onPlayerDetection,
    config.rimFromCalibration,
    config.kalmanFilteredBall,
    config.enabled,
    config.poseEnabled,
    config.ballEnabled,
    config.rimEnabled,
    runtimeActive, // Passed but not used in frame processor (Decision 29 reverted)
    config.yoloDelegate as AndroidDelegateOption | IosDelegateOption | null,
    config.poseDelegate as AndroidDelegateOption | IosDelegateOption | null,
    config.yoloModelId,
    config.selectedResolution,
    config.selectedFps,
    config.selectedPoseResolution,
    config.moveNetModelId
  )

  const start = () => {
    setIsActive(true)
  }

  const stop = () => {
    setIsActive(false)
  }

  return {
    // Camera
    device,
    hasPermission,
    isActive,
    requestPermission,
    setIsActive,
    frameOutput,

    // Vision state
    isModelReady,

    // Actions
    start,
    stop,
    resetShotTracking,

    // FPS metrics (SharedValues - use .value only in worklets or via useAnimatedReaction)
    fpsMetrics: {
      yoloFps: actualYoloFps,
      moveNetFps: actualMoveNetFps,
      actualCameraFps: actualCameraFps,
    },

    // Shared values (for overlay)
    sharedValues,
  }
}
