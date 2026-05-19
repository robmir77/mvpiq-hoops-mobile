// src/features/journal/api/journal.api.ts

import apiClient from '@/shared/api/apiClient'
import { API_BASE_URL } from '@/config/appConfig'
import AsyncStorage from '@react-native-async-storage/async-storage'
import {
    ChecklistTemplate,
    EntryType,
    ChecklistTemplateItemOption,
    SelectSource,
} from '../types/journal.types'

/**
 * Recupera il template checklist per tipo entry
 */
export const fetchChecklistTemplate = async (
    entryType: EntryType
): Promise<ChecklistTemplate> => {
    try {
        const response = await apiClient.get<ChecklistTemplate[]>(
            `/checklist-templates?entryType=${encodeURIComponent(entryType)}`
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

/**
 * Recupera lo storico delle entry diario per un giocatore
 */
export const fetchJournalEntries = async (
    playerId: string,
    entryType?: EntryType
) => {
    try {
        const url = entryType
            ? `/players/${playerId}/journal?entryType=${encodeURIComponent(entryType)}`
            : `/players/${playerId}/journal`

        const response = await apiClient.get(url)
        return response.data
    } catch (error: any) {
        console.error(
            'Errore caricamento storico diario:',
            error?.response?.data || error.message
        )

        throw new Error(
            error?.response?.data?.message ||
            'Errore caricamento storico diario'
        )
    }
}

/**
 * Recupera una singola entry diario
 */
export const fetchJournalEntry = async (playerId: string, entryId: string) => {
    try {
        const response = await apiClient.get(`/players/${playerId}/journal/${entryId}`)
        return response.data
    } catch (error: any) {
        console.error(
            'Errore caricamento entry diario:',
            error?.response?.data || error.message
        )

        throw new Error(
            error?.response?.data?.message ||
            'Errore caricamento entry diario'
        )
    }
}

/**
 * Cancella una entry diario
 */
export const deleteJournalEntry = async (playerId: string, entryId: string): Promise<void> => {
    try {
        const token = await AsyncStorage.getItem('token')
        const headers: Record<string, string> = {
            'Content-Type': 'application/json'
        }
        
        // FIX: verifica che il token sia una stringa non vuota prima di settare l'header
        if (token && typeof token === 'string' && token.trim() !== '') {
            headers['Authorization'] = `Bearer ${token}`
        }
        
        const response = await fetch(
            `${API_BASE_URL}/api/players/${playerId}/journal/${entryId}`,
            {
                method: 'DELETE',
                headers
            }
        )

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}))
            throw new Error(errorData.message || `HTTP ${response.status}`)
        }
    } catch (error: any) {
        console.error(
            'Errore cancellazione entry diario:',
            error.message
        )

        throw new Error(
            error.message ||
            'Errore cancellazione entry diario'
        )
    }
}

/**
 * Recupera opzioni dinamiche per checklist items
 */
export const fetchDynamicChecklistOptions = async (
    selectSource: SelectSource,
    selectQuery?: string
): Promise<ChecklistTemplateItemOption[]> => {
    try {
        let url = `/checklist-templates/dynamic-options?selectSource=${selectSource}`
        if (selectSource === 'SQL' && selectQuery) {
            url += `&selectQuery=${encodeURIComponent(selectQuery)}`
        }
        const response = await apiClient.get<ChecklistTemplateItemOption[]>(url)
        return response.data
    } catch (error: any) {
        console.error(
            'Errore caricamento opzioni dinamiche:',
            error?.response?.data || error.message
        )
        throw new Error(
            error?.response?.data?.message ||
            'Errore caricamento opzioni dinamiche'
        )
    }
}