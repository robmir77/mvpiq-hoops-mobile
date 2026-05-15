export interface PlayerCvTeam {
    id?: string
    teamName: string
    categoryId: number
    positionId?: string
    startYear?: number
    endYear?: number
    notes?: string
}

export interface PlayerCvHighlight {
    id?: string
    title?: string
    description?: string
    externalUrl?: string
    sortOrder?: number
    thumbnailUrl?: string
    mediaId?: string
}

export interface PlayerCvSharing {
    shareToken?: string
    shareEnabled?: boolean
    publicUpdatedAt?: string
    publicUrl?: string
}

export interface PlayerCv {
    headline?: string
    summary?: string
    stats?: Record<string, any>
    teams?: PlayerCvTeam[]
    highlights?: PlayerCvHighlight[]
    sharing?: PlayerCvSharing
}