// src/features/ai-training/api/ai-training.api.ts

import apiClient from '@/shared/api/apiClient'
import { 
    TrainingGenerationRequest, 
    TrainingProgram, 
    TrainingGenerationResponse 
} from '../types/ai-training.types'

export const generateTrainingProgram = async (
    request: TrainingGenerationRequest
): Promise<TrainingGenerationResponse> => {
    try {
        const response = await apiClient.post<{ data: TrainingGenerationResponse }>(
            '/ai/training-programs/generate',
            request, {
            timeout: 300000 // 5 minuti
        }
        )
        return response.data.data
    } catch (error: any) {
        console.error(
            'Errore generazione programma AI:',
            error?.response?.data || error.message
        )
        throw new Error(
            error?.response?.data?.message || 'Errore generazione programma AI'
        )
    }
}

export const getAthleteTrainingPrograms = async (
    athleteId: string
): Promise<TrainingProgram[]> => {
    try {
        const response = await apiClient.get<TrainingProgram[]>(
            `/ai/training-programs/${athleteId}`
        )
        return response.data
    } catch (error: any) {
        console.error(
            'Errore caricamento programmi atleta:',
            error?.response?.data || error.message
        )
        
        // Fallback per programmi non disponibili
        if (error?.response?.status === 404) {
            return []
        }
        
        throw new Error(
            error?.response?.data?.message || 'Errore caricamento programmi atleta'
        )
    }
}

export const getTrainingProgram = async (
    programId: string
): Promise<TrainingProgram> => {
    try {
        const response = await apiClient.get<{ data: TrainingProgram }>(
            `/ai/training-programs/program/${programId}`
        )
        return response.data.data
    } catch (error: any) {
        console.error(
            'Errore caricamento dettaglio programma:',
            error?.response?.data || error.message
        )
        throw new Error(
            error?.response?.data?.message || 'Errore caricamento dettaglio programma'
        )
    }
}

export const regenerateTrainingProgram = async (
    programId: string,
    request: TrainingGenerationRequest
): Promise<TrainingGenerationResponse> => {
    try {
        const response = await apiClient.post<{ data: TrainingGenerationResponse }>(
            `/ai/training-programs/${programId}/regenerate`,
            request
        )
        return response.data.data
    } catch (error: any) {
        console.error(
            'Errore rigenerazione programma:',
            error?.response?.data || error.message
        )
        throw new Error(
            error?.response?.data?.message || 'Errore rigenerazione programma'
        )
    }
}

export const getGenerationStatus = async (
    programId: string
): Promise<TrainingGenerationResponse> => {
    try {
        const response = await apiClient.get<{ data: TrainingGenerationResponse }>(
            `/ai/training-programs/status/${programId}`
        )
        return response.data.data
    } catch (error: any) {
        console.error(
            'Errore caricamento stato generazione:',
            error?.response?.data || error.message
        )
        throw new Error(
            error?.response?.data?.message || 'Errore caricamento stato generazione'
        )
    }
}
