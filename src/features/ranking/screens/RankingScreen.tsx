import React, { useEffect, useState, useContext } from 'react'
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    ActivityIndicator,
    TouchableOpacity,
} from 'react-native'

import { AuthContext } from '@/features/auth/context/AuthContext'
import {
    getGlobalRanking,
    getRoleRanking,
} from '@/features/ranking/api/ranking.api'
import { RankingItem } from '@/features/ranking/types/ranking.types'
import { getAthleteProfile } from '@/features/profile/api/profile.api'
import { PlayerProfile } from '@/features/profile/types/profile.types'

export default function RankingScreen() {
    const auth = useContext(AuthContext)
    if (!auth) return null

    const { user } = auth

    const [ranking, setRanking] = useState<RankingItem[]>([])
    const [profile, setProfile] = useState<PlayerProfile | null>(null)
    const [loading, setLoading] = useState(true)
    const [scope, setScope] = useState<'GLOBAL' | 'ROLE'>('GLOBAL')

    // 🔹 Carico il profilo una sola volta
    useEffect(() => {
        const fetchProfile = async () => {
            try {
                const playerProfile = await getAthleteProfile(user.id)
                setProfile(playerProfile)
            } catch (e) {
                console.error('Errore caricamento profilo:', e)
            }
        }

        fetchProfile()
    }, [])

    // 🔹 Carico il ranking ogni volta che cambia scope o profilo
    useEffect(() => {
        loadRanking()
    }, [scope, profile])

    const loadRanking = async () => {
        setLoading(true)

        try {
            let data: RankingItem[] = []

            if (scope === 'ROLE' && profile?.mainPosition) {
                data = await getRoleRanking(profile.mainPosition)
            } else {
                data = await getGlobalRanking()
            }

            setRanking(data)
        } catch (error) {
            console.error('Errore caricamento ranking:', error)
        } finally {
            setLoading(false)
        }
    }

    const hasRole = !!profile?.mainPosition

    if (loading) {
        return (
            <View style={styles.loaderContainer}>
                <ActivityIndicator size="large" color="#F97316" />
            </View>
        )
    }

    return (
        <View style={styles.container}>
            <ScrollView contentContainerStyle={{ padding: 20 }}>
                <Text style={styles.title}>Ranking</Text>

                {/* Scope Switch */}
                <View style={styles.switchRow}>
                    <TouchableOpacity
                        style={[
                            styles.switchButton,
                            scope === 'GLOBAL' && styles.activeSwitch,
                        ]}
                        onPress={() => setScope('GLOBAL')}
                    >
                        <Text style={styles.switchText}>Global</Text>
                    </TouchableOpacity>

                    {hasRole && (
                        <TouchableOpacity
                            style={[
                                styles.switchButton,
                                scope === 'ROLE' && styles.activeSwitch,
                            ]}
                            onPress={() => setScope('ROLE')}
                        >
                            <Text style={styles.switchText}>My Role</Text>
                        </TouchableOpacity>
                    )}
                </View>

                {/* Ranking List */}
                {ranking.map((item, index) => {
                    const isCurrentUser = item.playerId === user.id

                    return (
                        <View
                            key={item.playerId}
                            style={[
                                styles.rankCard,
                                isCurrentUser && styles.currentUserCard,
                            ]}
                        >
                            <Text style={styles.rankPosition}>
                                #{item.rankPosition ?? index + 1}
                            </Text>

                            <View style={{ flex: 1 }}>
                                <Text style={styles.playerName}>
                                    {item.playerName ?? 'Player'}
                                </Text>
                                <Text style={styles.score}>
                                    Score: {item.score}
                                </Text>
                            </View>
                        </View>
                    )
                })}
            </ScrollView>
        </View>
    )
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#0F172A',
    },
    loaderContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#0F172A',
    },
    title: {
        fontSize: 28,
        fontWeight: '700',
        color: '#FFFFFF',
        marginBottom: 20,
    },
    switchRow: {
        flexDirection: 'row',
        marginBottom: 20,
    },
    switchButton: {
        flex: 1,
        padding: 10,
        borderRadius: 12,
        backgroundColor: '#1E293B',
        alignItems: 'center',
        marginHorizontal: 5,
    },
    activeSwitch: {
        backgroundColor: '#F97316',
    },
    switchText: {
        color: '#FFFFFF',
        fontWeight: '600',
    },
    rankCard: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#1E293B',
        padding: 16,
        borderRadius: 18,
        marginBottom: 12,
    },
    currentUserCard: {
        borderWidth: 2,
        borderColor: '#F97316',
    },
    rankPosition: {
        fontSize: 18,
        fontWeight: '700',
        color: '#F97316',
        marginRight: 15,
    },
    playerName: {
        color: '#FFFFFF',
        fontWeight: '600',
    },
    score: {
        color: '#94A3B8',
        marginTop: 4,
    },
})