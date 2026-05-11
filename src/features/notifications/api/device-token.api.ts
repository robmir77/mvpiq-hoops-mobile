// src/features/notifications/api/device-token.api.ts

import apiClient from '@/shared/api/apiClient'
import { 
    DeviceToken, 
    RegisterDeviceTokenRequest 
} from '../types/notifications.types'

export const registerDeviceToken = async (
    request: RegisterDeviceTokenRequest
): Promise<DeviceToken> => {
    try {
        const response = await apiClient.post<DeviceToken>(
            '/device-tokens/register',
            request
        )
        return response.data
    } catch (error: any) {
        console.error(
            'Errore registrazione device token:',
            error?.response?.data || error.message
        )
        throw new Error(
            error?.response?.data?.message || 'Errore registrazione device token'
        )
    }
}

export const getUserDeviceTokens = async (
    userId: string
): Promise<DeviceToken[]> => {
    try {
        const response = await apiClient.get<DeviceToken[]>(
            `/device-tokens/user/${userId}`
        )
        return response.data
    } catch (error: any) {
        console.error(
            'Errore caricamento device token utente:',
            error?.response?.data || error.message
        )
        
        // Fallback per token non disponibili
        if (error?.response?.status === 404) {
            return []
        }
        
        throw new Error(
            error?.response?.data?.message || 'Errore caricamento device token utente'
        )
    }
}

export const deactivateDeviceToken = async (
    token: string
): Promise<DeviceToken> => {
    try {
        const response = await apiClient.put<DeviceToken>(
            `/device-tokens/deactivate?token=${encodeURIComponent(token)}`
        )
        return response.data
    } catch (error: any) {
        console.error(
            'Errore disattivazione device token:',
            error?.response?.data || error.message
        )
        throw new Error(
            error?.response?.data?.message || 'Errore disattivazione device token'
        )
    }
}

export const deactivateAllUserDeviceTokens = async (
    userId: string
): Promise<{ success: boolean }> => {
    try {
        const response = await apiClient.put<{ success: boolean }>(
            `/device-tokens/user/${userId}/deactivate-all`
        )
        return response.data
    } catch (error: any) {
        console.error(
            'Errore disattivazione tutti device token utente:',
            error?.response?.data || error.message
        )
        throw new Error(
            error?.response?.data?.message || 'Errore disattivazione tutti device token utente'
        )
    }
}

export const deactivateDeviceByDeviceId = async (
    deviceId: string
): Promise<DeviceToken> => {
    try {
        const response = await apiClient.put<DeviceToken>(
            `/device-tokens/device/${deviceId}/deactivate`
        )
        return response.data
    } catch (error: any) {
        console.error(
            'Errore disattivazione device per deviceId:',
            error?.response?.data || error.message
        )
        throw new Error(
            error?.response?.data?.message || 'Errore disattivazione device per deviceId'
        )
    }
}

export const cleanupInactiveTokens = async (): Promise<{
    deletedCount: number
}> => {
    try {
        const response = await apiClient.delete<{ deletedCount: number }>(
            '/device-tokens/cleanup'
        )
        return response.data
    } catch (error: any) {
        console.error(
            'Errore pulizia token inattivi:',
            error?.response?.data || error.message
        )
        throw new Error(
            error?.response?.data?.message || 'Errore pulizia token inattivi'
        )
    }
}
