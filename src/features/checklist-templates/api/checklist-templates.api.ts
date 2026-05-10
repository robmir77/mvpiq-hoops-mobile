import apiClient from '@/shared/api/apiClient'
import {
    ChecklistTemplate,
    CreateChecklistTemplatePayload,
    UpdateChecklistTemplatePayload,
    EntryType,
} from '../types/checklist-templates.types'

/**
 * GET Tutti i template (Admin)
 */
export const fetchAllChecklistTemplates = async (): Promise<ChecklistTemplate[]> => {
    try {
        const response = await apiClient.get<ChecklistTemplate[]>(
            '/checklist-templates/all'
        )
        return response.data
    } catch (error: any) {
        console.error(
            'Errore caricamento tutti i template:',
            error?.response?.data || error.message
        )
        throw new Error(
            error?.response?.data?.message ||
            'Errore caricamento tutti i template'
        )
    }
}

/**
 * GET Template specifico (Admin)
 */
export const fetchChecklistTemplateById = async (
    id: string
): Promise<ChecklistTemplate> => {
    try {
        const response = await apiClient.get<ChecklistTemplate>(
            `/checklist-templates/${id}`
        )
        return response.data
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

/**
 * POST Crea nuovo template (Admin)
 */
export const createChecklistTemplate = async (
    payload: CreateChecklistTemplatePayload
): Promise<ChecklistTemplate> => {
    try {
        const response = await apiClient.post<ChecklistTemplate>(
            '/checklist-templates',
            payload
        )
        return response.data
    } catch (error: any) {
        console.error(
            'Errore creazione template:',
            error?.response?.data || error.message
        )
        throw new Error(
            error?.response?.data?.message ||
            'Errore creazione template'
        )
    }
}

/**
 * PUT Aggiorna template (Admin)
 */
export const updateChecklistTemplate = async (
    id: string,
    payload: UpdateChecklistTemplatePayload
): Promise<ChecklistTemplate> => {
    try {
        const response = await apiClient.put<ChecklistTemplate>(
            `/checklist-templates/${id}`,
            payload
        )
        return response.data
    } catch (error: any) {
        console.error(
            'Errore aggiornamento template:',
            error?.response?.data || error.message
        )
        throw new Error(
            error?.response?.data?.message ||
            'Errore aggiornamento template'
        )
    }
}

/**
 * DELETE Cancella template (Admin)
 */
export const deleteChecklistTemplate = async (id: string): Promise<void> => {
    try {
        await apiClient.delete(`/checklist-templates/${id}`)
    } catch (error: any) {
        console.error(
            'Errore cancellazione template:',
            error?.response?.data || error.message
        )
        throw new Error(
            error?.response?.data?.message ||
            'Errore cancellazione template'
        )
    }
}

/**
 * GET Template per tipo (Pubblico)
 */
export const fetchChecklistTemplatesByType = async (
    entryType: EntryType
): Promise<ChecklistTemplate[]> => {
    try {
        const response = await apiClient.get<ChecklistTemplate[]>(
            `/checklist-templates?entryType=${encodeURIComponent(entryType)}`
        )
        return response.data
    } catch (error: any) {
        console.error(
            'Errore caricamento template per tipo:',
            error?.response?.data || error.message
        )
        throw new Error(
            error?.response?.data?.message ||
            'Errore caricamento template per tipo'
        )
    }
}
