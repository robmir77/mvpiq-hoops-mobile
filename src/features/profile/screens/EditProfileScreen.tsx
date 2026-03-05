import React, { useEffect, useState } from 'react'
import {
    View,
    Text,
    TextInput,
    StyleSheet,
    Button,
    Alert,
    ScrollView,
} from 'react-native'
import { useNavigation, useRoute } from '@react-navigation/native'
import { useQueryClient } from '@tanstack/react-query'

import { updateAthleteProfile } from '../api/profile.api'
import { getPositions, PositionMetadata } from '../api/position.api'
import { PlayerProfile } from '../types/profile.types'

import { globalStyles } from '@/shared/theme/globalStyles'
import { PositionCard } from '@/shared/components/PositionCard'

export default function EditProfileScreen() {
    const navigation = useNavigation<any>()
    const route = useRoute<any>()
    const queryClient = useQueryClient()

    const profile: PlayerProfile = route.params.profile

    const [positions, setPositions] = useState<PositionMetadata[]>([])
    const [loadingPositions, setLoadingPositions] = useState(true)

    const [displayName, setDisplayName] = useState(profile.displayName ?? '')
    const [city, setCity] = useState(profile.city ?? '')
    const [country, setCountry] = useState(profile.country ?? '')
    const [heightCm, setHeightCm] = useState(
        profile.heightCm ? String(profile.heightCm) : ''
    )
    const [weightKg, setWeightKg] = useState(
        profile.weightKg ? String(profile.weightKg) : ''
    )

    const [mainPositionId, setMainPositionId] = useState<string | undefined>(
        profile.mainPositionId ?? undefined
    )

    const [secondaryPositionIds, setSecondaryPositionIds] = useState<string[]>(
        profile.secondaryPositionIds ?? []
    )

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
        try {
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
        } catch {
            Alert.alert('Errore', 'Impossibile aggiornare il profilo')
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

            <View style={{ marginTop: 30 }}>
                <Button
                    title="Salva modifiche"
                    onPress={handleSave}
                />
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