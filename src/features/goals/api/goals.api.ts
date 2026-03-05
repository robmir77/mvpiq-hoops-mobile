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
    const response = await apiClient.post(
        `/goals/${athleteId}`,
        data
    )

    return response.data
}