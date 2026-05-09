// src/shared/context/AlertContext.tsx

import React, { createContext, useContext, useState, ReactNode } from 'react'
import { CustomAlert } from '@/shared/components/CustomAlert'

interface AlertState {
    visible: boolean
    title: string
    message: string
    type?: 'success' | 'error' | 'warning' | 'info'
    onConfirm?: () => void
    onCancel?: () => void
    confirmText?: string
    cancelText?: string
    showCancel?: boolean
}

interface AlertContextType {
    alert: AlertState
    showAlert: (options: Omit<AlertState, 'visible'>) => void
    hideAlert: () => void
    showSuccess: (title: string, message: string, onConfirm?: () => void) => void
    showError: (title: string, message: string, onConfirm?: () => void) => void
    showWarning: (title: string, message: string, onConfirm?: () => void, onCancel?: () => void) => void
    showInfo: (title: string, message: string, onConfirm?: () => void) => void
}

const AlertContext = createContext<AlertContextType | undefined>(undefined)

export const useGlobalAlert = (): AlertContextType => {
    const context = useContext(AlertContext)
    if (!context) {
        throw new Error('useGlobalAlert must be used within an AlertProvider')
    }
    return context
}

interface AlertProviderProps {
    children: ReactNode
}

export const AlertProvider: React.FC<AlertProviderProps> = ({ children }) => {
    const [alert, setAlert] = useState<AlertState>({
        visible: false,
        title: '',
        message: '',
        type: 'info',
    })

    const showAlert = (options: Omit<AlertState, 'visible'>) => {
        setAlert({ ...options, visible: true })
    }

    const hideAlert = () => {
        setAlert(prev => ({ ...prev, visible: false }))
    }

    const showSuccess = (title: string, message: string, onConfirm?: () => void) => {
        showAlert({
            title,
            message,
            type: 'success',
            onConfirm: () => {
                onConfirm?.()
                hideAlert()
            },
        })
    }

    const showError = (title: string, message: string, onConfirm?: () => void) => {
        showAlert({
            title,
            message,
            type: 'error',
            onConfirm: () => {
                onConfirm?.()
                hideAlert()
            },
        })
    }

    const showWarning = (title: string, message: string, onConfirm?: () => void, onCancel?: () => void) => {
        showAlert({
            title,
            message,
            type: 'warning',
            showCancel: true,
            onConfirm: () => {
                onConfirm?.()
                hideAlert()
            },
            onCancel: () => {
                onCancel?.()
                hideAlert()
            },
        })
    }

    const showInfo = (title: string, message: string, onConfirm?: () => void) => {
        showAlert({
            title,
            message,
            type: 'info',
            onConfirm: () => {
                onConfirm?.()
                hideAlert()
            },
        })
    }

    const value: AlertContextType = {
        alert,
        showAlert,
        hideAlert,
        showSuccess,
        showError,
        showWarning,
        showInfo,
    }

    return (
        <AlertContext.Provider value={value}>
            {children}
            <CustomAlert
                visible={alert.visible}
                title={alert.title}
                message={alert.message}
                type={alert.type}
                onConfirm={alert.onConfirm}
                onCancel={alert.onCancel}
                confirmText={alert.confirmText}
                cancelText={alert.cancelText}
                showCancel={alert.showCancel}
            />
        </AlertContext.Provider>
    )
}
