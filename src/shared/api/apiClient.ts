// src/shared/api/apiClient.ts

import axios from 'axios'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { API_BASE_URL } from '@/config/appConfig'

const apiClient = axios.create({
    baseURL: `${API_BASE_URL}/api`,
    timeout: 15000,
})

apiClient.interceptors.request.use(
    async (config) => {
        const method      = (config.method ?? 'get').toUpperCase()
        const isDelete    = method === 'DELETE'
        const isMultipart = config.data instanceof FormData

        // Leggi token prima di tutto
        let token: string | null = null
        const publicRoutes = ['/auth/login', '/auth/register']
        const isPublic = publicRoutes.some(r => config.url?.includes(r))
        if (!isPublic) {
            try {
                const raw = await AsyncStorage.getItem('token')
                token = typeof raw === 'string' && raw.trim() ? raw.trim() : null
            } catch (_) {}
        }

        if (isMultipart) {
            // Per FormData: NON toccare Content-Type (axios aggiunge il boundary)
            // Modifica solo Authorization sull'oggetto headers esistente
            if (token) {
                config.headers.set('Authorization', `Bearer ${token}`)
            } else {
                config.headers.delete('Authorization')
            }
        } else {
            // Per JSON e DELETE: ricostruisci headers come plain object pulito
            // (fix "header name must be a non-empty string" in axios 1.x + RN)
            const clean: Record<string, string> = {}
            if (!isDelete) clean['Content-Type'] = 'application/json'
            if (token)     clean['Authorization'] = `Bearer ${token}`
            config.headers = new axios.AxiosHeaders(clean)
        }

        return config
    },
    (error) => Promise.reject(error)
)

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