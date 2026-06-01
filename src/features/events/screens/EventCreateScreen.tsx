import React, { useContext, useState, useEffect } from 'react'
import {
    View, Text, StyleSheet, ScrollView, TextInput,
    TouchableOpacity, ActivityIndicator, Switch, Platform,
} from 'react-native'
import DateTimePicker from '@react-native-community/datetimepicker'
import { colors } from '@/shared/theme/colors'
import { globalStyles } from '@/shared/theme/globalStyles'
import { AuthContext } from '@/features/auth/context/AuthContext'
import { useCreateEvent, useUpdateEvent, useLocations, useEvent } from '../hooks/useEvents'
import { EventType, EventVisibility, CreateEventPayload } from '../types/events.types'
import { useCustomAlert, CustomAlert } from '@/shared/components/CustomAlert'

const EVENT_TYPES: { value: EventType; label: string; emoji: string }[] = [
    { value: 'PICKUP',     label: 'Partita al campetto', emoji: '🏀' },
    { value: 'TRAINING',   label: 'Allenamento gruppo',  emoji: '💪' },
    { value: 'TOURNAMENT', label: 'Torneo',               emoji: '🏆' },
    { value: 'SOCIAL',     label: 'Ritrovo',              emoji: '🤝' },
]

const VISIBILITY_OPTIONS: { value: EventVisibility; label: string; desc: string }[] = [
    { value: 'PUBLIC',  label: 'Pubblico',  desc: 'Visibile a tutti' },
    { value: 'FRIENDS', label: 'Amici',     desc: 'Solo chi segui' },
    { value: 'PRIVATE', label: 'Privato',   desc: 'Solo invitati' },
]

export default function EventCreateScreen({ route, navigation }: any) {
    const editEventId: string | undefined = route?.params?.eventId
    const isEdit = !!editEventId

    const auth = useContext(AuthContext)
    const userId = auth?.user?.id ?? ''
    const { alert, showError, showSuccess } = useCustomAlert()

    // Form state
    const [type, setType]                     = useState<EventType>('PICKUP')
    const [title, setTitle]                   = useState('')
    const [description, setDescription]       = useState('')
    const [startsAt, setStartsAt]             = useState(new Date(Date.now() + 3600_000))
    const [hasEndDate, setHasEndDate]         = useState(false)
    const [endsAt, setEndsAt]                 = useState(new Date(Date.now() + 7200_000))
    const [maxParticipants, setMaxParticipants] = useState('')
    const [visibility, setVisibility]         = useState<EventVisibility>('PUBLIC')
    const [locationId, setLocationId]         = useState<string | undefined>()

    // Date picker
    const [showStartPicker, setShowStartPicker] = useState(false)
    const [showEndPicker, setShowEndPicker]     = useState(false)

    // Locations
    const { data: locations = [] } = useLocations()
    const { data: existingEvent }  = useEvent(editEventId ?? '')

    // Mutations
    const createMutation = useCreateEvent(userId)
    const updateMutation = useUpdateEvent(userId, editEventId ?? '')

    // Pre-fill form in edit mode
    useEffect(() => {
        if (isEdit && existingEvent) {
            setType(existingEvent.type)
            setTitle(existingEvent.title)
            setDescription(existingEvent.description ?? '')
            setStartsAt(new Date(existingEvent.startsAt))
            if (existingEvent.endsAt) {
                setHasEndDate(true)
                setEndsAt(new Date(existingEvent.endsAt))
            }
            setMaxParticipants(existingEvent.maxParticipants?.toString() ?? '')
            setVisibility(existingEvent.visibility)
            setLocationId(existingEvent.locationId)
        }
    }, [existingEvent])

    const handleSave = async () => {
        if (!title.trim()) {
            showError('Titolo mancante', 'Inserisci un titolo per l\'evento.')
            return
        }

        const payload: CreateEventPayload = {
            type,
            title: title.trim(),
            description: description.trim() || undefined,
            startsAt: startsAt.toISOString(),
            endsAt: hasEndDate ? endsAt.toISOString() : undefined,
            maxParticipants: maxParticipants ? parseInt(maxParticipants, 10) : undefined,
            visibility,
            locationId,
        }

        try {
            if (isEdit) {
                await updateMutation.mutateAsync(payload)
                showSuccess('Salvato!', 'Evento aggiornato con successo.')
                setTimeout(() => navigation.goBack(), 800)
            } else {
                const created = await createMutation.mutateAsync(payload)
                navigation.replace('EventDetail', { id: created.id })
            }
        } catch (e: any) {
            showError('Errore', e.message)
        }
    }

    const isSaving = createMutation.isPending || updateMutation.isPending

    const formatDate = (d: Date) =>
        d.toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' }) +
        ' ' + d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })

    return (
        <View style={globalStyles.container}>
            <CustomAlert {...alert} />
            <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }}>
                <Text style={styles.screenTitle}>{isEdit ? 'Modifica evento' : 'Crea evento'}</Text>

                {/* Tipo */}
                <Text style={styles.label}>Tipo evento *</Text>
                <View style={styles.typeGrid}>
                    {EVENT_TYPES.map(t => (
                        <TouchableOpacity
                            key={t.value}
                            style={[styles.typeCard, type === t.value && styles.typeCardActive]}
                            onPress={() => setType(t.value)}
                            activeOpacity={0.75}
                        >
                            <Text style={styles.typeEmoji}>{t.emoji}</Text>
                            <Text style={[styles.typeLabel, type === t.value && styles.typeLabelActive]}>
                                {t.label}
                            </Text>
                        </TouchableOpacity>
                    ))}
                </View>

                {/* Titolo */}
                <Text style={styles.label}>Titolo *</Text>
                <TextInput
                    style={styles.input}
                    placeholder="Es. 5vs5 domenica mattina"
                    placeholderTextColor={colors.textSecondary}
                    value={title}
                    onChangeText={setTitle}
                    maxLength={200}
                />

                {/* Descrizione */}
                <Text style={styles.label}>Descrizione</Text>
                <TextInput
                    style={[styles.input, styles.textArea]}
                    placeholder="Regole, livello richiesto, cosa portare..."
                    placeholderTextColor={colors.textSecondary}
                    value={description}
                    onChangeText={setDescription}
                    multiline
                    numberOfLines={3}
                />

                {/* Data inizio */}
                <Text style={styles.label}>Data e ora inizio *</Text>
                <TouchableOpacity
                    style={styles.datePicker}
                    onPress={() => setShowStartPicker(true)}
                >
                    <Text style={styles.datePickerText}>{formatDate(startsAt)}</Text>
                </TouchableOpacity>
                {showStartPicker && (
                    <DateTimePicker
                        value={startsAt}
                        mode="datetime"
                        display={Platform.OS === 'ios' ? 'inline' : 'default'}
                        minimumDate={new Date()}
                        onChange={(_, date) => {
                            setShowStartPicker(false)
                            if (date) setStartsAt(date)
                        }}
                    />
                )}

                {/* Data fine */}
                <View style={styles.switchRow}>
                    <Text style={styles.label}>Data fine</Text>
                    <Switch
                        value={hasEndDate}
                        onValueChange={setHasEndDate}
                        trackColor={{ false: colors.cardBorder, true: colors.primary }}
                        thumbColor="#fff"
                    />
                </View>
                {hasEndDate && (
                    <>
                        <TouchableOpacity
                            style={styles.datePicker}
                            onPress={() => setShowEndPicker(true)}
                        >
                            <Text style={styles.datePickerText}>{formatDate(endsAt)}</Text>
                        </TouchableOpacity>
                        {showEndPicker && (
                            <DateTimePicker
                                value={endsAt}
                                mode="datetime"
                                display={Platform.OS === 'ios' ? 'inline' : 'default'}
                                minimumDate={startsAt}
                                onChange={(_, date) => {
                                    setShowEndPicker(false)
                                    if (date) setEndsAt(date)
                                }}
                            />
                        )}
                    </>
                )}

                {/* Max partecipanti */}
                <Text style={styles.label}>Max partecipanti (lascia vuoto = nessun limite)</Text>
                <TextInput
                    style={styles.input}
                    placeholder="Es. 10"
                    placeholderTextColor={colors.textSecondary}
                    value={maxParticipants}
                    onChangeText={v => setMaxParticipants(v.replace(/\D/g, ''))}
                    keyboardType="number-pad"
                />

                {/* Visibilità */}
                <Text style={styles.label}>Visibilità</Text>
                <View style={styles.visibilityRow}>
                    {VISIBILITY_OPTIONS.map(v => (
                        <TouchableOpacity
                            key={v.value}
                            style={[styles.visibilityCard, visibility === v.value && styles.visibilityCardActive]}
                            onPress={() => setVisibility(v.value)}
                            activeOpacity={0.75}
                        >
                            <Text style={[styles.visibilityLabel, visibility === v.value && styles.visibilityLabelActive]}>
                                {v.label}
                            </Text>
                            <Text style={styles.visibilityDesc}>{v.desc}</Text>
                        </TouchableOpacity>
                    ))}
                </View>

                {/* Location */}
                {locations.length > 0 && (
                    <>
                        <Text style={styles.label}>Luogo</Text>
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
                            <TouchableOpacity
                                style={[styles.locationChip, !locationId && styles.locationChipActive]}
                                onPress={() => setLocationId(undefined)}
                            >
                                <Text style={[styles.locationChipText, !locationId && styles.locationChipTextActive]}>
                                    Da definire
                                </Text>
                            </TouchableOpacity>
                            {locations.map(loc => (
                                <TouchableOpacity
                                    key={loc.id}
                                    style={[styles.locationChip, locationId === loc.id && styles.locationChipActive]}
                                    onPress={() => setLocationId(loc.id)}
                                >
                                    <Text style={[styles.locationChipText, locationId === loc.id && styles.locationChipTextActive]}>
                                        📍 {loc.name}
                                    </Text>
                                </TouchableOpacity>
                            ))}
                        </ScrollView>
                    </>
                )}

                {/* Save button */}
                <TouchableOpacity
                    style={[styles.saveButton, isSaving && { opacity: 0.6 }]}
                    onPress={handleSave}
                    disabled={isSaving}
                    activeOpacity={0.8}
                >
                    {isSaving
                        ? <ActivityIndicator color="#fff" />
                        : <Text style={styles.saveButtonText}>{isEdit ? 'Salva modifiche' : 'Crea evento'}</Text>
                    }
                </TouchableOpacity>
            </ScrollView>
        </View>
    )
}

const styles = StyleSheet.create({
    screenTitle: {
        fontSize: 22,
        fontWeight: '800',
        color: colors.textPrimary,
        marginBottom: 20,
    },
    label: {
        color: colors.textSecondary,
        fontSize: 13,
        fontWeight: '600',
        marginBottom: 6,
        marginTop: 4,
    },
    input: {
        backgroundColor: colors.card,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: colors.cardBorder,
        color: colors.textPrimary,
        paddingHorizontal: 14,
        paddingVertical: 12,
        fontSize: 15,
        marginBottom: 14,
    },
    textArea: {
        height: 80,
        textAlignVertical: 'top',
    },
    typeGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 10,
        marginBottom: 16,
    },
    typeCard: {
        width: '47%',
        backgroundColor: colors.card,
        borderRadius: 12,
        padding: 14,
        borderWidth: 1,
        borderColor: colors.cardBorder,
        alignItems: 'center',
    },
    typeCardActive: {
        borderColor: colors.primary,
        backgroundColor: '#1a2540',
    },
    typeEmoji: {
        fontSize: 24,
        marginBottom: 6,
    },
    typeLabel: {
        color: colors.textSecondary,
        fontSize: 13,
        fontWeight: '600',
        textAlign: 'center',
    },
    typeLabelActive: {
        color: colors.primary,
    },
    datePicker: {
        backgroundColor: colors.card,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: colors.cardBorder,
        paddingHorizontal: 14,
        paddingVertical: 12,
        marginBottom: 14,
    },
    datePickerText: {
        color: colors.textPrimary,
        fontSize: 15,
    },
    switchRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 6,
    },
    visibilityRow: {
        flexDirection: 'row',
        gap: 8,
        marginBottom: 16,
    },
    visibilityCard: {
        flex: 1,
        backgroundColor: colors.card,
        borderRadius: 10,
        padding: 10,
        borderWidth: 1,
        borderColor: colors.cardBorder,
        alignItems: 'center',
    },
    visibilityCardActive: {
        borderColor: colors.primary,
        backgroundColor: '#1a2540',
    },
    visibilityLabel: {
        color: colors.textSecondary,
        fontWeight: '700',
        fontSize: 13,
        marginBottom: 2,
    },
    visibilityLabelActive: {
        color: colors.primary,
    },
    visibilityDesc: {
        color: colors.textSecondary,
        fontSize: 10,
        textAlign: 'center',
    },
    locationChip: {
        backgroundColor: colors.card,
        borderRadius: 20,
        paddingHorizontal: 14,
        paddingVertical: 8,
        marginRight: 8,
        borderWidth: 1,
        borderColor: colors.cardBorder,
    },
    locationChipActive: {
        backgroundColor: colors.primary,
        borderColor: colors.primary,
    },
    locationChipText: {
        color: colors.textSecondary,
        fontSize: 13,
        fontWeight: '600',
    },
    locationChipTextActive: {
        color: '#fff',
    },
    saveButton: {
        backgroundColor: colors.primary,
        borderRadius: 14,
        paddingVertical: 16,
        alignItems: 'center',
        marginTop: 8,
    },
    saveButtonText: {
        color: '#fff',
        fontWeight: '700',
        fontSize: 17,
    },
})
