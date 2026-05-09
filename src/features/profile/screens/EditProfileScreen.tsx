import React, { useEffect, useState } from 'react'
import {
    View,
    Text,
    TextInput,
    StyleSheet,
    Button,
    Alert,
    ScrollView,
    TouchableOpacity, Modal,
} from 'react-native'
import { useNavigation, useRoute } from '@react-navigation/native'
import { useQueryClient } from '@tanstack/react-query'

import { updateAthleteProfile } from '../api/profile.api'
import { useProfile } from '../hooks/useProfile'
import { getPositions, PositionMetadata } from '../api/position.api'
import { PlayerProfile } from '../types/profile.types'

import { globalStyles } from '@/shared/theme/globalStyles'
import { PositionCard } from '@/shared/components/PositionCard'

export default function EditProfileScreen() {
    const navigation = useNavigation<any>()
    const route = useRoute<any>()
    const queryClient = useQueryClient()

    console.log('EditProfileScreen - route.params:', route.params)
    const playerId = route.params.playerId
    console.log('EditProfileScreen - playerId:', playerId)
    
    const { data: profile, isLoading } = useProfile(playerId)
    console.log('EditProfileScreen - profile data:', profile)

    const [positions, setPositions] = useState<PositionMetadata[]>([])
    const [loadingPositions, setLoadingPositions] = useState(true)

    const [displayName, setDisplayName] = useState('')
    const [city, setCity] = useState('')
    const [country, setCountry] = useState('')
    const [birthDate, setBirthDate] = useState('')
    const [showDatePicker, setShowDatePicker] = useState(false)
    const [selectedYear, setSelectedYear] = useState(1990)
    const [selectedMonth, setSelectedMonth] = useState(1)
    const [selectedDay, setSelectedDay] = useState(1)
    const [heightCm, setHeightCm] = useState('')
    const [weightKg, setWeightKg] = useState('')
    const [mainPositionId, setMainPositionId] = useState<string | undefined>(undefined)
    const [secondaryPositionIds, setSecondaryPositionIds] = useState<string[]>([])

    // Update form when profile data is loaded
    useEffect(() => {
        if (profile) {
            setDisplayName(profile.displayName ?? '')
            setCity(profile.city ?? '')
            setCountry(profile.country ?? '')
            setBirthDate(profile.birthDate ?? '')
            
            // Initialize date picker values if birthDate exists
            if (profile.birthDate) {
                const [year, month, day] = profile.birthDate.split('-').map(Number)
                setSelectedYear(year || 1990)
                setSelectedMonth(month || 1)
                setSelectedDay(day || 1)
            }
            
            setHeightCm(profile.heightCm ? String(profile.heightCm) : '')
            setWeightKg(profile.weightKg ? String(profile.weightKg) : '')
            setMainPositionId(profile.mainPositionId ?? undefined)
            setSecondaryPositionIds(profile.secondaryPositionIds ?? [])
        }
    }, [profile])

    useEffect(() => {
        const load = async () => {
            try {
                const data = await getPositions()
                setPositions(data)
            } catch {
                Alert.alert('Errore', 'Impossibile caricare posizioni')
            } finally {
                setLoadingPositions(false)
            }
        }

        load()
    }, [])

    const toggleSecondary = (positionId: string) => {
        if (positionId === mainPositionId) {
            Alert.alert(
                'Attenzione',
                'Una posizione primaria non può essere anche secondaria'
            )
            return
        }

        if (secondaryPositionIds.includes(positionId)) {
            setSecondaryPositionIds(
                secondaryPositionIds.filter(p => p !== positionId)
            )
        } else {
            setSecondaryPositionIds([...secondaryPositionIds, positionId])
        }
    }

    const handleSave = async () => {
        console.log('handleSave - profile:', profile)
        console.log('handleSave - profile.id:', profile?.id)
        
        if (!profile?.id) {
            Alert.alert('Errore', 'ID profilo non valido')
            return
        }

        try {
            console.log('Updating profile:', {
                profileId: profile.id,
                data: {
                    displayName: displayName || undefined,
                    birthDate: birthDate || undefined,
                    city: city || undefined,
                    country: country || undefined,
                    heightCm: heightCm ? Number(heightCm) : undefined,
                    weightKg: weightKg ? Number(weightKg) : undefined,
                    mainPositionId,
                    secondaryPositionIds,
                }
            })

            await updateAthleteProfile({
                profileId: profile.id,
                data: {
                    displayName: displayName || undefined,
                    birthDate: birthDate || undefined,
                    city: city || undefined,
                    country: country || undefined,
                    heightCm: heightCm ? Number(heightCm) : undefined,
                    weightKg: weightKg ? Number(weightKg) : undefined,
                    mainPositionId,
                    secondaryPositionIds,
                },
            })

            await queryClient.invalidateQueries({
                queryKey: ['profile', profile.id],
            })

            Alert.alert('Successo', 'Profilo aggiornato')
            navigation.goBack()
        } catch (error: any) {
            console.error('Error updating profile:', error)
            const errorMessage = error?.response?.data?.message || error?.message || 'Impossibile aggiornare il profilo'
            Alert.alert('Errore', errorMessage)
        }
    }

    return (
        <>
            <ScrollView style={globalStyles.container}>
            <Text style={globalStyles.sectionTitle}>
                Informazioni Base
            </Text>

            <Text style={globalStyles.label}>Nome</Text>
            <TextInput
                style={globalStyles.input}
                value={displayName}
                onChangeText={setDisplayName}
            />

            <Text style={globalStyles.label}>Città</Text>
            <TextInput
                style={globalStyles.input}
                value={city}
                onChangeText={setCity}
            />

            <Text style={globalStyles.label}>Paese</Text>
            <TextInput
                style={globalStyles.input}
                value={country}
                onChangeText={setCountry}
            />

            <Text style={globalStyles.label}>Data di nascita</Text>
            <TouchableOpacity
                style={globalStyles.input}
                onPress={() => setShowDatePicker(true)}
            >
                <Text style={{ color: birthDate ? '#FFFFFF' : '#94A3B8', fontSize: 16 }}>
                    {birthDate || 'Seleziona data di nascita'}
                </Text>
            </TouchableOpacity>

            <Text style={globalStyles.label}>Altezza (cm)</Text>
            <TextInput
                style={globalStyles.input}
                value={heightCm}
                onChangeText={setHeightCm}
                keyboardType="numeric"
            />

            <Text style={globalStyles.label}>Peso (kg)</Text>
            <TextInput
                style={globalStyles.input}
                value={weightKg}
                onChangeText={setWeightKg}
                keyboardType="numeric"
            />

            <Text style={globalStyles.sectionTitle}>
                Posizioni di gioco
            </Text>

            {/* MAIN POSITION */}
            <Text style={globalStyles.label}>
                Posizione principale
            </Text>

            {loadingPositions ? (
                <Text style={{ color: '#aaa', marginTop: 10 }}>
                    Loading...
                </Text>
            ) : (
                <View style={styles.positionsGrid}>
                    {positions.map(pos => {
                        const isSelected = mainPositionId === pos.id

                        return (
                            <PositionCard
                                key={pos.id}
                                label={`${pos.code} - ${pos.label}`}
                                selected={isSelected}
                                onPress={() => {
                                    setMainPositionId(pos.id)

                                    if (
                                        secondaryPositionIds.includes(pos.id)
                                    ) {
                                        setSecondaryPositionIds(
                                            secondaryPositionIds.filter(
                                                p => p !== pos.id
                                            )
                                        )
                                    }
                                }}
                            />
                        )
                    })}
                </View>
            )}

            {/* SECONDARY POSITIONS */}
            <Text style={globalStyles.label}>
                Posizioni secondarie
            </Text>

            <View style={styles.positionsGrid}>
                {positions.map(pos => {
                    const isSelected =
                        secondaryPositionIds.includes(pos.id)
                    const isMain = mainPositionId === pos.id

                    return (
                        <PositionCard
                            key={pos.id}
                            label={`${pos.code} - ${pos.label}`}
                            selected={isSelected}
                            disabled={isMain}
                            onPress={() => {
                                if (!isMain) toggleSecondary(pos.id)
                            }}
                        />
                    )
                })}
            </View>

            <View style={{ marginTop: 30, marginBottom: 40 }}>
                <TouchableOpacity
                    style={{
                        backgroundColor: '#F97316',
                        padding: 16,
                        borderRadius: 12,
                        alignItems: 'center',
                    }}
                    onPress={handleSave}
                >
                    <Text style={{
                        color: '#FFFFFF',
                        fontWeight: '600',
                        fontSize: 16,
                    }}>
                        Salva modifiche
                    </Text>
                </TouchableOpacity>
            </View>
        </ScrollView>

        {/* Date Picker Modal */}
        <Modal
            visible={showDatePicker}
            transparent
            animationType="slide"
        >
            <View style={styles.modalOverlay}>
                <View style={styles.modalContent}>
                    <Text style={styles.modalTitle}>Seleziona Data di Nascita</Text>
                    
                    {/* Date Display */}
                    <View style={styles.selectedDateDisplay}>
                        <Text style={styles.selectedDateText}>
                            {String(selectedDay).padStart(2, '0')}/{String(selectedMonth).padStart(2, '0')}/{selectedYear}
                        </Text>
                    </View>

                    {/* Date Picker Columns */}
                    <View style={styles.datePickerColumns}>
                        {/* Day Column */}
                        <View style={styles.pickerColumn}>
                            <Text style={styles.pickerLabel}>Giorno</Text>
                            <ScrollView style={styles.pickerScroll}>
                                {Array.from({ length: 31 }, (_, i) => i + 1).map(day => (
                                    <TouchableOpacity
                                        key={day}
                                        style={[
                                            styles.pickerItem,
                                            selectedDay === day && styles.pickerItemSelected
                                        ]}
                                        onPress={() => setSelectedDay(day)}
                                    >
                                        <Text style={[
                                            styles.pickerItemText,
                                            selectedDay === day && styles.pickerItemTextSelected
                                        ]}>
                                            {String(day).padStart(2, '0')}
                                        </Text>
                                    </TouchableOpacity>
                                ))}
                            </ScrollView>
                        </View>

                        {/* Month Column */}
                        <View style={styles.pickerColumn}>
                            <Text style={styles.pickerLabel}>Mese</Text>
                            <ScrollView style={styles.pickerScroll}>
                                {[
                                    'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
                                    'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'
                                ].map((month, index) => (
                                    <TouchableOpacity
                                        key={index + 1}
                                        style={[
                                            styles.pickerItem,
                                            selectedMonth === index + 1 && styles.pickerItemSelected
                                        ]}
                                        onPress={() => setSelectedMonth(index + 1)}
                                    >
                                        <Text style={[
                                            styles.pickerItemText,
                                            selectedMonth === index + 1 && styles.pickerItemTextSelected
                                        ]}>
                                            {month.substring(0, 3).toUpperCase()}
                                        </Text>
                                    </TouchableOpacity>
                                ))}
                            </ScrollView>
                        </View>

                        {/* Year Column */}
                        <View style={styles.pickerColumn}>
                            <Text style={styles.pickerLabel}>Anno</Text>
                            <ScrollView style={styles.pickerScroll}>
                                {Array.from({ length: 100 }, (_, i) => 2024 - i).map(year => (
                                    <TouchableOpacity
                                        key={year}
                                        style={[
                                            styles.pickerItem,
                                            selectedYear === year && styles.pickerItemSelected
                                        ]}
                                        onPress={() => setSelectedYear(year)}
                                    >
                                        <Text style={[
                                            styles.pickerItemText,
                                            selectedYear === year && styles.pickerItemTextSelected
                                        ]}>
                                            {year}
                                        </Text>
                                    </TouchableOpacity>
                                ))}
                            </ScrollView>
                        </View>
                    </View>

                    <View style={styles.modalButtons}>
                        <TouchableOpacity
                            style={styles.cancelButton}
                            onPress={() => setShowDatePicker(false)}
                        >
                            <Text style={styles.cancelButtonText}>Annulla</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={styles.confirmButton}
                            onPress={() => {
                                const formattedDate = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}-${String(selectedDay).padStart(2, '0')}`
                                setBirthDate(formattedDate)
                                setShowDatePicker(false)
                            }}
                        >
                            <Text style={styles.confirmButtonText}>Conferma</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </View>
        </Modal>
        </>
    )
}

const styles = StyleSheet.create({
    positionsGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 10,
        marginTop: 10,
    },
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    modalContent: {
        backgroundColor: '#1E293B',
        margin: 20,
        borderRadius: 20,
        padding: 25,
        width: '90%',
        maxWidth: 400,
    },
    modalTitle: {
        fontSize: 20,
        fontWeight: '600',
        color: '#FFFFFF',
        textAlign: 'center',
        marginBottom: 20,
    },
    dateInputContainer: {
        marginBottom: 20,
    },
    dateInput: {
        backgroundColor: '#334155',
        color: '#FFFFFF',
        padding: 15,
        borderRadius: 12,
        fontSize: 16,
        textAlign: 'center',
    },
    quickDatesContainer: {
        marginBottom: 25,
    },
    quickDatesTitle: {
        fontSize: 16,
        color: '#94A3B8',
        marginBottom: 15,
        textAlign: 'center',
    },
    quickDatesGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'center',
        gap: 10,
    },
    quickDateButton: {
        backgroundColor: '#334155',
        paddingVertical: 10,
        paddingHorizontal: 15,
        borderRadius: 8,
        minWidth: 60,
        alignItems: 'center',
    },
    quickDateText: {
        color: '#FFFFFF',
        fontSize: 14,
        fontWeight: '500',
    },
    modalButtons: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        gap: 15,
    },
    cancelButton: {
        flex: 1,
        backgroundColor: 'transparent',
        borderWidth: 1,
        borderColor: '#334155',
        padding: 15,
        borderRadius: 12,
        alignItems: 'center',
    },
    cancelButtonText: {
        color: '#94A3B8',
        fontSize: 16,
        fontWeight: '600',
    },
    confirmButton: {
        flex: 1,
        backgroundColor: '#F97316',
        padding: 15,
        borderRadius: 12,
        alignItems: 'center',
    },
    confirmButtonText: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: '600',
    },
    selectedDateDisplay: {
        backgroundColor: '#334155',
        padding: 15,
        borderRadius: 12,
        alignItems: 'center',
        marginBottom: 20,
    },
    selectedDateText: {
        color: '#FFFFFF',
        fontSize: 18,
        fontWeight: '600',
    },
    datePickerColumns: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 25,
        height: 200,
    },
    pickerColumn: {
        flex: 1,
        alignItems: 'center',
        marginHorizontal: 5,
    },
    pickerLabel: {
        color: '#94A3B8',
        fontSize: 14,
        fontWeight: '500',
        marginBottom: 10,
        textAlign: 'center',
    },
    pickerScroll: {
        flex: 1,
        width: '100%',
        backgroundColor: '#334155',
        borderRadius: 12,
        padding: 5,
    },
    pickerItem: {
        paddingVertical: 8,
        paddingHorizontal: 12,
        marginVertical: 2,
        borderRadius: 8,
        alignItems: 'center',
    },
    pickerItemSelected: {
        backgroundColor: '#F97316',
    },
    pickerItemText: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: '500',
    },
    pickerItemTextSelected: {
        color: '#FFFFFF',
        fontWeight: '700',
    },
})