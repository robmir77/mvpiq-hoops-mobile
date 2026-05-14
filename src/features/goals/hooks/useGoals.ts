import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getGoalsByAthlete, createGoal, updateGoal, deleteGoal } from '../api/goals.api'
import { Goal, CreateGoalRequest } from '../types/goals.types'

export const useGoals = (athleteId?: string) => {
    return useQuery({
        queryKey: ['goals', athleteId],
        queryFn: () => getGoalsByAthlete(athleteId!),
        enabled: !!athleteId,
    })
}

export const useCreateGoal = () => {
    const queryClient = useQueryClient()
    
    return useMutation({
        mutationFn: ({ athleteId, data }: { athleteId: string; data: CreateGoalRequest }) => 
            createGoal({ athleteId, data }),
        onSuccess: (data, variables) => {
            // Invalida la cache dei goals per l'atleta
            queryClient.invalidateQueries({ queryKey: ['goals', variables.athleteId] })
        },
    })
}

export const useUpdateGoal = () => {
    const queryClient = useQueryClient()
    
    return useMutation({
        mutationFn: ({ goalId, data }: { goalId: string; data: Partial<CreateGoalRequest> }) => 
            updateGoal(goalId, data),
        onSuccess: (data, variables) => {
            // Invalida la cache dei goals (non abbiamo l'athleteId qui, quindi invalidiamo tutto)
            queryClient.invalidateQueries({ queryKey: ['goals'] })
        },
    })
}

export const useDeleteGoal = () => {
    const queryClient = useQueryClient()
    
    return useMutation({
        mutationFn: (goalId: string) => deleteGoal(goalId),
        onSuccess: () => {
            // Invalida la cache dei goals
            queryClient.invalidateQueries({ queryKey: ['goals'] })
        },
    })
}