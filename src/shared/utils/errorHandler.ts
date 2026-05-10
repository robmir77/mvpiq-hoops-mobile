// src/shared/utils/errorHandler.ts

import { Alert } from 'react-native'

export interface ApiError {
    response?: {
        status: number
        data?: {
            message?: string
            error?: string
        }
    }
    message?: string
}

export const handleApiError = (error: ApiError): string => {
    const status = error.response?.status
    const message = error.response?.data?.message || error.response?.data?.error || error.message

    switch (status) {
        case 401:
            return 'Sessione scaduta. Effettua nuovamente il login.'
        case 403:
            return 'Accesso negato. Non hai i permessi necessari.'
        case 404:
            return 'Risorsa non trovata.'
        case 422:
            return message || 'Dati non validi.'
        case 500:
            return 'Errore del server. Riprova più tardi.'
        default:
            return message || 'Errore imprevisto. Riprova.'
    }
}

export const showErrorAlert = (title: string, error: ApiError) => {
    const message = handleApiError(error)
    Alert.alert(title, message, [{ text: 'OK', style: 'default' }])
}

export const isAuthError = (error: ApiError): boolean => {
    return error.response?.status === 401
}

export const isPermissionError = (error: ApiError): boolean => {
    return error.response?.status === 403
}

export const isNotFoundError = (error: ApiError): boolean => {
    return error.response?.status === 404
}
