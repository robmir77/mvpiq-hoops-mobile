// C:\MVPiQHoopsMobile\src\features\profile\api\profile.api.ts

import apiClient from '@/shared/api/apiClient'
import { PlayerProfile, UpdatePlayerProfile } from '@/features/profile/types/profile.types'

// API CORRETTE secondo documentazione
export const getPlayerProfile = async (
    id: string
): Promise<PlayerProfile> => {
    try {
        const response = await apiClient.get<PlayerProfile>(
            `/player-profiles/${id}`
        )

        return response.data
    } catch (error: any) {
        console.error(
            'Errore caricamento profilo:',
            error?.response?.data || error.message
        )

        throw new Error(
            error?.response?.data?.message || 'Errore caricamento profilo'
        )
    }
}

export const getPlayerProfileByUserId = async (
    userId: string
): Promise<PlayerProfile> => {
    try {
        const response = await apiClient.get<PlayerProfile>(
            `/player-profiles/user/${userId}`
        )

        return response.data
    } catch (error: any) {
        console.error(
            'Errore caricamento profilo utente:',
            error?.response?.data || error.message
        )

        // Fallback: se il backend ha problemi con player-profiles/user/{userId}
        // proviamo a recuperare i dati utente e creare un profilo base
        if (error?.response?.status === 500 && error?.response?.data?.message?.includes('user.id')) {
            console.log('🔄 Tentativo fallback con endpoint users/me')
            try {
                const userResponse = await apiClient.get(`/users/me/${userId}`)
                const userData = userResponse.data
                
                // Creiamo un profilo base dai dati utente
                const fallbackProfile: PlayerProfile = {
                    id: userData.id,
                    userId: userData.id,
                    username: userData.username,
                    displayName: userData.displayName || userData.username,
                    publicProfile: true,
                    verified: false
                }
                
                console.log('✅ Fallback profile creato con successo')
                return fallbackProfile
            } catch (fallbackError) {
                console.error('❌ Fallback fallito:', fallbackError)
            }
        }

        throw new Error(
            error?.response?.data?.message || 'Errore caricamento profilo utente'
        )
    }
}

export const createPlayerProfile = async (
    userId: string,
    profile: Partial<PlayerProfile>
): Promise<PlayerProfile> => {
    try {
        const response = await apiClient.post<PlayerProfile>(
            `/player-profiles?userId=${userId}`,
            profile
        )

        return response.data
    } catch (error: any) {
        console.error(
            'Errore creazione profilo:',
            error?.response?.data || error.message
        )

        throw new Error(
            error?.response?.data?.message || 'Errore creazione profilo'
        )
    }
}

export const updatePlayerProfile = async (
    id: string,
    profile: UpdatePlayerProfile
): Promise<PlayerProfile> => {
    try {
        const response = await apiClient.put<PlayerProfile>(
            `/player-profiles/${id}`,
            profile
        )

        return response.data
    } catch (error: any) {
        console.error(
            'Errore aggiornamento profilo:',
            error?.response?.data || error.message
        )

        throw new Error(
            error?.response?.data?.message ||
            'Errore durante aggiornamento profilo'
        )
    }
}

export const deletePlayerProfile = async (
    id: string
): Promise<void> => {
    try {
        await apiClient.delete(
            `/player-profiles/${id}`
        )
    } catch (error: any) {
        console.error(
            'Errore eliminazione profilo:',
            error?.response?.data || error.message
        )

        throw new Error(
            error?.response?.data?.message || 'Errore eliminazione profilo'
        )
    }
}

// API di ricerca e filtraggio
export const getPlayersByCountry = async (
    country: string
): Promise<PlayerProfile[]> => {
    try {
        const response = await apiClient.get<PlayerProfile[]>(
            `/player-profiles/country/${country}`
        )

        return response.data
    } catch (error: any) {
        console.error(
            'Errore caricamento giocatori per nazione:',
            error?.response?.data || error.message
        )

        throw new Error(
            error?.response?.data?.message || 'Errore caricamento giocatori per nazione'
        )
    }
}

export const getPlayersByLevel = async (
    level: string
): Promise<PlayerProfile[]> => {
    try {
        const response = await apiClient.get<PlayerProfile[]>(
            `/player-profiles/level/${level}`
        )

        return response.data
    } catch (error: any) {
        console.error(
            'Errore caricamento giocatori per livello:',
            error?.response?.data || error.message
        )

        throw new Error(
            error?.response?.data?.message || 'Errore caricamento giocatori per livello'
        )
    }
}

export const getPlayersByPosition = async (
    position: string
): Promise<PlayerProfile[]> => {
    try {
        const response = await apiClient.get<PlayerProfile[]>(
            `/player-profiles/position/${position}`
        )

        return response.data
    } catch (error: any) {
        console.error(
            'Errore caricamento giocatori per posizione:',
            error?.response?.data || error.message
        )

        throw new Error(
            error?.response?.data?.message || 'Errore caricamento giocatori per posizione'
        )
    }
}

export const getPlayersByAgeRange = async (
    minAge: number,
    maxAge: number
): Promise<PlayerProfile[]> => {
    try {
        const response = await apiClient.get<PlayerProfile[]>(
            `/player-profiles/age-range?minAge=${minAge}&maxAge=${maxAge}`
        )

        return response.data
    } catch (error: any) {
        console.error(
            'Errore caricamento giocatori per età:',
            error?.response?.data || error.message
        )

        throw new Error(
            error?.response?.data?.message || 'Errore caricamento giocatori per età'
        )
    }
}

export const getPublicPlayerProfiles = async (): Promise<PlayerProfile[]> => {
    try {
        const response = await apiClient.get<PlayerProfile[]>(
            '/player-profiles/public'
        )

        return response.data
    } catch (error: any) {
        console.error(
            'Errore caricamento profili pubblici:',
            error?.response?.data || error.message
        )

        throw new Error(
            error?.response?.data?.message || 'Errore caricamento profili pubblici'
        )
    }
}

export const searchPlayerProfiles = async (
    filters: Record<string, any>
): Promise<PlayerProfile[]> => {
    try {
        const response = await apiClient.post<PlayerProfile[]>(
            '/player-profiles/search',
            filters
        )

        return response.data
    } catch (error: any) {
        console.error(
            'Errore ricerca profili:',
            error?.response?.data || error.message
        )

        throw new Error(
            error?.response?.data?.message || 'Errore ricerca profili'
        )
    }
}

export const getPlayerStats = async (
    id: string
): Promise<any> => {
    try {
        const response = await apiClient.get(
            `/player-profiles/${id}/stats`
        )

        return response.data
    } catch (error: any) {
        console.error(
            'Errore caricamento statistiche giocatore:',
            error?.response?.data || error.message
        )

        throw new Error(
            error?.response?.data?.message || 'Errore caricamento statistiche giocatore'
        )
    }
}

export const getPlayerRankings = async (
    id: string
): Promise<any[]> => {
    try {
        const response = await apiClient.get(
            `/player-profiles/${id}/rankings`
        )

        return response.data
    } catch (error: any) {
        console.error(
            'Errore caricamento ranking giocatore:',
            error?.response?.data || error.message
        )

        throw new Error(
            error?.response?.data?.message || 'Errore caricamento ranking giocatore'
        )
    }
}

// Backward compatibility
export const getAthleteProfile = getPlayerProfileByUserId
export const updateAthleteProfile = updatePlayerProfile