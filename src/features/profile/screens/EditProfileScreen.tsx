import React, { useEffect, useState } from 'react'
import {
    View,
    Text,
    TextInput,
    StyleSheet,
    Button,
    Alert,
    ScrollView,
    TouchableOpacity,
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
    )
}

const styles = StyleSheet.create({
    positionsGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 10,
        marginTop: 10,
    },
})