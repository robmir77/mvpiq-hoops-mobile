import apiClient from '@/shared/api/apiClient'
import { TrainingStats, TrainingProgram } from '../types/training.types'

export const getTrainingStats = async (
    athleteId: string
): Promise<TrainingStats> => {
    try {
        const response = await apiClient.get<{ data: TrainingStats }>(
            `/training/stats/${athleteId}`
        )
        return response.data.data
    } catch (error: any) {
        console.error(
            'Errore caricamento statistiche training:',
            error?.response?.data || error.message
        )
        
        // Fallback per statistiche non disponibili
        if (error?.response?.status === 404) {
            return {
                sessions: 0,
                minutes: 0,
                points: 0
            }
        }
        
        throw new Error(
            error?.response?.data?.message || 'Errore caricamento statistiche training'
        )
    }
}

export const getTrainingPrograms = async (): Promise<
    TrainingProgram[]
> => {
    try {
        const response = await apiClient.get<TrainingProgram[]>(
            `/training/programs`
        )
        return response.data
    } catch (error: any) {
        console.error(
            'Errore caricamento programmi training:',
            error?.response?.data || error.message
        )
        
        // Fallback per programmi non disponibili
        if (error?.response?.status === 404) {
            return []
        }
        
        throw new Error(
            error?.response?.data?.message || 'Errore caricamento programmi training'
        )
    }
}