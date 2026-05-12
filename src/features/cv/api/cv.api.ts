import apiClient from '@/shared/api/apiClient'
import { PlayerCv } from '../types/cv.types'

export const getPlayerCv = async (playerId: string): Promise<PlayerCv> => {
    try {
        const response = await apiClient.get<PlayerCv>(
            `/players/${playerId}/cv`
        )

        return response.data
    } catch (error: any) {
        console.error(
            'Errore caricamento CV giocatore:',
            error?.response?.data || error.message
        )

        // Se il CV non esiste (404), restituiamo un CV vuoto senza errore
        if (error?.response?.status === 404) {
            console.log('🔄 CV non trovato, creo un CV vuoto')
            return {
                headline: '',
                summary: '',
                stats: {},
                teams: []
            }
        }

        // Per altri errori, lanciamo l'eccezione
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
        const response = await apiClient.put<PlayerCv>(
            `/players/${playerId}/cv`,
            data
        )

        return response.data
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