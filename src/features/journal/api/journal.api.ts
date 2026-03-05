// src/features/journal/api/journal.api.ts

import apiClient from '@/shared/api/apiClient'
import {
    ChecklistTemplate,
    EntryType,
} from '../types/journal.types'

/**
 * Recupera il template checklist per tipo entry
 */
export const fetchChecklistTemplate = async (
    entryType: EntryType
): Promise<ChecklistTemplate> => {
    try {
        const response = await apiClient.get<ChecklistTemplate[]>(
            `/checklist-templates?entryType=${entryType}`
        )

        const templates = response.data

        if (!templates || templates.length === 0) {
            throw new Error('Template non trovato')
        }

        return templates[0]
    } catch (error: any) {
        console.error(
            'Errore caricamento template:',
            error?.response?.data || error.message
        )

        throw new Error(
            error?.response?.data?.message ||
            'Errore caricamento template'
        )
    }
}

export type CreateJournalEntryPayload = {
    entryType: EntryType
    templateId: string
    answers: {
        itemId: string
        value: string | number | boolean
    }[]
}

export const createJournalEntry = async (
    playerId: string,
    payload: any
) => {
    try {
        const response = await apiClient.post(
            `/players/${playerId}/journal`,
            payload
        )

        return response.data
    } catch (error: any) {
        console.log("FULL ERROR:", error)
        console.log("RESPONSE DATA:", error?.response?.data)
        console.log("STATUS:", error?.response?.status)

        throw new Error(
            error?.response?.data?.message ||
            JSON.stringify(error?.response?.data) ||
            'Errore salvataggio journal'
        )
    }
}