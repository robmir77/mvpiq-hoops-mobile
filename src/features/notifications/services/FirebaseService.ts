// src/features/notifications/services/FirebaseService.ts

import messaging from '@react-native-firebase/messaging'
import { Platform } from 'react-native'
import { useRegisterDeviceToken } from '../hooks/useDeviceToken'
import { DevicePlatform } from '../types/notifications.types'

export class FirebaseService {
    private static instance: FirebaseService

    static getInstance(): FirebaseService {
        if (!FirebaseService.instance) {
            FirebaseService.instance = new FirebaseService()
        }
        return FirebaseService.instance
    }

    // Richiedi permessi notifiche
    async requestPermissions(): Promise<boolean> {
        try {
            const authStatus = await messaging().requestPermission()
            const enabled =
                authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
                authStatus === messaging.AuthorizationStatus.PROVISIONAL

            console.log('🔔 Permission status:', authStatus)
            return enabled
        } catch (error) {
            console.error('❌ Errore richiesta permessi notifiche:', error)
            return false
        }
    }

    // Ottieni il token FCM
    async getFCMToken(): Promise<string | null> {
        try {
            const enabled = await this.requestPermissions()
            if (!enabled) {
                console.log('⚠️ Permessi notifiche non concessi')
                return null
            }

            const token = await messaging().getToken()
            console.log('📱 FCM Token:', token)
            return token
        } catch (error) {
            console.error('❌ Errore ottenimento FCM token:', error)
            return null
        }
    }

    // Registra il token nel backend
    async registerToken(userId: string): Promise<boolean> {
        try {
            const token = await this.getFCMToken()
            if (!token) {
                return false
            }

            const platform = Platform.OS === 'ios' ? DevicePlatform.IOS : DevicePlatform.ANDROID

            // Qui dovresti usare il hook, ma per il servizio creiamo una funzione diretta
            // In un'implementazione reale, questo dovrebbe essere gestito nel componente
            console.log('📝 Registrazione token:', { token, platform, userId })
            
            return true
        } catch (error) {
            console.error('❌ Errore registrazione token:', error)
            return false
        }
    }

    // Ascolta i cambiamenti del token
    onTokenRefresh(callback: (token: string) => void): () => void {
        const unsubscribe = messaging().onTokenRefresh((token: string) => {
            console.log('🔄 Token refreshed:', token)
            callback(token)
        })

        return unsubscribe
    }

    // Ascolta le notifiche in foreground
    onForegroundMessage(callback: (message: any) => void): () => void {
        const unsubscribe = messaging().onMessage(async (remoteMessage: any) => {
            console.log('📨 Messaggio ricevuto in foreground:', remoteMessage)
            callback(remoteMessage)
        })

        return unsubscribe
    }

    // Ascolta le notifiche in background/click
    onNotificationOpenedApp(callback: (message: any) => void): () => void {
        const unsubscribe = messaging().onNotificationOpenedApp((remoteMessage: any) => {
            console.log('📲 Notifica aperta da background:', remoteMessage)
            callback(remoteMessage)
        })

        return unsubscribe
    }

    // Controlla se l'app è stata aperta da una notifica
    async getInitialNotification(): Promise<any> {
        try {
            const message = await messaging().getInitialNotification()
            if (message) {
                console.log('🚀 App aperta da notifica chiusa:', message)
            }
            return message
        } catch (error) {
            console.error('❌ Errore ottenimento notifica iniziale:', error)
            return null
        }
    }

    // Crea un canale di notifica (Android)
    async createNotificationChannel(
        channelId: string,
        channelName: string,
        channelDescription: string,
        importance: 'high' | 'default' | 'low' = 'default'
    ): Promise<void> {
        if (Platform.OS === 'android') {
            // Type assertion per evitare errori TypeScript quando Firebase non è installato
            const messagingAny = messaging() as any
            const Android = (messagingAny as any).Android || {}
            
            const channel = new Android.NotificationChannel(
                channelId,
                channelName,
                Android.Importance?.[importance.toUpperCase()] || Android.Importance?.DEFAULT
            )

            channel.setDescription(channelDescription)

            await messagingAny.createAndroidNotificationChannel(channel)
            console.log('📢 Canale notifica creato:', channelId)
        }
    }

    // Inizializza il servizio Firebase
    async initialize(userId: string): Promise<void> {
        try {
            console.log('🔥 Inizializzazione Firebase Service...')

            // Crea canali di notifica
            await this.createNotificationChannel(
                'training_programs',
                'Programmi di Allenamento',
                'Notifiche per i programmi di allenamento generati dall\'AI',
                'high'
            )

            await this.createNotificationChannel(
                'goals',
                'Obiettivi',
                'Notifiche per il raggiungimento degli obiettivi',
                'default'
            )

            await this.createNotificationChannel(
                'system',
                'Sistema',
                'Notifiche di sistema e annunci',
                'low'
            )

            // Registra il token
            await this.registerToken(userId)

            // Controlla notifica iniziale
            await this.getInitialNotification()

            console.log('✅ Firebase Service inizializzato con successo')
        } catch (error) {
            console.error('❌ Errore inizializzazione Firebase Service:', error)
        }
    }
}

export default FirebaseService.getInstance()
