import React, { useEffect, useState } from 'react'
import {
    View,
    Text,
    TextInput,
    StyleSheet,
    ScrollView,
    TouchableOpacity, Modal,
    Image,
    Alert,
} from 'react-native'
import { useNavigation, useRoute } from '@react-navigation/native'
import * as ImagePicker from 'expo-image-picker'

import { useProfile } from '../hooks/useProfile'
import { useUpdateProfile } from '../hooks/useUpdateProfile'
import { getPositions, PositionMetadata } from '../api/position.api'
import { uploadProfileImage } from '../api/profile.api'

import { globalStyles } from '@/shared/theme/globalStyles'
import { PositionCard } from '@/shared/components/PositionCard'
import { useGlobalAlert } from '@/shared/context/AlertContext'

export default function EditProfileScreen() {
    const navigation = useNavigation<any>()
    const route = useRoute<any>()
    const updateProfileMutation = useUpdateProfile()
    const { showSuccess, showError, showWarning } = useGlobalAlert()

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
    const [publicProfile, setPublicProfile] = useState(true)
    const [profileImage, setProfileImage] = useState<string | null>(null)
    const [showImagePickerModal, setShowImagePickerModal] = useState(false)
    const [uploadingImage, setUploadingImage] = useState(false)

    // Update form when profile data is loaded
    useEffect(() => {
        if (profile) {
            setDisplayName(profile.displayName ?? '')
            setCity(profile.city ?? '')
            setCountry(profile.country ?? '')
            setBirthDate(profile.birthDate ?? '')
            setPublicProfile(profile.publicProfile ?? true)
            setProfileImage(profile.avatarUrl ?? null)
            
            // Initialize date picker values if birthDate exists
            if (profile.birthDate) {
                const [year, month, day] = profile.birthDate.split('-').map(Number)
                setSelectedYear(year || 1990)
                setSelectedMonth(month || 1)
                setSelectedDay(day || 1)
            }
            
            setHeightCm(profile.heightCm ? String(profile.heightCm) : '')
            setWeightKg(profile.weightKg ? String(profile.weightKg) : '')
            
            // Extract positions from the backend structure
            if (profile.positions && Array.isArray(profile.positions)) {
                const mainPos = profile.positions.find((p: any) => p.isPrimary === true)
                const secondaryPos = profile.positions
                    .filter((p: any) => p.isPrimary === false)
                    .map((p: any) => p.position?.id)
                    .filter(Boolean)
                
                setMainPositionId(mainPos?.position?.id)
                setSecondaryPositionIds(secondaryPos)
            } else {
                // Fallback for direct fields if structure changes
                setMainPositionId(profile.mainPositionId ?? undefined)
                setSecondaryPositionIds(profile.secondaryPositionIds ?? [])
            }
        }
    }, [profile])

    useEffect(() => {
        const load = async () => {
            try {
                const data = await getPositions()
                setPositions(data)
            } catch {
                showError('Errore', 'Impossibile caricare posizioni')
            } finally {
                setLoadingPositions(false)
            }
        }

        load()
    }, [])

    // Request camera permissions
    useEffect(() => {
        (async () => {
            const { status } = await ImagePicker.requestCameraPermissionsAsync()
            if (status !== 'granted') {
                Alert.alert('Permessi necessari', 'È necessario concedere i permessi per la camera per scattare foto.')
            }
        })()
    }, [])

    const pickImageFromGallery = async () => {
        try {
            const result = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ['images'],
                allowsEditing: true,
                aspect: [1, 1],
                quality: 0.8,
            })

            if (!result.canceled && result.assets[0]) {
                setProfileImage(result.assets[0].uri)
            }
            setShowImagePickerModal(false)
        } catch (error) {
            showError('Errore', 'Impossibile selezionare l\'immagine')
        }
    }

    const takePhoto = async () => {
        try {
            const result = await ImagePicker.launchCameraAsync({
                mediaTypes: ['images'],
                allowsEditing: true,
                aspect: [1, 1],
                quality: 0.8,
            })

            if (!result.canceled && result.assets[0]) {
                setProfileImage(result.assets[0].uri)
            }
            setShowImagePickerModal(false)
        } catch (error) {
            showError('Errore', 'Impossibile scattare la foto')
        }
    }

    const toggleSecondary = (positionId: string) => {
        if (positionId === mainPositionId) {
            showWarning(
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
        console.log('🔧 handleSave - Start')
        console.log('🔧 profile:', profile)
        console.log('🔧 profile.id:', profile?.id)
        console.log('🔧 profileImage:', profileImage)
        console.log('🔧 profile.avatarUrl:', profile?.avatarUrl)

        if (!profile?.id) {
            showError('Errore', 'ID profilo non valido')
            return
        }

        try {
            let finalAvatarUrl = profile.avatarUrl

            // Upload image if it has changed
            if (profileImage && profileImage !== profile.avatarUrl) {
                console.log('📸 Image changed, starting upload...')
                setUploadingImage(true)
                try {
                    const uploadResult = await uploadProfileImage(profile.id, profileImage)
                    console.log('✅ Upload result:', uploadResult)
                    finalAvatarUrl = uploadResult.avatarUrl
                } catch (uploadError: any) {
                    console.error('❌ Error uploading image:', uploadError)
                    showError('Errore', 'Impossibile caricare l\'immagine')
                    setUploadingImage(false)
                    return
                }
            } else {
                console.log('ℹ️ Image not changed, skipping upload')
            }

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
                    publicProfile,
                }
            })

            await updateProfileMutation.mutateAsync({
                profileId: profile.id,
                data: {
                    displayName: displayName || undefined,
                    birthDate: birthDate || undefined,
                    city: city || undefined,
                    country: country || undefined,
                    heightCm: heightCm ? Number(heightCm) : undefined,
                    weightKg: weightKg ? Number(weightKg) : undefined,
                    mainPositionId: mainPositionId || undefined,
                    secondaryPositionIds: secondaryPositionIds.length > 0 ? secondaryPositionIds : undefined,
                    publicProfile,
                },
            })

            showSuccess('Successo', 'Profilo aggiornato', () => {
                navigation.goBack()
            })
        } catch (error: any) {
            console.error('Error updating profile:', error)
            const errorMessage = error?.response?.data?.message || error?.message || 'Impossibile aggiornare il profilo'
            showError('Errore', errorMessage)
        } finally {
            setUploadingImage(false)
        }
    }

    return (
        <>
            <ScrollView style={globalStyles.container}>
            <Text style={globalStyles.sectionTitle}>
                Foto Profilo
            </Text>

            <TouchableOpacity
                style={styles.profileImageContainer}
                onPress={() => setShowImagePickerModal(true)}
            >
                {profileImage ? (
                    <Image source={{ uri: profileImage }} style={styles.profileImage} />
                ) : (
                    <View style={styles.profileImagePlaceholder}>
                        <Text style={styles.profileImagePlaceholderText}>+</Text>
                    </View>
                )}
                <View style={styles.cameraIconContainer}>
                    <Text style={styles.cameraIcon}>📷</Text>
                </View>
            </TouchableOpacity>

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
                        backgroundColor: uploadingImage ? '#94A3B8' : '#F97316',
                        padding: 16,
                        borderRadius: 12,
                        alignItems: 'center',
                    }}
                    onPress={() => {
                        console.log('🔘 Button pressed!')
                        handleSave()
                    }}
                    disabled={uploadingImage}
                >
                    <Text style={{
                        color: '#FFFFFF',
                        fontWeight: '600',
                        fontSize: 16,
                    }}>
                        {uploadingImage ? 'Caricamento immagine...' : 'Salva modifiche'}
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

        {/* Image Picker Modal */}
        <Modal
            visible={showImagePickerModal}
            transparent
            animationType="slide"
        >
            <View style={styles.modalOverlay}>
                <View style={styles.imagePickerModalContent}>
                    <Text style={styles.modalTitle}>Scegli foto profilo</Text>

                    <TouchableOpacity
                        style={styles.imagePickerOption}
                        onPress={takePhoto}
                    >
                        <Text style={styles.imagePickerOptionText}>📷 Scatta foto</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={styles.imagePickerOption}
                        onPress={pickImageFromGallery}
                    >
                        <Text style={styles.imagePickerOptionText}>🖼️ Scegli dalla galleria</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={styles.cancelButton}
                        onPress={() => setShowImagePickerModal(false)}
                    >
                        <Text style={styles.cancelButtonText}>Annulla</Text>
                    </TouchableOpacity>
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
    profileImageContainer: {
        alignSelf: 'center',
        marginBottom: 20,
        position: 'relative',
    },
    profileImage: {
        width: 120,
        height: 120,
        borderRadius: 60,
        borderWidth: 3,
        borderColor: '#F97316',
    },
    profileImagePlaceholder: {
        width: 120,
        height: 120,
        borderRadius: 60,
        backgroundColor: '#334155',
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: 3,
        borderColor: '#F97316',
        borderStyle: 'dashed',
    },
    profileImagePlaceholderText: {
        fontSize: 48,
        color: '#94A3B8',
        fontWeight: '300',
    },
    cameraIconContainer: {
        position: 'absolute',
        bottom: 0,
        right: 0,
        backgroundColor: '#F97316',
        borderRadius: 20,
        width: 40,
        height: 40,
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: 3,
        borderColor: '#1E293B',
    },
    cameraIcon: {
        fontSize: 20,
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
    imagePickerModalContent: {
        backgroundColor: '#1E293B',
        margin: 20,
        borderRadius: 20,
        padding: 25,
        width: '90%',
        maxWidth: 350,
    },
    imagePickerOption: {
        backgroundColor: '#334155',
        padding: 16,
        borderRadius: 12,
        alignItems: 'center',
        marginBottom: 12,
    },
    imagePickerOptionText: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: '600',
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