import apiClient from '@/shared/api/apiClient'

import {
    VideoAnalysisType,
    VideoAnalysisSession,
    VideoAnalysisResult,
} from '../types/videoAnalysis.types'


export const getAnalysisTypes = async (): Promise<VideoAnalysisType[]> => {

    const response = await apiClient.get<VideoAnalysisType[]>(
        '/analysis/types'
    )

    return response.data
}


export const createAnalysisSession = async (
    data: {
        analysisCode: string
        videoUrl: string
        videoSeconds: number
        videoSizeMb: number
    }
): Promise<VideoAnalysisSession> => {

    const response = await apiClient.post<VideoAnalysisSession>(
        '/analysis/sessions',
        data
    )

    return response.data
}


export const getAnalysisResult = async (
    sessionId: string
): Promise<VideoAnalysisResult> => {

    const response = await apiClient.get<VideoAnalysisResult>(
        `/analysis/sessions/${sessionId}/result`
    )

    return response.data
}