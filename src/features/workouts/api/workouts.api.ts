// src/features/workouts/api/workouts.api.ts

import apiClient from '@/shared/api/apiClient'
import {
    WorkoutSession,
    CreateWorkoutSessionPayload,
    ShotEvent,
    AddShotEventPayload,
    CalibrationData,
    ShotChartResponse,
    ZoneStatistics,
    CareerStats,
} from '../types/workouts.types'

/* =========================
   WORKOUT SESSIONS
========================= */

/**
 * Crea una nuova sessione di workout
 */
export const createWorkoutSession = async (
    userId: string,
    payload: CreateWorkoutSessionPayload
): Promise<WorkoutSession> => {
    try {
        const response = await apiClient.post<WorkoutSession>(
            `/workouts/sessions?userId=${userId}`,
            payload
        )
        return response.data
    } catch (error: any) {
        console.error('Errore creazione sessione workout:', error?.response?.data || error.message)
        throw new Error(
            error?.response?.data?.message || 'Errore creazione sessione workout'
        )
    }
}

/**
 * Recupera i dettagli di una sessione
 */
export const getWorkoutSession = async (
    sessionId: string,
    userId: string
): Promise<WorkoutSession> => {
    try {
        const response = await apiClient.get<WorkoutSession>(
            `/workouts/sessions/${sessionId}?userId=${userId}`
        )
        return response.data
    } catch (error: any) {
        console.error('Errore recupero sessione workout:', error?.response?.data || error.message)
        throw new Error(
            error?.response?.data?.message || 'Errore recupero sessione workout'
        )
    }
}

/**
 * Recupera tutte le sessioni di un giocatore
 */
export const getPlayerWorkoutSessions = async (
    userId: string
): Promise<WorkoutSession[]> => {
    try {
        const response = await apiClient.get<WorkoutSession[]>(
            `/workouts/sessions?userId=${userId}`
        )
        return response.data
    } catch (error: any) {
        console.error('Errore recupero sessioni workout:', error?.response?.data || error.message)
        throw new Error(
            error?.response?.data?.message || 'Errore recupero sessioni workout'
        )
    }
}

/**
 * Termina una sessione di workout
 */
export const endWorkoutSession = async (
    sessionId: string,
    userId: string
): Promise<WorkoutSession> => {
    try {
        const response = await apiClient.post<WorkoutSession>(
            `/workouts/sessions/${sessionId}/end?userId=${userId}`
        )
        return response.data
    } catch (error: any) {
        console.error('Errore termine sessione workout:', error?.response?.data || error.message)
        throw new Error(
            error?.response?.data?.message || 'Errore termine sessione workout'
        )
    }
}

/**
 * Mette in pausa una sessione di workout
 */
export const pauseWorkoutSession = async (
    sessionId: string,
    userId: string
): Promise<WorkoutSession> => {
    try {
        const response = await apiClient.post<WorkoutSession>(
            `/workouts/sessions/${sessionId}/pause?userId=${userId}`
        )
        return response.data
    } catch (error: any) {
        console.error('Errore pausa sessione workout:', error?.response?.data || error.message)
        throw new Error(
            error?.response?.data?.message || 'Errore pausa sessione workout'
        )
    }
}

/**
 * Riprende una sessione di workout in pausa
 */
export const resumeWorkoutSession = async (
    sessionId: string,
    userId: string
): Promise<WorkoutSession> => {
    try {
        const response = await apiClient.post<WorkoutSession>(
            `/workouts/sessions/${sessionId}/resume?userId=${userId}`
        )
        return response.data
    } catch (error: any) {
        console.error('Errore ripresa sessione workout:', error?.response?.data || error.message)
        throw new Error(
            error?.response?.data?.message || 'Errore ripresa sessione workout'
        )
    }
}

/**
 * Recupera la sessione attiva di un giocatore
 */
export const getActiveWorkoutSession = async (
    userId: string
): Promise<WorkoutSession | null> => {
    try {
        const response = await apiClient.get<WorkoutSession>(
            `/workouts/sessions/active?userId=${userId}`
        )
        return response.data
    } catch (error: any) {
        // Se non c'è sessione attiva, ritorna null
        if (error?.response?.status === 404) {
            return null
        }
        console.error('Errore recupero sessione attiva:', error?.response?.data || error.message)
        throw new Error(
            error?.response?.data?.message || 'Errore recupero sessione attiva'
        )
    }
}

/* =========================
   SHOT EVENTS
========================= */

/**
 * Recupera tutti i tiri di una sessione
 */
export const getSessionShots = async (
    sessionId: string,
    userId: string
): Promise<ShotEvent[]> => {
    try {
        const response = await apiClient.get<ShotEvent[]>(
            `/workouts/sessions/${sessionId}/shots?userId=${userId}`
        )
        return response.data
    } catch (error: any) {
        console.error('Errore recupero tiri sessione:', error?.response?.data || error.message)
        throw new Error(
            error?.response?.data?.message || 'Errore recupero tiri sessione'
        )
    }
}

/**
 * Aggiunge un evento tiro a una sessione
 */
export const addShotEvent = async (
    sessionId: string,
    userId: string,
    payload: AddShotEventPayload
): Promise<ShotEvent> => {
    try {
        const response = await apiClient.post<ShotEvent>(
            `/workouts/sessions/${sessionId}/shots?userId=${userId}`,
            payload
        )
        return response.data
    } catch (error: any) {
        console.error('Errore aggiunta tiro:', error?.response?.data || error.message)
        throw new Error(
            error?.response?.data?.message || 'Errore aggiunta tiro'
        )
    }
}

/* =========================
   COURT CALIBRATION
========================= */

/**
 * Salva i dati di calibrazione del campo
 */
export const saveCourtCalibration = async (
    sessionId: string,
    userId: string,
    calibrationData: CalibrationData
): Promise<void> => {
    try {
        await apiClient.post(
            `/workouts/sessions/${sessionId}/calibration?userId=${userId}`,
            calibrationData
        )
    } catch (error: any) {
        console.error('Errore salvataggio calibrazione:', error?.response?.data || error.message)
        throw new Error(
            error?.response?.data?.message || 'Errore salvataggio calibrazione'
        )
    }
}

/* =========================
   ANALYTICS & STATISTICS
========================= */

/**
 * Recupera lo shot chart di una sessione
 */
export const getShotChart = async (
    sessionId: string,
    userId: string
): Promise<ShotChartResponse> => {
    try {
        const response = await apiClient.get<ShotChartResponse>(
            `/workouts/${sessionId}/analytics/shot-chart?userId=${userId}`
        )
        return response.data
    } catch (error: any) {
        console.error('Errore recupero shot chart:', error?.response?.data || error.message)
        throw new Error(
            error?.response?.data?.message || 'Errore recupero shot chart'
        )
    }
}

/**
 * Recupera le statistiche di una sessione
 */
export const getSessionStatistics = async (
    sessionId: string,
    userId: string
): Promise<any> => {
    try {
        const response = await apiClient.get(
            `/workouts/${sessionId}/analytics/stats?userId=${userId}`
        )
        return response.data
    } catch (error: any) {
        console.error('Errore recupero statistiche sessione:', error?.response?.data || error.message)
        throw new Error(
            error?.response?.data?.message || 'Errore recupero statistiche sessione'
        )
    }
}

/**
 * Recupera le statistiche per zona
 */
export const getZoneStatistics = async (
    sessionId: string,
    userId: string
): Promise<ZoneStatistics[]> => {
    try {
        const response = await apiClient.get<ZoneStatistics[]>(
            `/workouts/${sessionId}/analytics/zones?userId=${userId}`
        )
        return response.data
    } catch (error: any) {
        console.error('Errore recupero statistiche zone:', error?.response?.data || error.message)
        throw new Error(
            error?.response?.data?.message || 'Errore recupero statistiche zone'
        )
    }
}

/**
 * Recupera i tiri nelle hot zones
 */
export const getHotZoneShots = async (
    sessionId: string,
    userId: string,
    limit: number = 10
): Promise<ShotEvent[]> => {
    try {
        const response = await apiClient.get<ShotEvent[]>(
            `/workouts/${sessionId}/analytics/hot-zones?userId=${userId}&limit=${limit}`
        )
        return response.data
    } catch (error: any) {
        console.error('Errore recupero hot zone shots:', error?.response?.data || error.message)
        throw new Error(
            error?.response?.data?.message || 'Errore recupero hot zone shots'
        )
    }
}

/**
 * Recupera i tiri nelle cold zones
 */
export const getColdZoneShots = async (
    sessionId: string,
    userId: string,
    limit: number = 10
): Promise<ShotEvent[]> => {
    try {
        const response = await apiClient.get<ShotEvent[]>(
            `/workouts/${sessionId}/analytics/cold-zones?userId=${userId}&limit=${limit}`
        )
        return response.data
    } catch (error: any) {
        console.error('Errore recupero cold zone shots:', error?.response?.data || error.message)
        throw new Error(
            error?.response?.data?.message || 'Errore recupero cold zone shots'
        )
    }
}

/**
 * Recupera le statistiche carriera di un giocatore
 */
export const getCareerStatistics = async (
    sessionId: string,
    userId: string
): Promise<CareerStats> => {
    try {
        const response = await apiClient.get<CareerStats>(
            `/workouts/${sessionId}/analytics/career-stats?userId=${userId}`
        )
        return response.data
    } catch (error: any) {
        console.error('Errore recupero statistiche carriera:', error?.response?.data || error.message)
        throw new Error(
            error?.response?.data?.message || 'Errore recupero statistiche carriera'
        )
    }
}
