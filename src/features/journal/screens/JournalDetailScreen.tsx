import React, { useContext, useState, useEffect } from 'react'
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
import { fetchChecklistTemplate } from '../api/journal.api'

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
    const [templateItems, setTemplateItems] = useState<Map<string, any>>(new Map())

    // Load template to get item labels
    useEffect(() => {
        if (entry?.checklists?.[0]?.templateId && entry?.entryType) {
            fetchChecklistTemplate(entry.entryType)
                .then(template => {
                    const itemsMap = new Map()
                    template.items?.forEach((item: any) => {
                        itemsMap.set(item.id, item)
                    })
                    setTemplateItems(itemsMap)
                })
                .catch(err => console.log('Template load error:', err))
        }
    }, [entry])

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

    // Get all checklist values from items using template for labels
    const getChecklistValues = () => {
        if (!entry.checklists || entry.checklists.length === 0) return []

        const checklist = entry.checklists[0]
        const items = checklist.items || []
        if (!items || items.length === 0) return []

        const values = items.map((item: any, index: number) => {
            // Get template item for label
            const templateItem = templateItems.get(item.templateItemId)

            // Get label from template or fallback
            let label = templateItem?.label || templateItem?.itemLabel ||
                        templateItem?.fieldName || templateItem?.title ||
                        templateItem?.name || `Campo ${index + 1}`

            // Get the actual value - check all possible fields
            let value: any = item.booleanValue ?? item.numberValue ?? item.selectValue ?? item.textValue ?? item.itemValue ?? item.value ?? item.answerValue

            // If it's a select value, try to get the label from options
            const itemType = templateItem?.dataType
            if ((itemType === 'SELECT' || itemType === 'MULTI_SELECT') && value && templateItem?.options) {
                const option = templateItem.options.find((o: any) => o.valueCode === value || o.value === value)
                if (option?.valueLabel || option?.label) {
                    value = option.valueLabel || option.label
                }
            }

            // Format value for display
            if (value === null || value === undefined || value === '') {
                value = '⚪ Non inserito'
            } else if (typeof value === 'boolean') {
                value = value ? '✓ Sì' : '✗ No'
            } else if (Array.isArray(value)) {
                value = value.join(', ')
            } else {
                value = String(value)
            }

            return { label, value, index }
        })

        const filtered = values.filter((item: any) => !(item.label === `Campo ${item.index + 1}` && item.value === '⚪ Non inserito'))
        return filtered
    }

    const checklistValues = getChecklistValues()

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

                    {entry.durationMinutes && (
                        <Text style={styles.duration}>⏱️ {entry.durationMinutes} minuti</Text>
                    )}
                </View>

                {/* Ratings */}
                {(entry.moodRating || entry.performanceRating) && (
                    <View style={styles.ratingsCard}>
                        <Text style={styles.ratingsTitle}>Valutazioni</Text>
                        <View style={styles.ratingsRow}>
                            {entry.moodRating && (
                                <View style={styles.ratingItem}>
                                    <Text style={styles.ratingLabel}>Umore</Text>
                                    <Text style={styles.ratingValue}>{entry.moodRating}/10</Text>
                                </View>
                            )}
                            {entry.performanceRating && (
                                <View style={styles.ratingItem}>
                                    <Text style={styles.ratingLabel}>Prestazione</Text>
                                    <Text style={styles.ratingValue}>{entry.performanceRating}/10</Text>
                                </View>
                            )}
                        </View>
                    </View>
                )}

                {/* All checklist values */}
                {checklistValues.length > 0 && (
                    <View style={styles.valuesCard}>
                        <Text style={styles.valuesTitle}>Dettagli Checklist</Text>
                        {checklistValues.map((item: any, index: number) => (
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
    opponentMuted: {
        color: '#64748B',
        fontSize: 16,
        fontStyle: 'italic',
    },
    locationMuted: {
        color: '#64748B',
        fontSize: 14,
        marginTop: 4,
        fontStyle: 'italic',
    },
    duration: {
        color: '#94A3B8',
        fontSize: 14,
        marginTop: 4,
    },
    ratingsCard: {
        backgroundColor: '#121826',
        borderRadius: 12,
        padding: 16,
        marginBottom: 16,
        borderWidth: 1,
        borderColor: '#22c55e',
    },
    ratingsTitle: {
        color: '#22c55e',
        fontSize: 16,
        fontWeight: 'bold',
        marginBottom: 12,
    },
    ratingsRow: {
        flexDirection: 'row',
        justifyContent: 'space-around',
    },
    ratingItem: {
        alignItems: 'center',
    },
    ratingLabel: {
        color: '#94A3B8',
        fontSize: 14,
        marginBottom: 4,
    },
    ratingValue: {
        color: '#22c55e',
        fontSize: 24,
        fontWeight: 'bold',
    },
})
