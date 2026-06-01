export type EventType = 'PICKUP' | 'TRAINING' | 'TOURNAMENT' | 'SOCIAL'
export type EventStatus = 'DRAFT' | 'OPEN' | 'FULL' | 'CANCELLED' | 'COMPLETED'
export type EventVisibility = 'PUBLIC' | 'FRIENDS' | 'PRIVATE'
export type RsvpStatus = 'INVITED' | 'GOING' | 'MAYBE' | 'NOT_GOING'

export type EventLocation = {
    id: string
    name: string
    address?: string
    city?: string
    lat?: number
    lng?: number
    courtType: 'OUTDOOR' | 'INDOOR' | 'GYM'
    isIndoor: boolean
    isPublic: boolean
    createdAt: string
}

export type EventParticipant = {
    id: string
    eventId: string
    userId: string
    userDisplayName?: string
    rsvpStatus: RsvpStatus
    respondedAt?: string
    note?: string
    joinedAt: string
}

export type Event = {
    id: string
    creatorId: string
    creatorDisplayName?: string
    type: EventType
    title: string
    description?: string
    startsAt: string
    endsAt?: string
    maxParticipants?: number
    status: EventStatus
    visibility: EventVisibility
    locationId?: string
    location?: EventLocation
    tags?: string
    participantCount: number
    participants?: EventParticipant[]
    createdAt: string
    updatedAt: string
}

export type CreateEventPayload = {
    type: EventType
    title: string
    description?: string
    startsAt: string
    endsAt?: string
    maxParticipants?: number
    status?: EventStatus
    visibility?: EventVisibility
    locationId?: string
    tags?: string
}

export type CreateLocationPayload = {
    name: string
    address?: string
    city?: string
    lat?: number
    lng?: number
    courtType?: 'OUTDOOR' | 'INDOOR' | 'GYM'
    isIndoor?: boolean
    isPublic?: boolean
}
