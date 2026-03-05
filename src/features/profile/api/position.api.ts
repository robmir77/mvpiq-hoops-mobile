import apiClient from '@/shared/api/apiClient'

export type PositionCategory = 'offense' | 'defense' | 'mixed' | string

export interface PositionMetadata {
    id: string
    code: string
    label?: string
    description?: string
    category?: PositionCategory
    isActive?: boolean
    sortOrder?: number
    createdAt?: string
}

export const getPositions = async (): Promise<PositionMetadata[]> => {
    const response = await apiClient.get<PositionMetadata[]>(
        '/positions'
    )

    return response.data
}