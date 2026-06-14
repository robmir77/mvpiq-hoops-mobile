// src/features/workouts/hooks/useWorkoutWebSocket.ts

import { useEffect, useRef, useState, useCallback } from 'react'
import { RealtimeStats } from '../types/workouts.types'
import { API_BASE_URL } from '@/config/appConfig'

type WsStatus = 'connecting' | 'connected' | 'disconnected' | 'error'

export const useWorkoutWebSocket = (sessionId: string | null, userId: string | null) => {
    const ws = useRef<WebSocket | null>(null)
    const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
    const [stats, setStats] = useState<RealtimeStats | null>(null)
    const [status, setStatus] = useState<WsStatus>('disconnected')
    const reconnectAttempts = useRef(0)
    const MAX_RECONNECT = 3

    const connect = useCallback(() => {
        if (!sessionId || !userId) return

        // Sostituisci http/https con ws/wss per il WebSocket
        const wsBase = API_BASE_URL.replace(/^http/, 'ws')
        const url = `${wsBase}/api/workouts/live/${sessionId}?userId=${userId}`

        setStatus('connecting')
        const socket = new WebSocket(url)
        ws.current = socket

        socket.onopen = () => {
            setStatus('connected')
            reconnectAttempts.current = 0
        }

        socket.onmessage = (event) => {
            try {
                const data: RealtimeStats = JSON.parse(event.data)
                // Only update stats if key values changed (reduces React renders)
                setStats(prev => {
                    if (
                        prev?.shotCount === data.shotCount &&
                        prev?.fieldGoalPercentage === data.fieldGoalPercentage &&
                        prev?.shotStreak === data.shotStreak &&
                        prev?.releaseAngleAvg === data.releaseAngleAvg &&
                        prev?.releaseVelocityAvg === data.releaseVelocityAvg
                    ) {
                        return prev
                    }
                    return data
                })
            } catch {
                // ignora messaggi non JSON
            }
        }

        socket.onclose = () => {
            setStatus('disconnected')
            // Riconnessione automatica con backoff
            if (reconnectAttempts.current < MAX_RECONNECT) {
                const delay = 1000 * Math.pow(2, reconnectAttempts.current)
                reconnectAttempts.current++
                reconnectTimer.current = setTimeout(connect, delay)
            }
        }

        socket.onerror = () => {
            setStatus('error')
        }
    }, [sessionId, userId])

    const disconnect = useCallback(() => {
        if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
        reconnectAttempts.current = MAX_RECONNECT // previene riconnessione
        ws.current?.close()
        ws.current = null
        setStatus('disconnected')
    }, [])

    useEffect(() => {
        if (sessionId && userId) connect()
        return () => disconnect()
    }, [sessionId, userId])

    return { stats, status, disconnect }
}
