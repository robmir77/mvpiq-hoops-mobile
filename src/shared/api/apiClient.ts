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
        console.log('➡️ BODY:', config.data)
        console.log('➡️ TOKEN:', isPublicRoute ? 'SKIPPED' : token)

        if (token && !isPublicRoute) {
            config.headers.Authorization = `Bearer ${token}`
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
    (error) => {
        console.log('\n🛑 RESPONSE ERROR')
        console.log('⬅️ URL:', error?.config?.url)
        console.log('⬅️ STATUS:', error?.response?.status)
        console.log('⬅️ DATA:', error?.response?.data)

        return Promise.reject(error)
    }
)

export default apiClient