import React, { useState, useContext } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, FlatList, RefreshControl } from 'react-native'
import { globalStyles } from '@/shared/theme/globalStyles'
import { AuthContext } from '@/features/auth/context/AuthContext'
import { useWorkoutSessions } from '../hooks/useWorkoutSessions'
import { useQueryClient } from '@tanstack/react-query'
import { WorkoutSession, SessionStatus } from '../types/workouts.types'
import { useCustomAlert, CustomAlert } from '@/shared/components/CustomAlert'

type FilterType = 'ALL' | 'ACTIVE' | 'COMPLETED'

export default function WorkoutHomeScreen({ navigation }: any) {
    const auth = useContext(AuthContext)
    const [filter, setFilter] = useState<FilterType>('ALL')
    const { user } = auth || {}

    const queryClient = useQueryClient()
    const { data: sessions, isLoading, error } = useWorkoutSessions(user?.id || '')

    const [refreshing, setRefreshing] = useState(false)
    const { alert, showWarning, showError, showSuccess } = useCustomAlert()

    const onRefresh = async () => {
        setRefreshing(true)
        await queryClient.invalidateQueries({ queryKey: ['workoutSessions'] })
        setRefreshing(false)
    }

    // Filtra le sessioni in base allo stato
    const filteredSessions = sessions?.filter((session: WorkoutSession) => {
        if (filter === 'ALL') return true
        if (filter === 'ACTIVE') return session.status === 'ACTIVE' || session.status === 'PAUSED'
        if (filter === 'COMPLETED') return session.status === 'COMPLETED'
        return true
    }) || []

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

    const renderSessionCard = ({ item }: { item: WorkoutSession }) => {
        const isActive = item.status === 'ACTIVE' || item.status === 'PAUSED'
        const isPaused = item.status === 'PAUSED'

        return (
            <TouchableOpacity
                style={styles.sessionCard}
                onPress={() => navigation.navigate('WorkoutSession', { sessionId: item.id })}
            >
                <View style={styles.cardHeader}>
                    <Text style={styles.sessionDate}>
                        {new Date(item.startTime).toLocaleDateString('it-IT', {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                        })}
                    </Text>
                    <View style={[
                        styles.statusBadge,
                        isActive && styles.statusBadgeActive,
                        item.status === 'COMPLETED' && styles.statusBadgeCompleted
                    ]}>
                        <Text style={[
                            styles.statusText,
                            isActive && styles.statusTextActive,
                            item.status === 'COMPLETED' && styles.statusTextCompleted
                        ]}>
                            {isPaused ? '⏸️ In Pausa' : isActive ? '🔴 Attiva' : '✅ Completata'}
                        </Text>
                    </View>
                </View>

                <View style={styles.statsRow}>
                    <View style={styles.statItem}>
                        <Text style={styles.statLabel}>Tiri</Text>
                        <Text style={styles.statValue}>{item.totalShots}</Text>
                    </View>
                    <View style={styles.statItem}>
                        <Text style={styles.statLabel}>Segnati</Text>
                        <Text style={styles.statValue}>{item.madeShots}</Text>
                    </View>
                    <View style={styles.statItem}>
                        <Text style={styles.statLabel}>%</Text>
                        <Text style={styles.statValue}>{item.shootingPercentage?.toFixed(0) || 0}%</Text>
                    </View>
                </View>

                <View style={styles.cardFooter}>
                    <Text style={styles.cameraMode}>
                        📷 {item.cameraMode === 'ANGLE_45' ? '45°' : item.cameraMode === 'LATERAL' ? 'Laterale' : 'Frontale'}
                    </Text>
                    <TouchableOpacity onPress={() => navigation.navigate('Stats', { sessionId: item.id })}>
                        <Text style={styles.viewDetails}>Vedi dettagli →</Text>
                    </TouchableOpacity>
                </View>
            </TouchableOpacity>
        )
    }

    const renderEmptyState = () => (
        <View style={styles.emptyState}>
            <Text style={styles.emptyStateIcon}>🏀</Text>
            <Text style={styles.emptyStateTitle}>Nessuna sessione</Text>
            <Text style={styles.emptyStateText}>
                Inizia il tuo primo allenamento di tiro
            </Text>
        </View>
    )

    return (
        <View style={styles.container}>
            <Text style={styles.title}>Allenamenti Tiro</Text>

            {/* Pulsante Crea */}
            <TouchableOpacity
                style={[globalStyles.button, styles.createButton]}
                onPress={() => navigation.navigate('WorkoutSetup')}
            >
                <Text style={globalStyles.buttonText}>+ Nuovo Allenamento</Text>
            </TouchableOpacity>

            {/* Filtri */}
            <View style={styles.filterContainer}>
                {renderFilterButton('ALL', 'Tutte')}
                {renderFilterButton('ACTIVE', 'Attive')}
                {renderFilterButton('COMPLETED', 'Completate')}
            </View>

            {/* Lista Sessioni */}
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
                    data={filteredSessions}
                    renderItem={renderSessionCard}
                    keyExtractor={(item) => item.id}
                    contentContainerStyle={filteredSessions.length === 0 ? styles.emptyList : undefined}
                    ListEmptyComponent={renderEmptyState}
                    showsVerticalScrollIndicator={false}
                    refreshControl={
                        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
                    }
                />
            )}
            <CustomAlert {...alert} />
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
    createButton: {
        marginBottom: 15,
        backgroundColor: '#ff8c00',
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
    sessionCard: {
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
        marginBottom: 12,
    },
    sessionDate: {
        fontSize: 12,
        color: '#888',
        fontWeight: '500',
    },
    statusBadge: {
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 6,
        backgroundColor: '#2a2a2a',
    },
    statusBadgeActive: {
        backgroundColor: '#ef4444',
    },
    statusBadgeCompleted: {
        backgroundColor: '#22c55e',
    },
    statusText: {
        fontSize: 11,
        fontWeight: '600',
        color: '#888',
    },
    statusTextActive: {
        color: '#fff',
    },
    statusTextCompleted: {
        color: '#fff',
    },
    statsRow: {
        flexDirection: 'row',
        justifyContent: 'space-around',
        marginBottom: 12,
        paddingVertical: 10,
        backgroundColor: '#1a1a1a',
        borderRadius: 8,
    },
    statItem: {
        alignItems: 'center',
    },
    statLabel: {
        fontSize: 11,
        color: '#888',
        marginBottom: 4,
    },
    statValue: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#fff',
    },
    cardFooter: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    cameraMode: {
        fontSize: 12,
        color: '#ff8c00',
        fontWeight: '600',
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
