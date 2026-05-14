// C:\MVPiQHoopsMobile\src\features\profile\api\profile.api.ts

import apiClient from '@/shared/api/apiClient'
import { Player, UpdatePlayer } from '@/features/profile/types/profile.types'
import * as FileSystem from 'expo-file-system/legacy'

// API CORRETTE secondo documentazione
export const getPlayer = async (
    id: string
): Promise<Player> => {
    try {
        const response = await apiClient.get<Player>(
            `/athlet/${id}`
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

export const getPlayerByUserId = async (
    userId: string
): Promise<Player> => {
    try {
        const response = await apiClient.get<Player>(
            `/athlet/user/${userId}`
        )

        return response.data
    } catch (error: any) {
        console.error(
            'Errore caricamento profilo utente:',
            error?.response?.data || error.message
        )

        // Fallback: se il backend ha problemi con athlet/user/{userId}
        // proviamo a recuperare i dati utente e creare un profilo base
        if (error?.response?.status === 500 && error?.response?.data?.message?.includes('user.id')) {
            console.log('🔄 Tentativo fallback con endpoint users/me')
            try {
                const userResponse = await apiClient.get(`/users/me/${userId}`)
                const userData = userResponse.data
                
                // Creiamo un profilo base dai dati utente
                const fallbackProfile: Player = {
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

export const createPlayer = async (
    userId: string,
    profile: Partial<Player>
): Promise<Player> => {
    try {
        const response = await apiClient.post<Player>(
            `/athlet?userId=${userId}`,
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

export const updatePlayer = async (
    id: string,
    profile: UpdatePlayer
): Promise<Player> => {
    try {
        const response = await apiClient.put<Player>(
            `/athlet/${id}`,
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

export const deletePlayer = async (
    id: string
): Promise<void> => {
    try {
        await apiClient.delete(
            `/athlet/${id}`
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
): Promise<Player[]> => {
    try {
        const response = await apiClient.get<Player[]>(
            `/athletes/country/${country}`
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
): Promise<Player[]> => {
    try {
        const response = await apiClient.get<Player[]>(
            `/athletes/level/${level}`
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
): Promise<Player[]> => {
    try {
        const response = await apiClient.get<Player[]>(
            `/athletes/position/${position}`
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
): Promise<Player[]> => {
    try {
        const response = await apiClient.get<Player[]>(
            `/athletes/age-range?minAge=${minAge}&maxAge=${maxAge}`
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

export const getPublicPlayers = async (): Promise<Player[]> => {
    try {
        const response = await apiClient.get<Player[]>(
            '/athletes/public'
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

export const searchPlayers = async (
    filters: Record<string, any>
): Promise<Player[]> => {
    try {
        const response = await apiClient.post<Player[]>(
            '/athletes/search',
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
            `/athlet/${id}/stats`
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
            `/athlet/${id}/rankings`
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

// Athlete Management - Alternative Endpoints (dal backend)
export const getAllAthletes = async (): Promise<Player[]> => {
    try {
        const response = await apiClient.get<{ data: Player[] }>('/athletes')

        return response.data.data
    } catch (error: any) {
        console.error(
            'Errore caricamento tutti gli atleti:',
            error?.response?.data || error.message
        )

        throw new Error(
            error?.response?.data?.message || 'Errore caricamento tutti gli atleti'
        )
    }
}

export const getAthleteById = async (
    id: string
): Promise<Player> => {
    try {
        const response = await apiClient.get<{ data: Player }>(`/athlet/${id}`)

        return response.data.data
    } catch (error: any) {
        console.error(
            'Errore caricamento atleta:',
            error?.response?.data || error.message
        )

        throw new Error(
            error?.response?.data?.message || 'Errore caricamento atleta'
        )
    }
}

export const getAthleteByUserId = async (
    userId: string
): Promise<Player> => {
    try {
        const response = await apiClient.get<{ data: Player }>(
            `/athlet/user/${userId}`
        )

        return response.data.data
    } catch (error: any) {
        console.error(
            'Errore caricamento atleta per user ID:',
            error?.response?.data || error.message
        )

        throw new Error(
            error?.response?.data?.message || 'Errore caricamento atleta per user ID'
        )
    }
}

export const updateAthleteProfile = async (
    id: string,
    profileData: {
        mainPositionId?: string
        secondaryPositionIds?: string[]
        [key: string]: any
    }
): Promise<Player> => {
    try {
        const response = await apiClient.put<Player>(
            `/athlet/${id}`,
            profileData
        )

        return response.data
    } catch (error: any) {
        console.error(
            'Errore aggiornamento profilo atleta:',
            error?.response?.data || error.message
        )

        throw new Error(
            error?.response?.data?.message || 'Errore aggiornamento profilo atleta'
        )
    }
}

// Backward compatibility
export const getAthleteProfile = getPlayerByUserId

// Legacy aliases for backward compatibility
export const getPlayerProfile = getPlayer
export const getPlayerProfileByUserId = getPlayerByUserId
export const createPlayerProfile = createPlayer
export const updatePlayerProfile = updatePlayer
export const deletePlayerProfile = deletePlayer
export const getPublicPlayerProfiles = getPublicPlayers
export const searchPlayerProfiles = searchPlayers

// Profile Image Upload
export const uploadProfileImage = async (
    playerId: string,
    imageUri: string
): Promise<{ avatarUrl: string }> => {
    try {
        console.log('📸 uploadProfileImage - Start')
        console.log('📸 playerId:', playerId)
        console.log('📸 imageUri:', imageUri)

        // Convert URI to file info
        const fileInfo = await FileSystem.getInfoAsync(imageUri)
        console.log('📸 fileInfo:', fileInfo)

        if (!fileInfo.exists) {
            console.error('❌ File does not exist')
            throw new Error('File does not exist')
        }

        // Create FormData
        const formData = new FormData()

        // Determine file type from URI
        const uriParts = imageUri.split('.')
        const fileType = uriParts[uriParts.length - 1] || 'jpg'

        console.log('📸 fileType:', fileType)

        formData.append('file', {
            uri: imageUri,
            name: `profile.${fileType}`,
            type: `image/${fileType}`,
        } as any)

        console.log('📸 FormData created, sending to API...')

        const response = await apiClient.put<{ avatarUrl: string }>(
            `/players/${playerId}/profile-image`,
            formData,
            {
                headers: {
                    'Content-Type': 'multipart/form-data'
                }
            }
        )

        console.log('✅ Upload successful:', response.data)
        return response.data
    } catch (error: any) {
        console.error('❌ Errore upload immagine profilo:')
        console.error('❌ error:', error)
        console.error('❌ error.response:', error?.response)
        console.error('❌ error.response.data:', error?.response?.data)
        console.error('❌ error.message:', error?.message)

        throw new Error(
            error?.response?.data?.message || error?.message || 'Errore upload immagine profilo'
        )
    }
}