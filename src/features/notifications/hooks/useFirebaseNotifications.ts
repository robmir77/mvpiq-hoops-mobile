// src/features/notifications/hooks/useFirebaseNotifications.ts

import { useEffect, useContext } from 'react'
import { Platform } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import { AuthContext } from '@/features/auth/context/AuthContext'
import { useRegisterDeviceToken } from './useDeviceToken'
import FirebaseService from '../services/FirebaseService'
import { DevicePlatform } from '../types/notifications.types'

export const useFirebaseNotifications = () => {
    const navigation = useNavigation<any>()
    const auth = useContext(AuthContext)
    const registerTokenMutation = useRegisterDeviceToken()

    useEffect(() => {
        if (!auth?.user?.id) return

        const userId = auth.user.id

        const initializeNotifications = async () => {
            try {
                console.log('🔥 Inizializzazione notifiche Firebase...')

                // Inizializza il servizio Firebase
                await FirebaseService.initialize(userId)

                // Ottieni e registra il token
                const token = await FirebaseService.getFCMToken()
                if (token) {
                    const platform = Platform.OS === 'ios' ? DevicePlatform.IOS : DevicePlatform.ANDROID
                    
                    registerTokenMutation.mutate({
                        token,
                        platform
                    })
                }

                // Ascolta i messaggi in foreground
                const unsubscribeForeground = FirebaseService.onForegroundMessage((message) => {
                    console.log('📨 Messaggio ricevuto in foreground:', message)
                    // Notifiche in foreground gestite dal sistema di notifiche
                })

                // Ascolta le notifiche aperte da background
                const unsubscribeOpened = FirebaseService.onNotificationOpenedApp((message) => {
                    console.log('📲 Notifica aperta da background:', message)
                    handleNotificationNavigation(message)
                })

                // Controlla se l'app è stata aperta da una notifica
                const initialNotification = await FirebaseService.getInitialNotification()
                if (initialNotification) {
                    handleNotificationNavigation(initialNotification)
                }

                // Ascolta i refresh del token
                const unsubscribeTokenRefresh = FirebaseService.onTokenRefresh((newToken) => {
                    console.log('🔄 Token refreshed, ri-registro...')
                    const platform = Platform.OS === 'ios' ? DevicePlatform.IOS : DevicePlatform.ANDROID
                    
                    registerTokenMutation.mutate({
                        token: newToken,
                        platform
                    })
                })

                return () => {
                    unsubscribeForeground()
                    unsubscribeOpened()
                    unsubscribeTokenRefresh()
                }
            } catch (error) {
                console.error('❌ Errore inizializzazione notifiche Firebase:', error)
            }
        }

        initializeNotifications()
        
        // useEffect non può restituire una Promise come cleanup
        // Il cleanup è gestito internamente nella funzione
        return undefined
    }, [auth?.user?.id, registerTokenMutation])

    const handleNotificationNavigation = (message: any) => {
        // Gestisci la navigazione basata sul tipo di notifica
        const data = message.data || {}
        const type = data.type

        console.log('🧭 Navigazione per tipo notifica:', type)

        switch (type) {
            case 'TRAINING_PROGRAM_GENERATED':
                navigation.navigate('Training', {
                    screen: 'AiTrainingProgram',
                    params: { programId: data.programId }
                })
                break
            case 'TRAINING_REMINDER':
                navigation.navigate('Training')
                break
            case 'GOAL_ACHIEVED':
                navigation.navigate('Goals')
                break
            case 'PROFILE_UPDATED':
                navigation.navigate('Profile')
                break
            case 'VIDEO_ANALYSIS_COMPLETED':
                navigation.navigate('Training', {
                    screen: 'VideoAnalysis'
                })
                break
            default:
                // Naviga alla schermata Notifiche di default
                navigation.navigate('Notifications')
        }
    }

    return {
        isInitialized: !!auth?.user?.id,
        isRegistering: registerTokenMutation.isPending
    }
}
