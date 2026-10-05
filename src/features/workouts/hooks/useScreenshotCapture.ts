// src/features/workouts/hooks/useScreenshotCapture.ts
//
// Hook for capturing and saving screenshots during workout sessions

import { useCallback } from 'react'
import { captureRef } from 'react-native-view-shot'
import * as MediaLibrary from 'expo-media-library'
import type { ShotResult } from '../types/workouts.types'

interface ScreenshotData {
    assetId: string
    timestamp: string
    shotNumber: number
}

export const useScreenshotCapture = (cameraViewRef: React.RefObject<any>) => {
    const captureShotScreenshot = useCallback(async (shotNumber: number): Promise<ScreenshotData | null> => {
        if (!cameraViewRef.current) return null
        try {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
            const uri = await captureRef(cameraViewRef, {
                format: 'jpg',
                quality: 0.9,
                result: 'tmpfile',
            })
            const asset = await MediaLibrary.createAssetAsync(uri)
            console.log('[Screenshot] Captured:', asset.uri)
            return { assetId: asset.id, timestamp, shotNumber }
        } catch (error) {
            console.error('[Screenshot] Failed to capture:', error)
            return null
        }
    }, [cameraViewRef])

    const saveScreenshotWithResult = useCallback(async (screenshotData: ScreenshotData, result: ShotResult) => {
        try {
            const resultLabel = result === 'MADE' ? `CANESTRO_${screenshotData.shotNumber}` : 'FAIL'
            const filename = `MVPiQ_Shot_${resultLabel}_${screenshotData.timestamp}.jpg`
            let album = await MediaLibrary.getAlbumAsync('MVPiQ Hoops')
            if (!album) {
                album = await MediaLibrary.createAlbumAsync('MVPiQ Hoops', screenshotData.assetId, false)
            } else {
                await MediaLibrary.addAssetsToAlbumAsync([screenshotData.assetId], album, false)
            }
            console.log('[Screenshot] Saved to album:', filename)
        } catch (error) {
            console.error('[Screenshot] Failed to save to album:', error)
        }
    }, [])

    return { captureShotScreenshot, saveScreenshotWithResult }
}
