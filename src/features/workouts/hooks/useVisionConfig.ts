// src/features/workouts/hooks/useVisionConfig.ts
//
// Hook for computing vision pipeline configuration

import { useMemo } from 'react'
import type { CalibrationData, TrackingState } from '../types/workouts.types'

interface UseVisionConfigProps {
    poseEnabled: boolean
    ballEnabled: boolean
    rimDetectionEnabled: boolean
    yoloDelegate: string
    poseDelegate: string
    effectiveYoloModelId: string
    effectiveMoveNetModelId: string
    effectiveResolution: { width: number; height: number }
    effectiveFps: number
    effectivePoseResolution: number
    calibration: CalibrationData | null
    rimFromDetection: { x: number; y: number; width: number; height: number; confidence: number } | null
    trackingState: TrackingState | null
}

export const useVisionConfig = ({
    poseEnabled,
    ballEnabled,
    rimDetectionEnabled,
    yoloDelegate,
    poseDelegate,
    effectiveYoloModelId,
    effectiveMoveNetModelId,
    effectiveResolution,
    effectiveFps,
    effectivePoseResolution,
    calibration,
    rimFromDetection,
    trackingState,
}: UseVisionConfigProps) => {
    const rimFromCalibration = useMemo(() =>
        calibration?.hoopCenter
            ? { x: calibration.hoopCenter.x, y: calibration.hoopCenter.y, width: 0.05, height: 0.05 }
            : null
    , [calibration?.hoopCenter?.x, calibration?.hoopCenter?.y])

    const effectiveRim = rimFromDetection || rimFromCalibration

    const visionConfig = useMemo(() => ({
        enabled: true,
        poseEnabled,
        ballEnabled,
        rimEnabled: rimDetectionEnabled,
        yoloDelegate,
        poseDelegate,
        yoloModelId: effectiveYoloModelId,
        moveNetModelId: effectiveMoveNetModelId,
        selectedResolution: effectiveResolution,
        selectedFps: effectiveFps,
        selectedPoseResolution: effectivePoseResolution,
        rimFromCalibration: effectiveRim,
    }), [
        poseEnabled,
        ballEnabled,
        rimDetectionEnabled,
        yoloDelegate,
        poseDelegate,
        effectiveYoloModelId,
        effectiveMoveNetModelId,
        effectiveResolution,
        effectiveFps,
        effectivePoseResolution,
        effectiveRim,
    ])

    return { visionConfig, effectiveRim }
}
