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

        const publicRoutes = ['/auth/login', '/auth/register']
        const isPublicRoute = publicRoutes.some((route) => config.url?.includes(route))

        // FIX: verifica che il token sia una stringa non vuota prima di settare l'header.
        // axios lancia "header name must be a non-empty string" se il valore è null/undefined.
        if (token && typeof token === 'string' && token.trim() !== '' && !isPublicRoute) {
            config.headers.Authorization = `Bearer ${token}`
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
            await AsyncStorage.removeItem('token')
            await AsyncStorage.removeItem('auth_user')
        }
        return Promise.reject(error)
    }
)

export default apiClient
