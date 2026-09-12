// src/vision/useCameraPipeline.ts
//
// Camera Pipeline - frame acquisition only
// Integrates VisionCamera with the new zero-image-passing architecture
// Responsibilities:
// - Camera setup and permissions
// - Frame processor attachment
// - NO analysis, tracking, overlay, or basketball logic

import { useRef, useState } from 'react'
import { useCameraDevice, useCameraPermission } from 'react-native-vision-camera'
import { useShotTracker } from './useShotTracker'
import type { BallDetection, PoseResult, ShotEvent } from './types'
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
}

export const useCameraPipeline = (
  onBallDetection: (detection: BallDetection) => void,
  onPoseResult: (result: PoseResult) => void,
  onShotEvent: (event: ShotEvent) => void,
  onRimDetection?: (rim: { x: number; y: number; width: number; height: number; confidence: number }) => void,
  rimFromCalibration?: { x: number; y: number; width: number; height: number } | null,
  kalmanFilteredBall?: { x: number; y: number; vx: number; vy: number } | null,
  enabled: boolean = true,
  poseEnabled: boolean = true,
  ballEnabled: boolean = true,
  rimEnabled: boolean = false,
  yoloDelegate?: AndroidDelegateOption | IosDelegateOption | null,
  poseDelegate?: AndroidDelegateOption | IosDelegateOption | null,
  yoloModelId?: string,
  selectedResolution?: { width: number; height: number } | null,
  selectedFps?: number | null,
  selectedPoseResolution?: number,
  moveNetModelId?: string,
): CameraPipelineResult => {
  const { hasPermission, requestPermission: reqPerm } = useCameraPermission()
  const device = useCameraDevice('back')
  const [isActive, setIsActive] = useState(false)

  const requestPermission = async (): Promise<boolean> => {
    return reqPerm()
  }

  // Initialize shot tracker with the new architecture
  const { frameOutput, isModelReady, resetShotTracking } = useShotTracker(
    onBallDetection,
    onPoseResult,
    onShotEvent,
    onRimDetection,
    rimFromCalibration,
    kalmanFilteredBall,
    enabled,
    poseEnabled,
    ballEnabled,
    rimEnabled,
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
  }
}
