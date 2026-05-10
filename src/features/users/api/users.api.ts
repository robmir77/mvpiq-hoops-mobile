// src/features/users/api/users.api.ts

import apiClient from '@/shared/api/apiClient'
import { OnlineUserDTO } from '../types/users.types'

export interface UserDTO {
    id: string
    username: string
    email: string
    displayName?: string
    role?: string
    createdAt?: string
    updatedAt?: string
}

export const getCurrentUser = async (
    userId: string
): Promise<UserDTO> => {
    try {
        const response = await apiClient.get<UserDTO>(
            `/users/me/${userId}`
        )

        return response.data
    } catch (error: any) {
        console.error(
            'Errore caricamento utente corrente:',
            error?.response?.data || error.message
        )

        throw new Error(
            error?.response?.data?.message || 'Errore caricamento utente corrente'
        )
    }
}

/**
 * GET Utenti online (Admin only)
 */
export const getOnlineUsers = async (
    minutesAgo: number = 15
): Promise<OnlineUserDTO[]> => {
    try {
        const response = await apiClient.get<OnlineUserDTO[]>(
            `/users/online?minutesAgo=${minutesAgo}`
        )
        return response.data
    } catch (error: any) {
        console.error(
            'Errore caricamento utenti online:',
            error?.response?.data || error.message
        )
        throw new Error(
            error?.response?.data?.message || 'Errore caricamento utenti online'
        )
    }
}
