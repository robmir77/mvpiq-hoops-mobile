// src/features/workouts/hooks/useVisionCamera.ts
//
// Gestisce setup camera con react-native-vision-camera v4.
// Supporta Frame Processor per eliminare il bottleneck JPEG.

import { useState, useEffect, useCallback, useRef } from 'react'
import {
    useCameraDevice,
    useCameraPermission,
    CameraDevice,
} from 'react-native-vision-camera'
import type { RefObject } from 'react'

export interface VisionCameraSetup {
    device: CameraDevice | undefined
    hasPermission: boolean
    isActive: boolean
    requestPermission: () => Promise<boolean>
    setIsActive: (v: boolean) => void
    optimalFormat?: any
    cameraRef: RefObject<any>
}

export const useVisionCamera = (): VisionCameraSetup => {
    const { hasPermission, requestPermission: reqPerm } = useCameraPermission()
    const device = useCameraDevice('back')
    const [isActive, setIsActive] = useState(false)
    const cameraRef = useRef<any>(null)

    // reqPerm() restituisce boolean (true = concesso)
    const requestPermission = async (): Promise<boolean> => {
        return reqPerm()
    }

    useEffect(() => {
        if (hasPermission) setIsActive(true)
        else setIsActive(false)
    }, [hasPermission])

    // Seleziona formato camera ottimizzato per rilevamento palla (640×480 o 960×540)
    // Per Frame Processor, preferiamo risoluzioni più basse per performance
    const getOptimalFormat = useCallback(() => {
        if (!device?.formats) return undefined
        // Cerca formato più vicino a 640×480 per ridurre carico CPU nel frame processor
        const targetWidth = 640
        const targetHeight = 480
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

    useEffect(() => {
        console.log('[VisionCamera] optimalFormat:', optimalFormat ? `${optimalFormat.videoWidth || optimalFormat.photoWidth}x${optimalFormat.videoHeight || optimalFormat.photoHeight}` : 'undefined')
    }, [optimalFormat])

    return { device, hasPermission, isActive, requestPermission, setIsActive, optimalFormat, cameraRef }
}
