import React, { useEffect, useState, useContext } from 'react'
import {
    View,
    Text,
    ActivityIndicator,
    ScrollView,
    StyleSheet,
    Button,
    Alert,
} from 'react-native'
import {
    fetchChecklistTemplate,
    createJournalEntry,
} from '../api/journal.api'
import { ChecklistTemplate } from '../types/journal.types'
import { ChecklistField } from '../components/ChecklistField'
import { AuthContext } from '@/features/auth/context/AuthContext'

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

    const [template, setTemplate] = useState<ChecklistTemplate | null>(null)
    const [loading, setLoading] = useState(true)
    const [answers, setAnswers] = useState<Record<string, any>>({})

    useEffect(() => {
        loadTemplate()
    }, [])

    const loadTemplate = async () => {
        try {
            const data = await fetchChecklistTemplate(entryType)
            setTemplate(data)
        } catch (e) {
            Alert.alert('Errore', 'Impossibile caricare il template')
        } finally {
            setLoading(false)
        }
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
            Alert.alert('Errore', 'Utente non autenticato')
            return
        }

        const missingRequired = template.items.filter(
            (item) => item.isRequired && answers[item.id] == null
        )

        if (missingRequired.length > 0) {
            Alert.alert('Errore', 'Completa tutti i campi obbligatori')
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
                        items: template.items.map((item) => {
                            const value = answers[item.id]

                            return {
                                templateItemId: item.id,
                                booleanValue:
                                    item.dataType === 'BOOLEAN' ? value ?? null : null,
                                numberValue:
                                    item.dataType === 'NUMBER' ? value ?? null : null,
                                textValue:
                                    item.dataType === 'TEXT' ? value ?? null : null,
                                selectValue:
                                    item.dataType === 'SELECT' ? value ?? null : null,
                                completed: true,
                            }
                        }),
                    },
                ],
            }

            await createJournalEntry(playerId, payload)

            Alert.alert('Successo', 'Journal salvato')
            navigation.goBack()
        } catch (e: any) {
            Alert.alert(
                'Errore',
                e?.message || 'Salvataggio fallito'
            )
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
        <ScrollView style={styles.container}>
            <Text style={styles.title}>{template.name}</Text>

            {template.items
                .sort((a, b) => a.sortOrder - b.sortOrder)
                .map((item) => (
                    <ChecklistField
                        key={item.id}
                        item={item}
                        value={answers[item.id]}
                        onChange={(val) => handleChange(item.id, val)}
                    />
                ))}

            <View style={{ marginTop: 20 }}>
                <Button title="Salva Journal" onPress={handleSubmit} />
            </View>
        </ScrollView>
    )
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#0b0f1a',
        padding: 20,
    },
    title: {
        fontSize: 20,
        fontWeight: 'bold',
        color: 'white',
        marginBottom: 20,
    },
    center: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#0b0f1a',
    },
})