// src/features/workouts/hooks/useTrackingStatus.ts
//
// Hook for managing tracking badge and auto status display

import { useState, useRef, useCallback } from 'react'
import { useAnimatedReaction, runOnJS } from 'react-native-reanimated'

interface UseTrackingStatusProps {
    sharedValues: {
        ballX?: { value: number }
        confidence?: { value: number }
        inFlight?: { value: number | boolean }
    }
    modelsReady: boolean
    yoloModelName: string
}

export const useTrackingStatus = ({
    sharedValues,
    modelsReady,
    yoloModelName,
}: UseTrackingStatusProps) => {
    const [trackingBadgeText, setTrackingBadgeText] = useState('Cerca palla...')
    const [trackingDotActive, setTrackingDotActive] = useState(false)
    const [trackingDotColor, setTrackingDotColor] = useState('#555')

    const [autoStatusText, setAutoStatusText] = useState('In attesa della palla…')
    const [autoDotActive, setAutoDotActive] = useState(false)

    const lastTrackingBadgeUpdate = useRef(0)
    const lastAutoStatusUpdate = useRef(0)

    const updateTrackingBadge = useCallback((isActive: boolean, confidence: number) => {
        if (isActive) {
            setTrackingBadgeText(`🏀 ${Math.round(confidence * 100)}%`)
            setTrackingDotActive(true)
            setTrackingDotColor('#4ade80')
        } else {
            setTrackingBadgeText(modelsReady ? 'Cerca palla...' : `Caricamento ${yoloModelName}...`)
            setTrackingDotActive(false)
            setTrackingDotColor('#555')
        }
    }, [modelsReady, yoloModelName])

    const updateAutoStatus = useCallback((ballX: number, inFlight: boolean) => {
        const isActive = ballX > 0
        setAutoDotActive(isActive)
        if (!modelsReady) {
            setAutoStatusText(`Caricamento ${yoloModelName}...`)
        } else if (inFlight) {
            setAutoStatusText('✈ Tiro rilevato — scia attiva')
        } else if (isActive) {
            setAutoStatusText('Rilevamento automatico attivo')
        } else {
            setAutoStatusText('In attesa della palla…')
        }
    }, [modelsReady, yoloModelName])

    useAnimatedReaction(
        () => ({
            isActive: (sharedValues?.ballX?.value ?? 0) > 0,
            confidence: sharedValues?.confidence?.value ?? 0,
        }),
        (current) => {
            'worklet'
            const now = Date.now()
            if (now - lastTrackingBadgeUpdate.current > 150) {
                lastTrackingBadgeUpdate.current = now
                runOnJS(updateTrackingBadge)(current.isActive, current.confidence)
            }
        }
    )

    useAnimatedReaction(
        () => ({
            ballX: sharedValues?.ballX?.value ?? 0,
            inFlight: sharedValues?.inFlight?.value ?? false,
        }),
        (current) => {
            'worklet'
            const now = Date.now()
            if (now - lastAutoStatusUpdate.current > 150) {
                lastAutoStatusUpdate.current = now
                runOnJS(updateAutoStatus)(current.ballX, !!current.inFlight)
            }
        }
    )

    return {
        trackingBadgeText,
        trackingDotActive,
        trackingDotColor,
        autoStatusText,
        autoDotActive,
    }
}
