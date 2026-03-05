// src/features/auth/api/auth.ts

import apiClient from '@/shared/api/apiClient'
import AsyncStorage from '@react-native-async-storage/async-storage'

export interface LoginResponse {
    token: string
    id: string            // ← attenzione: il backend restituisce "id", non "userId"
    username: string
    displayName?: string
    email?: string
    role?: string
}

export const login = async (
    email: string,
    password: string
): Promise<LoginResponse> => {
    try {
        const response = await apiClient.post('/auth/login', {
            email,
            password,
        })

        const data = response.data

        // 🔥 SALVATAGGIO TOKEN
        await AsyncStorage.setItem('token', data.token)

        console.log('💾 TOKEN SALVATO')

        return data
    } catch (error: any) {
        console.error(
            'Errore login:',
            error?.response?.data || error.message
        )

        throw new Error(
            error?.response?.data?.message || 'Credenziali errate'
        )
    }
}