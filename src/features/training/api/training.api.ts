import apiClient from '@/shared/api/apiClient'
import { TrainingStats, TrainingProgram } from '../types/training.types'

export const getTrainingStats = async (
    athleteId: string
): Promise<TrainingStats> => {
    const response = await apiClient.get<TrainingStats>(
        `/training/stats/${athleteId}`
    )
    return response.data
}

export const getTrainingPrograms = async (): Promise<
    TrainingProgram[]
> => {
    const response = await apiClient.get<TrainingProgram[]>(
        `/training/programs`
    )
    return response.data
}