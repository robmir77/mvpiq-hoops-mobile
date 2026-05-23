// src/features/workouts/hooks/useVisionCamera.ts
//
// Gestisce setup camera con react-native-vision-camera v5.
// v5: requestPermission() restituisce boolean direttamente (non 'granted'/'denied').

import { useState, useEffect } from 'react'
import {
    useCameraDevice,
    useCameraPermission,
    CameraDevice,
} from 'react-native-vision-camera'

export interface VisionCameraSetup {
    device: CameraDevice | undefined
    hasPermission: boolean
    isActive: boolean
    requestPermission: () => Promise<boolean>
    setIsActive: (v: boolean) => void
}

export const useVisionCamera = (): VisionCameraSetup => {
    const { hasPermission, requestPermission: reqPerm } = useCameraPermission()
    const device = useCameraDevice('back')
    const [isActive, setIsActive] = useState(false)

    // v5: reqPerm() restituisce boolean (true = concesso)
    const requestPermission = async (): Promise<boolean> => {
        return reqPerm()
    }

    useEffect(() => {
        if (hasPermission) setIsActive(true)
        else setIsActive(false)
    }, [hasPermission])

    return { device, hasPermission, isActive, requestPermission, setIsActive }
}
