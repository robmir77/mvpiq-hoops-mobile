// src/features/workouts/hooks/useVisionCamera.ts
//
// Gestisce setup camera con react-native-vision-camera v5.
// v5: requestPermission() restituisce boolean direttamente (non 'granted'/'denied').

import { useState, useEffect, useCallback } from 'react'
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
    optimalFormat?: any
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

    // Seleziona formato camera ottimizzato per rilevamento palla (960×540)
    const getOptimalFormat = useCallback(() => {
        if (!device?.formats) return undefined
        // Cerca formato più vicino a 960×540 per ridurre carico CPU
        const targetWidth = 960
        const targetHeight = 540
        const targetRatio = targetWidth / targetHeight

        let bestFormat = device.formats[0]
        let bestScore = Infinity

        for (const format of device.formats) {
            const width = format.videoWidth || format.photoWidth || 0
            const height = format.videoHeight || format.photoHeight || 0
            if (width === 0 || height === 0) continue

            const ratio = width / height
            const ratioDiff = Math.abs(ratio - targetRatio)
            const resolutionDiff = Math.abs(width - targetWidth) + Math.abs(height - targetHeight)
            const score = ratioDiff * 1000 + resolutionDiff

            if (score < bestScore) {
                bestScore = score
                bestFormat = format
            }
        }

        return bestFormat
    }, [device])

    const optimalFormat = getOptimalFormat()

    return { device, hasPermission, isActive, requestPermission, setIsActive, optimalFormat }
}
