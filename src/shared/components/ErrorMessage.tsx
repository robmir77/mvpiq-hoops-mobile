// src/shared/components/ErrorMessage.tsx

import React from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'

interface Props {
    message: string
    onRetry?: () => void
    retryText?: string
    icon?: string
}

export const ErrorMessage: React.FC<Props> = ({
    message,
    onRetry,
    retryText = 'Riprova',
    icon = '⚠️',
}) => {
    return (
        <View style={styles.container}>
            <Text style={styles.icon}>{icon}</Text>
            <Text style={styles.message}>{message}</Text>
            {onRetry && (
                <TouchableOpacity style={styles.retryButton} onPress={onRetry}>
                    <Text style={styles.retryText}>{retryText}</Text>
                </TouchableOpacity>
            )}
        </View>
    )
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 20,
        backgroundColor: '#1a1a1a',
    },
    icon: {
        fontSize: 48,
        marginBottom: 16,
    },
    message: {
        fontSize: 16,
        color: '#ff4444',
        textAlign: 'center',
        marginBottom: 20,
        lineHeight: 22,
    },
    retryButton: {
        backgroundColor: '#ff8c00',
        paddingHorizontal: 20,
        paddingVertical: 10,
        borderRadius: 8,
    },
    retryText: {
        color: '#fff',
        fontWeight: 'bold',
        fontSize: 16,
    },
})
