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

export interface CameraPipelineResult {
  device: any
  hasPermission: boolean
  isActive: boolean
  requestPermission: () => Promise<boolean>
  setIsActive: (v: boolean) => void
  cameraRef: any
  frameProcessor: any
  isModelReady: boolean
  resetShotTracking: () => void
  runPoseFromSnapshot: ((snapshot: Uint8Array, width: number, height: number) => void) | null
}

export const useCameraPipeline = (
  onBallDetection: (detection: BallDetection) => void,
  onPoseResult: (result: PoseResult) => void,
  onShotEvent: (event: ShotEvent) => void,
  onPoseRequest?: () => void,
  rimFromCalibration?: { x: number; y: number; width: number; height: number } | null,
  enabled: boolean = true
): CameraPipelineResult => {
  const { hasPermission, requestPermission: reqPerm } = useCameraPermission()
  const device = useCameraDevice('back')
  const [isActive, setIsActive] = useState(false)
  const cameraRef = useRef<any>(null)

  const requestPermission = async (): Promise<boolean> => {
    return reqPerm()
  }

  // Initialize shot tracker with the new architecture
  const { frameProcessor, isModelReady, resetShotTracking, runPoseFromSnapshot } = useShotTracker(
    onBallDetection,
    onPoseResult,
    onShotEvent,
    onPoseRequest,
    rimFromCalibration
  )

  return {
    device,
    hasPermission,
    isActive,
    requestPermission,
    setIsActive,
    cameraRef,
    frameProcessor,
    isModelReady,
    resetShotTracking,
    runPoseFromSnapshot,
  }
}
