// staleTime=0: data always stale → refetch on invalidate/focus
// gcTime=5min: keep in cache to avoid loading flash

import { useQuery } from '@tanstack/react-query'
import { getPlayerWorkoutSessions } from '../api/workouts.api'

export const useWorkoutSessions = (userId: string) => {
    return useQuery({
        queryKey: ['workoutSessions', userId],
        queryFn: () => getPlayerWorkoutSessions(userId),
        enabled: !!userId,
        staleTime: 0,
        gcTime: 5 * 60 * 1000,
    })
}
