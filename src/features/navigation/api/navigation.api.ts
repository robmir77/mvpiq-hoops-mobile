// src/features/navigation/api/navigation.api.ts

import apiClient from '@/shared/api/apiClient'
import { NavigationResponse, AccessResponse } from '@/features/auth/types/auth.types'

export const getNavigationSections = async (): Promise<NavigationResponse> => {
    try {
        const response = await apiClient.get('/navigation/sections')
        return response.data
    } catch (error: any) {
        console.error('Errore caricamento sezioni navigazione:', error)
        throw error
    }
}

export const checkSectionAccess = async (sectionId: string): Promise<AccessResponse> => {
    try {
        const response = await apiClient.get(`/api/navigation/sections/${sectionId}/access`)
        return response.data
    } catch (error: any) {
        console.error(`Errore verifica accesso sezione ${sectionId}:`, error)
        throw error
    }
}
