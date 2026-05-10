
import React from 'react'
import { View, Text, StyleSheet, Pressable } from 'react-native'
import { colors } from '@/shared/theme/colors'

interface Props {
    label: string
    selected?: boolean
    disabled?: boolean
    onPress: () => void
}

export const PositionCard = ({
                                 label,
                                 selected,
                                 disabled,
                                 onPress,
                             }: Props) => {
    return (
        <Pressable
            onPress={onPress}
            style={[
                styles.card,
                selected && styles.selected,
                disabled && styles.disabled,
            ]}
        >
            <Text
                style={[
                    styles.text,
                    selected && styles.selectedText,
                    disabled && styles.disabledText,
                ]}
            >
                {label}
            </Text>
        </Pressable>
    )
}

const styles = StyleSheet.create({
    card: {
        backgroundColor: colors.card,
        paddingVertical: 12,
        paddingHorizontal: 18,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: colors.cardBorder,
    },
    selected: {
        backgroundColor: colors.primary,
        borderColor: colors.primary,
    },
    disabled: {
        backgroundColor: '#2a2a2a',
        borderColor: '#444',
        opacity: 1,
    },
    text: {
        color: colors.textPrimary,
        fontWeight: '600',
    },
    selectedText: {
        color: '#000',
    },
    disabledText: {
        color: '#ffffff',
        opacity: 0.8,
    },
})