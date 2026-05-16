// src/features/cv/types/cv.types.ts

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
    externalUrl?: string   // Link YouTube/Vimeo
    storageUrl?: string    // Upload diretto
    thumbnailUrl?: string
    mediaId?: string
}

export interface PlayerCvSharing {
    shareToken?: string
    shareEnabled?: boolean
    publicUrl?: string
    publicUpdatedAt?: string
}

export interface PlayerCv {
    headline?: string
    summary?: string
    stats?: Record<string, any>
    teams?: PlayerCvTeam[]
    highlights?: PlayerCvHighlight[]
    sharing?: PlayerCvSharing
}
