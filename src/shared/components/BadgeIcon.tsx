// src/shared/components/BadgeIcon.tsx

import React from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons'

interface BadgeIconProps {
    name: any // Accetta qualsiasi nome di icona
    size: number
    color: string
    badgeCount?: number
    iconType?: 'ionicons' | 'material'
}

export const BadgeIcon: React.FC<BadgeIconProps> = ({
    name,
    size,
    color,
    badgeCount,
    iconType = 'ionicons'
}) => {
    const showBadge = badgeCount && badgeCount > 0

    const renderIcon = () => {
        if (iconType === 'material') {
            return <MaterialCommunityIcons name={name} size={size} color={color} />
        }
        return <Ionicons name={name} size={size} color={color} />
    }

    return (
        <View style={styles.container}>
            {renderIcon()}
            {showBadge && (
                <View style={styles.badge}>
                    <Text style={styles.badgeText}>
                        {badgeCount > 99 ? '99+' : badgeCount.toString()}
                    </Text>
                </View>
            )}
        </View>
    )
}

const styles = StyleSheet.create({
    container: {
        position: 'relative',
        width: 24,
        height: 24,
        justifyContent: 'center',
        alignItems: 'center',
    },
    badge: {
        position: 'absolute',
        top: -6,
        right: -6,
        backgroundColor: '#ff8c00',
        borderRadius: 10,
        minWidth: 20,
        height: 20,
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: 2,
        borderColor: '#0b0f1a',
    },
    badgeText: {
        color: '#fff',
        fontSize: 10,
        fontWeight: '600',
        paddingHorizontal: 4,
    },
})
