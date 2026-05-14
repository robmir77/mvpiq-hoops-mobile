import apiClient from '@/shared/api/apiClient'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { API_BASE_URL } from '@/config/appConfig'
import { Goal, CreateGoalRequest } from '../types/goals.types'

export const getGoalsByAthlete = async (
    athleteId: string
): Promise<Goal[]> => {
    const response = await apiClient.get<Goal[]>(`/goals/${athleteId}`)
    return response.data
}

export const createGoal = async ({
                                     athleteId,
                                     data,
                                 }: {
    athleteId: string
    data: CreateGoalRequest
}) => {
    const response = await apiClient.post<Goal>(
        `/goals/${athleteId}`,
        data
    )

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
        console.error(
            'Errore aggiornamento goal:',
            error?.response?.data || error.message
        )
        throw new Error(
            error?.response?.data?.message || 'Errore aggiornamento goal'
        )
    }
}

export const deleteGoal = async (goalId: string): Promise<void> => {
    try {
        const token = await AsyncStorage.getItem('token')
        const response = await fetch(
            `${API_BASE_URL}/api/goals/${goalId}`,
            {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            }
        )

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}))
            throw new Error(errorData.message || `HTTP ${response.status}`)
        }
    } catch (error: any) {
        console.error(
            'Errore eliminazione goal:',
            error?.response?.data || error.message
        )
        throw new Error(
            error?.response?.data?.message || 'Errore eliminazione goal'
        )
    }
}