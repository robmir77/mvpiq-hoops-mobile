// src/features/positions/types/positions.types.ts

export interface PositionMetadata {
    id: string
    code: string
    name: string
    description?: string
    abbreviation?: string
    sortOrder?: number
}

export type PositionCode = 'PG' | 'SG' | 'SF' | 'PF' | 'C' | 'G' | 'F'

export const POSITION_CODES = {
    PG: 'Point Guard',
    SG: 'Shooting Guard', 
    SF: 'Small Forward',
    PF: 'Power Forward',
    C: 'Center',
    G: 'Guard',
    F: 'Forward'
} as const

export const POSITION_ABBREVIATIONS = {
    PG: 'PG',
    SG: 'SG',
    SF: 'SF', 
    PF: 'PF',
    C: 'C',
    G: 'G',
    F: 'F'
} as const
