export interface PlayerProfile {
    id: string
    userId: string
    username: string
    displayName: string
    birthDate?: string
    heightCm?: number
    weightKg?: number
    // UUID
    mainPositionId?: string
    secondaryPositionIds?: string[]
    mainPositionLabel?: string
    secondaryPositionLabels?: string[]
    level?: string
    dominantHand?: string
    country?: string
    city?: string
    gender?: string
    avatarUrl?: string
    publicProfile?: boolean
    verified?: boolean
    approximateAge?: any
    bio?: string
}

export interface UpdatePlayerProfile {
    displayName?: string
    birthDate?: string

    city?: string
    country?: string

    heightCm?: number
    weightKg?: number

    dominantHand?: string
    level?: string

    // UUID
    mainPositionId?: string
    secondaryPositionIds?: string[]

    avatarUrl?: string
}