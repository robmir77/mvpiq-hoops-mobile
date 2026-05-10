// src/features/auth/api/auth.ts

import apiClient from '@/shared/api/apiClient'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { LoginResponse, RegisterRequest, UserRole } from '../types/auth.types'

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
        await AsyncStorage.setItem('token', data.data?.token)

        console.log('💾 TOKEN SALVATO')

        return data.data
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
    displayName?: string,
    role?: UserRole
): Promise<LoginResponse> => {
    try {
        const response = await apiClient.post('/auth/register', {
            username,
            email,
            password,
            displayName,
            role,
        })

        const data = response.data

        // 🔥 VERIFICA PRESENZA TOKEN
        if (!data.data?.token) {
            console.log('⚠️ Token non presente nella risposta di registrazione')
            // Rimuove il salvataggio automatico del token e restituisce i dati
            return data.data
        }

        // 🔥 SALVATAGGIO TOKEN
        await AsyncStorage.setItem('token', data.data.token)

        console.log('💾 TOKEN SALVATO DOPO REGISTRAZIONE')

        return data.data
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

export const refreshAccessToken = async (): Promise<string> => {
    try {
        const response = await apiClient.post('/auth/refresh')
        const newToken = response.data?.data?.token
        
        if (newToken) {
            await AsyncStorage.setItem('token', newToken)
            console.log('🔄 TOKEN REFRESHED')
            return newToken
        }
        
        throw new Error('Refresh token non valido')
    } catch (error: any) {
        console.error('Errore refresh token:', error)
        // Se il refresh fallisce, rimuovi il token
        await logout()
        throw new Error('Sessione scaduta - Effettua nuovamente il login')
    }
}

export const logout = async (): Promise<void> => {
    try {
        // Chiama logout sul backend se disponibile
        try {
            await apiClient.post('/auth/logout')
        } catch (error) {
            console.log('Logout backend non disponibile o già scaduto')
        }
        
        // Rimuovi tutti i dati di autenticazione da AsyncStorage
        await AsyncStorage.multiRemove(['token', 'auth_user'])
        console.log('🗑️ TOKEN E UTENTE RIMOSSI - Logout completato')
    } catch (error) {
        console.error('Errore durante il logout:', error)
        // Forza la rimozione anche in caso di errore
        await AsyncStorage.multiRemove(['token', 'auth_user'])
        throw new Error('Logout fallito')
    }
}