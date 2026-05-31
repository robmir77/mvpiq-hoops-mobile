// src/features/goals/api/goals.api.ts

import AsyncStorage from '@react-native-async-storage/async-storage'
import apiClient from '@/shared/api/apiClient'
import { Goal, CreateGoalRequest } from '../types/goals.types'

export const getGoalsByAthlete = async (athleteId: string): Promise<Goal[]> => {
    const response = await apiClient.get<Goal[]>(`/goals/${athleteId}`)
    return response.data
}

export const createGoal = async ({
    athleteId,
    data,
}: {
    athleteId: string
    data: CreateGoalRequest
}): Promise<Goal> => {
    const response = await apiClient.post<Goal>(`/goals/${athleteId}`, data)
    return response.data
}

export const updateGoal = async (
    goalId: string,
    data: Partial<CreateGoalRequest>
): Promise<Goal> => {
    try {
        const response = await apiClient.put<Goal>(`/goals/${goalId}`, data)
        return response.data
    } catch (error: any) {
        throw new Error(error?.response?.data?.message || 'Errore aggiornamento goal')
    }
}

export const deleteGoal = async (goalId: string): Promise<void> => {
    try {
        // Usa fetch nativo per DELETE per evitare problemi con axios headers
        const token = await AsyncStorage.getItem('token')
        const { API_BASE_URL } = await import('@/config/appConfig')

        const headers: Record<string, string> = {}
        if (token && typeof token === 'string' && token.trim() !== '') {
            headers['Authorization'] = `Bearer ${token.trim()}`
        }

        const response = await fetch(
            `${API_BASE_URL}/api/goals/${goalId}`,
            {
                method: 'DELETE',
                headers,
            }
        )

        if (!response.ok) {
            throw new Error(`Failed to delete goal: ${response.status}`)
        }
    } catch (error: any) {
        throw new Error(error?.message || 'Errore eliminazione goal')
    }
}
