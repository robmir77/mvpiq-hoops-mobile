// src/features/scouting/api/scouting.api.ts

import apiClient from '@/shared/api/apiClient'

export interface ScoutSavedFilter {
    id: string
    scoutId: string
    name: string
    filterJson: Record<string, any>
    createdAt?: string
    updatedAt?: string
}

export interface CreateScoutFilterRequest {
    scoutId: string
    name: string
    filterJson: Record<string, any>
}

export interface UpdateScoutFilterRequest {
    name: string
    filterJson: Record<string, any>
}

export const createScoutFilter = async (
    filter: CreateScoutFilterRequest
): Promise<ScoutSavedFilter> => {
    try {
        const response = await apiClient.post<ScoutSavedFilter>(
            '/scout/filters',
            filter
        )

        return response.data
    } catch (error: any) {
        console.error(
            'Errore creazione filtro scout:',
            error?.response?.data || error.message
        )

        throw new Error(
            error?.response?.data?.message || 'Errore creazione filtro scout'
        )
    }
}

export const updateScoutFilter = async (
    id: string,
    filter: UpdateScoutFilterRequest
): Promise<ScoutSavedFilter> => {
    try {
        const response = await apiClient.put<ScoutSavedFilter>(
            `/scout/filters/${id}`,
            filter
        )

        return response.data
    } catch (error: any) {
        console.error(
            'Errore aggiornamento filtro scout:',
            error?.response?.data || error.message
        )

        throw new Error(
            error?.response?.data?.message || 'Errore aggiornamento filtro scout'
        )
    }
}

export const deleteScoutFilter = async (
    id: string
): Promise<void> => {
    try {
        await apiClient.delete(`/scout/filters/${id}`)
    } catch (error: any) {
        console.error(
            'Errore eliminazione filtro scout:',
            error?.response?.data || error.message
        )

        throw new Error(
            error?.response?.data?.message || 'Errore eliminazione filtro scout'
        )
    }
}

export const getScoutFilter = async (
    id: string
): Promise<ScoutSavedFilter> => {
    try {
        const response = await apiClient.get<ScoutSavedFilter>(
            `/scout/filters/${id}`
        )

        return response.data
    } catch (error: any) {
        console.error(
            'Errore caricamento filtro scout:',
            error?.response?.data || error.message
        )

        throw new Error(
            error?.response?.data?.message || 'Errore caricamento filtro scout'
        )
    }
}

export const getScoutFilters = async (
    scoutId: string
): Promise<ScoutSavedFilter[]> => {
    try {
        const response = await apiClient.get<ScoutSavedFilter[]>(
            `/scout/filters/scout/${scoutId}`
        )

        return response.data
    } catch (error: any) {
        console.error(
            'Errore caricamento filtri scout:',
            error?.response?.data || error.message
        )

        throw new Error(
            error?.response?.data?.message || 'Errore caricamento filtri scout'
        )
    }
}

export const searchScoutFilters = async (
    scoutId: string,
    name: string
): Promise<ScoutSavedFilter[]> => {
    try {
        const response = await apiClient.get<ScoutSavedFilter[]>(
            `/scout/filters/search?scoutId=${scoutId}&name=${encodeURIComponent(name)}`
        )

        return response.data
    } catch (error: any) {
        console.error(
            'Errore ricerca filtri scout:',
            error?.response?.data || error.message
        )

        throw new Error(
            error?.response?.data?.message || 'Errore ricerca filtri scout'
        )
    }
}

export const searchPlayers = async (
    filters: Record<string, any>
): Promise<any[]> => {
    try {
        const response = await apiClient.post<any[]>(
            '/scout/search',
            filters
        )

        return response.data
    } catch (error: any) {
        console.error(
            'Errore ricerca giocatori:',
            error?.response?.data || error.message
        )

        throw new Error(
            error?.response?.data?.message || 'Errore ricerca giocatori'
        )
    }
}

export const getScoutRankings = async (
    scope: string,
    scopeValue: string
): Promise<any[]> => {
    try {
        const response = await apiClient.get<any[]>(
            `/scout/rankings?scope=${scope}&scopeValue=${encodeURIComponent(scopeValue)}`
        )

        return response.data
    } catch (error: any) {
        console.error(
            'Errore caricamento ranking scout:',
            error?.response?.data || error.message
        )

        throw new Error(
            error?.response?.data?.message || 'Errore caricamento ranking scout'
        )
    }
}

export const getScoutPlayerProfile = async (
    playerId: string
): Promise<any> => {
    try {
        const response = await apiClient.get(
            `/scout/players/${playerId}/profile`
        )

        return response.data
    } catch (error: any) {
        console.error(
            'Errore caricamento profilo scout giocatore:',
            error?.response?.data || error.message
        )

        throw new Error(
            error?.response?.data?.message || 'Errore caricamento profilo scout giocatore'
        )
    }
}
