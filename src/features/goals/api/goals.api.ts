import apiClient from '@/shared/api/apiClient'
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