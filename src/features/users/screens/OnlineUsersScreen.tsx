import React, { useState } from 'react'
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    TouchableOpacity,
    ActivityIndicator,
    RefreshControl,
} from 'react-native'
import { useOnlineUsers } from '../hooks/useOnlineUsers'
import { OnlineUserDTO } from '../types/users.types'

const UserCard = ({ user }: { user: OnlineUserDTO }) => {
    const getRoleColor = (role: string) => {
        const colors: Record<string, string> = {
            admin: '#ef4444',
            player: '#3b82f6',
            trainer: '#10b981',
            scout: '#f59e0b',
            creator: '#8b5cf6',
            guest: '#6b7280',
        }
        return colors[role] || '#6b7280'
    }

    const getRoleLabel = (role: string) => {
        const labels: Record<string, string> = {
            admin: 'Admin',
            player: 'Giocatore',
            trainer: 'Allenatore',
            scout: 'Scout',
            creator: 'Creator',
            guest: 'Ospite',
        }
        return labels[role] || role
    }

    const formatLastActivity = (dateString: string) => {
        const date = new Date(dateString)
        const now = new Date()
        const diffMs = now.getTime() - date.getTime()
        const diffMins = Math.floor(diffMs / 60000)

        if (diffMins < 1) return 'Adesso'
        if (diffMins < 60) return `${diffMins} min fa`
        if (diffMins < 1440) return `${Math.floor(diffMins / 60)} ore fa`
        return `${Math.floor(diffMins / 1440)} giorni fa`
    }

    return (
        <View style={styles.userCard}>
            <View style={styles.userHeader}>
                <View style={styles.avatarContainer}>
                    {user.avatarUrl ? (
                        <Text style={styles.avatarText}>👤</Text>
                    ) : (
                        <Text style={styles.avatarPlaceholder}>
                            {user.displayName?.charAt(0).toUpperCase() || user.username.charAt(0).toUpperCase()}
                        </Text>
                    )}
                </View>
                <View style={styles.userInfo}>
                    <Text style={styles.userName}>{user.displayName || user.username}</Text>
                    <Text style={styles.userEmail}>{user.email}</Text>
                </View>
                <View style={[styles.roleBadge, { backgroundColor: getRoleColor(user.role) }]}>
                    <Text style={styles.roleText}>{getRoleLabel(user.role)}</Text>
                </View>
            </View>
            <View style={styles.userFooter}>
                <Text style={styles.activityLabel}>Attività: {user.activityType || 'N/A'}</Text>
                <Text style={styles.lastActivity}>{formatLastActivity(user.lastActivityAt)}</Text>
            </View>
        </View>
    )
}

export default function OnlineUsersScreen() {
    const [minutesAgo, setMinutesAgo] = useState(15)
    const { data: users, isLoading, isError, refetch } = useOnlineUsers(minutesAgo)

    const timeOptions = [
        { value: 5, label: '5 min' },
        { value: 15, label: '15 min' },
        { value: 30, label: '30 min' },
        { value: 60, label: '1 ora' },
    ]

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <Text style={styles.headerTitle}>Utenti Online</Text>
            </View>

            <View style={styles.filterContainer}>
                {timeOptions.map((option) => (
                    <TouchableOpacity
                        key={option.value}
                        style={[
                            styles.filterButton,
                            minutesAgo === option.value && styles.filterButtonActive
                        ]}
                        onPress={() => setMinutesAgo(option.value)}
                    >
                        <Text style={[
                            styles.filterButtonText,
                            minutesAgo === option.value && styles.filterButtonTextActive
                        ]}>
                            {option.label}
                        </Text>
                    </TouchableOpacity>
                ))}
            </View>

            <ScrollView
                style={styles.scrollView}
                refreshControl={
                    <RefreshControl refreshing={isLoading} onRefresh={refetch} />
                }
            >
                {isLoading ? (
                    <View style={styles.center}>
                        <ActivityIndicator size="large" color="#ff8c00" />
                        <Text style={styles.loadingText}>Caricamento utenti...</Text>
                    </View>
                ) : isError ? (
                    <View style={styles.center}>
                        <Text style={styles.errorText}>Errore caricamento utenti</Text>
                    </View>
                ) : !users || users.length === 0 ? (
                    <View style={styles.emptyState}>
                        <Text style={styles.emptyIcon}>👥</Text>
                        <Text style={styles.emptyTitle}>Nessun utente online</Text>
                        <Text style={styles.emptyDescription}>
                            Nessuna attività rilevata negli ultimi {minutesAgo} minuti
                        </Text>
                    </View>
                ) : (
                    <>
                        <Text style={styles.countLabel}>
                            {users.length} utent{users.length === 1 ? 'e' : 'i'} online
                        </Text>
                        {users.map((user) => (
                            <UserCard key={user.userId} user={user} />
                        ))}
                    </>
                )}
            </ScrollView>
        </View>
    )
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#0b0f1a',
    },
    header: {
        padding: 20,
        borderBottomWidth: 1,
        borderBottomColor: '#2a2a2a',
    },
    headerTitle: {
        fontSize: 24,
        fontWeight: 'bold',
        color: '#fff',
    },
    filterContainer: {
        flexDirection: 'row',
        padding: 20,
        gap: 8,
        borderBottomWidth: 1,
        borderBottomColor: '#2a2a2a',
    },
    filterButton: {
        flex: 1,
        paddingVertical: 10,
        paddingHorizontal: 15,
        borderRadius: 8,
        backgroundColor: '#121826',
        borderWidth: 1,
        borderColor: '#2a2a2a',
        alignItems: 'center',
    },
    filterButtonActive: {
        backgroundColor: '#ff8c00',
        borderColor: '#ff8c00',
    },
    filterButtonText: {
        color: '#888',
        fontSize: 12,
        fontWeight: '600',
    },
    filterButtonTextActive: {
        color: '#fff',
    },
    scrollView: {
        flex: 1,
    },
    center: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingVertical: 40,
    },
    loadingText: {
        color: '#fff',
        marginTop: 10,
    },
    errorText: {
        color: '#ef4444',
        fontSize: 16,
    },
    emptyState: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingVertical: 60,
    },
    emptyIcon: {
        fontSize: 48,
        marginBottom: 15,
    },
    emptyTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#fff',
        marginBottom: 8,
    },
    emptyDescription: {
        color: '#888',
        textAlign: 'center',
        paddingHorizontal: 40,
    },
    countLabel: {
        fontSize: 14,
        color: '#888',
        textAlign: 'center',
        marginBottom: 15,
        marginTop: 10,
    },
    userCard: {
        backgroundColor: '#121826',
        marginHorizontal: 10,
        marginVertical: 6,
        padding: 16,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#2a2a2a',
    },
    userHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 12,
    },
    avatarContainer: {
        width: 48,
        height: 48,
        borderRadius: 24,
        backgroundColor: '#2a2a2a',
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 12,
    },
    avatarPlaceholder: {
        fontSize: 20,
        fontWeight: 'bold',
        color: '#ff8c00',
    },
    avatarText: {
        fontSize: 24,
    },
    userInfo: {
        flex: 1,
    },
    userName: {
        fontSize: 16,
        fontWeight: 'bold',
        color: '#fff',
        marginBottom: 4,
    },
    userEmail: {
        fontSize: 12,
        color: '#888',
    },
    roleBadge: {
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 12,
    },
    roleText: {
        color: '#fff',
        fontSize: 11,
        fontWeight: 'bold',
    },
    userFooter: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderTopWidth: 1,
        borderTopColor: '#2a2a2a',
        paddingTop: 10,
    },
    activityLabel: {
        fontSize: 12,
        color: '#888',
    },
    lastActivity: {
        fontSize: 12,
        color: '#ff8c00',
        fontWeight: '600',
    },
})
