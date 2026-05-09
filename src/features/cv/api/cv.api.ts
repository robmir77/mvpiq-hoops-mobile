import apiClient from '@/shared/api/apiClient'
import { PlayerCv } from '../types/cv.types'

export const getPlayerCv = async (playerId: string): Promise<PlayerCv> => {
    try {
        const response = await apiClient.get<{ data: PlayerCv }>(
            `/players/${playerId}/cv`
        )

        return response.data.data
    } catch (error: any) {
        console.error(
            'Errore caricamento CV giocatore:',
            error?.response?.data || error.message
        )

        // Se il CV non esiste (404), restituiamo un CV vuoto
        if (error?.response?.status === 404) {
            console.log('🔄 CV non trovato, creo un CV vuoto')
            return {
                headline: '',
                summary: '',
                stats: {},
                teams: []
            }
        }

        throw new Error(
            error?.response?.data?.message || 'Errore caricamento CV giocatore'
        )
    }
}

export const updatePlayerCv = async (
    playerId: string,
    data: PlayerCv
): Promise<PlayerCv> => {
    try {
        const response = await apiClient.put<{ data: PlayerCv }>(
            `/players/${playerId}/cv`,
            data
        )

        return response.data.data
    } catch (error: any) {
        console.error(
            'Errore aggiornamento CV giocatore:',
            error?.response?.data || error.message
        )

        throw new Error(
            error?.response?.data?.message || 'Errore aggiornamento CV giocatore'
        )
    }
}