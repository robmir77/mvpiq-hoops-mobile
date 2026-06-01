import apiClient from '@/shared/api/apiClient'
import {
    Event,
    EventLocation,
    EventParticipant,
    CreateEventPayload,
    CreateLocationPayload,
    RsvpStatus,
} from '../types/events.types'

// ─── EVENTI ──────────────────────────────────────────────────────────────────

/**
 * Lista eventi pubblici prossimi, filtrabili per tipo.
 */
export const fetchUpcomingEvents = async (type?: string): Promise<Event[]> => {
    try {
        const url = type ? `/events?type=${encodeURIComponent(type)}` : '/events'
        const response = await apiClient.get<Event[]>(url)
        return response.data
    } catch (error: any) {
        throw new Error(error?.response?.data?.message || 'Errore caricamento eventi')
    }
}

/**
 * Dettaglio di un singolo evento con lista partecipanti.
 */
export const fetchEvent = async (eventId: string): Promise<Event> => {
    try {
        const response = await apiClient.get<Event>(`/events/${eventId}`)
        return response.data
    } catch (error: any) {
        throw new Error(error?.response?.data?.message || 'Errore caricamento evento')
    }
}

/**
 * Eventi creati da un utente.
 */
export const fetchEventsByCreator = async (userId: string): Promise<Event[]> => {
    try {
        const response = await apiClient.get<Event[]>(`/events/user/${userId}`)
        return response.data
    } catch (error: any) {
        throw new Error(error?.response?.data?.message || 'Errore caricamento eventi')
    }
}

/**
 * Eventi a cui un utente partecipa.
 */
export const fetchEventsByParticipant = async (userId: string): Promise<Event[]> => {
    try {
        const response = await apiClient.get<Event[]>(`/events/participant/${userId}`)
        return response.data
    } catch (error: any) {
        throw new Error(error?.response?.data?.message || 'Errore caricamento eventi')
    }
}

/**
 * Crea un nuovo evento.
 */
export const createEvent = async (
    creatorId: string,
    payload: CreateEventPayload
): Promise<Event> => {
    try {
        const response = await apiClient.post<Event>(
            `/events?creatorId=${creatorId}`,
            payload
        )
        return response.data
    } catch (error: any) {
        throw new Error(error?.response?.data?.message || 'Errore creazione evento')
    }
}

/**
 * Aggiorna un evento esistente.
 */
export const updateEvent = async (
    creatorId: string,
    eventId: string,
    payload: Partial<CreateEventPayload>
): Promise<Event> => {
    try {
        const response = await apiClient.put<Event>(
            `/events/${eventId}?creatorId=${creatorId}`,
            payload
        )
        return response.data
    } catch (error: any) {
        throw new Error(error?.response?.data?.message || 'Errore aggiornamento evento')
    }
}

/**
 * Soft-delete di un evento (solo creatore).
 */
export const deleteEvent = async (creatorId: string, eventId: string): Promise<void> => {
    try {
        await apiClient.delete(`/events/${eventId}?creatorId=${creatorId}`)
    } catch (error: any) {
        throw new Error(error?.response?.data?.message || 'Errore eliminazione evento')
    }
}

// ─── PARTECIPAZIONI / RSVP ───────────────────────────────────────────────────

/**
 * Iscriviti a un evento.
 */
export const joinEvent = async (
    userId: string,
    eventId: string
): Promise<EventParticipant> => {
    try {
        const response = await apiClient.post<EventParticipant>(
            `/events/${eventId}/join?userId=${userId}`
        )
        return response.data
    } catch (error: any) {
        throw new Error(error?.response?.data?.message || 'Errore iscrizione evento')
    }
}

/**
 * Abbandona un evento.
 */
export const leaveEvent = async (userId: string, eventId: string): Promise<void> => {
    try {
        await apiClient.delete(`/events/${eventId}/leave?userId=${userId}`)
    } catch (error: any) {
        throw new Error(error?.response?.data?.message || 'Errore abbandono evento')
    }
}

/**
 * Aggiorna il proprio RSVP.
 */
export const updateRsvp = async (
    userId: string,
    eventId: string,
    status: RsvpStatus
): Promise<EventParticipant> => {
    try {
        const response = await apiClient.put<EventParticipant>(
            `/events/${eventId}/rsvp?userId=${userId}&status=${status}`
        )
        return response.data
    } catch (error: any) {
        throw new Error(error?.response?.data?.message || 'Errore aggiornamento RSVP')
    }
}

/**
 * Lista partecipanti di un evento.
 */
export const fetchParticipants = async (
    eventId: string,
    rsvpStatus?: RsvpStatus
): Promise<EventParticipant[]> => {
    try {
        const url = rsvpStatus
            ? `/events/${eventId}/participants?rsvpStatus=${rsvpStatus}`
            : `/events/${eventId}/participants`
        const response = await apiClient.get<EventParticipant[]>(url)
        return response.data
    } catch (error: any) {
        throw new Error(error?.response?.data?.message || 'Errore caricamento partecipanti')
    }
}

// ─── LOCATION ────────────────────────────────────────────────────────────────

/**
 * Lista location pubbliche, opzionalmente filtrate per città.
 */
export const fetchLocations = async (city?: string): Promise<EventLocation[]> => {
    try {
        const url = city
            ? `/event-locations?city=${encodeURIComponent(city)}`
            : '/event-locations'
        const response = await apiClient.get<EventLocation[]>(url)
        return response.data
    } catch (error: any) {
        throw new Error(error?.response?.data?.message || 'Errore caricamento location')
    }
}

/**
 * Crea una nuova location.
 */
export const createLocation = async (
    userId: string,
    payload: CreateLocationPayload
): Promise<EventLocation> => {
    try {
        const response = await apiClient.post<EventLocation>(
            `/event-locations?userId=${userId}`,
            payload
        )
        return response.data
    } catch (error: any) {
        throw new Error(error?.response?.data?.message || 'Errore creazione location')
    }
}
