// src/features/notifications/screens/NotificationsScreen.tsx

import React, { useContext } from 'react'
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    RefreshControl,
    TouchableOpacity,
} from 'react-native'

import { useNavigation } from '@react-navigation/native'
import { AuthContext } from '@/features/auth/context/AuthContext'
import { 
    useUserNotifications, 
    useUnreadNotificationsCount,
    useMarkNotificationAsRead,
    useMarkAllNotificationsAsRead,
    useDeleteAllNotifications
} from '../hooks/useNotifications'
import { Notification, NotificationType } from '../types/notifications.types'
import { useCustomAlert, CustomAlert } from '@/shared/components/CustomAlert'

export default function NotificationsScreen() {
    const navigation = useNavigation<any>()
    const auth = useContext(AuthContext)
    
    if (!auth) return null

    const { user } = auth
    if (!user) return null

    const { data: notifications, isLoading, refetch } = useUserNotifications(user.id)
    const { data: unreadCount, refetch: refetchUnreadCount } = useUnreadNotificationsCount(user.id)
    
    const markAsReadMutation = useMarkNotificationAsRead()
    const markAllAsReadMutation = useMarkAllNotificationsAsRead()
    const deleteAllMutation = useDeleteAllNotifications()
    const { alert, showWarning } = useCustomAlert()

    const handleMarkAsRead = (notificationId: string) => {
        markAsReadMutation.mutate(notificationId)
    }

    const handleMarkAllAsRead = () => {
        showWarning(
            'Conferma',
            'Sei sicuro di voler segnare tutte le notifiche come lette?',
            () => markAllAsReadMutation.mutate(user.id)
        )
    }

    const handleDeleteAll = () => {
        showWarning(
            'Conferma',
            'Sei sicuro di voler eliminare tutte le notifiche?',
            () => deleteAllMutation.mutate(user.id)
        )
    }

    const getNotificationIcon = (type: NotificationType) => {
        switch (type) {
            case NotificationType.TRAINING_PROGRAM_GENERATED:
                return '🏋️'
            case NotificationType.TRAINING_REMINDER:
                return '⏰'
            case NotificationType.GOAL_ACHIEVED:
                return '🎯'
            case NotificationType.PROFILE_UPDATED:
                return '👤'
            case NotificationType.TEAM_INVITATION:
                return '👥'
            case NotificationType.VIDEO_ANALYSIS_COMPLETED:
                return '🎥'
            case NotificationType.SYSTEM_ANNOUNCEMENT:
                return '📢'
            default:
                return '📬'
        }
    }

    const getNotificationColor = (type: NotificationType) => {
        switch (type) {
            case NotificationType.TRAINING_PROGRAM_GENERATED:
                return '#ff8c00'
            case NotificationType.TRAINING_REMINDER:
                return '#4CAF50'
            case NotificationType.GOAL_ACHIEVED:
                return '#2196F3'
            case NotificationType.PROFILE_UPDATED:
                return '#9C27B0'
            case NotificationType.TEAM_INVITATION:
                return '#FF9800'
            case NotificationType.VIDEO_ANALYSIS_COMPLETED:
                return '#F44336'
            case NotificationType.SYSTEM_ANNOUNCEMENT:
                return '#607D8B'
            default:
                return '#757575'
        }
    }

    const formatDate = (dateString: string) => {
        const date = new Date(dateString)
        const now = new Date()
        const diffInHours = (now.getTime() - date.getTime()) / (1000 * 60 * 60)

        if (diffInHours < 1) {
            return 'Pochi minuti fa'
        } else if (diffInHours < 24) {
            return `${Math.floor(diffInHours)} ore fa`
        } else if (diffInHours < 48) {
            return 'Ieri'
        } else {
            return date.toLocaleDateString('it-IT')
        }
    }

    const renderNotification = (notification: Notification) => {
        const isUnread = !notification.isRead
        const iconColor = getNotificationColor(notification.type)

        return (
            <TouchableOpacity
                key={notification.id}
                style={[styles.notificationCard, isUnread && styles.unreadCard]}
                onPress={() => handleMarkAsRead(notification.id)}
            >
                <View style={styles.notificationHeader}>
                    <View style={styles.notificationIconContainer}>
                        <Text style={[styles.notificationIcon, { color: iconColor }]}>
                            {getNotificationIcon(notification.type)}
                        </Text>
                    </View>
                    <View style={styles.notificationContent}>
                        <Text style={[styles.notificationTitle, isUnread && styles.unreadTitle]}>
                            {notification.title}
                        </Text>
                        <Text style={styles.notificationBody}>
                            {notification.body}
                        </Text>
                        <Text style={styles.notificationTime}>
                            {formatDate(notification.createdAt)}
                        </Text>
                    </View>
                    {isUnread && (
                        <View style={styles.unreadDot} />
                    )}
                </View>
            </TouchableOpacity>
        )
    }

    const handleRefresh = () => {
        refetch()
        refetchUnreadCount()
    }

    if (isLoading) {
        return (
            <View style={styles.loadingContainer}>
                <Text style={styles.loadingText}>Caricamento notifiche...</Text>
            </View>
        )
    }

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <Text style={styles.title}>Notifiche</Text>
                {unreadCount?.count && unreadCount.count > 0 && (
                    <View style={styles.badge}>
                        <Text style={styles.badgeText}>{unreadCount.count}</Text>
                    </View>
                )}
            </View>

            <View style={styles.actions}>
                {unreadCount?.count && unreadCount.count > 0 && (
                    <TouchableOpacity
                        style={styles.actionButton}
                        onPress={handleMarkAllAsRead}
                        disabled={markAllAsReadMutation.isPending}
                    >
                        <Text style={styles.actionButtonText}>
                            {markAllAsReadMutation.isPending ? 'Elaborazione...' : 'Segna tutte come lette'}
                        </Text>
                    </TouchableOpacity>
                )}
                
                {notifications && notifications.length > 0 && (
                    <TouchableOpacity
                        style={[styles.actionButton, styles.deleteButton]}
                        onPress={handleDeleteAll}
                        disabled={deleteAllMutation.isPending}
                    >
                        <Text style={[styles.actionButtonText, styles.deleteButtonText]}>
                            {deleteAllMutation.isPending ? 'Eliminazione...' : 'Elimina tutte'}
                        </Text>
                    </TouchableOpacity>
                )}
            </View>

            <ScrollView
                contentContainerStyle={{ padding: 20 }}
                refreshControl={
                    <RefreshControl refreshing={isLoading} onRefresh={handleRefresh} />
                }
            >
                {!notifications || notifications.length === 0 ? (
                    <View style={styles.emptyState}>
                        <Text style={styles.emptyText}>Nessuna notifica</Text>
                        <Text style={styles.emptySubtext}>Le tue notifiche appariranno qui</Text>
                    </View>
                ) : (
                    Array.isArray(notifications) ? notifications.map(renderNotification) : []
                )}
            </ScrollView>
            <CustomAlert {...alert} />
        </View>
    )
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#1a1a1a',
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#1a1a1a',
    },
    loadingText: {
        color: '#fff',
        fontSize: 18,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 20,
        paddingVertical: 15,
        borderBottomWidth: 1,
        borderBottomColor: '#333',
    },
    title: {
        fontSize: 24,
        fontWeight: '700',
        color: '#fff',
    },
    badge: {
        backgroundColor: '#ff8c00',
        borderRadius: 12,
        paddingHorizontal: 8,
        paddingVertical: 4,
        minWidth: 24,
        alignItems: 'center',
    },
    badgeText: {
        color: '#fff',
        fontSize: 12,
        fontWeight: '600',
    },
    actions: {
        flexDirection: 'row',
        paddingHorizontal: 20,
        paddingVertical: 10,
        gap: 10,
    },
    actionButton: {
        backgroundColor: '#2a2a2a',
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: 8,
        flex: 1,
        alignItems: 'center',
    },
    deleteButton: {
        backgroundColor: '#ff4444',
    },
    actionButtonText: {
        color: '#fff',
        fontSize: 14,
        fontWeight: '600',
    },
    deleteButtonText: {
        color: '#fff',
    },
    emptyState: {
        alignItems: 'center',
        marginTop: 100,
    },
    emptyText: {
        color: '#fff',
        fontSize: 18,
        fontWeight: '600',
        marginBottom: 8,
    },
    emptySubtext: {
        color: '#ccc',
        fontSize: 14,
    },
    notificationCard: {
        backgroundColor: '#2a2a2a',
        borderRadius: 12,
        padding: 16,
        marginBottom: 12,
        borderLeftWidth: 3,
        borderLeftColor: '#333',
    },
    unreadCard: {
        backgroundColor: '#333',
        borderLeftColor: '#ff8c00',
    },
    notificationHeader: {
        flexDirection: 'row',
        alignItems: 'flex-start',
    },
    notificationIconContainer: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: '#1a1a1a',
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 12,
    },
    notificationIcon: {
        fontSize: 20,
    },
    notificationContent: {
        flex: 1,
    },
    notificationTitle: {
        color: '#fff',
        fontSize: 16,
        fontWeight: '600',
        marginBottom: 4,
    },
    unreadTitle: {
        fontWeight: '700',
    },
    notificationBody: {
        color: '#ccc',
        fontSize: 14,
        marginBottom: 8,
        lineHeight: 20,
    },
    notificationTime: {
        color: '#888',
        fontSize: 12,
    },
    unreadDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: '#ff8c00',
        marginLeft: 8,
        marginTop: 4,
    },
})
