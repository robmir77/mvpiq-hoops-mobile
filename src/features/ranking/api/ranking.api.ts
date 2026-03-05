import apiClient from '@/shared/api/apiClient'
import { RankingItem } from '../types/ranking.types'

export const getGlobalRanking = async (): Promise<
    RankingItem[]
> => {
    const response = await apiClient.get<RankingItem[]>(
        '/ranking/global'
    )

    return response.data
}

export const getRoleRanking = async (
    role: string
): Promise<RankingItem[]> => {
    const response = await apiClient.get<RankingItem[]>(
        `/ranking/${role}`
    )

    return response.data
}