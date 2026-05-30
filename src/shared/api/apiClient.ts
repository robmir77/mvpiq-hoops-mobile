// src/shared/api/apiClient.ts

import axios, { InternalAxiosRequestConfig } from 'axios'
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
    async (config: InternalAxiosRequestConfig) => {

        // FIX 1: rimuovi Content-Type per DELETE (nessun body → header non valido)
        // Alcune implementazioni fetch di RN lanciano "header name must be a non-empty
        // string" quando Content-Type è impostato ma il body è assente.
        if (config.method?.toUpperCase() === 'DELETE') {
            delete config.headers['Content-Type']
        }

        const publicRoutes = ['/auth/login', '/auth/register']
        const isPublicRoute = publicRoutes.some(r => config.url?.includes(r))

        if (!isPublicRoute) {
            try {
                const token = await AsyncStorage.getItem('token')

                if (token && typeof token === 'string' && token.trim() !== '') {
                    // FIX 2: usa bracket notation + cast stringa esplicito
                    // axios 1.x su RN può lanciare "header name must be a non-empty string"
                    // se il valore passato a AxiosHeaders non è una stringa pura.
                    config.headers['Authorization'] = `Bearer ${String(token).trim()}`
                } else {
                    // FIX 3: elimina esplicitamente il header quando non c'è token
                    // (invece di lasciarlo come chiave undefined nell'oggetto headers)
                    delete config.headers['Authorization']
                }
            } catch (_) {
                // AsyncStorage fallisce in alcuni edge case (es. primo avvio)
                delete config.headers['Authorization']
            }
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