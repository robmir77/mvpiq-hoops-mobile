// src/features/positions/hooks/usePositions.ts

import { useQuery } from '@tanstack/react-query'
import { getAllPositions, getPositionByCode, getPositionsByCategory } from '../api/positions.api'
import { PositionMetadata } from '../types/positions.types'

export const usePositions = () => {
    return useQuery({
        queryKey: ['positions'],
        queryFn: getAllPositions,
        staleTime: 1000 * 60 * 10, // 10 minuti
    })
}

export const usePositionByCode = (code?: string) => {
    return useQuery({
        queryKey: ['position', code],
        queryFn: () => getPositionByCode(code!),
        enabled: !!code,
    })
}

export const usePositionsByCategory = (category?: string) => {
    return useQuery({
        queryKey: ['positions', 'category', category],
        queryFn: () => getPositionsByCategory(category),
        enabled: !!category,
    })
}
