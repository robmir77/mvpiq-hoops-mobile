// src/features/positions/api/positions.api.ts

import apiClient from '@/shared/api/apiClient'

export interface PositionMetadata {
    id: string
    code: string
    name: string
    description?: string
    abbreviation?: string
    sortOrder?: number
}

export const getAllPositions = async (): Promise<PositionMetadata[]> => {
    try {
        const response = await apiClient.get<PositionMetadata[]>('/positions')
        
        // Il backend restituisce già ordinato per code
        return response.data
    } catch (error: any) {
        console.error(
            'Errore caricamento posizioni:',
            error?.response?.data || error.message
        )

        throw new Error(
            error?.response?.data?.message || 'Errore caricamento posizioni'
        )
    }
}

export const getPositionByCode = async (
    code: string
): Promise<PositionMetadata | null> => {
    try {
        const positions = await getAllPositions()
        return positions.find(pos => pos.code === code) || null
    } catch (error) {
        console.error('Errore ricerca posizione per codice:', error)
        return null
    }
}

export const getPositionsByCategory = async (
    category?: string
): Promise<PositionMetadata[]> => {
    try {
        const positions = await getAllPositions()
        
        if (!category) return positions
        
        // Filtra per categoria se necessario (es. "guard", "forward", "center")
        return positions.filter(pos => 
            pos.name.toLowerCase().includes(category.toLowerCase()) ||
            pos.code.toLowerCase().includes(category.toLowerCase())
        )
    } catch (error) {
        console.error('Errore filtro posizioni per categoria:', error)
        return []
    }
}
