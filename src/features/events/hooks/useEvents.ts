import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
    fetchUpcomingEvents,
    fetchEvent,
    fetchEventsByCreator,
    fetchEventsByParticipant,
    createEvent,
    updateEvent,
    deleteEvent,
    joinEvent,
    leaveEvent,
    updateRsvp,
    fetchLocations,
    createLocation,
} from '../api/events.api'
import { CreateEventPayload, CreateLocationPayload, RsvpStatus } from '../types/events.types'

// ─── QUERY ───────────────────────────────────────────────────────────────────

export const useUpcomingEvents = (type?: string) =>
    useQuery({
        queryKey: ['events', 'upcoming', type],
        queryFn: () => fetchUpcomingEvents(type),
        retry: 1,
        refetchOnWindowFocus: false,
    })

export const useEvent = (eventId: string) =>
    useQuery({
        queryKey: ['events', eventId],
        queryFn: () => fetchEvent(eventId),
        enabled: !!eventId,
        retry: 1,
        refetchOnWindowFocus: false,
    })

export const useEventsByCreator = (userId: string) =>
    useQuery({
        queryKey: ['events', 'creator', userId],
        queryFn: () => fetchEventsByCreator(userId),
        enabled: !!userId,
        retry: 1,
        refetchOnWindowFocus: false,
    })

export const useEventsByParticipant = (userId: string) =>
    useQuery({
        queryKey: ['events', 'participant', userId],
        queryFn: () => fetchEventsByParticipant(userId),
        enabled: !!userId,
        retry: 1,
        refetchOnWindowFocus: false,
    })

export const useLocations = (city?: string) =>
    useQuery({
        queryKey: ['event-locations', city],
        queryFn: () => fetchLocations(city),
        retry: 1,
        refetchOnWindowFocus: false,
    })

// ─── MUTATION ────────────────────────────────────────────────────────────────

export const useCreateEvent = (creatorId: string) => {
    const qc = useQueryClient()
    return useMutation({
        mutationFn: (payload: CreateEventPayload) => createEvent(creatorId, payload),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['events'] })
        },
    })
}

export const useUpdateEvent = (creatorId: string, eventId: string) => {
    const qc = useQueryClient()
    return useMutation({
        mutationFn: (payload: Partial<CreateEventPayload>) =>
            updateEvent(creatorId, eventId, payload),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['events', eventId] })
            qc.invalidateQueries({ queryKey: ['events', 'creator', creatorId] })
        },
    })
}

export const useDeleteEvent = (creatorId: string) => {
    const qc = useQueryClient()
    return useMutation({
        mutationFn: (eventId: string) => deleteEvent(creatorId, eventId),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['events'] })
        },
    })
}

export const useJoinEvent = (userId: string) => {
    const qc = useQueryClient()
    return useMutation({
        mutationFn: (eventId: string) => joinEvent(userId, eventId),
        onSuccess: (_data, eventId) => {
            qc.invalidateQueries({ queryKey: ['events', eventId] })
            qc.invalidateQueries({ queryKey: ['events', 'participant', userId] })
        },
    })
}

export const useLeaveEvent = (userId: string) => {
    const qc = useQueryClient()
    return useMutation({
        mutationFn: (eventId: string) => leaveEvent(userId, eventId),
        onSuccess: (_data, eventId) => {
            qc.invalidateQueries({ queryKey: ['events', eventId] })
            qc.invalidateQueries({ queryKey: ['events', 'participant', userId] })
        },
    })
}

export const useUpdateRsvp = (userId: string, eventId: string) => {
    const qc = useQueryClient()
    return useMutation({
        mutationFn: (status: RsvpStatus) => updateRsvp(userId, eventId, status),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['events', eventId] })
            qc.invalidateQueries({ queryKey: ['events', 'participant', userId] })
        },
    })
}

export const useCreateLocation = (userId: string) => {
    const qc = useQueryClient()
    return useMutation({
        mutationFn: (payload: CreateLocationPayload) => createLocation(userId, payload),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['event-locations'] })
        },
    })
}
