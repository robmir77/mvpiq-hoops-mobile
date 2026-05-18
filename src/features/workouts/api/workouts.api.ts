// src/features/workouts/api/workouts.api.ts
// Aggiornamento: saveCourtCalibration ora invia campi flat
// allineati al CalibrationRequest BE (hoopCenterX/Y, non hoopCenter.x/y)

import apiClient from '@/shared/api/apiClient'
import {
    WorkoutSession, CreateWorkoutSessionPayload,
    ShotEvent, AddShotEventPayload,
    CalibrationData, ShotChartResponse,
    ZoneStatistics, CareerStats,
    FrameDataPayload, PoseAnalysisPayload,
} from '../types/workouts.types'

// ─── Sessioni ─────────────────────────────────────────────────

export const createWorkoutSession = async (
    userId: string, payload: CreateWorkoutSessionPayload
): Promise<WorkoutSession> => {
    const r = await apiClient.post<WorkoutSession>(
        `/workouts/sessions?userId=${userId}`, payload)
    return r.data
}

export const getWorkoutSession = async (
    sessionId: string, userId: string
): Promise<WorkoutSession> => {
    const r = await apiClient.get<WorkoutSession>(
        `/workouts/sessions/${sessionId}?userId=${userId}`)
    return r.data
}

export const getPlayerWorkoutSessions = async (
    userId: string
): Promise<WorkoutSession[]> => {
    const r = await apiClient.get<WorkoutSession[]>(
        `/workouts/sessions?userId=${userId}`)
    return r.data
}

export const endWorkoutSession = async (
    sessionId: string, userId: string
): Promise<WorkoutSession> => {
    const r = await apiClient.post<WorkoutSession>(
        `/workouts/sessions/${sessionId}/end?userId=${userId}`)
    return r.data
}

export const pauseWorkoutSession = async (
    sessionId: string, userId: string
): Promise<WorkoutSession> => {
    const r = await apiClient.post<WorkoutSession>(
        `/workouts/sessions/${sessionId}/pause?userId=${userId}`)
    return r.data
}

export const resumeWorkoutSession = async (
    sessionId: string, userId: string
): Promise<WorkoutSession> => {
    const r = await apiClient.post<WorkoutSession>(
        `/workouts/sessions/${sessionId}/resume?userId=${userId}`)
    return r.data
}

export const getActiveWorkoutSession = async (
    userId: string
): Promise<WorkoutSession | null> => {
    try {
        const r = await apiClient.get<WorkoutSession>(
            `/workouts/sessions/active?userId=${userId}`)
        return r.data
    } catch (e: any) {
        if (e?.response?.status === 404) return null
        throw e
    }
}

// ─── Tiri ─────────────────────────────────────────────────────

export const getSessionShots = async (
    sessionId: string, userId: string
): Promise<ShotEvent[]> => {
    const r = await apiClient.get<ShotEvent[]>(
        `/workouts/sessions/${sessionId}/shots?userId=${userId}`)
    return r.data
}

export const addShotEvent = async (
    sessionId: string, userId: string, payload: AddShotEventPayload
): Promise<ShotEvent> => {
    const r = await apiClient.post<ShotEvent>(
        `/workouts/sessions/${sessionId}/shots?userId=${userId}`, payload)
    return r.data
}

// ─── Calibrazione ─────────────────────────────────────────────
// Il BE CalibrationRequest usa campi FLAT (hoopCenterX, hoopCenterY)
// con @NotNull su hoopCenterX e hoopCenterY.
// Il FE CalibrationData usa struttura nested (hoopCenter: {x, y}).
// Qui facciamo il mapping prima di inviare.

export const saveCourtCalibration = async (
    sessionId: string,
    userId: string,
    data: CalibrationData
): Promise<void> => {
    const body: Record<string, any> = {
        // ✅ Flatten: hoopCenter.x/y → hoopCenterX/Y
        hoopCenterX: data.hoopCenter.x,
        hoopCenterY: data.hoopCenter.y,
        homographyMatrix: data.homographyMatrix.length > 0
            ? data.homographyMatrix
            : null,
    }

    // Angoli campo opzionali
    if (data.courtCorners) {
        const { topLeft, topRight, bottomRight, bottomLeft } = data.courtCorners
        body.threePointLineTopX    = topLeft.x
        body.threePointLineTopY    = topLeft.y
        body.threePointLineRightX  = topRight.x
        body.threePointLineRightY  = topRight.y
        body.sidelineRightX        = bottomRight.x
        body.sidelineRightY        = bottomRight.y
        body.sidelineLeftX         = bottomLeft.x
        body.sidelineLeftY         = bottomLeft.y
    }

    await apiClient.post(
        `/workouts/sessions/${sessionId}/calibration?userId=${userId}`,
        body
    )
}

// ─── AI Tracking — Frame Data ─────────────────────────────────

export const saveFrameData = async (
    sessionId: string, userId: string, payload: FrameDataPayload
): Promise<void> => {
    try {
        await apiClient.post(
            `/workouts/sessions/${sessionId}/frames?userId=${userId}`, payload)
    } catch {
        // best-effort — non blocca la sessione
    }
}

// ─── AI Tracking — Pose Analysis ─────────────────────────────

export const savePoseAnalysis = async (
    sessionId: string, userId: string, payload: PoseAnalysisPayload
): Promise<void> => {
    try {
        await apiClient.post(
            `/workouts/sessions/${sessionId}/pose-analysis?userId=${userId}`, payload)
    } catch {
        // best-effort
    }
}

// ─── Analytics ────────────────────────────────────────────────

export const getShotChart = async (
    sessionId: string, userId: string
): Promise<ShotChartResponse> => {
    const r = await apiClient.get<ShotChartResponse>(
        `/workouts/${sessionId}/analytics/shot-chart?userId=${userId}`)
    return r.data
}

export const getSessionStatistics = async (
    sessionId: string, userId: string
): Promise<any> => {
    const r = await apiClient.get(
        `/workouts/${sessionId}/analytics/stats?userId=${userId}`)
    return r.data
}

export const getZoneStatistics = async (
    sessionId: string, userId: string
): Promise<ZoneStatistics[]> => {
    const r = await apiClient.get<ZoneStatistics[]>(
        `/workouts/${sessionId}/analytics/zones?userId=${userId}`)
    return r.data
}

export const getHotZoneShots = async (
    sessionId: string, userId: string, limit = 10
): Promise<ShotEvent[]> => {
    const r = await apiClient.get<ShotEvent[]>(
        `/workouts/${sessionId}/analytics/hot-zones?userId=${userId}&limit=${limit}`)
    return r.data
}

export const getColdZoneShots = async (
    sessionId: string, userId: string, limit = 10
): Promise<ShotEvent[]> => {
    const r = await apiClient.get<ShotEvent[]>(
        `/workouts/${sessionId}/analytics/cold-zones?userId=${userId}&limit=${limit}`)
    return r.data
}

export const getCareerStatistics = async (userId: string): Promise<CareerStats> => {
    const r = await apiClient.get<CareerStats>(
        `/workouts/player/analytics/career-stats?userId=${userId}`)
    return r.data
}
