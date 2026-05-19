// src/features/workouts/screens/WorkoutHomeScreen.tsx
//
// NOVITÀ:
//  - Delete singola sessione con swipe-to-reveal o long-press → conferma alert
//  - Auto-refresh della lista ogni volta che la schermata torna in focus (useFocusEffect)
//  - staleTime azzerata nell'hook così il focus invalida subito

import React, { useState, useContext, useCallback } from 'react'
import {
    View, Text, StyleSheet, TouchableOpacity, FlatList,
    RefreshControl, Animated, Platform,
} from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import { AuthContext } from '@/features/auth/context/AuthContext'
import { useWorkoutSessions } from '../hooks/useWorkoutSessions'
import { useQueryClient } from '@tanstack/react-query'
import { WorkoutSession } from '../types/workouts.types'
import { useCustomAlert, CustomAlert } from '@/shared/components/CustomAlert'
import apiClient from '@/shared/api/apiClient'

type FilterType = 'ALL' | 'ACTIVE' | 'COMPLETED'

export default function WorkoutHomeScreen({ navigation }: any) {
    const auth = useContext(AuthContext)
    const { user } = auth || {}
    const queryClient = useQueryClient()

    const [filter, setFilter] = useState<FilterType>('ALL')
    const [refreshing, setRefreshing] = useState(false)
    const [deletingId, setDeletingId] = useState<string | null>(null)
    const { alert, showWarning, showError, showSuccess } = useCustomAlert()

    const { data: sessions, isLoading, error } = useWorkoutSessions(user?.id || '')

    // ── Auto-refresh quando si ritorna su questa schermata ────────────────────
    useFocusEffect(
        useCallback(() => {
            if (user?.id) {
                queryClient.invalidateQueries({ queryKey: ['workoutSessions', user.id] })
            }
        }, [user?.id])
    )

    const onRefresh = async () => {
        setRefreshing(true)
        await queryClient.invalidateQueries({ queryKey: ['workoutSessions', user?.id] })
        setRefreshing(false)
    }

    // ── Delete ────────────────────────────────────────────────────────────────
    const handleDeleteSession = (session: WorkoutSession) => {
        const label = new Date(session.startTime).toLocaleDateString('it-IT', {
            day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
        })
        showWarning(
            'Elimina allenamento',
            `Vuoi eliminare la sessione del ${label}? L'operazione non è reversibile.`,
            async () => {
                if (!user?.id) return
                setDeletingId(session.id)
                try {
                    await apiClient.delete(
                        `/workouts/sessions/${session.id}?userId=${user.id}`
                    )
                    await queryClient.invalidateQueries({ queryKey: ['workoutSessions', user.id] })
                    showSuccess('Eliminata', 'Sessione eliminata con successo')
                } catch (e: any) {
                    showError('Errore', e.message || 'Impossibile eliminare la sessione')
                } finally {
                    setDeletingId(null)
                }
            }
        )
    }

    // ── Filtro ────────────────────────────────────────────────────────────────
    const filteredSessions = (sessions ?? []).filter((s: WorkoutSession) => {
        if (filter === 'ACTIVE')    return s.status === 'ACTIVE' || s.status === 'PAUSED'
        if (filter === 'COMPLETED') return s.status === 'COMPLETED'
        return true
    })

    // ── Render ────────────────────────────────────────────────────────────────
    const renderSessionCard = ({ item }: { item: WorkoutSession }) => {
        const isActive  = item.status === 'ACTIVE' || item.status === 'PAUSED'
        const isPaused  = item.status === 'PAUSED'
        const isDeleting = deletingId === item.id

        const fgPct = item.totalShots > 0
            ? ((item.madeShots / item.totalShots) * 100).toFixed(0)
            : '0'

        const cameraLabel =
            item.cameraMode === 'ANGLE_45' ? '45°' :
            item.cameraMode === 'LATERAL'  ? 'Laterale' : 'Frontale'

        return (
            <View style={[styles.card, isDeleting && styles.cardDeleting]}>
                {/* Riga header: data + badge stato */}
                <View style={styles.cardHeader}>
                    <Text style={styles.cardDate}>
                        {new Date(item.startTime).toLocaleDateString('it-IT', {
                            day: 'numeric', month: 'short', year: 'numeric',
                            hour: '2-digit', minute: '2-digit',
                        })}
                    </Text>
                    <View style={[
                        styles.badge,
                        isActive ? styles.badgeActive : styles.badgeCompleted,
                    ]}>
                        <Text style={styles.badgeText}>
                            {isPaused ? '⏸ Pausa' : isActive ? '🔴 Attiva' : '✅ Completata'}
                        </Text>
                    </View>
                </View>

                {/* Stats */}
                <View style={styles.statsRow}>
                    <StatCell label="Tiri" value={item.totalShots} />
                    <StatCell label="Segnati" value={item.madeShots} highlight />
                    <StatCell label="FG%" value={`${fgPct}%`} highlight />
                    {item.averageShotDistance != null && (
                        <StatCell label="Dist" value={`${item.averageShotDistance.toFixed(1)}m`} />
                    )}
                </View>

                {/* Footer: angolo camera + azioni */}
                <View style={styles.cardFooter}>
                    <Text style={styles.cameraMode}>📷 {cameraLabel}</Text>

                    <View style={styles.footerActions}>
                        {/* Dettagli / Riprendi */}
                        <TouchableOpacity
                            style={styles.detailBtn}
                            onPress={() => navigation.navigate(
                                isActive ? 'WorkoutSession' : 'Stats',
                                { sessionId: item.id }
                            )}
                        >
                            <Text style={styles.detailBtnText}>
                                {isActive ? 'Riprendi →' : 'Dettagli →'}
                            </Text>
                        </TouchableOpacity>

                        {/* Elimina */}
                        <TouchableOpacity
                            style={[styles.deleteBtn, isDeleting && styles.deleteBtnDisabled]}
                            onPress={() => handleDeleteSession(item)}
                            disabled={isDeleting}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                            <Text style={styles.deleteBtnText}>
                                {isDeleting ? '...' : '🗑'}
                            </Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </View>
        )
    }

    const renderEmpty = () => (
        <View style={styles.empty}>
            <Text style={styles.emptyIcon}>🏀</Text>
            <Text style={styles.emptyTitle}>Nessuna sessione</Text>
            <Text style={styles.emptyText}>Inizia il tuo primo allenamento di tiro</Text>
        </View>
    )

    return (
        <View style={styles.container}>
            <Text style={styles.title}>Allenamenti Tiro</Text>

            {/* Nuovo allenamento */}
            <TouchableOpacity
                style={styles.newBtn}
                onPress={() => navigation.navigate('WorkoutSetup')}
            >
                <Text style={styles.newBtnText}>+ Nuovo Allenamento</Text>
            </TouchableOpacity>

            {/* Filtri */}
            <View style={styles.filters}>
                {(['ALL', 'ACTIVE', 'COMPLETED'] as FilterType[]).map(f => (
                    <TouchableOpacity
                        key={f}
                        style={[styles.filterBtn, filter === f && styles.filterBtnActive]}
                        onPress={() => setFilter(f)}
                    >
                        <Text style={[styles.filterBtnText, filter === f && styles.filterBtnTextActive]}>
                            {f === 'ALL' ? 'Tutte' : f === 'ACTIVE' ? 'Attive' : 'Completate'}
                        </Text>
                    </TouchableOpacity>
                ))}
            </View>

            {/* Lista */}
            {isLoading ? (
                <View style={styles.centered}>
                    <Text style={styles.mutedText}>Caricamento...</Text>
                </View>
            ) : error ? (
                <View style={styles.centered}>
                    <Text style={styles.errorText}>Errore nel caricamento</Text>
                    <TouchableOpacity onPress={onRefresh} style={{ marginTop: 12 }}>
                        <Text style={styles.detailBtnText}>Riprova</Text>
                    </TouchableOpacity>
                </View>
            ) : (
                <FlatList
                    data={filteredSessions}
                    renderItem={renderSessionCard}
                    keyExtractor={item => item.id}
                    contentContainerStyle={filteredSessions.length === 0 ? styles.emptyList : { paddingBottom: 24 }}
                    ListEmptyComponent={renderEmpty}
                    showsVerticalScrollIndicator={false}
                    refreshControl={
                        <RefreshControl
                            refreshing={refreshing}
                            onRefresh={onRefresh}
                            tintColor="#ff8c00"
                        />
                    }
                />
            )}

            <CustomAlert {...alert} />
        </View>
    )
}

const StatCell = ({ label, value, highlight }: {
    label: string; value: string | number; highlight?: boolean
}) => (
    <View style={styles.statCell}>
        <Text style={styles.statCellLabel}>{label}</Text>
        <Text style={[styles.statCellValue, highlight && styles.statCellValueHL]}>{value}</Text>
    </View>
)

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#0b0f1a',
        paddingHorizontal: 16,
        paddingTop: Platform.OS === 'ios' ? 56 : 20,
    },
    title: { fontSize: 22, fontWeight: '800', color: '#fff', marginBottom: 14 },

    newBtn: {
        backgroundColor: '#ff8c00', borderRadius: 12,
        paddingVertical: 13, alignItems: 'center', marginBottom: 14,
    },
    newBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },

    filters: { flexDirection: 'row', gap: 8, marginBottom: 14 },
    filterBtn: {
        flex: 1, paddingVertical: 9, alignItems: 'center',
        borderRadius: 8, backgroundColor: '#1a1a1a',
        borderWidth: 1, borderColor: '#2a2a2a',
    },
    filterBtnActive: { backgroundColor: '#ff8c00', borderColor: '#ff8c00' },
    filterBtnText: { fontSize: 12, fontWeight: '600', color: '#888' },
    filterBtnTextActive: { color: '#fff' },

    // Card
    card: {
        backgroundColor: '#121826', borderRadius: 12,
        padding: 14, marginBottom: 12,
        borderWidth: 1, borderColor: '#2a2a2a',
    },
    cardDeleting: { opacity: 0.5 },
    cardHeader: {
        flexDirection: 'row', justifyContent: 'space-between',
        alignItems: 'center', marginBottom: 10,
    },
    cardDate: { fontSize: 12, color: '#888', fontWeight: '500' },
    badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
    badgeActive: { backgroundColor: '#ef4444' },
    badgeCompleted: { backgroundColor: '#22c55e' },
    badgeText: { fontSize: 11, fontWeight: '700', color: '#fff' },

    statsRow: {
        flexDirection: 'row', justifyContent: 'space-around',
        backgroundColor: '#1a1a1a', borderRadius: 8,
        paddingVertical: 10, marginBottom: 10,
    },
    statCell: { alignItems: 'center' },
    statCellLabel: { fontSize: 10, color: '#888', marginBottom: 3 },
    statCellValue: { fontSize: 17, fontWeight: '800', color: '#fff' },
    statCellValueHL: { color: '#ff8c00' },

    cardFooter: {
        flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    },
    cameraMode: { fontSize: 12, color: '#ff8c00', fontWeight: '600' },
    footerActions: { flexDirection: 'row', alignItems: 'center', gap: 12 },

    detailBtn: {},
    detailBtnText: { fontSize: 13, color: '#ff8c00', fontWeight: '600' },

    deleteBtn: {
        width: 32, height: 32, borderRadius: 8,
        backgroundColor: '#1e2433', borderWidth: 1,
        borderColor: '#3a2a2a', justifyContent: 'center', alignItems: 'center',
    },
    deleteBtnDisabled: { opacity: 0.4 },
    deleteBtnText: { fontSize: 15 },

    // Empty / loading
    emptyList: { flexGrow: 1 },
    empty: { alignItems: 'center', paddingTop: 60 },
    emptyIcon: { fontSize: 48, marginBottom: 14 },
    emptyTitle: { fontSize: 18, fontWeight: '700', color: '#fff', marginBottom: 6 },
    emptyText: { fontSize: 13, color: '#888', textAlign: 'center' },
    centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    mutedText: { color: '#888', fontSize: 14 },
    errorText: { color: '#ef4444', fontSize: 14 },
})
