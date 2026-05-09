// src/features/ranking/hooks/useRanking.ts

import { useQuery } from '@tanstack/react-query'
import { getGlobalRanking, getRoleRanking } from '../api/ranking.api'
import { RankingItem } from '../types/ranking.types'

export const useGlobalRanking = () => {
    return useQuery({
        queryKey: ['ranking-global'],
        queryFn: getGlobalRanking,
        staleTime: 1000 * 60 * 5, // 5 minuti
    })
}

export const useRoleRanking = (role?: string) => {
    return useQuery({
        queryKey: ['ranking-role', role],
        queryFn: () => role ? getRoleRanking(role) : Promise.resolve([]),
        enabled: !!role,
        staleTime: 1000 * 60 * 5, // 5 minuti
    })
}
