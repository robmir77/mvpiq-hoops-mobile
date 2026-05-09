// src/features/trainerFollow/api/trainerFollow.api.ts

import apiClient from '@/shared/api/apiClient'

export interface TrainerFollow {
    id: string
    trainerId: string
    playerId: string
    followDate?: string
}

export interface FollowRequest {
    trainerId: string
    playerId: string
}

export const followPlayer = async (
    request: FollowRequest
): Promise<TrainerFollow> => {
    try {
        const response = await apiClient.post<TrainerFollow>(
            '/trainer/follow',
            request
        )

        return response.data
    } catch (error: any) {
        console.error(
            'Errore follow giocatore:',
            error?.response?.data || error.message
        )

        throw new Error(
            error?.response?.data?.message || 'Errore follow giocatore'
        )
    }
}

export const unfollowPlayer = async (
    trainerId: string,
    playerId: string
): Promise<void> => {
    try {
        await apiClient.delete(
            `/trainer/follow?trainerId=${trainerId}&playerId=${playerId}`
        )
    } catch (error: any) {
        console.error(
            'Errore unfollow giocatore:',
            error?.response?.data || error.message
        )

        throw new Error(
            error?.response?.data?.message || 'Errore unfollow giocatore'
        )
    }
}

export const getTrainerFollows = async (
    trainerId: string
): Promise<TrainerFollow[]> => {
    try {
        const response = await apiClient.get<TrainerFollow[]>(
            `/trainer/follows/${trainerId}`
        )

        return response.data
    } catch (error: any) {
        console.error(
            'Errore caricamento follows allenatore:',
            error?.response?.data || error.message
        )

        throw new Error(
            error?.response?.data?.message || 'Errore caricamento follows allenatore'
        )
    }
}

export const getPlayerFollowers = async (
    playerId: string
): Promise<TrainerFollow[]> => {
    try {
        const response = await apiClient.get<TrainerFollow[]>(
            `/trainer/followers/${playerId}`
        )

        return response.data
    } catch (error: any) {
        console.error(
            'Errore caricamento followers giocatore:',
            error?.response?.data || error.message
        )

        throw new Error(
            error?.response?.data?.message || 'Errore caricamento followers giocatore'
        )
    }
}

export const checkFollowStatus = async (
    trainerId: string,
    playerId: string
): Promise<{ isFollowing: boolean }> => {
    try {
        const response = await apiClient.get<{ isFollowing: boolean }>(
            `/trainer/follow/check?trainerId=${trainerId}&playerId=${playerId}`
        )

        return response.data
    } catch (error: any) {
        console.error(
            'Errore verifica follow status:',
            error?.response?.data || error.message
        )

        throw new Error(
            error?.response?.data?.message || 'Errore verifica follow status'
        )
    }
}

export const getTrainerStats = async (
    trainerId: string
): Promise<any> => {
    try {
        const response = await apiClient.get(
            `/trainer/stats/${trainerId}`
        )

        return response.data
    } catch (error: any) {
        console.error(
            'Errore caricamento statistiche allenatore:',
            error?.response?.data || error.message
        )

        throw new Error(
            error?.response?.data?.message || 'Errore caricamento statistiche allenatore'
        )
    }
}

export const getTrainerPlayersProgress = async (
    trainerId: string
): Promise<any[]> => {
    try {
        const response = await apiClient.get(
            `/trainer/players/${trainerId}/progress`
        )

        return response.data
    } catch (error: any) {
        console.error(
            'Errore caricamento progresso giocatori:',
            error?.response?.data || error.message
        )

        throw new Error(
            error?.response?.data?.message || 'Errore caricamento progresso giocatori'
        )
    }
}

export const getPlayerDetailsForTrainer = async (
    playerId: string,
    trainerId: string
): Promise<any> => {
    try {
        const response = await apiClient.get(
            `/trainer/players/${playerId}/details?trainerId=${trainerId}`
        )

        return response.data
    } catch (error: any) {
        console.error(
            'Errore caricamento dettagli giocatore per allenatore:',
            error?.response?.data || error.message
        )

        throw new Error(
            error?.response?.data?.message || 'Errore caricamento dettagli giocatore per allenatore'
        )
    }
}

export const addTrainerFeedback = async (
    feedback: {
        trainerId: string
        playerId: string
        feedback: string
    }
): Promise<void> => {
    try {
        await apiClient.post('/trainer/feedback', feedback)
    } catch (error: any) {
        console.error(
            'Errore aggiunta feedback allenatore:',
            error?.response?.data || error.message
        )

        throw new Error(
            error?.response?.data?.message || 'Errore aggiunta feedback allenatore'
        )
    }
}

export const getTrainerFollowCount = async (
    trainerId: string
): Promise<{ count: number }> => {
    try {
        const response = await apiClient.get<{ count: number }>(
            `/trainer/follow-count/${trainerId}`
        )

        return response.data
    } catch (error: any) {
        console.error(
            'Errore caricamento numero follow allenatore:',
            error?.response?.data || error.message
        )

        throw new Error(
            error?.response?.data?.message || 'Errore caricamento numero follow allenatore'
        )
    }
}

export const getPlayerFollowerCount = async (
    playerId: string
): Promise<{ count: number }> => {
    try {
        const response = await apiClient.get<{ count: number }>(
            `/trainer/follower-count/${playerId}`
        )

        return response.data
    } catch (error: any) {
        console.error(
            'Errore caricamento numero follower giocatore:',
            error?.response?.data || error.message
        )

        throw new Error(
            error?.response?.data?.message || 'Errore caricamento numero follower giocatore'
        )
    }
}
