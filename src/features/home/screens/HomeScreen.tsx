import React, { useContext, useState, useEffect } from 'react'
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    TouchableOpacity,
    ActivityIndicator,
    Modal,
    TextInput,
    RefreshControl,
} from 'react-native'
import { useNavigation } from '@react-navigation/native'
import { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { AuthContext } from '@/features/auth/context/AuthContext'
import { UserRole } from '@/features/auth/types/auth.types'
import { useRolePermissions } from '@/features/auth/hooks/useRolePermissions'
import { useProfile } from '@/features/profile/hooks/useProfile'
import { useGoals } from '@/features/goals/hooks/useGoals'
import { useCreateGoal } from '@/features/goals/hooks/useCreateGoal'
import { useOnlineUsers } from '@/features/users/hooks/useOnlineUsers'
import { NavigationMenu } from '@/features/navigation/components/NavigationMenu'
import { MainStackParamList } from '@/app/navigation/types'
import { useCustomAlert, CustomAlert } from '@/shared/components/CustomAlert'
import { useQueryClient } from '@tanstack/react-query'

type NavigationProp = NativeStackNavigationProp<MainStackParamList>

export default function HomeScreen() {
    const auth = useContext(AuthContext)
    const navigation = useNavigation<NavigationProp>()
    const { getRoleLabel, getRoleColor } = useRolePermissions()
    const { alert, showWarning } = useCustomAlert()
    
    if (!auth) return null

    const { user, isLoading } = auth

    // Check if user is admin
    const isAdmin = user?.roles?.includes(UserRole.ADMIN) || false

    // 🔹 1. Fetch profile
    const {
        data: profile,
        isLoading: profileLoading,
    } = useProfile(user?.id)

    // 🔹 2. Estraggo athleteId in modo esplicito
    //const athleteId = profile?.id
    const athleteId = user?.id

    // 🔹 3. Fetch goals SOLO quando athleteId esiste e non è admin
    const {
        data: goals = [],
        isLoading: goalsLoading,
    } = useGoals(isAdmin ? undefined : athleteId)

    // 🔹 4. Fetch online users (solo admin)
    const {
        data: onlineUsers = [],
        isLoading: onlineUsersLoading,
    } = useOnlineUsers(isAdmin ? 15 : undefined)

    const createGoalMutation = useCreateGoal()
    const queryClient = useQueryClient()

    const [modalVisible, setModalVisible] = useState(false)
    const [title, setTitle] = useState('')
    const [description, setDescription] = useState('')
    const [showNavigationMenu, setShowNavigationMenu] = useState(false)
    const [refreshing, setRefreshing] = useState(false)

    const onRefresh = async () => {
        setRefreshing(true)
        await queryClient.invalidateQueries({ queryKey: ['profile'] })
        await queryClient.invalidateQueries({ queryKey: ['goals'] })
        await queryClient.invalidateQueries({ queryKey: ['onlineUsers'] })
        setRefreshing(false)
    }

    const completedGoals =
        goals.filter((g) => g.completed).length

    const isDataLoading = profileLoading || goalsLoading || auth.isLoading

    // Check if user has no goals and show wizard
    useEffect(() => {
        if (!isDataLoading && user && user.hasGoals === false) {
            // Show alert to offer wizard setup
            showWarning(
                'Benvenuto! 🏀',
                'Non hai ancora impostato nessun obiettivo. Vuoi creare i tuoi primi goal ora?',
                () => navigation.navigate('GoalWizard'),
                () => {}
            )
        }
    }, [isDataLoading, user, navigation])

    if (isDataLoading) {
        return (
            <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
                <ActivityIndicator size="large" color="#ff8c00" />
            </View>
        )
    }

    return (
        <>
            {/* Navigation Menu Modal */}
            {showNavigationMenu && (
                <Modal
                    visible={showNavigationMenu}
                    animationType="slide"
                    transparent
                    onRequestClose={() => setShowNavigationMenu(false)}
                >
                    <View style={styles.modalOverlay}>
                        <View style={styles.modalContent}>
                            <View style={styles.modalHeader}>
                                <Text style={styles.modalTitle}>Menu Navigazione</Text>
                                <TouchableOpacity
                                    style={styles.closeButton}
                                    onPress={() => setShowNavigationMenu(false)}
                                >
                                    <Text style={styles.closeButtonText}>✕</Text>
                                </TouchableOpacity>
                            </View>
                            <NavigationMenu
                                onSectionPress={(section) => {
                                    setShowNavigationMenu(false)
                                    // La navigazione viene gestita internamente dal componente
                                }}
                            />
                        </View>
                    </View>
                </Modal>
            )}

            <ScrollView
                style={styles.container}
                refreshControl={
                    <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
                }
            >
                <View style={styles.header}>
                <View>
                    <Text style={styles.greeting}>Bentornato 👋</Text>
                    <Text style={styles.username}>{user?.displayName || user?.username || 'Utente'}</Text>
                    <View style={styles.roleContainer}>
                        <Text style={[styles.roleText, { color: getRoleColor() }]}>
                            {getRoleLabel()}
                        </Text>
                    </View>
                </View>
                <TouchableOpacity
                    style={styles.logoutButton}
                    onPress={async () => {
                        showWarning(
                            'Logout',
                            'Sei sicuro di voler uscire?',
                            async () => {
                                await auth?.logout()
                            }
                        )
                    }}
                >
                    <Text style={styles.logoutButtonText}>🚪 Esci</Text>
                </TouchableOpacity>
            </View>

            {!isAdmin && (
                <>
                    <View style={styles.card}>
                        <View style={styles.statBox}>
                            <Text style={styles.statValue}>
                                {profile?.level || '-'}
                            </Text>
                            <Text style={styles.statLabel}>Livello</Text>
                        </View>

                        <View style={styles.statBox}>
                            <Text style={styles.statValue}>
                                {completedGoals}
                            </Text>
                            <Text style={styles.statLabel}>Completati</Text>
                        </View>

                        <View style={styles.statBox}>
                            <Text style={styles.statValue}>
                                {goals.length}
                            </Text>
                            <Text style={styles.statLabel}>Totali</Text>
                        </View>
                    </View>

                    <Text style={styles.sectionTitle}>I tuoi Goals</Text>

                    <TouchableOpacity
                        style={styles.addButton}
                        onPress={() => setModalVisible(true)}
                    >
                        <Text style={styles.addButtonText}>
                            ➕ Nuovo Goal
                        </Text>
                    </TouchableOpacity>

                    {goals.length === 0 && (
                        <Text style={{ color: '#aaa', marginBottom: 20 }}>
                            Nessun goal ancora. Creane uno 🚀
                        </Text>
                    )}

                    {goals.map((goal) => (
                        <View key={goal.id} style={styles.goalCard}>
                            <Text style={styles.goalTitle}>
                                {goal.title}
                            </Text>
                            <Text
                                style={[
                                    styles.goalStatus,
                                    {
                                        color: goal.completed
                                            ? '#00ff99'
                                            : '#ff8c00',
                                    },
                                ]}
                            >
                                {goal.completed
                                    ? 'Completato'
                                    : 'In corso'}
                            </Text>
                        </View>
                    ))}
                </>
            )}

            {isAdmin && (
                <>
                    <Text style={styles.sectionTitle}>Utenti Online</Text>

                    {onlineUsersLoading ? (
                        <Text style={{ color: '#aaa', marginBottom: 20 }}>
                            Caricamento...
                        </Text>
                    ) : onlineUsers.length === 0 ? (
                        <Text style={{ color: '#aaa', marginBottom: 20 }}>
                            Nessun utente online negli ultimi 15 minuti
                        </Text>
                    ) : (
                        <>
                            <Text style={{ color: '#888', marginBottom: 10, fontSize: 12 }}>
                                {onlineUsers.length} utent{onlineUsers.length === 1 ? 'e' : 'i'} online
                            </Text>
                            {onlineUsers.slice(0, 5).map((user) => (
                                <View key={user.userId} style={styles.onlineUserCard}>
                                    <View style={styles.onlineUserInfo}>
                                        <Text style={styles.onlineUserName}>
                                            {user.displayName || user.username}
                                        </Text>
                                        <Text style={styles.onlineUserRole}>
                                            {user.roles?.[0] || 'N/A'}
                                        </Text>
                                    </View>
                                    <Text style={styles.onlineUserActivity}>
                                        {user.activityType || 'Attivo'}
                                    </Text>
                                </View>
                            ))}
                            {onlineUsers.length > 5 && (
                                <TouchableOpacity
                                    style={styles.viewMoreButton}
                                    onPress={() => navigation.navigate('admin_users' as any)}
                                >
                                    <Text style={styles.viewMoreText}>
                                        Vedi tutti ({onlineUsers.length})
                                    </Text>
                                </TouchableOpacity>
                            )}
                        </>
                    )}
                </>
            )}
            </ScrollView>

            <Modal
                visible={modalVisible}
                animationType="slide"
                transparent
            >
                <View style={styles.modalContainer}>
                    <View style={styles.modalContent}>
                        <Text style={styles.modalTitle}>
                            Nuovo Goal
                        </Text>

                        <TextInput
                            placeholder="Titolo"
                            placeholderTextColor="#888"
                            style={styles.input}
                            value={title}
                            onChangeText={setTitle}
                        />

                        <TextInput
                            placeholder="Descrizione"
                            placeholderTextColor="#888"
                            style={styles.input}
                            value={description}
                            onChangeText={setDescription}
                        />

                        <TouchableOpacity
                            style={styles.saveButton}
                            onPress={() => {
                                if (!athleteId || !title) return

                                createGoalMutation.mutate({
                                    athleteId,
                                    data: { title, description },
                                })

                                setTitle('')
                                setDescription('')
                                setModalVisible(false)
                            }}
                        >
                            <Text style={styles.saveButtonText}>
                                Salva
                            </Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            onPress={() => setModalVisible(false)}
                        >
                            <Text style={styles.cancelText}>
                                Annulla
                            </Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </Modal>

            <CustomAlert
                visible={alert.visible}
                title={alert.title}
                message={alert.message}
                type={alert.type}
                onConfirm={alert.onConfirm}
                onCancel={alert.onCancel}
                confirmText={alert.confirmText}
                cancelText={alert.cancelText}
                showCancel={alert.showCancel}
            />
        </>
    )
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#0b0f1a',
        paddingHorizontal: 20,
    },
    header: {
        marginTop: 40,
        marginBottom: 20,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    headerButtons: {
        flexDirection: 'column',
        gap: 8,
    },
    menuButton: {
        backgroundColor: '#ff8c00',
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: 8,
    },
    menuButtonText: {
        color: 'white',
        fontWeight: '600',
        fontSize: 14,
    },
    logoutButton: {
        backgroundColor: '#dc2626',
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: 8,
    },
    logoutButtonText: {
        color: 'white',
        fontWeight: '600',
        fontSize: 14,
    },
    greeting: {
        fontSize: 18,
        color: '#aaa',
    },
    username: {
        fontSize: 26,
        fontWeight: 'bold',
        color: 'white',
    },
    roleContainer: {
        marginTop: 4,
    },
    roleText: {
        fontSize: 14,
        fontWeight: '600',
    },
    card: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        backgroundColor: '#121826',
        borderRadius: 15,
        padding: 20,
        marginBottom: 25,
    },
    statBox: {
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
    sectionTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        color: 'white',
        marginBottom: 15,
    },
    addButton: {
        backgroundColor: '#ff8c00',
        padding: 12,
        borderRadius: 12,
        alignItems: 'center',
        marginBottom: 15,
    },
    addButtonText: {
        fontWeight: 'bold',
        color: '#0b0f1a',
    },
    goalCard: {
        backgroundColor: '#121826',
        padding: 15,
        borderRadius: 12,
        marginBottom: 12,
        flexDirection: 'row',
        justifyContent: 'space-between',
    },
    goalTitle: {
        color: 'white',
        fontWeight: 'bold',
    },
    goalStatus: {
        fontWeight: 'bold',
    },
    modalContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: 'rgba(0,0,0,0.6)',
    },
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        justifyContent: 'flex-end',
    },
    modalContent: {
        width: '85%',
        backgroundColor: '#121826',
        padding: 20,
        borderRadius: 15,
    },
    modalTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        color: 'white',
        marginBottom: 15,
    },
    modalHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 20,
        borderBottomWidth: 1,
        borderBottomColor: '#2a2a2a',
    },
    closeButton: {
        width: 32,
        height: 32,
        borderRadius: 16,
        backgroundColor: '#2a2a2a',
        justifyContent: 'center',
        alignItems: 'center',
    },
    closeButtonText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: 'bold',
    },
    input: {
        backgroundColor: '#1c2333',
        color: 'white',
        padding: 12,
        borderRadius: 10,
        marginBottom: 10,
    },
    saveButton: {
        backgroundColor: '#ff8c00',
        padding: 12,
        borderRadius: 10,
        alignItems: 'center',
    },
    saveButtonText: {
        fontWeight: 'bold',
        color: '#0b0f1a',
    },
    cancelText: {
        color: '#aaa',
        marginTop: 10,
        textAlign: 'center',
    },
    onlineUserCard: {
        backgroundColor: '#121826',
        padding: 12,
        borderRadius: 8,
        marginBottom: 8,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    onlineUserInfo: {
        flex: 1,
    },
    onlineUserName: {
        color: '#fff',
        fontWeight: 'bold',
        fontSize: 14,
    },
    onlineUserRole: {
        color: '#888',
        fontSize: 12,
    },
    onlineUserActivity: {
        color: '#ff8c00',
        fontSize: 12,
        fontWeight: '600',
    },
    viewMoreButton: {
        backgroundColor: '#1c2333',
        padding: 10,
        borderRadius: 8,
        alignItems: 'center',
        marginTop: 8,
    },
    viewMoreText: {
        color: '#ff8c00',
        fontSize: 12,
        fontWeight: '600',
    },
})