// src/features/training/hooks/useTraining.ts

import { useQuery } from '@tanstack/react-query'
import { getTrainingStats, getTrainingPrograms } from '../api/training.api'
import { TrainingStats, TrainingProgram } from '../types/training.types'

export const useTrainingStats = (athleteId?: string) => {
    return useQuery({
        queryKey: ['training-stats', athleteId],
        queryFn: () => getTrainingStats(athleteId!),
        enabled: !!athleteId,
        staleTime: 1000 * 60 * 5, // 5 minuti
    })
}

export const useTrainingPrograms = () => {
    return useQuery({
        queryKey: ['training-programs'],
        queryFn: getTrainingPrograms,
        staleTime: 1000 * 60 * 10, // 10 minuti
    })
}
