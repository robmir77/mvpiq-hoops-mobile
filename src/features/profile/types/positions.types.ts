// src/features/positions/types/positions.types.ts

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