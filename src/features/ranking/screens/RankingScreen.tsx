import React, { useContext } from 'react'
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    RefreshControl,
    TouchableOpacity,
    ActivityIndicator,
} from 'react-native'

import { useNavigation } from '@react-navigation/native'
import { AuthContext } from '@/features/auth/context/AuthContext'
import { useGlobalRanking, useRoleRanking } from '../hooks/useRanking'
import { RankingItem } from '../types/ranking.types'

export default function RankingScreen() {
    const navigation = useNavigation<any>()
    const auth = useContext(AuthContext)
    
    if (!auth) return null

    const { user } = auth
    const [scope, setScope] = React.useState<'GLOBAL' | 'ROLE'>('GLOBAL')
    
    const { data: globalRanking, isLoading: globalLoading, refetch: refetchGlobal } = useGlobalRanking()
    const { data: roleRanking, isLoading: roleLoading, refetch: refetchRole } = useRoleRanking(user?.mainPosition)
    
    const isLoading = globalLoading || roleLoading
    const ranking = scope === 'ROLE' ? (roleRanking || []) : (globalRanking || [])
    
    const handleRefresh = () => {
        refetchGlobal()
        refetchRole()
    }

    const hasRole = !!user?.mainPosition

    if (isLoading) {
        return (
            <View style={styles.loaderContainer}>
                <ActivityIndicator size="large" color="#ff8c00" />
            </View>
        )
    }

    return (
        <View style={styles.container}>
            <ScrollView 
                contentContainerStyle={{ padding: 20 }}
                refreshControl={
                    <RefreshControl refreshing={isLoading} onRefresh={handleRefresh} />
                }
            >
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
                    const isCurrentUser = user ? item.playerId === user.id : false

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
        backgroundColor: '#1a1a1a',
    },
    title: {
        fontSize: 28,
        fontWeight: '700',
        color: '#fff',
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
        backgroundColor: '#2a2a2a',
        alignItems: 'center',
        marginHorizontal: 5,
    },
    activeSwitch: {
        backgroundColor: '#ff8c00',
    },
    switchText: {
        color: '#fff',
        fontWeight: '600',
    },
    rankCard: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#2a2a2a',
        padding: 16,
        borderRadius: 18,
        marginBottom: 12,
    },
    currentUserCard: {
        borderWidth: 2,
        borderColor: '#ff8c00',
    },
    rankPosition: {
        fontSize: 18,
        fontWeight: '700',
        color: '#ff8c00',
        marginRight: 15,
    },
    playerName: {
        color: '#fff',
        fontWeight: '600',
    },
    score: {
        color: '#ccc',
        marginTop: 4,
    },
    emptyState: {
        backgroundColor: '#2a2a2a',
        padding: 20,
        borderRadius: 18,
        alignItems: 'center',
        marginBottom: 15,
    },
    emptyText: {
        color: '#ccc',
        fontSize: 16,
        textAlign: 'center',
    },
})