// src/features/workouts/hooks/useWorkoutSessions.ts
//
// staleTime portato a 0: i dati vengono considerati subito "stale"
// così useFocusEffect + invalidateQueries triggera sempre un nuovo fetch
// quando si ritorna sulla WorkoutHome (dopo una sessione, dopo una delete, ecc.)

import { useQuery } from '@tanstack/react-query'
import { getPlayerWorkoutSessions } from '../api/workouts.api'

export const useWorkoutSessions = (userId: string) => {
    return useQuery({
        queryKey: ['workoutSessions', userId],
        queryFn: () => getPlayerWorkoutSessions(userId),
        enabled: !!userId,
        staleTime: 0,           // sempre stale → refetch a ogni invalidate/focus
        gcTime: 5 * 60 * 1000, // mantieni in cache 5 min per evitare flash di loading
    })
}
