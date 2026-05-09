// src/features/ai-training/hooks/useAiTraining.ts

import { useQuery, useMutation } from '@tanstack/react-query'
import { 
    generateTrainingProgram, 
    getAthleteTrainingPrograms, 
    getTrainingProgram, 
    regenerateTrainingProgram,
    getGenerationStatus 
} from '../api/ai-training.api'
import { 
    TrainingGenerationRequest, 
    TrainingProgram, 
    TrainingGenerationResponse 
} from '../types/ai-training.types'

export const useGenerateTrainingProgram = () => {
    return useMutation({
        mutationFn: generateTrainingProgram,
        onSuccess: (data) => {
            console.log('✅ Programma generato con successo:', data)
        },
        onError: (error) => {
            console.error('❌ Errore generazione programma:', error)
        }
    })
}

export const useAthleteTrainingPrograms = (athleteId?: string) => {
    return useQuery({
        queryKey: ['ai-training-programs', athleteId],
        queryFn: () => athleteId ? getAthleteTrainingPrograms(athleteId) : Promise.resolve([]),
        enabled: !!athleteId,
        staleTime: 1000 * 60 * 5, // 5 minuti
    })
}

export const useTrainingProgram = (programId?: string) => {
    return useQuery({
        queryKey: ['ai-training-program', programId],
        queryFn: () => programId ? getTrainingProgram(programId) : Promise.resolve({} as TrainingProgram),
        enabled: !!programId,
        staleTime: 1000 * 60 * 10, // 10 minuti
    })
}

export const useRegenerateTrainingProgram = () => {
    return useMutation({
        mutationFn: ({ programId, request }: { programId: string; request: TrainingGenerationRequest }) => 
            regenerateTrainingProgram(programId, request),
        onSuccess: (data) => {
            console.log('✅ Programma rigenerato con successo:', data)
        },
        onError: (error) => {
            console.error('❌ Errore rigenerazione programma:', error)
        }
    })
}

export const useGenerationStatus = (programId?: string) => {
    return useQuery({
        queryKey: ['generation-status', programId],
        queryFn: () => programId ? getGenerationStatus(programId) : Promise.resolve({} as TrainingGenerationResponse),
        enabled: !!programId,
        refetchInterval: (data) => {
            // Poll solo se lo stato è PENDING o GENERATING
            const status = (data as any)?.generationStatus
            return status === 'PENDING' || status === 'GENERATING' ? 2000 : false
        },
        staleTime: 1000 * 30, // 30 secondi per polling
    })
}
