// src/shared/api/apiClient.ts

import axios from 'axios'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { API_BASE_URL } from '@/config/appConfig'

const apiClient = axios.create({
    baseURL: `${API_BASE_URL}/api`,
    timeout: 10000,
    headers: {
        'Content-Type': 'application/json',
    },
})

/* =========================
   REQUEST INTERCEPTOR
========================= */
apiClient.interceptors.request.use(
    async (config) => {
        const token = await AsyncStorage.getItem('token')

        // 👇 Rotte pubbliche che NON devono avere token
        const publicRoutes = ['/auth/login', '/auth/register']

        const isPublicRoute = publicRoutes.some((route) =>
            config.url?.includes(route)
        )

        console.log('\n🚀 REQUEST')
        console.log('➡️ URL:', `${config.baseURL}${config.url}`)
        console.log('➡️ METHOD:', config.method?.toUpperCase())
        console.log('➡️ BODY:', config.data || 'none')
        console.log('➡️ TOKEN:', isPublicRoute ? 'SKIPPED' : (token ? 'PRESENT' : 'MISSING'))

        if (token && !isPublicRoute) {
            config.headers.set('Authorization', `Bearer ${token}`)
        }

        return config
    },
    (error) => {
        console.log('❌ REQUEST ERROR:', error)
        return Promise.reject(error)
    }
)

/* =========================
   RESPONSE INTERCEPTOR
========================= */
apiClient.interceptors.response.use(
    (response) => {
        console.log('\n✅ RESPONSE')
        console.log('⬅️ URL:', response.config.url)
        console.log('⬅️ STATUS:', response.status)
        console.log('⬅️ DATA:', response.data)

        return response
    },
    async (error) => {
        console.log('\n🛑 RESPONSE ERROR')
        console.log('⬅️ URL:', error?.config?.url)
        console.log('⬅️ STATUS:', error?.response?.status)
        console.log('⬅️ DATA:', error?.response?.data)

        // Gestione automatica dei token scaduti (401)
        if (error?.response?.status === 401) {
            console.log('🔐 TOKEN SCADUTO - Reindirizzamento al login')
            
            // Rimuovi il token scaduto
            await AsyncStorage.removeItem('token')
            await AsyncStorage.removeItem('auth_user')
            
            // Qui potresti emettere un evento o usare un navigation service
            // per reindirizzare automaticamente alla schermata di login
            console.log('🗑️ Token rimosso - Utente deve fare nuovamente il login')
        }

        return Promise.reject(error)
    }
)

export default apiClient