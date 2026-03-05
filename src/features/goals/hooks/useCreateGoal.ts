import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createGoal } from '../api/goals.api'

export const useCreateGoal = () => {
    const queryClient = useQueryClient()

    return useMutation({
        mutationFn: createGoal,
        onSuccess: (_, variables) => {
            queryClient.invalidateQueries({
                queryKey: ['goals', variables.athleteId],
            })
        },
    })
}