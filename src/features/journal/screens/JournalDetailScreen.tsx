import React, { useContext } from 'react'
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    TouchableOpacity,
    ActivityIndicator,
} from 'react-native'
import { AuthContext } from '@/features/auth/context/AuthContext'
import { useJournalEntry } from '../hooks/useJournalEntry'

type Props = {
    route: {
        params: {
            id: string
        }
    }
    navigation: any
}

export default function JournalDetailScreen({ route, navigation }: Props) {
    const { id } = route.params
    const auth = useContext(AuthContext)
    const { user } = auth || {}

    const { data: entry, isLoading, error } = useJournalEntry(user?.id || '', id)

    if (isLoading) {
        return (
            <View style={styles.center}>
                <ActivityIndicator size="large" color="#ff8c00" />
            </View>
        )
    }

    if (error || !entry) {
        return (
            <View style={styles.center}>
                <Text style={{ color: 'white' }}>Errore caricamento dettaglio</Text>
                <TouchableOpacity
                    style={styles.backButton}
                    onPress={() => navigation.goBack()}
                >
                    <Text style={styles.backButtonText}>← Indietro</Text>
                </TouchableOpacity>
            </View>
        )
    }

    // Get first two checklist values
    const getFirstTwoValues = () => {
        if (!entry.checklists || entry.checklists.length === 0) return []

        const checklist = entry.checklists[0]
        if (!checklist.answers || checklist.answers.length === 0) return []

        return checklist.answers.slice(0, 2).map((answer: any) => {
            const item = checklist.template?.items?.find((i: any) => i.id === answer.itemId)
            let value = answer.value

            // Format value based on dataType
            if (item?.dataType === 'BOOLEAN') {
                value = answer.booleanValue ? 'Sì' : 'No'
            } else if (item?.dataType === 'SELECT' || item?.dataType === 'MULTI_SELECT') {
                const option = item?.options?.find((o: any) => o.valueCode === answer.selectValue)
                value = option?.valueLabel || answer.selectValue || '-'
            } else if (item?.dataType === 'NUMBER') {
                value = answer.numberValue?.toString() || '-'
            } else if (item?.dataType === 'DATE') {
                value = answer.dateValue || '-'
            } else {
                value = answer.textValue || '-'
            }

            return {
                label: item?.label || 'Campo',
                value: value
            }
        })
    }

    const firstTwoValues = getFirstTwoValues()

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <TouchableOpacity
                    style={styles.backButton}
                    onPress={() => navigation.goBack()}
                >
                    <Text style={styles.backButtonText}>← Indietro</Text>
                </TouchableOpacity>
                <Text style={styles.title}>
                    {entry.entryType === 'MATCH' ? '⚽ Partita' : '🏋️ Allenamento'}
                </Text>
            </View>

            <ScrollView style={styles.content}>
                <View style={styles.card}>
                    <Text style={styles.date}>
                        {entry.entryDate
                            ? new Date(entry.entryDate).toLocaleDateString('it-IT', {
                                day: 'numeric',
                                month: 'long',
                                year: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit'
                            })
                            : 'Data non disponibile'}
                    </Text>

                    {entry.opponent && (
                        <Text style={styles.opponent}>Avversario: {entry.opponent}</Text>
                    )}

                    {entry.location && (
                        <Text style={styles.location}>📍 {entry.location}</Text>
                    )}
                </View>

                {/* First two checklist values */}
                {firstTwoValues.length > 0 && (
                    <View style={styles.valuesCard}>
                        <Text style={styles.valuesTitle}>Dettagli</Text>
                        {firstTwoValues.map((item: any, index: number) => (
                            <View key={index} style={styles.valueRow}>
                                <Text style={styles.valueLabel}>{item.label}</Text>
                                <Text style={styles.valueText}>{item.value}</Text>
                            </View>
                        ))}
                    </View>
                )}

                {entry.description && (
                    <View style={styles.descriptionCard}>
                        <Text style={styles.descriptionTitle}>Note</Text>
                        <Text style={styles.descriptionText}>{entry.description}</Text>
                    </View>
                )}
            </ScrollView>
        </View>
    )
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#0b0f1a',
    },
    center: {
        flex: 1,
        backgroundColor: '#0b0f1a',
        justifyContent: 'center',
        alignItems: 'center',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 16,
        borderBottomWidth: 1,
        borderBottomColor: '#1a1a1a',
    },
    backButton: {
        marginRight: 16,
    },
    backButtonText: {
        color: '#ff8c00',
        fontSize: 16,
    },
    title: {
        color: 'white',
        fontSize: 20,
        fontWeight: 'bold',
        flex: 1,
    },
    content: {
        flex: 1,
        padding: 16,
    },
    card: {
        backgroundColor: '#121826',
        borderRadius: 12,
        padding: 16,
        marginBottom: 16,
        borderWidth: 1,
        borderColor: '#2a2a2a',
    },
    date: {
        color: '#94A3B8',
        fontSize: 14,
        marginBottom: 8,
    },
    opponent: {
        color: 'white',
        fontSize: 16,
        fontWeight: 'bold',
    },
    location: {
        color: '#94A3B8',
        fontSize: 14,
        marginTop: 4,
    },
    valuesCard: {
        backgroundColor: '#121826',
        borderRadius: 12,
        padding: 16,
        marginBottom: 16,
        borderWidth: 1,
        borderColor: '#ff8c00',
    },
    valuesTitle: {
        color: '#ff8c00',
        fontSize: 16,
        fontWeight: 'bold',
        marginBottom: 12,
    },
    valueRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 8,
        borderBottomWidth: 1,
        borderBottomColor: '#2a2a2a',
    },
    valueLabel: {
        color: '#94A3B8',
        fontSize: 14,
        flex: 1,
    },
    valueText: {
        color: 'white',
        fontSize: 16,
        fontWeight: 'bold',
    },
    descriptionCard: {
        backgroundColor: '#121826',
        borderRadius: 12,
        padding: 16,
        marginBottom: 16,
        borderWidth: 1,
        borderColor: '#2a2a2a',
    },
    descriptionTitle: {
        color: '#ff8c00',
        fontSize: 16,
        fontWeight: 'bold',
        marginBottom: 8,
    },
    descriptionText: {
        color: 'white',
        fontSize: 14,
        lineHeight: 20,
    },
})
