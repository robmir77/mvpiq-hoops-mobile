import apiClient from '@/shared/api/apiClient'
import { RankingItem } from '../types/ranking.types'

export const getGlobalRanking = async (): Promise<
    RankingItem[]
> => {
    try {
        const response = await apiClient.get<RankingItem[]>(
            '/ranking/global'
        )

        return response.data
    } catch (error: any) {
        console.error(
            'Errore caricamento ranking globale:',
            error?.response?.data || error.message
        )
        
        // Fallback per ranking non disponibile
        if (error?.response?.status === 404) {
            return []
        }
        
        throw new Error(
            error?.response?.data?.message || 'Errore caricamento ranking globale'
        )
    }
}

export const getRoleRanking = async (
    role: string
): Promise<RankingItem[]> => {
    try {
        const response = await apiClient.get<RankingItem[]>(
            `/ranking/${role}`
        )

        return response.data
    } catch (error: any) {
        console.error(
            'Errore caricamento ranking per ruolo:',
            error?.response?.data || error.message
        )
        
        // Fallback per ranking non disponibile
        if (error?.response?.status === 404) {
            return []
        }
        
        throw new Error(
            error?.response?.data?.message || 'Errore caricamento ranking per ruolo'
        )
    }
}