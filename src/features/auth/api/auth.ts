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
    hasGoals?: boolean    // ← flag per indicare se l'utente ha già configurato i goal
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

export const register = async (
    username: string,
    email: string,
    password: string,
    displayName?: string
): Promise<LoginResponse> => {
    try {
        const response = await apiClient.post('/auth/register', {
            username,
            email,
            password,
            displayName,
        })

        const data = response.data

        // 🔥 VERIFICA PRESENZA TOKEN
        if (!data.token) {
            console.log('⚠️ Token non presente nella risposta di registrazione')
            // Rimuove il salvataggio automatico del token e restituisce i dati
            return data
        }

        // 🔥 SALVATAGGIO TOKEN
        await AsyncStorage.setItem('token', data.token)

        console.log('💾 TOKEN SALVATO DOPO REGISTRAZIONE')

        return data
    } catch (error: any) {
        console.error(
            'Errore registrazione:',
            error?.response?.data || error.message
        )

        throw new Error(
            error?.response?.data?.message || 'Registrazione fallita'
        )
    }
}

export const logout = async (): Promise<void> => {
    try {
        // Rimuovi il token da AsyncStorage
        await AsyncStorage.removeItem('token')
        console.log('🗑️ TOKEN RIMOSSO - Logout completato')
    } catch (error) {
        console.error('Errore durante il logout:', error)
        throw new Error('Logout fallito')
    }
}