import { StyleSheet } from 'react-native'
import { colors } from './colors'

export const globalStyles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: colors.background,
        padding: 20,
    },

    sectionTitle: {
        color: colors.primary,
        fontSize: 18,
        fontWeight: 'bold',
        marginTop: 20,
        marginBottom: 10,
    },

    label: {
        color: colors.textPrimary,
        marginBottom: 5,
        marginTop: 15,
    },

    input: {
        backgroundColor: colors.card,
        color: colors.textPrimary,
        padding: 12,
        borderRadius: 8,
    },

    button: {
        backgroundColor: '#F97316',
        padding: 16,
        borderRadius: 12,
        alignItems: 'center',
        marginBottom: 10,
    },

    buttonText: {
        color: '#FFFFFF',
        fontWeight: '600',
        fontSize: 16,
    },
})