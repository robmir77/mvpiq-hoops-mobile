// features/profile/screens/ProfileScreen.tsx

import React, { useContext, useEffect, useState } from 'react'
import {
    View,
    Text,
    ActivityIndicator,
    StyleSheet,
    Image,
    ScrollView,
    TouchableOpacity,
} from 'react-native'
import { useNavigation } from '@react-navigation/native'
import { AuthContext } from '@/features/auth/context/AuthContext'
import { useProfile } from '../hooks/useProfile'
import { getAllPositions } from '@/features/positions/api/positions.api'
import { PositionMetadata } from '@/features/positions/types/positions.types'
import { PositionCard } from '@/shared/components/PositionCard'

export default function ProfileScreen() {
    const navigation = useNavigation<any>()
    const auth = useContext(AuthContext)

    if (!auth) return null

    const { user } = auth
    const { data, isLoading, isError } = useProfile(user?.id)

    const [positions, setPositions] = useState<PositionMetadata[]>([])
    const [loadingPositions, setLoadingPositions] = useState(true)

    useEffect(() => {
        const loadPositions = async () => {
            try {
                const data = await getAllPositions()
                setPositions(data)
            } catch (error) {
                console.error('Errore caricamento posizioni:', error)
            } finally {
                setLoadingPositions(false)
            }
        }

        loadPositions()
    }, [])

    if (isLoading) {
        return (
            <View style={styles.center}>
                <ActivityIndicator size="large" color="#ff8c00" />
            </View>
        )
    }

    if (isError || !data) {
        return (
            <View style={styles.center}>
                <Text style={{ color: 'white' }}>Errore caricamento profilo</Text>
            </View>
        )
    }

    return (
        <ScrollView style={styles.container}>
            {/* Header */}
            <View style={styles.header}>
                <Image
                    source={{
                        uri: data.avatarUrl || 'https://i.pravatar.cc/300',
                    }}
                    style={styles.avatar}
                />

                <Text style={styles.name}>{data?.displayName || data?.username || 'Profilo'}</Text>

                <Text style={styles.position}>
                    {data.mainPositionLabel
                        ? `${data.mainPositionLabel}${data.level ? ` • ${data.level}` : ''}`
                        : data.level ?? ''}
                </Text>

                {/* Pulsanti Azione */}
                <View style={styles.actionButtons}>
                    <TouchableOpacity
                        style={styles.editButton}
                        onPress={() => {
                            console.log('ProfileScreen - Navigating to EditProfile with playerId:', data.id);
                            navigation.navigate('EditProfile', { playerId: data.id })
                        }}
                    >
                        <Text style={styles.editButtonText}>Modifica Profilo</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={[styles.editButton, styles.cvButton]}
                        onPress={() =>
                            navigation.navigate('EditCv', { playerId: data.id })
                        }
                    >
                        <Text style={styles.editButtonText}>Modifica CV sportivo</Text>
                    </TouchableOpacity>
                </View>
            </View>

            {/* Informazioni Base */}
            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Informazioni Personali</Text>
                
                <View style={styles.infoRow}>
                    <Text style={styles.infoLabel}>👤 Nome</Text>
                    <Text style={styles.infoValue}>{data.displayName || '-'}</Text>
                </View>

                <View style={styles.infoRow}>
                    <Text style={styles.infoLabel}>📍 Città</Text>
                    <Text style={styles.infoValue}>{data.city || '-'}</Text>
                </View>

                <View style={styles.infoRow}>
                    <Text style={styles.infoLabel}>🌍 Paese</Text>
                    <Text style={styles.infoValue}>{data.country || '-'}</Text>
                </View>

                <View style={styles.infoRow}>
                    <Text style={styles.infoLabel}>🎂 Data di nascita</Text>
                    <Text style={styles.infoValue}>{data.birthDate || '-'}</Text>
                </View>
            </View>

            {/* Statistiche Fisiche */}
            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Statistiche Fisiche</Text>
                
                <View style={styles.statsGrid}>
                    <View style={styles.statItem}>
                        <Text style={styles.statValue}>{data.heightCm || '-'} cm</Text>
                        <Text style={styles.statLabel}>Altezza</Text>
                    </View>

                    <View style={styles.statItem}>
                        <Text style={styles.statValue}>{data.weightKg || '-'} kg</Text>
                        <Text style={styles.statLabel}>Peso</Text>
                    </View>
                </View>
            </View>

            {/* Posizioni di Gioco */}
            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Posizioni di Gioco</Text>
                
                {/* Posizione Principale */}
                <Text style={styles.subsectionTitle}>Posizione Principale</Text>
                {loadingPositions ? (
                    <Text style={styles.loadingText}>Caricamento posizioni...</Text>
                ) : (
                    <View style={styles.positionsGrid}>
                        {(() => {
                            // Extract main position from backend structure
                            let mainPositionId = data.mainPositionId;
                            if (!mainPositionId && data.positions && Array.isArray(data.positions)) {
                                const mainPos = data.positions.find((p: any) => p.isPrimary === true);
                                mainPositionId = mainPos?.position?.id;
                            }
                            
                            return positions
                                .filter(pos => mainPositionId === pos.id)
                                .map(pos => (
                                    <PositionCard
                                        key={pos.id}
                                        label={`${pos.code} - ${pos.name}`}
                                        selected={true}
                                        disabled={true}
                                        onPress={() => {}}
                                    />
                                ));
                        })()}
                    </View>
                )}

                {/* Posizioni Secondarie */}
                <Text style={styles.subsectionTitle}>Posizioni Secondarie</Text>
                {loadingPositions ? (
                    <Text style={styles.loadingText}>Caricamento posizioni...</Text>
                ) : (
                    <View style={styles.positionsGrid}>
                        {(() => {
                            // Extract secondary positions from backend structure
                            let secondaryPositionIds = data.secondaryPositionIds;
                            if ((!secondaryPositionIds || secondaryPositionIds.length === 0) && data.positions && Array.isArray(data.positions)) {
                                secondaryPositionIds = data.positions
                                    .filter((p: any) => p.isPrimary === false)
                                    .map((p: any) => p.position?.id)
                                    .filter(Boolean);
                            }
                            
                            return positions
                                .filter(pos => secondaryPositionIds?.includes(pos.id))
                                .map(pos => (
                                    <PositionCard
                                        key={pos.id}
                                        label={`${pos.code} - ${pos.name}`}
                                        selected={true}
                                        disabled={true}
                                        onPress={() => {}}
                                    />
                                ));
                        })()}
                    </View>
                )}
            </View>
        </ScrollView>
    )
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#0b0f1a',
    },
    center: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#0b0f1a',
    },
    header: {
        alignItems: 'center',
        paddingVertical: 30,
    },
    avatar: {
        width: 140,
        height: 140,
        borderRadius: 70,
        borderWidth: 3,
        borderColor: '#ff8c00',
    },
    name: {
        marginTop: 15,
        fontSize: 24,
        fontWeight: 'bold',
        color: 'white',
    },
    position: {
        marginTop: 5,
        fontSize: 16,
        color: '#aaa',
    },
    actionButtons: {
        marginTop: 20,
        gap: 10,
    },
    editButton: {
        backgroundColor: '#ff8c00',
        paddingVertical: 10,
        paddingHorizontal: 20,
        borderRadius: 20,
        alignItems: 'center',
    },
    cvButton: {
        backgroundColor: '#ff8c00',
    },
    editButtonText: {
        color: '#0b0f1a',
        fontWeight: 'bold',
    },
    section: {
        marginTop: 30,
        paddingHorizontal: 20,
    },
    sectionTitle: {
        fontSize: 20,
        fontWeight: 'bold',
        color: 'white',
        marginBottom: 15,
    },
    subsectionTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: '#ff8c00',
        marginTop: 20,
        marginBottom: 10,
    },
    infoRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: '#2a2a2a',
    },
    infoLabel: {
        fontSize: 16,
        color: '#ccc',
        flex: 1,
    },
    infoValue: {
        fontSize: 16,
        color: 'white',
        fontWeight: '500',
    },
    statsGrid: {
        flexDirection: 'row',
        justifyContent: 'space-around',
        backgroundColor: '#121826',
        borderRadius: 15,
        paddingVertical: 20,
    },
    statItem: {
        alignItems: 'center',
    },
    statValue: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#ff8c00',
    },
    statLabel: {
        fontSize: 12,
        color: '#aaa',
        marginTop: 5,
    },
    positionsGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 10,
        marginTop: 10,
    },
    loadingText: {
        color: '#aaa',
        fontSize: 14,
        fontStyle: 'italic',
    },
})