// src/features/workouts/components/ShotFeedback.tsx
//
// Shot feedback overlay component
// Displays shot result animation and tracking badge

import React from 'react'
import { View, Text, StyleSheet, Animated } from 'react-native'
import type { ShotResult } from '../types/workouts.types'

interface ShotFeedbackProps {
    lastShotResult: ShotResult | null
    feedbackOpacity: Animated.Value
    trackingBadgeText: string
    trackingDotActive: boolean
    trackingDotColor: string
}

export const ShotFeedback: React.FC<ShotFeedbackProps> = ({
    lastShotResult,
    feedbackOpacity,
    trackingBadgeText,
    trackingDotActive,
    trackingDotColor,
}) => {
    return (
        <>
            <View style={styles.trackingBadge} pointerEvents="none">
                <View style={[styles.trackingDot, { backgroundColor: trackingDotColor }]} />
                <Text style={styles.trackingText}>{trackingBadgeText}</Text>
            </View>

            {lastShotResult && (
                <Animated.View style={[styles.shotFeedback, { opacity: feedbackOpacity }]} pointerEvents="none">
                    <Text
                        style={[
                            styles.shotFeedbackText,
                            lastShotResult === 'MADE' ? styles.shotMadeText : styles.shotMissText,
                        ]}
                    >
                        {lastShotResult === 'MADE' ? '🏀 CANESTRO!' : '❌ MANCATO'}
                    </Text>
                </Animated.View>
            )}
        </>
    )
}

const styles = StyleSheet.create({
    trackingBadge: {
        position: 'absolute',
        top: 12,
        left: 12,
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(0,0,0,0.5)',
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 20,
    },
    trackingDot: {
        width: 7,
        height: 7,
        borderRadius: 3.5,
        backgroundColor: '#555',
        marginRight: 6,
    },
    trackingDotActive: {
        backgroundColor: '#4ade80',
    },
    trackingText: {
        color: '#fff',
        fontSize: 11,
        fontWeight: '600',
    },
    shotFeedback: {
        position: 'absolute',
        top: '28%',
        left: 0,
        right: 0,
        alignItems: 'center',
    },
    shotFeedbackText: {
        fontSize: 32,
        fontWeight: '900',
        textShadowColor: 'rgba(0,0,0,0.8)',
        textShadowOffset: { width: 0, height: 2 },
        textShadowRadius: 6,
    },
    shotMadeText: {
        color: '#4ade80',
    },
    shotMissText: {
        color: '#f87171',
    },
})
