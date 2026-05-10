import React, { useContext } from 'react'
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    TouchableOpacity,
    ActivityIndicator,
    Alert,
    RefreshControl,
} from 'react-native'
import { useNavigation } from '@react-navigation/native'
import { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { useChecklistTemplates, useDeleteChecklistTemplate } from '../hooks/useChecklistTemplates'
import { ChecklistTemplate } from '../types/checklist-templates.types'
import { AuthContext } from '@/features/auth/context/AuthContext'

type NavigationProp = NativeStackNavigationProp<any>

const TemplateCard = ({ template, onPress, onEdit, onDelete }: {
    template: ChecklistTemplate
    onPress: () => void
    onEdit: () => void
    onDelete: () => void
}) => {
    const getEntryTypeLabel = (type: string) => {
        return type === 'MATCH' ? '⚽ Partita' : '🏋️ Allenamento'
    }

    return (
        <TouchableOpacity style={styles.templateCard} onPress={onPress}>
            <View style={styles.cardHeader}>
                <Text style={styles.templateName}>{template.name}</Text>
                <View style={[styles.statusBadge, { backgroundColor: template.isActive ? '#4CAF50' : '#666' }]}>
                    <Text style={styles.statusText}>{template.isActive ? 'Attivo' : 'Inattivo'}</Text>
                </View>
            </View>
            <View style={styles.cardInfo}>
                <Text style={styles.infoLabel}>{getEntryTypeLabel(template.entryType)}</Text>
                <Text style={styles.infoLabel}>Codice: {template.code}</Text>
            </View>
            <View style={styles.cardFooter}>
                <Text style={styles.itemCount}>{template.items?.length || 0} item</Text>
                <View style={styles.cardActions}>
                    <TouchableOpacity style={styles.actionButton} onPress={onEdit}>
                        <Text style={styles.actionButtonText}>Modifica</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.actionButton, styles.deleteButton]} onPress={onDelete}>
                        <Text style={styles.actionButtonText}>Elimina</Text>
                    </TouchableOpacity>
                </View>
            </View>
        </TouchableOpacity>
    )
}

export default function ChecklistTemplatesAdminScreen() {
    const navigation = useNavigation<NavigationProp>()
    const auth = useContext(AuthContext)
    const { data: templates, isLoading, isError, refetch } = useChecklistTemplates()
    const deleteMutation = useDeleteChecklistTemplate()

    const handleCreateTemplate = () => {
        navigation.navigate('ChecklistTemplateEdit' as any)
    }

    const handleEditTemplate = (template: ChecklistTemplate) => {
        navigation.navigate('ChecklistTemplateEdit' as any, { templateId: template.id })
    }

    const handleDeleteTemplate = (template: ChecklistTemplate) => {
        Alert.alert(
            'Conferma Eliminazione',
            `Sei sicuro di voler eliminare il template "${template.name}"?`,
            [
                { text: 'Annulla', style: 'cancel' },
                {
                    text: 'Elimina',
                    style: 'destructive',
                    onPress: async () => {
                        try {
                            await deleteMutation.mutateAsync(template.id)
                            Alert.alert('Successo', 'Template eliminato con successo')
                        } catch (error: any) {
                            Alert.alert('Errore', error.message || 'Impossibile eliminare il template')
                        }
                    }
                }
            ]
        )
    }

    if (isLoading) {
        return (
            <View style={styles.center}>
                <ActivityIndicator size="large" color="#ff8c00" />
                <Text style={styles.loadingText}>Caricamento template...</Text>
            </View>
        )
    }

    if (isError) {
        return (
            <View style={styles.center}>
                <Text style={styles.errorText}>Errore caricamento template</Text>
                <TouchableOpacity style={styles.retryButton} onPress={() => refetch()}>
                    <Text style={styles.retryText}>Riprova</Text>
                </TouchableOpacity>
            </View>
        )
    }

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <Text style={styles.headerTitle}>Configurazione Checklist</Text>
                <TouchableOpacity style={styles.createButton} onPress={handleCreateTemplate}>
                    <Text style={styles.createButtonText}>+ Nuovo Template</Text>
                </TouchableOpacity>
            </View>

            <ScrollView
                style={styles.scrollView}
                refreshControl={
                    <RefreshControl refreshing={isLoading} onRefresh={refetch} />
                }
            >
                {!templates || templates.length === 0 ? (
                    <View style={styles.emptyState}>
                        <Text style={styles.emptyTitle}>Nessun template</Text>
                        <Text style={styles.emptyDescription}>
                            Crea il tuo primo template checklist per partite o allenamenti
                        </Text>
                        <TouchableOpacity style={styles.createFirstButton} onPress={handleCreateTemplate}>
                            <Text style={styles.createFirstButtonText}>Crea Template</Text>
                        </TouchableOpacity>
                    </View>
                ) : (
                    templates.map((template) => (
                        <TemplateCard
                            key={template.id}
                            template={template}
                            onPress={() => handleEditTemplate(template)}
                            onEdit={() => handleEditTemplate(template)}
                            onDelete={() => handleDeleteTemplate(template)}
                        />
                    ))
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
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 20,
        borderBottomWidth: 1,
        borderBottomColor: '#2a2a2a',
    },
    headerTitle: {
        fontSize: 24,
        fontWeight: 'bold',
        color: '#fff',
    },
    createButton: {
        backgroundColor: '#ff8c00',
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: 20,
    },
    createButtonText: {
        color: '#fff',
        fontWeight: 'bold',
        fontSize: 14,
    },
    scrollView: {
        flex: 1,
    },
    templateCard: {
        backgroundColor: '#121826',
        margin: 10,
        padding: 16,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#2a2a2a',
    },
    cardHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 8,
    },
    templateName: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#fff',
        flex: 1,
    },
    statusBadge: {
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 12,
    },
    statusText: {
        color: '#fff',
        fontSize: 12,
        fontWeight: 'bold',
    },
    cardInfo: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 12,
    },
    infoLabel: {
        color: '#888',
        fontSize: 12,
    },
    cardFooter: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderTopWidth: 1,
        borderTopColor: '#2a2a2a',
        paddingTop: 12,
    },
    itemCount: {
        color: '#888',
        fontSize: 12,
    },
    cardActions: {
        flexDirection: 'row',
        gap: 8,
    },
    actionButton: {
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 6,
        backgroundColor: '#2a2a2a',
    },
    deleteButton: {
        backgroundColor: '#ef4444',
    },
    actionButtonText: {
        color: '#fff',
        fontSize: 12,
        fontWeight: '600',
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
    errorText: {
        color: '#ff4444',
        fontSize: 16,
        marginBottom: 20,
    },
    retryButton: {
        backgroundColor: '#ff8c00',
        paddingHorizontal: 20,
        paddingVertical: 10,
        borderRadius: 8,
    },
    retryText: {
        color: '#fff',
        fontWeight: 'bold',
    },
    emptyState: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingVertical: 60,
    },
    emptyTitle: {
        fontSize: 20,
        fontWeight: 'bold',
        color: '#fff',
        marginBottom: 8,
    },
    emptyDescription: {
        color: '#888',
        textAlign: 'center',
        marginBottom: 20,
        paddingHorizontal: 40,
    },
    createFirstButton: {
        backgroundColor: '#ff8c00',
        paddingHorizontal: 24,
        paddingVertical: 12,
        borderRadius: 8,
    },
    createFirstButtonText: {
        color: '#fff',
        fontWeight: 'bold',
        fontSize: 16,
    },
})
