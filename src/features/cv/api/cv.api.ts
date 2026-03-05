import apiClient from '@/shared/api/apiClient'
import { PlayerCv } from '../types/cv.types'

export const getPlayerCv = async (playerId: string) => {
    const response = await apiClient.get<PlayerCv>(
        `/players/${playerId}/cv`
    )

    return response.data
}

export const updatePlayerCv = async (
    playerId: string,
    data: PlayerCv
) => {
    const response = await apiClient.put<PlayerCv>(
        `/players/${playerId}/cv`,
        data
    )

    return response.data
}