export interface PlayerCvTeam {
    id?: string
    teamName: string
    categoryId: number
    positionId?: string
    startYear?: number
    endYear?: number
    notes?: string
}

export interface PlayerCv {
    headline?: string
    summary?: string
    stats?: Record<string, any>
    teams?: PlayerCvTeam[]
}