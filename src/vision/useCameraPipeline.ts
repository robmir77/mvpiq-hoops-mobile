// src/vision/useCameraPipeline.ts
// Camera pipeline for frame acquisition only. Integrates VisionCamera with zero-image-passing architecture.

import { useRef, useState } from 'react'
import { useCameraDevice, useCameraPermission } from 'react-native-vision-camera'
import { useShotTracker } from './useShotTracker'
import type { BallDetection, PoseResult } from './types'
import type { AndroidDelegateOption, IosDelegateOption } from './delegates'

export interface CameraPipelineResult {
  device: any
  hasPermission: boolean
  isActive: boolean
  requestPermission: () => Promise<boolean>
  setIsActive: (v: boolean) => void
  frameOutput: any
  isModelReady: boolean
  resetShotTracking: () => void
  yoloFps: any
  moveNetFps: any
  actualCameraFps: any
  actualYoloFps: any
  actualMoveNetFps: any
  sharedValues?: {
    playerX: any
    playerY: any
    playerWidth: any
    playerHeight: any
    playerConfidence: any
    ballRejectionReason: any
    rimRejectionReason: any
    playerTrackState: any
    playerTrackAge: any
  }
}

export const useCameraPipeline = (
  onBallDetection: (detection: BallDetection) => void,
  onPoseResult: (result: PoseResult) => void,
  onRimDetection?: (rim: { x: number; y: number; width: number; height: number; confidence: number }) => void,
  onPlayerDetection?: (player: { x: number; y: number; width: number; height: number; confidence: number }, timestamp: number) => void,
  rimFromCalibration?: { x: number; y: number; width: number; height: number } | null,
  enabled: boolean = true,
  poseEnabled: boolean = true,
  ballEnabled: boolean = false,
  rimEnabled: boolean = false,
  runtimeActive: boolean = false, // Parameter kept for API compatibility, but not used (Decision 29 reverted)
  yoloDelegate?: AndroidDelegateOption | IosDelegateOption | null,
  poseDelegate?: AndroidDelegateOption | IosDelegateOption | null,
  yoloModelId?: string,
  selectedResolution?: { width: number; height: number } | null,
  selectedFps?: number | null,
  selectedPoseResolution?: number,
  moveNetModelId?: string,
): CameraPipelineResult => {
  // TEMP: Commented to reduce log noise during performance investigation
  // console.log('[useCameraPipeline] Received params:', {
  //     selectedResolution,
  //     selectedFps,
  //     selectedPoseResolution,
  //     yoloModelId,
  //     moveNetModelId,
  //     yoloDelegate,
  //     poseDelegate,
  //     enabled,
  //     poseEnabled,
  //     ballEnabled,
  //     rimEnabled,
  // })
  const { hasPermission, requestPermission: reqPerm } = useCameraPermission()
  const device = useCameraDevice('back')
  const [isActive, setIsActive] = useState(false)

  const requestPermission = async (): Promise<boolean> => {
    return reqPerm()
  }

  // Initialize shot tracker with the new architecture
  // Note: runtimeActive parameter is passed but not used in frame processor (Decision 29 reverted)
  const { frameOutput, isModelReady, resetShotTracking, yoloFps, moveNetFps, sharedValues: shotTrackerSharedValues, actualCameraFps, actualYoloFps, actualMoveNetFps } = useShotTracker(
    onBallDetection,
    onPoseResult,
    onRimDetection,
    onPlayerDetection,
    rimFromCalibration,
    enabled,
    poseEnabled,
    ballEnabled,
    rimEnabled,
    runtimeActive, // Passed but not used in frame processor
    yoloDelegate,
    poseDelegate,
    yoloModelId,
    selectedResolution,
    selectedFps,
    selectedPoseResolution,
    moveNetModelId
  )

  return {
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
    sharedValues: shotTrackerSharedValues,
  }
}
