import React, { useState, useContext } from 'react'
import {
    View, Text, StyleSheet, FlatList, TouchableOpacity,
    RefreshControl, ActivityIndicator,
} from 'react-native'
import { globalStyles } from '@/shared/theme/globalStyles'
import { colors } from '@/shared/theme/colors'
import { AuthContext } from '@/features/auth/context/AuthContext'
import { useUpcomingEvents, useEventsByParticipant } from '../hooks/useEvents'
import { useQueryClient } from '@tanstack/react-query'
import { Event, EventType } from '../types/events.types'

type FilterTab = 'upcoming' | 'mine'
type TypeFilter = 'ALL' | EventType

const TYPE_LABELS: Record<TypeFilter, string> = {
    ALL: 'Tutti',
    PICKUP: 'Partite',
    TRAINING: 'Allenamenti',
    TOURNAMENT: 'Tornei',
    SOCIAL: 'Ritrovi',
}

const STATUS_COLORS: Record<string, string> = {
    OPEN: '#22c55e',
    FULL: '#f59e0b',
    CANCELLED: '#ef4444',
    COMPLETED: '#6b7280',
    DRAFT: '#6b7280',
}

function EventCard({ event, onPress }: { event: Event; onPress: () => void }) {
    const date = new Date(event.startsAt)
    const dateLabel = date.toLocaleDateString('it-IT', {
        weekday: 'short', day: '2-digit', month: 'short',
    })
    const timeLabel = date.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })

    return (
        <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.75}>
            <View style={styles.cardHeader}>
                <View style={styles.typeBadge}>
                    <Text style={styles.typeBadgeText}>{TYPE_LABELS[event.type as TypeFilter] ?? event.type}</Text>
                </View>
                <View style={[styles.statusDot, { backgroundColor: STATUS_COLORS[event.status] ?? '#888' }]} />
            </View>

            <Text style={styles.cardTitle} numberOfLines={2}>{event.title}</Text>

            <View style={styles.cardMeta}>
                <Text style={styles.cardMetaText}>🗓 {dateLabel} · {timeLabel}</Text>
                {event.location && (
                    <Text style={styles.cardMetaText} numberOfLines={1}>
                        📍 {event.location.name}
                        {event.location.city ? `, ${event.location.city}` : ''}
                    </Text>
                )}
            </View>

            <View style={styles.cardFooter}>
                <Text style={styles.participantCount}>
                    👤 {event.participantCount}
                    {event.maxParticipants ? `/${event.maxParticipants}` : ''} partecipanti
                </Text>
                {event.status === 'FULL' && (
                    <Text style={styles.fullBadge}>AL COMPLETO</Text>
                )}
            </View>
        </TouchableOpacity>
    )
}

export default function EventsHomeScreen({ navigation }: any) {
    const auth = useContext(AuthContext)
    const userId = auth?.user?.id ?? ''
    const qc = useQueryClient()

    const [activeTab, setActiveTab] = useState<FilterTab>('upcoming')
    const [typeFilter, setTypeFilter] = useState<TypeFilter>('ALL')
    const [refreshing, setRefreshing] = useState(false)

    const typeParam = typeFilter === 'ALL' ? undefined : typeFilter

    const upcoming = useUpcomingEvents(typeParam)
    const myEvents = useEventsByParticipant(userId)

    const activeQuery = activeTab === 'upcoming' ? upcoming : myEvents
    const events: Event[] = activeQuery.data ?? []

    const onRefresh = async () => {
        setRefreshing(true)
        await qc.invalidateQueries({ queryKey: ['events'] })
        setRefreshing(false)
    }

    return (
        <View style={globalStyles.container}>
            {/* Header */}
            <View style={styles.header}>
                <Text style={styles.headerTitle}>Eventi</Text>
                <TouchableOpacity
                    style={styles.createButton}
                    onPress={() => navigation.navigate('EventCreate')}
                    activeOpacity={0.8}
                >
                    <Text style={styles.createButtonText}>+ Crea</Text>
                </TouchableOpacity>
            </View>

            {/* Tab: Upcoming / I miei */}
            <View style={styles.tabRow}>
                {(['upcoming', 'mine'] as FilterTab[]).map(tab => (
                    <TouchableOpacity
                        key={tab}
                        style={[styles.tab, activeTab === tab && styles.tabActive]}
                        onPress={() => setActiveTab(tab)}
                    >
                        <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>
                            {tab === 'upcoming' ? 'Prossimi' : 'I miei'}
                        </Text>
                    </TouchableOpacity>
                ))}
            </View>

            {/* Filtro tipo (solo su upcoming) */}
            {activeTab === 'upcoming' && (
                <View style={styles.typeFilterRow}>
                    {(Object.keys(TYPE_LABELS) as TypeFilter[]).map(t => (
                        <TouchableOpacity
                            key={t}
                            style={[styles.typeChip, typeFilter === t && styles.typeChipActive]}
                            onPress={() => setTypeFilter(t)}
                        >
                            <Text style={[styles.typeChipText, typeFilter === t && styles.typeChipTextActive]}>
                                {TYPE_LABELS[t]}
                            </Text>
                        </TouchableOpacity>
                    ))}
                </View>
            )}

            {/* Lista */}
            {activeQuery.isLoading ? (
                <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
            ) : activeQuery.isError ? (
                <Text style={styles.errorText}>Impossibile caricare gli eventi.</Text>
            ) : (
                <FlatList
                    data={events}
                    keyExtractor={e => e.id}
                    renderItem={({ item }) => (
                        <EventCard
                            event={item}
                            onPress={() => navigation.navigate('EventDetail', { id: item.id })}
                        />
                    )}
                    contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
                    refreshControl={
                        <RefreshControl
                            refreshing={refreshing}
                            onRefresh={onRefresh}
                            tintColor={colors.primary}
                        />
                    }
                    ListEmptyComponent={
                        <Text style={styles.emptyText}>
                            {activeTab === 'upcoming'
                                ? 'Nessun evento in programma.'
                                : 'Non sei iscritto a nessun evento.'}
                        </Text>
                    }
                />
            )}
        </View>
    )
}

const styles = StyleSheet.create({
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingTop: 16,
        paddingBottom: 8,
    },
    headerTitle: {
        fontSize: 24,
        fontWeight: '700',
        color: colors.textPrimary,
    },
    createButton: {
        backgroundColor: colors.primary,
        paddingHorizontal: 14,
        paddingVertical: 7,
        borderRadius: 20,
    },
    createButtonText: {
        color: '#fff',
        fontWeight: '700',
        fontSize: 14,
    },
    tabRow: {
        flexDirection: 'row',
        marginHorizontal: 16,
        marginBottom: 8,
        backgroundColor: colors.card,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: colors.cardBorder,
        overflow: 'hidden',
    },
    tab: {
        flex: 1,
        paddingVertical: 10,
        alignItems: 'center',
    },
    tabActive: {
        backgroundColor: colors.primary,
    },
    tabText: {
        color: colors.textSecondary,
        fontWeight: '600',
        fontSize: 14,
    },
    tabTextActive: {
        color: '#fff',
    },
    typeFilterRow: {
        flexDirection: 'row',
        paddingHorizontal: 16,
        marginBottom: 4,
        gap: 8,
    },
    typeChip: {
        paddingHorizontal: 12,
        paddingVertical: 5,
        borderRadius: 16,
        backgroundColor: colors.card,
        borderWidth: 1,
        borderColor: colors.cardBorder,
    },
    typeChipActive: {
        backgroundColor: colors.primary,
        borderColor: colors.primary,
    },
    typeChipText: {
        color: colors.textSecondary,
        fontSize: 12,
        fontWeight: '600',
    },
    typeChipTextActive: {
        color: '#fff',
    },
    card: {
        backgroundColor: colors.card,
        borderRadius: 14,
        padding: 16,
        marginBottom: 12,
        borderWidth: 1,
        borderColor: colors.cardBorder,
    },
    cardHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 8,
    },
    typeBadge: {
        backgroundColor: '#1a2540',
        borderRadius: 6,
        paddingHorizontal: 8,
        paddingVertical: 3,
    },
    typeBadgeText: {
        color: colors.primary,
        fontSize: 11,
        fontWeight: '700',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    statusDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
    },
    cardTitle: {
        fontSize: 16,
        fontWeight: '700',
        color: colors.textPrimary,
        marginBottom: 8,
    },
    cardMeta: {
        gap: 3,
        marginBottom: 10,
    },
    cardMetaText: {
        color: colors.textSecondary,
        fontSize: 13,
    },
    cardFooter: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    participantCount: {
        color: colors.textSecondary,
        fontSize: 12,
    },
    fullBadge: {
        color: '#f59e0b',
        fontSize: 11,
        fontWeight: '700',
        letterSpacing: 0.5,
    },
    emptyText: {
        color: colors.textSecondary,
        textAlign: 'center',
        marginTop: 48,
        fontSize: 15,
    },
    errorText: {
        color: '#ef4444',
        textAlign: 'center',
        marginTop: 48,
        fontSize: 15,
    },
})
