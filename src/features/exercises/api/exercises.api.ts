// src/features/exercises/api/exercises.api.ts

import apiClient from '@/shared/api/apiClient'

export interface Exercise {
    id: string
    title: string
    description?: string
    category?: string
    difficulty?: string
    mediaType?: string
    mediaId?: string
    ownerId: string
    isPublic?: boolean
    createdAt?: string
    updatedAt?: string
}

export interface CreateExerciseRequest {
    title: string
    description?: string
    category?: string
    difficulty?: string
    mediaType?: string
    mediaId?: string
    isPublic?: boolean
}

export const createExercise = async (
    ownerId: string,
    exercise: CreateExerciseRequest,
    mediaId?: string
): Promise<Exercise> => {
    try {
        let url = `/exercises?ownerId=${ownerId}`
        if (mediaId) {
            url += `&mediaId=${mediaId}`
        }

        const response = await apiClient.post<Exercise>(url, exercise)

        return response.data
    } catch (error: any) {
        console.error(
            'Errore creazione esercizio:',
            error?.response?.data || error.message
        )

        throw new Error(
            error?.response?.data?.message || 'Errore creazione esercizio'
        )
    }
}

export const updateExercise = async (
    id: string,
    exercise: Partial<Exercise>
): Promise<Exercise> => {
    try {
        const response = await apiClient.put<Exercise>(
            `/exercises/${id}`,
            exercise
        )

        return response.data
    } catch (error: any) {
        console.error(
            'Errore aggiornamento esercizio:',
            error?.response?.data || error.message
        )

        throw new Error(
            error?.response?.data?.message || 'Errore aggiornamento esercizio'
        )
    }
}

export const deleteExercise = async (
    id: string
): Promise<void> => {
    try {
        await apiClient.delete(`/exercises/${id}`)
    } catch (error: any) {
        console.error(
            'Errore eliminazione esercizio:',
            error?.response?.data || error.message
        )

        throw new Error(
            error?.response?.data?.message || 'Errore eliminazione esercizio'
        )
    }
}

export const getExercise = async (
    id: string
): Promise<Exercise> => {
    try {
        const response = await apiClient.get<Exercise>(`/exercises/${id}`)

        return response.data
    } catch (error: any) {
        console.error(
            'Errore caricamento esercizio:',
            error?.response?.data || error.message
        )

        throw new Error(
            error?.response?.data?.message || 'Errore caricamento esercizio'
        )
    }
}

export const getExercisesByOwner = async (
    ownerId: string
): Promise<Exercise[]> => {
    try {
        const response = await apiClient.get<Exercise[]>(
            `/exercises/owner/${ownerId}`
        )

        return response.data
    } catch (error: any) {
        console.error(
            'Errore caricamento esercizi proprietario:',
            error?.response?.data || error.message
        )

        throw new Error(
            error?.response?.data?.message || 'Errore caricamento esercizi proprietario'
        )
    }
}

export const getPublicExercises = async (): Promise<Exercise[]> => {
    try {
        const response = await apiClient.get<Exercise[]>('/exercises/public')

        return response.data
    } catch (error: any) {
        console.error(
            'Errore caricamento esercizi pubblici:',
            error?.response?.data || error.message
        )

        throw new Error(
            error?.response?.data?.message || 'Errore caricamento esercizi pubblici'
        )
    }
}

export const getExercisesByCategory = async (
    category: string
): Promise<Exercise[]> => {
    try {
        const response = await apiClient.get<Exercise[]>(
            `/exercises/category/${category}`
        )

        return response.data
    } catch (error: any) {
        console.error(
            'Errore caricamento esercizi per categoria:',
            error?.response?.data || error.message
        )

        throw new Error(
            error?.response?.data?.message || 'Errore caricamento esercizi per categoria'
        )
    }
}

export const getExercisesByDifficulty = async (
    difficulty: string
): Promise<Exercise[]> => {
    try {
        const response = await apiClient.get<Exercise[]>(
            `/exercises/difficulty/${difficulty}`
        )

        return response.data
    } catch (error: any) {
        console.error(
            'Errore caricamento esercizi per difficoltà:',
            error?.response?.data || error.message
        )

        throw new Error(
            error?.response?.data?.message || 'Errore caricamento esercizi per difficoltà'
        )
    }
}

export const searchExercises = async (
    title: string
): Promise<Exercise[]> => {
    try {
        const response = await apiClient.get<Exercise[]>(
            `/exercises/search?title=${encodeURIComponent(title)}`
        )

        return response.data
    } catch (error: any) {
        console.error(
            'Errore ricerca esercizi:',
            error?.response?.data || error.message
        )

        throw new Error(
            error?.response?.data?.message || 'Errore ricerca esercizi'
        )
    }
}

export const getExercisesByMediaType = async (
    mediaType: string
): Promise<Exercise[]> => {
    try {
        const response = await apiClient.get<Exercise[]>(
            `/exercises/media-type/${mediaType}`
        )

        return response.data
    } catch (error: any) {
        console.error(
            'Errore caricamento esercizi per tipo media:',
            error?.response?.data || error.message
        )

        throw new Error(
            error?.response?.data?.message || 'Errore caricamento esercizi per tipo media'
        )
    }
}
