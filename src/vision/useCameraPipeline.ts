// src/vision/useCameraPipeline.ts
//
// Camera Pipeline - frame acquisition only
// Integrates VisionCamera with the new zero-image-passing architecture
// Responsibilities:
// - Camera setup and permissions
// - Frame processor attachment
// - NO analysis, tracking, overlay, or basketball logic

import { useState, useEffect, useCallback } from 'react'
import { useCameraDevice, useCameraPermission } from 'react-native-vision-camera'
import { useShotTracker, type AndroidDelegateOption, type IosDelegateOption } from './useShotTracker'
import type { BallDetection, PoseResult, ShotEvent } from './types'

export interface CameraPipelineResult {
  device: any
  hasPermission: boolean
  isActive: boolean
  requestPermission: () => Promise<boolean>
  setIsActive: (v: boolean) => void
  frameOutput: any | null
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
  yoloDelegate?: AndroidDelegateOption | IosDelegateOption | null,
  poseDelegate?: AndroidDelegateOption | IosDelegateOption | null
): CameraPipelineResult => {
  const { hasPermission, requestPermission: reqPerm } = useCameraPermission()
  const device = useCameraDevice('back')
  const [isActive, setIsActive] = useState(false)
  const [isPipelineReady, setIsPipelineReady] = useState(false)
  const [requestedActiveState, setRequestedActiveState] = useState(false)

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
    yoloDelegate,
    poseDelegate
  )

  // Mark pipeline as ready when models are loaded
  useEffect(() => {
    if (isModelReady) {
      setIsPipelineReady(true)
      // Start camera if it was requested to start before pipeline was ready
      if (requestedActiveState) {
        setIsActive(true)
      }
    }
  }, [isModelReady, requestedActiveState])

  // Override setIsActive to prevent camera start before pipeline is ready
  const safeSetIsActive = useCallback((value: boolean) => {
    setRequestedActiveState(value)
    if (value && !isPipelineReady) {
      // Camera will start when models are ready
      return
    }
    setIsActive(value)
  }, [isPipelineReady])

  return {
    device,
    hasPermission,
    isActive,
    requestPermission,
    setIsActive: safeSetIsActive,
    frameOutput,
    isModelReady,
    resetShotTracking,
  }
}
