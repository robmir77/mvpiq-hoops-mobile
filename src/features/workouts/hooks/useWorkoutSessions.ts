// src/features/workouts/hooks/useWorkoutSessions.ts

import { useQuery } from '@tanstack/react-query'
import { getPlayerWorkoutSessions } from '../api/workouts.api'

export const useWorkoutSessions = (userId: string) => {
    return useQuery({
        queryKey: ['workoutSessions', userId],
        queryFn: () => getPlayerWorkoutSessions(userId),
        enabled: !!userId,
        staleTime: 5 * 60 * 1000, // 5 minuti
    })
}
