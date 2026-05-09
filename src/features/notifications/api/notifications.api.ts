// src/features/notifications/api/notifications.api.ts

import apiClient from '@/shared/api/apiClient'
import { 
    Notification, 
    NotificationResponse, 
    UnreadCountResponse, 
    TestNotificationRequest 
} from '../types/notifications.types'

export const getUserNotifications = async (
    userId: string
): Promise<Notification[]> => {
    try {
        const response = await apiClient.get<Notification[]>(
            `/notifications/user/${userId}`
        )
        return response.data
    } catch (error: any) {
        console.error(
            'Errore caricamento notifiche utente:',
            error?.response?.data || error.message
        )
        
        // Fallback per notifiche non disponibili
        if (error?.response?.status === 404) {
            return []
        }
        
        throw new Error(
            error?.response?.data?.message || 'Errore caricamento notifiche utente'
        )
    }
}

export const getUnreadNotificationsCount = async (
    userId: string
): Promise<UnreadCountResponse> => {
    try {
        const response = await apiClient.get<UnreadCountResponse>(
            `/notifications/user/${userId}/unread-count`
        )
        return response.data
    } catch (error: any) {
        console.error(
            'Errore caricamento conteggio notifiche non lette:',
            error?.response?.data || error.message
        )
        
        // Fallback per conteggio non disponibile
        if (error?.response?.status === 404) {
            return { count: 0 }
        }
        
        throw new Error(
            error?.response?.data?.message || 'Errore caricamento conteggio notifiche non lette'
        )
    }
}

export const markNotificationAsRead = async (
    notificationId: string
): Promise<NotificationResponse> => {
    try {
        const response = await apiClient.put<NotificationResponse>(
            `/notifications/${notificationId}/read`
        )
        return response.data
    } catch (error: any) {
        console.error(
            'Errore marcatura notifica come letta:',
            error?.response?.data || error.message
        )
        throw new Error(
            error?.response?.data?.message || 'Errore marcatura notifica come letta'
        )
    }
}

export const markAllNotificationsAsRead = async (
    userId: string
): Promise<{ success: boolean }> => {
    try {
        const response = await apiClient.put<{ success: boolean }>(
            `/notifications/user/${userId}/read-all`
        )
        return response.data
    } catch (error: any) {
        console.error(
            'Errore marcatura tutte notifiche come lette:',
            error?.response?.data || error.message
        )
        throw new Error(
            error?.response?.data?.message || 'Errore marcatura tutte notifiche come lette'
        )
    }
}

export const deleteAllNotifications = async (
    userId: string
): Promise<{ success: boolean }> => {
    try {
        const response = await apiClient.delete<{ success: boolean }>(
            `/notifications/user/${userId}`
        )
        return response.data
    } catch (error: any) {
        console.error(
            'Errore eliminazione tutte notifiche:',
            error?.response?.data || error.message
        )
        throw new Error(
            error?.response?.data?.message || 'Errore eliminazione tutte notifiche'
        )
    }
}

export const sendTestNotification = async (
    userId: string,
    request: TestNotificationRequest
): Promise<NotificationResponse> => {
    try {
        const response = await apiClient.post<NotificationResponse>(
            `/notifications/test/${userId}`,
            request
        )
        return response.data
    } catch (error: any) {
        console.error(
            'Errore invio notifica test:',
            error?.response?.data || error.message
        )
        throw new Error(
            error?.response?.data?.message || 'Errore invio notifica test'
        )
    }
}
