// src/shared/components/CustomAlert.tsx

import React from 'react'
import {
    View,
    Text,
    Modal,
    TouchableOpacity,
    StyleSheet,
    Dimensions,
} from 'react-native'

interface CustomAlertProps {
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

const { width: screenWidth } = Dimensions.get('window')

export const CustomAlert: React.FC<CustomAlertProps> = ({
    visible,
    title,
    message,
    type = 'info',
    onConfirm,
    onCancel,
    confirmText = 'OK',
    cancelText = 'Annulla',
    showCancel = false,
}) => {
    const getColors = () => {
        switch (type) {
            case 'success':
                return {
                    background: '#10b981',
                    border: '#059669',
                    icon: '✅',
                }
            case 'error':
                return {
                    background: '#ef4444',
                    border: '#dc2626',
                    icon: '❌',
                }
            case 'warning':
                return {
                    background: '#f59e0b',
                    border: '#d97706',
                    icon: '⚠️',
                }
            default:
                return {
                    background: '#ff8c00',
                    border: '#ea580c',
                    icon: 'ℹ️',
                }
        }
    }

    const colors = getColors()

    return (
        <Modal
            visible={visible}
            transparent={true}
            animationType="fade"
            onRequestClose={onCancel}
        >
            <View style={styles.overlay}>
                <View style={styles.alertContainer}>
                    {/* Header */}
                    <View style={[styles.header, { backgroundColor: colors.background }]}>
                        <Text style={styles.icon}>{colors.icon}</Text>
                        <Text style={styles.title}>{title}</Text>
                    </View>

                    {/* Body */}
                    <View style={styles.body}>
                        <Text style={styles.message}>{message}</Text>
                    </View>

                    {/* Actions */}
                    <View style={styles.actions}>
                        {showCancel && (
                            <TouchableOpacity
                                style={[styles.button, styles.cancelButton]}
                                onPress={onCancel}
                            >
                                <Text style={styles.cancelButtonText}>{cancelText}</Text>
                            </TouchableOpacity>
                        )}
                        <TouchableOpacity
                            style={[styles.button, styles.confirmButton, { backgroundColor: colors.background }]}
                            onPress={onConfirm}
                        >
                            <Text style={styles.confirmButtonText}>{confirmText}</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </View>
        </Modal>
    )
}

// Hook per gestire l'alert
export const useCustomAlert = () => {
    const [alert, setAlert] = React.useState<{
        visible: boolean
        title: string
        message: string
        type?: 'success' | 'error' | 'warning' | 'info'
        onConfirm?: () => void
        onCancel?: () => void
        confirmText?: string
        cancelText?: string
        showCancel?: boolean
    }>({
        visible: false,
        title: '',
        message: '',
    })

    const showAlert = (options: Omit<typeof alert, 'visible'>) => {
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

    return {
        alert,
        showAlert,
        hideAlert,
        showSuccess,
        showError,
        showWarning,
        showInfo,
    }
}

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 20,
    },
    alertContainer: {
        backgroundColor: '#1a1a1a',
        borderRadius: 16,
        width: Math.min(screenWidth - 40, 400),
        maxWidth: '100%',
        borderWidth: 2,
        borderColor: '#ff8c00',
        overflow: 'hidden',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 8,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 20,
        gap: 12,
        backgroundColor: '#0f0f0f',
    },
    icon: {
        fontSize: 28,
    },
    title: {
        fontSize: 20,
        fontWeight: '700',
        color: '#ffffff',
        flex: 1,
        textShadowColor: 'rgba(0, 0, 0, 0.5)',
        textShadowOffset: { width: 0, height: 1 },
        textShadowRadius: 2,
    },
    body: {
        padding: 20,
        paddingTop: 0,
    },
    message: {
        fontSize: 18,
        color: '#ffffff',
        lineHeight: 26,
        fontWeight: '500',
    },
    actions: {
        flexDirection: 'row',
        padding: 20,
        paddingTop: 16,
        gap: 12,
        backgroundColor: '#0f0f0f',
    },
    button: {
        flex: 1,
        paddingVertical: 16,
        paddingHorizontal: 20,
        borderRadius: 12,
        alignItems: 'center',
        minHeight: 52,
    },
    confirmButton: {
        // backgroundColor viene impostato dinamicamente
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.2,
        shadowRadius: 4,
        elevation: 4,
    },
    cancelButton: {
        backgroundColor: '#2a2a2a',
        borderWidth: 2,
        borderColor: '#666',
    },
    confirmButtonText: {
        fontSize: 18,
        fontWeight: '700',
        color: '#ffffff',
        textShadowColor: 'rgba(0, 0, 0, 0.3)',
        textShadowOffset: { width: 0, height: 1 },
        textShadowRadius: 2,
    },
    cancelButtonText: {
        fontSize: 18,
        fontWeight: '700',
        color: '#ffffff',
    },
})
