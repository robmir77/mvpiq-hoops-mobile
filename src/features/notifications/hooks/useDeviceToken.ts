// src/features/notifications/hooks/useDeviceToken.ts

import { useQuery, useMutation } from '@tanstack/react-query'
import { 
    registerDeviceToken,
    getUserDeviceTokens,
    deactivateDeviceToken,
    deactivateAllUserDeviceTokens,
    cleanupInactiveTokens
} from '../api/device-token.api'
import { 
    RegisterDeviceTokenRequest 
} from '../types/notifications.types'

export const useRegisterDeviceToken = () => {
    return useMutation({
        mutationFn: registerDeviceToken,
        onSuccess: (data) => {
            console.log('✅ Device token registrato con successo:', data.id)
        },
        onError: (error) => {
            console.error('❌ Errore registrazione device token:', error)
        }
    })
}

export const useUserDeviceTokens = (userId?: string) => {
    return useQuery({
        queryKey: ['device-tokens', userId],
        queryFn: () => userId ? getUserDeviceTokens(userId) : Promise.resolve([]),
        enabled: !!userId,
        staleTime: 1000 * 60 * 10, // 10 minuti
    })
}

export const useDeactivateDeviceToken = () => {
    return useMutation({
        mutationFn: deactivateDeviceToken,
        onSuccess: (data) => {
            console.log('✅ Device token disattivato con successo:', data.id)
        },
        onError: (error) => {
            console.error('❌ Errore disattivazione device token:', error)
        }
    })
}

export const useDeactivateAllUserDeviceTokens = () => {
    return useMutation({
        mutationFn: deactivateAllUserDeviceTokens,
        onSuccess: (data) => {
            console.log('✅ Tutti i device token utente disattivati con successo')
        },
        onError: (error) => {
            console.error('❌ Errore disattivazione tutti device token utente:', error)
        }
    })
}

export const useCleanupInactiveTokens = () => {
    return useMutation({
        mutationFn: cleanupInactiveTokens,
        onSuccess: (data) => {
            console.log(`✅ Pulizia token inattivi completata: ${data.deletedCount} token eliminati`)
        },
        onError: (error) => {
            console.error('❌ Errore pulizia token inattivi:', error)
        }
    })
}
