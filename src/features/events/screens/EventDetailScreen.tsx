import React, { useContext, useState } from 'react'
import {
    View, Text, StyleSheet, ScrollView, TouchableOpacity,
    ActivityIndicator, Alert,
} from 'react-native'
import { colors } from '@/shared/theme/colors'
import { globalStyles } from '@/shared/theme/globalStyles'
import { AuthContext } from '@/features/auth/context/AuthContext'
import { useEvent, useJoinEvent, useLeaveEvent, useDeleteEvent, useUpdateRsvp } from '../hooks/useEvents'
import { RsvpStatus, EventParticipant } from '../types/events.types'
import { useCustomAlert, CustomAlert } from '@/shared/components/CustomAlert'

const RSVP_LABELS: Record<RsvpStatus, string> = {
    GOING: '✅ Ci vado',
    MAYBE: '🤔 Forse',
    NOT_GOING: '❌ Non vengo',
    INVITED: '📩 Invitato',
}

function ParticipantRow({ p }: { p: EventParticipant }) {
    return (
        <View style={styles.participantRow}>
            <View style={styles.avatar}>
                <Text style={styles.avatarText}>
                    {(p.userDisplayName ?? '?').charAt(0).toUpperCase()}
                </Text>
            </View>
            <Text style={styles.participantName} numberOfLines={1}>
                {p.userDisplayName ?? 'Utente'}
            </Text>
            <Text style={styles.rsvpLabel}>{RSVP_LABELS[p.rsvpStatus]}</Text>
        </View>
    )
}

export default function EventDetailScreen({ route, navigation }: any) {
    const { id: eventId } = route.params
    const auth = useContext(AuthContext)
    const userId = auth?.user?.id ?? ''

    const { data: event, isLoading, isError } = useEvent(eventId)
    const joinMutation = useJoinEvent(userId)
    const leaveMutation = useLeaveEvent(userId)
    const deleteMutation = useDeleteEvent(userId)
    const updateRsvpMutation = useUpdateRsvp(userId, eventId)
    const { alert, showWarning, showError, showSuccess } = useCustomAlert()

    const [rsvpLoading, setRsvpLoading] = useState(false)

    if (isLoading) {
        return (
            <View style={[globalStyles.container, { justifyContent: 'center', alignItems: 'center' }]}>
                <ActivityIndicator color={colors.primary} size="large" />
            </View>
        )
    }

    if (isError || !event) {
        return (
            <View style={[globalStyles.container, { justifyContent: 'center', alignItems: 'center' }]}>
                <Text style={{ color: '#ef4444', fontSize: 16 }}>Evento non trovato.</Text>
            </View>
        )
    }

    const isCreator = event.creatorId === userId
    const myParticipation = event.participants?.find(p => p.userId === userId)
    const isParticipant = !!myParticipation
    const canJoin = !isParticipant && event.status === 'OPEN'

    const startDate = new Date(event.startsAt)
    const dateLabel = startDate.toLocaleDateString('it-IT', {
        weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
    })
    const timeLabel = startDate.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })

    const handleJoin = async () => {
        try {
            await joinMutation.mutateAsync(eventId)
            showSuccess('Iscritto!', 'Sei stato aggiunto all\'evento.')
        } catch (e: any) {
            showError('Errore', e.message)
        }
    }

    const handleLeave = () => {
        showWarning(
            'Abbandona evento',
            'Sei sicuro di voler abbandonare questo evento?',
            async () => {
                try {
                    await leaveMutation.mutateAsync(eventId)
                } catch (e: any) {
                    showError('Errore', e.message)
                }
            }
        )
    }

    const handleDelete = () => {
        showWarning(
            'Elimina evento',
            'Sei sicuro di voler eliminare questo evento? L\'azione non è reversibile.',
            async () => {
                try {
                    await deleteMutation.mutateAsync(eventId)
                    navigation.goBack()
                } catch (e: any) {
                    showError('Errore', e.message)
                }
            }
        )
    }

    const handleRsvp = async (status: RsvpStatus) => {
        setRsvpLoading(true)
        try {
            await updateRsvpMutation.mutateAsync(status)
        } catch (e: any) {
            showError('Errore', e.message)
        } finally {
            setRsvpLoading(false)
        }
    }

    const goingParticipants = event.participants?.filter(p => p.rsvpStatus === 'GOING') ?? []
    const otherParticipants = event.participants?.filter(p => p.rsvpStatus !== 'GOING') ?? []

    return (
        <View style={globalStyles.container}>
            <CustomAlert {...alert} />
            <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>

                {/* Tipo + stato */}
                <View style={styles.topRow}>
                    <View style={styles.typeBadge}>
                        <Text style={styles.typeBadgeText}>{event.type}</Text>
                    </View>
                    <Text style={[
                        styles.statusText,
                        event.status === 'OPEN' && { color: '#22c55e' },
                        event.status === 'FULL' && { color: '#f59e0b' },
                        event.status === 'CANCELLED' && { color: '#ef4444' },
                    ]}>
                        {event.status}
                    </Text>
                </View>

                {/* Titolo */}
                <Text style={styles.title}>{event.title}</Text>

                {/* Data/ora */}
                <View style={styles.infoBox}>
                    <Text style={styles.infoLabel}>📅 Data</Text>
                    <Text style={styles.infoValue}>{dateLabel} · {timeLabel}</Text>
                </View>

                {/* Location */}
                {event.location && (
                    <View style={styles.infoBox}>
                        <Text style={styles.infoLabel}>📍 Luogo</Text>
                        <Text style={styles.infoValue}>
                            {event.location.name}
                            {event.location.address ? `\n${event.location.address}` : ''}
                            {event.location.city ? `, ${event.location.city}` : ''}
                        </Text>
                    </View>
                )}

                {/* Partecipanti */}
                <View style={styles.infoBox}>
                    <Text style={styles.infoLabel}>👥 Partecipanti</Text>
                    <Text style={styles.infoValue}>
                        {event.participantCount}
                        {event.maxParticipants ? ` / ${event.maxParticipants}` : ''} confermati
                    </Text>
                </View>

                {/* Descrizione */}
                {event.description ? (
                    <View style={styles.descBox}>
                        <Text style={styles.infoLabel}>📝 Note</Text>
                        <Text style={styles.descText}>{event.description}</Text>
                    </View>
                ) : null}

                {/* CTA principale */}
                {!isCreator && (
                    <View style={styles.ctaRow}>
                        {canJoin && (
                            <TouchableOpacity
                                style={styles.joinButton}
                                onPress={handleJoin}
                                disabled={joinMutation.isPending}
                                activeOpacity={0.8}
                            >
                                <Text style={styles.joinButtonText}>
                                    {joinMutation.isPending ? 'Iscrizione...' : '✅ Partecipo'}
                                </Text>
                            </TouchableOpacity>
                        )}
                        {isParticipant && (
                            <TouchableOpacity
                                style={styles.leaveButton}
                                onPress={handleLeave}
                                disabled={leaveMutation.isPending}
                                activeOpacity={0.8}
                            >
                                <Text style={styles.leaveButtonText}>
                                    {leaveMutation.isPending ? '...' : 'Abbandona'}
                                </Text>
                            </TouchableOpacity>
                        )}
                    </View>
                )}

                {/* RSVP update (se già iscritto) */}
                {isParticipant && myParticipation && (
                    <View style={styles.rsvpRow}>
                        <Text style={styles.sectionTitle}>Aggiorna RSVP</Text>
                        <View style={styles.rsvpButtons}>
                            {(['GOING', 'MAYBE', 'NOT_GOING'] as RsvpStatus[]).map(s => (
                                <TouchableOpacity
                                    key={s}
                                    style={[
                                        styles.rsvpButton,
                                        myParticipation.rsvpStatus === s && styles.rsvpButtonActive,
                                    ]}
                                    onPress={() => handleRsvp(s)}
                                    disabled={rsvpLoading}
                                >
                                    <Text style={[
                                        styles.rsvpButtonText,
                                        myParticipation.rsvpStatus === s && styles.rsvpButtonTextActive,
                                    ]}>
                                        {RSVP_LABELS[s]}
                                    </Text>
                                </TouchableOpacity>
                            ))}
                        </View>
                    </View>
                )}

                {/* Azioni creatore */}
                {isCreator && (
                    <View style={styles.creatorActions}>
                        <TouchableOpacity
                            style={styles.editButton}
                            onPress={() => navigation.navigate('EventCreate', { eventId: event.id })}
                            activeOpacity={0.8}
                        >
                            <Text style={styles.editButtonText}>✏️ Modifica</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={styles.deleteButton}
                            onPress={handleDelete}
                            disabled={deleteMutation.isPending}
                            activeOpacity={0.8}
                        >
                            <Text style={styles.deleteButtonText}>
                                {deleteMutation.isPending ? '...' : '🗑 Elimina'}
                            </Text>
                        </TouchableOpacity>
                    </View>
                )}

                {/* Lista partecipanti confermati */}
                {goingParticipants.length > 0 && (
                    <View style={styles.participantsSection}>
                        <Text style={styles.sectionTitle}>Confermati ({goingParticipants.length})</Text>
                        {goingParticipants.map(p => <ParticipantRow key={p.id} p={p} />)}
                    </View>
                )}

                {/* Lista altri (maybe / invited) */}
                {otherParticipants.length > 0 && (
                    <View style={styles.participantsSection}>
                        <Text style={styles.sectionTitle}>In attesa ({otherParticipants.length})</Text>
                        {otherParticipants.map(p => <ParticipantRow key={p.id} p={p} />)}
                    </View>
                )}

            </ScrollView>
        </View>
    )
}

const styles = StyleSheet.create({
    topRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 10,
    },
    typeBadge: {
        backgroundColor: '#1a2540',
        borderRadius: 6,
        paddingHorizontal: 10,
        paddingVertical: 4,
    },
    typeBadgeText: {
        color: colors.primary,
        fontSize: 12,
        fontWeight: '700',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    statusText: {
        fontSize: 13,
        fontWeight: '700',
        color: colors.textSecondary,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    title: {
        fontSize: 22,
        fontWeight: '800',
        color: colors.textPrimary,
        marginBottom: 16,
        lineHeight: 28,
    },
    infoBox: {
        backgroundColor: colors.card,
        borderRadius: 10,
        padding: 12,
        marginBottom: 10,
        borderWidth: 1,
        borderColor: colors.cardBorder,
    },
    infoLabel: {
        color: colors.textSecondary,
        fontSize: 12,
        marginBottom: 3,
        fontWeight: '600',
    },
    infoValue: {
        color: colors.textPrimary,
        fontSize: 14,
        fontWeight: '500',
    },
    descBox: {
        backgroundColor: colors.card,
        borderRadius: 10,
        padding: 12,
        marginBottom: 16,
        borderWidth: 1,
        borderColor: colors.cardBorder,
    },
    descText: {
        color: colors.textPrimary,
        fontSize: 14,
        lineHeight: 20,
    },
    ctaRow: {
        flexDirection: 'row',
        gap: 10,
        marginBottom: 16,
    },
    joinButton: {
        flex: 1,
        backgroundColor: colors.primary,
        borderRadius: 12,
        paddingVertical: 14,
        alignItems: 'center',
    },
    joinButtonText: {
        color: '#fff',
        fontWeight: '700',
        fontSize: 16,
    },
    leaveButton: {
        flex: 1,
        backgroundColor: colors.card,
        borderRadius: 12,
        paddingVertical: 14,
        alignItems: 'center',
        borderWidth: 1,
        borderColor: '#ef4444',
    },
    leaveButtonText: {
        color: '#ef4444',
        fontWeight: '700',
        fontSize: 16,
    },
    rsvpRow: {
        marginBottom: 16,
    },
    rsvpButtons: {
        flexDirection: 'row',
        gap: 8,
        flexWrap: 'wrap',
    },
    rsvpButton: {
        backgroundColor: colors.card,
        borderRadius: 10,
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderWidth: 1,
        borderColor: colors.cardBorder,
    },
    rsvpButtonActive: {
        backgroundColor: colors.primary,
        borderColor: colors.primary,
    },
    rsvpButtonText: {
        color: colors.textSecondary,
        fontSize: 13,
        fontWeight: '600',
    },
    rsvpButtonTextActive: {
        color: '#fff',
    },
    creatorActions: {
        flexDirection: 'row',
        gap: 10,
        marginBottom: 20,
    },
    editButton: {
        flex: 1,
        backgroundColor: colors.card,
        borderRadius: 12,
        paddingVertical: 12,
        alignItems: 'center',
        borderWidth: 1,
        borderColor: colors.primary,
    },
    editButtonText: {
        color: colors.primary,
        fontWeight: '700',
        fontSize: 14,
    },
    deleteButton: {
        flex: 1,
        backgroundColor: colors.card,
        borderRadius: 12,
        paddingVertical: 12,
        alignItems: 'center',
        borderWidth: 1,
        borderColor: '#ef4444',
    },
    deleteButtonText: {
        color: '#ef4444',
        fontWeight: '700',
        fontSize: 14,
    },
    participantsSection: {
        marginTop: 16,
    },
    sectionTitle: {
        fontSize: 16,
        fontWeight: '700',
        color: colors.textPrimary,
        marginBottom: 10,
    },
    participantRow: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.card,
        borderRadius: 10,
        padding: 10,
        marginBottom: 6,
        borderWidth: 1,
        borderColor: colors.cardBorder,
    },
    avatar: {
        width: 34,
        height: 34,
        borderRadius: 17,
        backgroundColor: colors.primary,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 10,
    },
    avatarText: {
        color: '#fff',
        fontWeight: '700',
        fontSize: 14,
    },
    participantName: {
        flex: 1,
        color: colors.textPrimary,
        fontSize: 14,
        fontWeight: '500',
    },
    rsvpLabel: {
        color: colors.textSecondary,
        fontSize: 12,
    },
})
