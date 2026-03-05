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
})