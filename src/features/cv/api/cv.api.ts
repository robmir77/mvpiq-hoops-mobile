// src/features/cv/api/cv.api.ts

import apiClient from '@/shared/api/apiClient'
import { PlayerCv, PlayerCvSharing, PlayerCvHighlight } from '../types/cv.types'

// ─── CV Base ──────────────────────────────────────────────────

export const getPlayerCv = async (playerId: string): Promise<PlayerCv> => {
    try {
        const response = await apiClient.get<PlayerCv>(`/players/${playerId}/cv`)
        return response.data
    } catch (error: any) {
        if (error?.response?.status === 404) {
            return { headline: '', summary: '', stats: {}, teams: [], highlights: [] }
        }
        throw new Error(error?.response?.data?.message || 'Errore caricamento CV')
    }
}

export const updatePlayerCv = async (playerId: string, data: PlayerCv): Promise<PlayerCv> => {
    try {
        const response = await apiClient.put<PlayerCv>(`/players/${playerId}/cv`, data)
        return response.data
    } catch (error: any) {
        throw new Error(error?.response?.data?.message || 'Errore aggiornamento CV')
    }
}

// ─── Sharing ──────────────────────────────────────────────────

export const enableCvSharing = async (playerId: string): Promise<PlayerCvSharing> => {
    try {
        const response = await apiClient.post<PlayerCvSharing>(`/players/${playerId}/cv/share`)
        return response.data
    } catch (error: any) {
        throw new Error(error?.response?.data?.message || 'Errore abilitazione condivisione CV')
    }
}

export const disableCvSharing = async (playerId: string): Promise<PlayerCvSharing> => {
    try {
        const response = await apiClient.delete<PlayerCvSharing>(`/players/${playerId}/cv/share`)
        return response.data
    } catch (error: any) {
        throw new Error(error?.response?.data?.message || 'Errore disabilitazione condivisione CV')
    }
}

// ─── Highlights ───────────────────────────────────────────────

export const getCvHighlights = async (playerId: string): Promise<PlayerCvHighlight[]> => {
    try {
        const response = await apiClient.get<PlayerCvHighlight[]>(`/players/${playerId}/cv/highlights`)
        return response.data
    } catch (error: any) {
        throw new Error(error?.response?.data?.message || 'Errore caricamento highlights')
    }
}

// Aggiunge un highlight con link esterno (YouTube, Vimeo, ecc.)
export const addExternalCvHighlight = async (
    playerId: string,
    externalUrl: string,
    title: string,
    description?: string
): Promise<PlayerCvHighlight> => {
    try {
        const response = await apiClient.post<PlayerCvHighlight>(
            `/players/${playerId}/cv/highlights`,
            { externalUrl, title, description }
        )
        return response.data
    } catch (error: any) {
        throw new Error(error?.response?.data?.message || 'Errore aggiunta highlight esterno')
    }
}

// Aggiunge un highlight da un MediaAsset già caricato
export const addCvHighlight = async (
    playerId: string,
    mediaId: string,
    title: string,
    description?: string
): Promise<PlayerCvHighlight> => {
    try {
        const response = await apiClient.post<PlayerCvHighlight>(
            `/players/${playerId}/cv/highlights`,
            { mediaId, title, description }
        )
        return response.data
    } catch (error: any) {
        throw new Error(error?.response?.data?.message || 'Errore aggiunta highlight')
    }
}

export const deleteCvHighlight = async (
    playerId: string,
    highlightId: string
): Promise<void> => {
    try {
        await apiClient.delete(`/players/${playerId}/cv/highlights/${highlightId}`)
    } catch (error: any) {
        throw new Error(error?.response?.data?.message || 'Errore eliminazione highlight')
    }
}
