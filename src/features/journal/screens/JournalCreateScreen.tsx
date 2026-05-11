import React, { useEffect, useState, useContext } from 'react'
import {
    View,
    Text,
    ActivityIndicator,
    ScrollView,
    StyleSheet,
    TouchableOpacity,
    RefreshControl,
} from 'react-native'
import {
    fetchChecklistTemplate,
    createJournalEntry,
    fetchDynamicChecklistOptions,
} from '../api/journal.api'
import { ChecklistTemplate, SelectSource } from '../types/journal.types'
import { ChecklistField } from '../components/ChecklistField'
import { useDynamicChecklistOptions } from '../hooks/useDynamicChecklistOptions'
import { AuthContext } from '@/features/auth/context/AuthContext'
import { globalStyles } from '@/shared/theme/globalStyles'
import { useCustomAlert, CustomAlert } from '@/shared/components/CustomAlert'

type Props = {
    route: {
        params: {
            entryType: 'MATCH' | 'TRAINING'
        }
    }
    navigation: any
}

export default function JournalCreateScreen({ route, navigation }: Props) {
    const { entryType } = route.params

    const auth = useContext(AuthContext)
    const playerId = auth?.user?.id
    const { alert, showError, showSuccess } = useCustomAlert()

    const [template, setTemplate] = useState<ChecklistTemplate | null>(null)
    const [loading, setLoading] = useState(true)
    const [refreshing, setRefreshing] = useState(false)
    const [answers, setAnswers] = useState<Record<string, any>>({})
    const [sqlOptionsMap, setSqlOptionsMap] = useState<Record<string, any[]>>({})

    // Collect all unique selectSources from template items
    const selectSources = template?.items
        ?.filter(item => item.selectSource && item.selectSource !== 'STATIC')
        ?.map(item => item.selectSource)
        ?.filter((source): source is SelectSource => !!source) || []

    // Fetch dynamic options for POSITION_METADATA
    const { data: positionMetadataOptions } = useDynamicChecklistOptions(
        selectSources.includes('POSITION_METADATA') ? 'POSITION_METADATA' : undefined
    )

    // Fetch dynamic options for PLAYER_POSITION
    const { data: playerPositionOptions } = useDynamicChecklistOptions(
        selectSources.includes('PLAYER_POSITION') ? 'PLAYER_POSITION' : undefined
    )

    // Fetch dynamic options for TRAINING_TYPE
    const { data: trainingTypeOptions } = useDynamicChecklistOptions(
        selectSources.includes('TRAINING_TYPE') ? 'TRAINING_TYPE' : undefined
    )

    // Fetch SQL options for each item with selectSource='SQL'
    useEffect(() => {
        if (!template) return

        const fetchSqlOptions = async () => {
            const sqlItems = template.items.filter(
                item => item.selectSource === 'SQL' && item.selectQuery
            )

            const optionsMap: Record<string, any[]> = {}

            for (const item of sqlItems) {
                try {
                    const options = await fetchDynamicChecklistOptions('SQL', item.selectQuery)
                    optionsMap[item.id] = options
                } catch (error) {
                    console.error(`Error fetching SQL options for item ${item.id}:`, error)
                    optionsMap[item.id] = []
                }
            }

            setSqlOptionsMap(optionsMap)
        }

        fetchSqlOptions()
    }, [template])

    // Map options to selectSources (excluding SQL which is handled per-item)
    const dynamicOptionsMap: Partial<Record<Exclude<SelectSource, 'SQL'>, any[]>> = {
        POSITION_METADATA: positionMetadataOptions || [],
        PLAYER_POSITION: playerPositionOptions || [],
        TRAINING_TYPE: trainingTypeOptions || [],
    }

    // Helper to get options for an item
    const getItemOptions = (item: any) => {
        if (item.selectSource === 'SQL') {
            // SQL options are fetched per-item and stored in sqlOptionsMap
            return sqlOptionsMap[item.id] || []
        }
        return item.selectSource ? dynamicOptionsMap[item.selectSource as Exclude<SelectSource, 'SQL'>] : undefined
    }

    useEffect(() => {
        loadTemplate()
    }, [])

    const loadTemplate = async () => {
        try {
            const data = await fetchChecklistTemplate(entryType)
            setTemplate(data)
        } catch (e) {
            showError('Errore', 'Impossibile caricare il template')
        } finally {
            setLoading(false)
            setRefreshing(false)
        }
    }

    const onRefresh = async () => {
        setRefreshing(true)
        await loadTemplate()
    }

    const handleChange = (itemId: string, value: any) => {
        setAnswers((prev) => ({
            ...prev,
            [itemId]: value,
        }))
    }

    const handleSubmit = async () => {
        if (!template) return

        if (!playerId) {
            showError('Errore', 'Utente non autenticato')
            return
        }

        const missingRequired = template.items?.filter(
            (item) => item.isRequired && answers[item.id] == null
        ) || []

        if (missingRequired.length > 0) {
            showError('Errore', 'Completa tutti i campi obbligatori')
            return
        }

        try {
            const payload = {
                entryType,
                entryDate: new Date().toISOString(),
                visibility: 'PRIVATE',

                checklists: [
                    {
                        templateId: template.id,
                        status: 'COMPLETED',
                        items: (template.items || []).map((item) => {
                            const value = answers[item.id]

                            return {
                                templateItemId: item.id,
                                booleanValue:
                                    item.dataType === 'BOOLEAN' ? value ?? null : null,
                                numberValue:
                                    item.dataType === 'NUMBER' ? value ?? null : null,
                                textValue:
                                    item.dataType === 'TEXT' ? value ?? null : null,
                                dateValue:
                                    item.dataType === 'DATE' ? value ?? null : null,
                                selectValue:
                                    item.dataType === 'SELECT' || item.dataType === 'MULTI_SELECT'
                                        ? (item.dataType === 'MULTI_SELECT' && Array.isArray(value) ? value.join(',') : value ?? null)
                                        : null,
                                completed: true,
                            }
                        }),
                    },
                ],
            }

            await createJournalEntry(playerId, payload)

            showSuccess('Successo', 'Journal salvato', () => navigation.goBack())
        } catch (e: any) {
            showError('Errore', e?.message || 'Salvataggio fallito')
        }
    }

    if (loading) {
        return (
            <View style={styles.center}>
                <ActivityIndicator size="large" color="#ff8c00" />
            </View>
        )
    }

    if (!template) {
        return (
            <View style={styles.center}>
                <Text style={{ color: 'white' }}>Template non trovato</Text>
            </View>
        )
    }

    return (
        <ScrollView
            style={styles.container}
            refreshControl={
                <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
            }
        >
            <View style={styles.header}>
                <TouchableOpacity 
                    style={styles.backButton} 
                    onPress={() => navigation.goBack()}
                >
                    <Text style={styles.backButtonText}>← Indietro</Text>
                </TouchableOpacity>
                <Text style={styles.title}>{template.name}</Text>
            </View>

            {template.items?.sort((a, b) => a.sortOrder - b.sortOrder)
                .map((item) => (
                    <ChecklistField
                        key={item.id}
                        item={item}
                        value={answers[item.id]}
                        onChange={(val) => handleChange(item.id, val)}
                        dynamicOptions={getItemOptions(item)}
                    />
                ))}

            <View style={{ marginTop: 20 }}>
                <TouchableOpacity style={globalStyles.button} onPress={handleSubmit}>
                    <Text style={globalStyles.buttonText}>Salva Journal</Text>
                </TouchableOpacity>
            </View>

            <CustomAlert {...alert} />
        </ScrollView>
    )
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#0b0f1a',
        padding: 20,
        paddingBottom: 100,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 20,
    },
    backButton: {
        marginRight: 15,
        padding: 8,
    },
    backButtonText: {
        color: '#F97316',
        fontSize: 16,
        fontWeight: '600',
    },
    title: {
        fontSize: 20,
        fontWeight: 'bold',
        color: 'white',
        flex: 1,
    },
    center: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#0b0f1a',
    },
})