import { useQuery } from '@tanstack/react-query'
import { getGoalsByAthlete } from '../api/goals.api'

export const useGoals = (athleteId?: string) => {
    return useQuery({
        queryKey: ['goals', athleteId],
        queryFn: () => getGoalsByAthlete(athleteId!),
        enabled: !!athleteId,
    })
}