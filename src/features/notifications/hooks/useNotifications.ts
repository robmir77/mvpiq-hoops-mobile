// src/features/notifications/hooks/useNotifications.ts

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { 
    getUserNotifications,
    getUnreadNotificationsCount,
    markNotificationAsRead,
    markAllNotificationsAsRead,
    deleteAllNotifications,
    sendTestNotification
} from '../api/notifications.api'
import { 
    Notification, 
    TestNotificationRequest 
} from '../types/notifications.types'

export const useUserNotifications = (userId?: string) => {
    return useQuery({
        queryKey: ['notifications', userId],
        queryFn: () => userId ? getUserNotifications(userId) : Promise.resolve([]),
        enabled: !!userId,
        staleTime: 1000 * 60 * 2, // 2 minuti
    })
}

export const useUnreadNotificationsCount = (userId?: string) => {
    return useQuery({
        queryKey: ['notifications-unread-count', userId],
        queryFn: () => userId ? getUnreadNotificationsCount(userId) : Promise.resolve({ count: 0 }),
        enabled: !!userId,
        staleTime: 1000 * 60, // 1 minuto
    })
}

export const useMarkNotificationAsRead = () => {
    const queryClient = useQueryClient()
    
    return useMutation({
        mutationFn: markNotificationAsRead,
        onSuccess: (data, variables) => {
            // Invalida le cache delle notifiche e del conteggio
            queryClient.invalidateQueries({
                queryKey: ['notifications']
            })
            queryClient.invalidateQueries({
                queryKey: ['notifications-unread-count']
            })
        },
        onError: (error) => {
            console.error('❌ Errore marcatura notifica come letta:', error)
        }
    })
}

export const useMarkAllNotificationsAsRead = () => {
    const queryClient = useQueryClient()
    
    return useMutation({
        mutationFn: markAllNotificationsAsRead,
        onSuccess: () => {
            // Invalida le cache delle notifiche e del conteggio
            queryClient.invalidateQueries({
                queryKey: ['notifications']
            })
            queryClient.invalidateQueries({
                queryKey: ['notifications-unread-count']
            })
        },
        onError: (error) => {
            console.error('❌ Errore marcatura tutte notifiche come lette:', error)
        }
    })
}

export const useDeleteAllNotifications = () => {
    const queryClient = useQueryClient()
    
    return useMutation({
        mutationFn: deleteAllNotifications,
        onSuccess: () => {
            // Invalida le cache delle notifiche e del conteggio
            queryClient.invalidateQueries({
                queryKey: ['notifications']
            })
            queryClient.invalidateQueries({
                queryKey: ['notifications-unread-count']
            })
        },
        onError: (error) => {
            console.error('❌ Errore eliminazione tutte notifiche:', error)
        }
    })
}

export const useSendTestNotification = () => {
    const queryClient = useQueryClient()
    
    return useMutation({
        mutationFn: ({ userId, request }: { userId: string; request: TestNotificationRequest }) => 
            sendTestNotification(userId, request),
        onSuccess: (data) => {
            console.log('✅ Notifica test inviata con successo:', data)
            // Invalida le cache delle notifiche
            queryClient.invalidateQueries({
                queryKey: ['notifications']
            })
        },
        onError: (error) => {
            console.error('❌ Errore invio notifica test:', error)
        }
    })
}
