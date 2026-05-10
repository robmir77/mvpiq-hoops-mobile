import React, { useState, useContext } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, FlatList, RefreshControl } from 'react-native'
import { globalStyles } from '@/shared/theme/globalStyles'
import { AuthContext } from '@/features/auth/context/AuthContext'
import { useJournalEntries } from '../hooks/useJournalEntries'
import { EntryType } from '../types/journal.types'
import { useQueryClient } from '@tanstack/react-query'

type FilterType = 'ALL' | 'MATCH' | 'TRAINING'

export default function JournalHomeScreen({ navigation }: any) {
    const auth = useContext(AuthContext)
    const [filter, setFilter] = useState<FilterType>('ALL')
    const { user } = auth || {}

    const entryTypeFilter = filter === 'ALL' ? undefined : filter
    const queryClient = useQueryClient()

    const { data: entries, isLoading, error } = useJournalEntries(user?.id || '', entryTypeFilter)

    const [refreshing, setRefreshing] = useState(false)

    const onRefresh = async () => {
        setRefreshing(true)
        await queryClient.invalidateQueries({ queryKey: ['journalEntries'] })
        setRefreshing(false)
    }

    const renderFilterButton = (type: FilterType, label: string) => (
        <TouchableOpacity
            style={[
                styles.filterButton,
                filter === type && styles.filterButtonActive
            ]}
            onPress={() => setFilter(type)}
        >
            <Text style={[
                styles.filterButtonText,
                filter === type && styles.filterButtonTextActive
            ]}>
                {label}
            </Text>
        </TouchableOpacity>
    )

    const renderEntryCard = ({ item }: any) => (
        <TouchableOpacity
            style={styles.entryCard}
            onPress={() => navigation.navigate('JournalDetail', { id: item.id })}
        >
            <View style={styles.cardHeader}>
                <Text style={styles.entryDate}>
                    {item.createdAt ? new Date(item.createdAt).toLocaleDateString('it-IT', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric'
                    }) : 'Data non disponibile'}
                </Text>
                <Text style={styles.entryType}>
                    {item.entryType === 'MATCH' ? '⚽ Partita' : '🏋️ Allenamento'}
                </Text>
            </View>
            <Text style={styles.entryTitle}>
                {item.entryType === 'MATCH' ? 'Diario Partita' : 'Diario Allenamento'}
            </Text>
            {item.summary && (
                <Text style={styles.entrySummary} numberOfLines={2}>
                    {item.summary}
                </Text>
            )}
            <Text style={styles.viewDetails}>Vedi dettagli →</Text>
        </TouchableOpacity>
    )

    const renderEmptyState = () => (
        <View style={styles.emptyState}>
            <Text style={styles.emptyStateIcon}>📝</Text>
            <Text style={styles.emptyStateTitle}>Nessun diario creato</Text>
            <Text style={styles.emptyStateText}>
                Crea il tuo primo diario partita o allenamento
            </Text>
        </View>
    )

    return (
        <View style={styles.container}>
            <Text style={styles.title}>Diario</Text>

            {/* Pulsanti Crea */}
            <View style={styles.createButtons}>
                <TouchableOpacity
                    style={[globalStyles.button, styles.createButton]}
                    onPress={() =>
                        navigation.navigate('JournalCreate', { entryType: 'MATCH' })
                    }
                >
                    <Text style={globalStyles.buttonText}>+ Partita</Text>
                </TouchableOpacity>

                <TouchableOpacity
                    style={[globalStyles.button, styles.createButton, styles.trainingButton]}
                    onPress={() =>
                        navigation.navigate('JournalCreate', { entryType: 'TRAINING' })
                    }
                >
                    <Text style={globalStyles.buttonText}>+ Allenamento</Text>
                </TouchableOpacity>
            </View>

            {/* Filtri */}
            <View style={styles.filterContainer}>
                {renderFilterButton('ALL', 'Tutte')}
                {renderFilterButton('MATCH', 'Partite')}
                {renderFilterButton('TRAINING', 'Allenamenti')}
            </View>

            {/* Lista Storico */}
            {isLoading ? (
                <View style={styles.loadingContainer}>
                    <Text style={styles.loadingText}>Caricamento...</Text>
                </View>
            ) : error ? (
                <View style={styles.errorContainer}>
                    <Text style={styles.errorText}>Errore nel caricamento</Text>
                </View>
            ) : (
                <FlatList
                    data={entries || []}
                    renderItem={renderEntryCard}
                    keyExtractor={(item) => item.id}
                    contentContainerStyle={entries?.length === 0 ? styles.emptyList : undefined}
                    ListEmptyComponent={renderEmptyState}
                    showsVerticalScrollIndicator={false}
                    refreshControl={
                        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
                    }
                />
            )}
        </View>
    )
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#0b0f1a',
        padding: 20,
    },
    title: {
        fontSize: 22,
        fontWeight: 'bold',
        color: 'white',
        marginBottom: 15,
    },
    filterContainer: {
        flexDirection: 'row',
        marginBottom: 15,
        gap: 8,
    },
    filterButton: {
        flex: 1,
        paddingVertical: 10,
        paddingHorizontal: 15,
        borderRadius: 8,
        backgroundColor: '#1a1a1a',
        borderWidth: 1,
        borderColor: '#2a2a2a',
        alignItems: 'center',
    },
    filterButtonActive: {
        backgroundColor: '#ff8c00',
        borderColor: '#ff8c00',
    },
    filterButtonText: {
        fontSize: 12,
        fontWeight: '600',
        color: '#888',
    },
    filterButtonTextActive: {
        color: '#fff',
    },
    createButtons: {
        flexDirection: 'row',
        gap: 10,
        marginBottom: 15,
    },
    createButton: {
        flex: 1,
    },
    trainingButton: {
        backgroundColor: '#f97316',
    },
    entryCard: {
        backgroundColor: '#121826',
        borderRadius: 12,
        padding: 15,
        marginBottom: 12,
        borderWidth: 1,
        borderColor: '#2a2a2a',
    },
    cardHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 8,
    },
    entryDate: {
        fontSize: 12,
        color: '#888',
        fontWeight: '500',
    },
    entryType: {
        fontSize: 12,
        color: '#ff8c00',
        fontWeight: '600',
    },
    entryTitle: {
        fontSize: 16,
        fontWeight: 'bold',
        color: '#fff',
        marginBottom: 6,
    },
    entrySummary: {
        fontSize: 14,
        color: '#aaa',
        marginBottom: 8,
        lineHeight: 20,
    },
    viewDetails: {
        fontSize: 13,
        color: '#ff8c00',
        fontWeight: '600',
    },
    emptyState: {
        alignItems: 'center',
        paddingVertical: 40,
    },
    emptyStateIcon: {
        fontSize: 48,
        marginBottom: 15,
    },
    emptyStateTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#fff',
        marginBottom: 8,
    },
    emptyStateText: {
        fontSize: 14,
        color: '#888',
        textAlign: 'center',
    },
    emptyList: {
        flexGrow: 1,
    },
    loadingContainer: {
        alignItems: 'center',
        paddingVertical: 40,
    },
    loadingText: {
        color: '#888',
        fontSize: 14,
    },
    errorContainer: {
        alignItems: 'center',
        paddingVertical: 40,
    },
    errorText: {
        color: '#ef4444',
        fontSize: 14,
    },
})