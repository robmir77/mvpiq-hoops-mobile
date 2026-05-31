// src/shared/api/apiClient.ts

import axios, { InternalAxiosRequestConfig, AxiosHeaders } from 'axios'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { API_BASE_URL } from '@/config/appConfig'

const apiClient = axios.create({
    baseURL: `${API_BASE_URL}/api`,
    timeout: 10000,
})

/* =========================
   REQUEST INTERCEPTOR
========================= */
apiClient.interceptors.request.use(
    async (config: InternalAxiosRequestConfig) => {

        const publicRoutes = ['/auth/login', '/auth/register']
        const isPublicRoute = publicRoutes.some(r => config.url?.includes(r))

        // Per DELETE: resetta completamente gli header e aggiungi solo Authorization se necessario
        // React Native fetch lancia "header name must be a non-empty string" con header problematici
        if (config.method?.toUpperCase() === 'DELETE') {
            console.log('[API] DELETE request, cleaning headers', config.url)

            const headers = new AxiosHeaders()

            if (!isPublicRoute) {
                try {
                    const token = await AsyncStorage.getItem('token')
                    if (token && typeof token === 'string' && token.trim() !== '') {
                        const authValue = `Bearer ${String(token).trim()}`
                        headers.set('Authorization', authValue)
                        console.log('[API] Set Authorization header for DELETE')
                    }
                } catch (_) {
                    // AsyncStorage fallisce in alcuni edge case
                }
            }

            config.headers = headers
            console.log('[API] DELETE headers after cleaning:', JSON.stringify(headers.toJSON()))
        } else {
            // Per altri metodi: gestisci Authorization e Content-Type normalmente
            const headers = new AxiosHeaders()
            headers.set('Content-Type', 'application/json')

            if (!isPublicRoute) {
                try {
                    const token = await AsyncStorage.getItem('token')
                    if (token && typeof token === 'string' && token.trim() !== '') {
                        headers.set('Authorization', `Bearer ${String(token).trim()}`)
                    }
                } catch (_) {
                    // AsyncStorage fallisce in alcuni edge case
                }
            }

            config.headers = headers
        }

        return config
    },
    (error) => Promise.reject(error)
)

/* =========================
   RESPONSE INTERCEPTOR
========================= */
apiClient.interceptors.response.use(
    (response) => response,
    async (error) => {
        if (error?.response?.status === 401) {
            await AsyncStorage.removeItem('token').catch(() => {})
            await AsyncStorage.removeItem('auth_user').catch(() => {})
        }
        return Promise.reject(error)
    }
)

export default apiClient