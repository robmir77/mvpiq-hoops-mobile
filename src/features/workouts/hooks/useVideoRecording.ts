// src/features/workouts/hooks/useVideoRecording.ts
//
// Hook for managing video recording during workout sessions

import { useState, useRef, useCallback } from 'react'

export const useVideoRecording = () => {
    const [isVideoRecording, setIsVideoRecording] = useState(false)
    const [videoDuration, setVideoDuration] = useState(0)
    const isVideoRecordingRef = useRef(false)
    const videoTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

    // Gestione timer durata registrazione video
    const startVideoTimer = useCallback(() => {
        setVideoDuration(0)
        videoTimerRef.current = setInterval(() => {
            setVideoDuration(prev => prev + 1)
        }, 1000)
    }, [])

    const stopVideoTimer = useCallback(() => {
        if (videoTimerRef.current) {
            clearInterval(videoTimerRef.current)
            videoTimerRef.current = null
        }
    }, [])

    const startRecording = useCallback(async () => {
        console.warn('[VideoRecording] Video recording not yet migrated to v5 API')
        return false
    }, [])

    const stopRecording = useCallback(async () => {
        console.warn('[VideoRecording] Video recording not yet migrated to v5 API')
        setIsVideoRecording(false)
        isVideoRecordingRef.current = false
        stopVideoTimer()
    }, [stopVideoTimer])

    const toggleRecording = useCallback(async () => {
        if (isVideoRecording) {
            await stopRecording()
        } else {
            await startRecording()
        }
    }, [isVideoRecording, startRecording, stopRecording])

    const formatVideoDuration = useCallback((seconds: number) => {
        const mins = Math.floor(seconds / 60)
        const secs = seconds % 60
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
    }, [])

    return {
        isVideoRecording,
        videoDuration,
        isVideoRecordingRef,
        startRecording,
        stopRecording,
        toggleRecording,
        formatVideoDuration,
    }
}
