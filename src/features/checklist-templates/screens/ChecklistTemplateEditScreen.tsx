import React, { useContext, useState, useEffect } from 'react'
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    TextInput,
    TouchableOpacity,
    ActivityIndicator,
    Alert,
} from 'react-native'
import { useNavigation, useRoute } from '@react-navigation/native'
import { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { useChecklistTemplate, useCreateChecklistTemplate, useUpdateChecklistTemplate } from '../hooks/useChecklistTemplates'
import { ChecklistTemplate, ChecklistTemplateItem, DataType, SelectSource, EntryType } from '../types/checklist-templates.types'

type NavigationProp = NativeStackNavigationProp<any>
type RouteProp = any

const ItemForm = ({ item, index, onUpdate, onRemove }: {
    item: ChecklistTemplateItem
    index: number
    onUpdate: (index: number, field: keyof ChecklistTemplateItem, value: any) => void
    onRemove: (index: number) => void
}) => {
    return (
        <View style={styles.itemForm}>
            <View style={styles.itemHeader}>
                <Text style={styles.itemNumber}>Item {index + 1}</Text>
                <TouchableOpacity style={styles.removeButton} onPress={() => onRemove(index)}>
                    <Text style={styles.removeButtonText}>Rimuovi</Text>
                </TouchableOpacity>
            </View>

            <TextInput
                style={styles.input}
                placeholder="Label domanda"
                placeholderTextColor="#666"
                value={item.label}
                onChangeText={(text) => onUpdate(index, 'label', text)}
            />

            <View style={styles.row}>
                <View style={styles.halfWidth}>
                    <Text style={styles.label}>Tipo Dato</Text>
                    <View style={styles.dropdown}>
                        <TextInput
                            style={styles.dropdownInput}
                            placeholder="BOOLEAN"
                            placeholderTextColor="#666"
                            value={item.dataType}
                            onChangeText={(text) => onUpdate(index, 'dataType', text as DataType)}
                        />
                    </View>
                </View>

                <View style={styles.halfWidth}>
                    <Text style={styles.label}>Ordine</Text>
                    <TextInput
                        style={styles.input}
                        placeholder="1"
                        placeholderTextColor="#666"
                        keyboardType="numeric"
                        value={item.sortOrder.toString()}
                        onChangeText={(text) => onUpdate(index, 'sortOrder', parseInt(text) || 0)}
                    />
                </View>
            </View>

            <TouchableOpacity
                style={[styles.checkbox, item.isRequired && styles.checkboxChecked]}
                onPress={() => onUpdate(index, 'isRequired', !item.isRequired)}
            >
                <Text style={styles.checkboxText}>Obbligatorio</Text>
            </TouchableOpacity>

            {item.dataType === 'SELECT' && (
                <>
                    <Text style={styles.label}>Sorgente Opzioni</Text>
                    <TextInput
                        style={styles.input}
                        placeholder="STATIC | POSITION_METADATA | PLAYER_POSITION | TRAINING_TYPE"
                        placeholderTextColor="#666"
                        value={item.selectSource || ''}
                        onChangeText={(text) => onUpdate(index, 'selectSource', text as SelectSource)}
                    />
                </>
            )}
        </View>
    )
}

export default function ChecklistTemplateEditScreen() {
    const navigation = useNavigation<NavigationProp>()
    const route = useRoute<RouteProp>()
    const { templateId } = route.params || {}
    const { data: existingTemplate, isLoading: isLoadingTemplate } = useChecklistTemplate(templateId || '')
    const createMutation = useCreateChecklistTemplate()
    const updateMutation = useUpdateChecklistTemplate()

    const [code, setCode] = useState('')
    const [name, setName] = useState('')
    const [entryType, setEntryType] = useState<EntryType>('MATCH')
    const [isActive, setIsActive] = useState(true)
    const [items, setItems] = useState<Omit<ChecklistTemplateItem, 'id'>[]>([])

    useEffect(() => {
        if (existingTemplate) {
            setCode(existingTemplate.code)
            setName(existingTemplate.name)
            setEntryType(existingTemplate.entryType)
            setIsActive(existingTemplate.isActive)
            setItems(existingTemplate.items)
        }
    }, [existingTemplate])

    const handleAddItem = () => {
        setItems([
            ...items,
            {
                label: '',
                dataType: 'BOOLEAN',
                isRequired: false,
                sortOrder: items.length + 1,
                options: [],
            },
        ])
    }

    const handleUpdateItem = (index: number, field: keyof ChecklistTemplateItem, value: any) => {
        const newItems = [...items]
        ;(newItems[index] as any)[field] = value
        setItems(newItems)
    }

    const handleRemoveItem = (index: number) => {
        setItems(items.filter((_, i) => i !== index))
    }

    const handleSave = async () => {
        console.log('=== SALVA TEMPLATE ===')
        console.log('Code:', code)
        console.log('Name:', name)
        console.log('EntryType:', entryType)
        console.log('Items:', items)
        console.log('TemplateId:', templateId)

        if (!code || !name) {
            Alert.alert('Errore', 'Compila tutti i campi obbligatori')
            return
        }

        if (items.length === 0) {
            Alert.alert('Errore', 'Aggiungi almeno un item alla checklist')
            return
        }

        const invalidItem = items.find(item => !item.label || !item.dataType)
        if (invalidItem) {
            Alert.alert('Errore', 'Compila tutti i campi degli items')
            return
        }

        try {
            const payload = {
                code,
                name,
                entryType,
                items,
            }

            console.log('Payload da inviare:', JSON.stringify(payload, null, 2))

            if (templateId) {
                console.log('Aggiornamento template esistente:', templateId)
                await updateMutation.mutateAsync({ id: templateId, payload })
                Alert.alert('Successo', 'Template aggiornato con successo')
            } else {
                console.log('Creazione nuovo template')
                await createMutation.mutateAsync(payload as any)
                Alert.alert('Successo', 'Template creato con successo')
            }

            navigation.goBack()
        } catch (error: any) {
            console.error('Errore salvataggio:', error)
            console.error('Error response:', error?.response?.data)
            console.error('Error message:', error?.message)
            Alert.alert('Errore', error?.response?.data?.message || error.message || 'Impossibile salvare il template')
        }
    }

    if (isLoadingTemplate) {
        return (
            <View style={styles.center}>
                <ActivityIndicator size="large" color="#ff8c00" />
                <Text style={styles.loadingText}>Caricamento...</Text>
            </View>
        )
    }

    return (
        <View style={styles.container}>
            <ScrollView style={styles.scrollView}>
                <Text style={styles.title}>{templateId ? 'Modifica Template' : 'Nuovo Template'}</Text>

                <Text style={styles.label}>Codice *</Text>
                <TextInput
                    style={styles.input}
                    placeholder="Es: MATCH_PREP"
                    placeholderTextColor="#666"
                    value={code}
                    onChangeText={setCode}
                    autoCapitalize="characters"
                />

                <Text style={styles.label}>Nome *</Text>
                <TextInput
                    style={styles.input}
                    placeholder="Es: Preparazione Match"
                    placeholderTextColor="#666"
                    value={name}
                    onChangeText={setName}
                />

                <Text style={styles.label}>Tipo Entry *</Text>
                <View style={styles.row}>
                    <TouchableOpacity
                        style={[styles.typeButton, entryType === 'MATCH' && styles.typeButtonActive]}
                        onPress={() => setEntryType('MATCH')}
                    >
                        <Text style={[styles.typeButtonText, entryType === 'MATCH' && styles.typeButtonTextActive]}>
                            ⚽ Partita
                        </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={[styles.typeButton, entryType === 'TRAINING' && styles.typeButtonActive]}
                        onPress={() => setEntryType('TRAINING')}
                    >
                        <Text style={[styles.typeButtonText, entryType === 'TRAINING' && styles.typeButtonTextActive]}>
                            🏋️ Allenamento
                        </Text>
                    </TouchableOpacity>
                </View>

                {templateId && (
                    <TouchableOpacity
                        style={[styles.checkbox, isActive && styles.checkboxChecked]}
                        onPress={() => setIsActive(!isActive)}
                    >
                        <Text style={styles.checkboxText}>Template Attivo</Text>
                    </TouchableOpacity>
                )}

                <View style={styles.sectionHeader}>
                    <Text style={styles.sectionTitle}>Items Checklist</Text>
                    <TouchableOpacity style={styles.addButton} onPress={handleAddItem}>
                        <Text style={styles.addButtonText}>+ Aggiungi Item</Text>
                    </TouchableOpacity>
                </View>

                {items.map((item, index) => (
                    <ItemForm
                        key={index}
                        item={item as ChecklistTemplateItem}
                        index={index}
                        onUpdate={handleUpdateItem}
                        onRemove={handleRemoveItem}
                    />
                ))}

                {items.length === 0 && (
                    <Text style={styles.emptyText}>Nessun item aggiunto</Text>
                )}

                <TouchableOpacity
                    style={[styles.saveButton, (createMutation.isPending || updateMutation.isPending) && styles.saveButtonDisabled]}
                    onPress={handleSave}
                    disabled={createMutation.isPending || updateMutation.isPending}
                >
                    {createMutation.isPending || updateMutation.isPending ? (
                        <ActivityIndicator color="#fff" />
                    ) : (
                        <Text style={styles.saveButtonText}>Salva Template</Text>
                    )}
                </TouchableOpacity>
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
        justifyContent: 'center',
        alignItems: 'center',
    },
    loadingText: {
        color: '#fff',
        marginTop: 10,
    },
    scrollView: {
        flex: 1,
        padding: 20,
    },
    title: {
        fontSize: 24,
        fontWeight: 'bold',
        color: '#fff',
        marginBottom: 20,
    },
    label: {
        fontSize: 14,
        fontWeight: '600',
        color: '#fff',
        marginBottom: 8,
        marginTop: 16,
    },
    input: {
        backgroundColor: '#121826',
        borderWidth: 1,
        borderColor: '#2a2a2a',
        borderRadius: 8,
        padding: 12,
        color: '#fff',
        fontSize: 14,
    },
    row: {
        flexDirection: 'row',
        gap: 12,
    },
    halfWidth: {
        flex: 1,
    },
    dropdown: {
        backgroundColor: '#121826',
        borderWidth: 1,
        borderColor: '#2a2a2a',
        borderRadius: 8,
    },
    dropdownInput: {
        padding: 12,
        color: '#fff',
        fontSize: 14,
    },
    typeButton: {
        flex: 1,
        padding: 12,
        borderRadius: 8,
        backgroundColor: '#121826',
        borderWidth: 1,
        borderColor: '#2a2a2a',
        alignItems: 'center',
    },
    typeButtonActive: {
        backgroundColor: '#ff8c00',
        borderColor: '#ff8c00',
    },
    typeButtonText: {
        color: '#888',
        fontSize: 14,
        fontWeight: '600',
    },
    typeButtonTextActive: {
        color: '#fff',
    },
    checkbox: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 12,
        borderRadius: 8,
        backgroundColor: '#121826',
        borderWidth: 1,
        borderColor: '#2a2a2a',
        marginTop: 16,
    },
    checkboxChecked: {
        backgroundColor: '#4CAF50',
        borderColor: '#4CAF50',
    },
    checkboxText: {
        color: '#fff',
        fontSize: 14,
        fontWeight: '600',
    },
    sectionHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginTop: 24,
        marginBottom: 12,
    },
    sectionTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#fff',
    },
    addButton: {
        backgroundColor: '#ff8c00',
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: 20,
    },
    addButtonText: {
        color: '#fff',
        fontWeight: 'bold',
        fontSize: 14,
    },
    itemForm: {
        backgroundColor: '#121826',
        borderRadius: 12,
        padding: 16,
        marginTop: 12,
        borderWidth: 1,
        borderColor: '#2a2a2a',
    },
    itemHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 12,
    },
    itemNumber: {
        fontSize: 16,
        fontWeight: 'bold',
        color: '#fff',
    },
    removeButton: {
        backgroundColor: '#ef4444',
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 6,
    },
    removeButtonText: {
        color: '#fff',
        fontSize: 12,
        fontWeight: '600',
    },
    emptyText: {
        color: '#888',
        textAlign: 'center',
        marginTop: 20,
        fontSize: 14,
    },
    saveButton: {
        backgroundColor: '#ff8c00',
        padding: 16,
        borderRadius: 8,
        alignItems: 'center',
        marginTop: 24,
        marginBottom: 20,
    },
    saveButtonDisabled: {
        backgroundColor: '#666',
    },
    saveButtonText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: 'bold',
    },
})
