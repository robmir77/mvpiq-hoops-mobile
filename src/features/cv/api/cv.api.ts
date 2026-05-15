import apiClient from '@/shared/api/apiClient'
import { PlayerCv, PlayerCvSharing, PlayerCvHighlight } from '../types/cv.types'

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
                teams: [],
                highlights: []
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

// ===============================
// SHARING ENDPOINTS
// ===============================
export const enableCvSharing = async (playerId: string): Promise<PlayerCvSharing> => {
    try {
        const response = await apiClient.post<PlayerCvSharing>(
            `/players/${playerId}/cv/share`
        )

        return response.data
    } catch (error: any) {
        console.error(
            'Errore abilitazione condivisione CV:',
            error?.response?.data || error.message
        )

        throw new Error(
            error?.response?.data?.message || 'Errore abilitazione condivisione CV'
        )
    }
}

export const disableCvSharing = async (playerId: string): Promise<PlayerCvSharing> => {
    try {
        const response = await apiClient.delete<PlayerCvSharing>(
            `/players/${playerId}/cv/share`
        )

        return response.data
    } catch (error: any) {
        console.error(
            'Errore disabilitazione condivisione CV:',
            error?.response?.data || error.message
        )

        throw new Error(
            error?.response?.data?.message || 'Errore disabilitazione condivisione CV'
        )
    }
}

// ===============================
// HIGHLIGHTS ENDPOINTS
// ===============================
export const getCvHighlights = async (playerId: string): Promise<PlayerCvHighlight[]> => {
    try {
        const response = await apiClient.get<PlayerCvHighlight[]>(
            `/players/${playerId}/cv/highlights`
        )

        return response.data
    } catch (error: any) {
        console.error(
            'Errore caricamento highlights:',
            error?.response?.data || error.message
        )

        throw new Error(
            error?.response?.data?.message || 'Errore caricamento highlights'
        )
    }
}

export const addCvHighlight = async (
    playerId: string,
    mediaId: string,
    title: string,
    description?: string
): Promise<PlayerCvHighlight> => {
    try {
        const formData = new FormData()
        formData.append('mediaId', mediaId)
        formData.append('title', title)
        if (description) {
            formData.append('description', description)
        }

        const response = await apiClient.post<PlayerCvHighlight>(
            `/players/${playerId}/cv/highlights`,
            formData,
            {
                headers: {
                    'Content-Type': 'multipart/form-data'
                }
            }
        )

        return response.data
    } catch (error: any) {
        console.error(
            'Errore aggiunta highlight:',
            error?.response?.data || error.message
        )

        throw new Error(
            error?.response?.data?.message || 'Errore aggiunta highlight'
        )
    }
}

export const addExternalCvHighlight = async (
    playerId: string,
    externalUrl: string,
    title: string,
    description?: string
): Promise<PlayerCvHighlight> => {
    try {
        const formData = new FormData()
        formData.append('externalUrl', externalUrl)
        formData.append('title', title)
        if (description) {
            formData.append('description', description)
        }

        const response = await apiClient.post<PlayerCvHighlight>(
            `/players/${playerId}/cv/highlights/link`,
            formData,
            {
                headers: {
                    'Content-Type': 'multipart/form-data'
                }
            }
        )

        return response.data
    } catch (error: any) {
        console.error(
            'Errore aggiunta highlight esterno:',
            error?.response?.data || error.message
        )

        throw new Error(
            error?.response?.data?.message || 'Errore aggiunta highlight esterno'
        )
    }
}

export const deleteCvHighlight = async (
    playerId: string,
    highlightId: string
): Promise<void> => {
    try {
        await apiClient.delete(
            `/players/${playerId}/cv/highlights/${highlightId}`
        )
    } catch (error: any) {
        console.error(
            'Errore eliminazione highlight:',
            error?.response?.data || error.message
        )

        throw new Error(
            error?.response?.data?.message || 'Errore eliminazione highlight'
        )
    }
}