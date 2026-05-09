// src/shared/components/LoadingSpinner.tsx

import React from 'react'
import { View, ActivityIndicator, Text, StyleSheet } from 'react-native'

interface Props {
    size?: 'small' | 'large'
    color?: string
    text?: string
    fullscreen?: boolean
}

export const LoadingSpinner: React.FC<Props> = ({
    size = 'large',
    color = '#ff8c00',
    text,
    fullscreen = false,
}) => {
    const containerStyle = fullscreen ? styles.fullscreenContainer : styles.container

    return (
        <View style={containerStyle}>
            <ActivityIndicator size={size} color={color} />
            {text && <Text style={styles.text}>{text}</Text>}
        </View>
    )
}

const styles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
    },
    fullscreenContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#1a1a1a',
    },
    text: {
        marginLeft: 12,
        color: '#fff',
        fontSize: 16,
    },
})
