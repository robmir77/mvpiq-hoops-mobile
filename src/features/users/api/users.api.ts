// src/features/users/api/users.api.ts

import apiClient from '@/shared/api/apiClient'

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
