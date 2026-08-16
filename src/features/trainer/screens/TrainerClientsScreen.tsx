import React, { useState, useEffect, useContext } from 'react'
import {
    View,
    Text,
    StyleSheet,
    FlatList,
    TouchableOpacity,
    ActivityIndicator,
    Modal,
    TextInput,
    ScrollView,
    RefreshControl,
} from 'react-native'
import { AuthContext } from '@/features/auth/context/AuthContext'
import { colors } from '@/shared/theme/colors'
import {
    getTrainerPlayersProgress,
    getPlayerDetailsForTrainer,
    addTrainerFeedback,
} from '@/features/trainerFollow/api/trainerFollow.api'
import { useCustomAlert, CustomAlert } from '@/shared/components/CustomAlert'
import { Users, Activity, Award, MessageSquare, X, Send, ChevronRight } from 'lucide-react-native'

export default function TrainerClientsScreen() {
    const auth = useContext(AuthContext)
    const user = auth?.user
    const { alert, showError, showSuccess } = useCustomAlert()

    const [loading, setLoading] = useState(true)
    const [refreshing, setRefreshing] = useState(false)
    const [clients, setClients] = useState<any[]>([])

    // Detail Modal State
    const [selectedPlayer, setSelectedPlayer] = useState<any>(null)
    const [modalVisible, setModalVisible] = useState(false)
    const [playerDetails, setPlayerDetails] = useState<any>(null)
    const [loadingDetails, setLoadingDetails] = useState(false)

    // Feedback Input State
    const [feedbackText, setFeedbackText] = useState('')
    const [submittingFeedback, setSubmittingFeedback] = useState(false)

    useEffect(() => {
        loadClients()
    }, [user?.id])

    const loadClients = async () => {
        if (!user?.id) return
        try {
            setLoading(true)
            const data = await getTrainerPlayersProgress(user.id)
            setClients(data || [])
        } catch (error: any) {
            console.error('Errore caricamento atleti seguiti:', error)
            setClients([])
        } finally {
            setLoading(false)
            setRefreshing(false)
        }
    }

    const handleRefresh = () => {
        setRefreshing(true)
        loadClients()
    }

    const handleOpenDetail = async (player: any) => {
        setSelectedPlayer(player)
        setModalVisible(true)
        setFeedbackText('')
        setLoadingDetails(true)
        try {
            const playerId = player.playerId || player.id
            const details = await getPlayerDetailsForTrainer(playerId, user?.id || '')
            setPlayerDetails(details)
        } catch (error) {
            console.error('Errore caricamento dettagli atleta:', error)
            setPlayerDetails(player)
        } finally {
            setLoadingDetails(false)
        }
    }

    const handleSendFeedback = async () => {
        if (!feedbackText.trim() || !selectedPlayer || !user?.id) {
            showError('Attenzione', 'Inserisci un testo prima di inviare il feedback.')
            return
        }

        setSubmittingFeedback(true)
        try {
            const playerId = selectedPlayer.playerId || selectedPlayer.id
            await addTrainerFeedback({
                trainerId: user.id,
                playerId: playerId,
                feedback: feedbackText.trim(),
            })
            showSuccess('Successo', 'Feedback tecnico inviato con successo!')
            setFeedbackText('')
            // Ricarica dettagli
            const updatedDetails = await getPlayerDetailsForTrainer(playerId, user.id)
            setPlayerDetails(updatedDetails)
        } catch (error: any) {
            showError('Errore', error.message || 'Impossibile inviare il feedback.')
        } finally {
            setSubmittingFeedback(false)
        }
    }

    const renderClientCard = ({ item }: { item: any }) => {
        const playerName = item.displayName || item.playerName || item.username || 'Atleta'
        const totalSessions = item.totalSessions || item.sessionsCount || 0
        const score = item.workoutScore || item.score || 0
        const streak = item.streakDays || item.streak || 0
        const activeGoals = item.activeGoalsCount || 0

        return (
            <TouchableOpacity
                style={styles.card}
                activeOpacity={0.8}
                onPress={() => handleOpenDetail(item)}
            >
                <View style={styles.cardHeader}>
                    <View style={styles.avatarPlaceholder}>
                        <Text style={styles.avatarText}>{playerName.charAt(0).toUpperCase()}</Text>
                    </View>

                    <View style={styles.playerInfo}>
                        <Text style={styles.playerName}>{playerName}</Text>
                        <Text style={styles.playerRole}>{item.preferredPosition || item.roleCode || 'Giocatore'}</Text>
                    </View>

                    <ChevronRight color={colors.primary} size={20} />
                </View>

                <View style={styles.statsRow}>
                    <View style={styles.statBox}>
                        <Activity size={16} color={colors.primary} />
                        <Text style={styles.statValue}>{totalSessions}</Text>
                        <Text style={styles.statLabel}>Sessioni</Text>
                    </View>

                    <View style={styles.statBox}>
                        <Award size={16} color="#F59E0B" />
                        <Text style={styles.statValue}>{score}</Text>
                        <Text style={styles.statLabel}>Score</Text>
                    </View>

                    <View style={styles.statBox}>
                        <Text style={[styles.statValue, { color: '#10B981' }]}>🔥 {streak}</Text>
                        <Text style={styles.statLabel}>Streak</Text>
                    </View>

                    <View style={styles.statBox}>
                        <Users size={16} color="#6366F1" />
                        <Text style={styles.statValue}>{activeGoals}</Text>
                        <Text style={styles.statLabel}>Obiettivi</Text>
                    </View>
                </View>
            </TouchableOpacity>
        )
    }

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <Text style={styles.title}>Atleti Seguiti</Text>
                <Text style={styles.subtitle}>Monitora i progressi e invia feedback tecnici</Text>
            </View>

            {loading ? (
                <View style={styles.centerContainer}>
                    <ActivityIndicator size="large" color={colors.primary} />
                    <Text style={styles.loadingText}>Caricamento atleti...</Text>
                </View>
            ) : (
                <FlatList
                    data={clients}
                    keyExtractor={(item, index) => item.id || item.playerId || index.toString()}
                    renderItem={renderClientCard}
                    contentContainerStyle={styles.listContent}
                    refreshControl={
                        <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.primary} />
                    }
                    ListEmptyComponent={
                        <View style={styles.emptyContainer}>
                            <Users size={48} color="#4B5563" />
                            <Text style={styles.emptyTitle}>Nessun atleta seguito</Text>
                            <Text style={styles.emptySubtitle}>
                                Cerca atleti nella sezione Scouting e inizia a seguirli per valutarne i progressi.
                            </Text>
                        </View>
                    }
                />
            )}

            {/* Modal Dettaglio Atleta & Form Feedback */}
            <Modal visible={modalVisible} animationType="slide" transparent={true} onRequestClose={() => setModalVisible(false)}>
                <View style={styles.modalOverlay}>
                    <View style={styles.modalContent}>
                        <View style={styles.modalHeader}>
                            <Text style={styles.modalTitle}>Scheda Atleta</Text>
                            <TouchableOpacity onPress={() => setModalVisible(false)} style={styles.closeButton}>
                                <X color="#9CA3AF" size={24} />
                            </TouchableOpacity>
                        </View>

                        {loadingDetails ? (
                            <View style={styles.modalLoading}>
                                <ActivityIndicator size="large" color={colors.primary} />
                            </View>
                        ) : (
                            <ScrollView style={styles.modalBody} showsVerticalScrollIndicator={false}>
                                <View style={styles.playerDetailHeader}>
                                    <View style={styles.largeAvatar}>
                                        <Text style={styles.largeAvatarText}>
                                            {(selectedPlayer?.displayName || selectedPlayer?.playerName || 'A').charAt(0).toUpperCase()}
                                        </Text>
                                    </View>
                                    <Text style={styles.detailName}>
                                        {selectedPlayer?.displayName || selectedPlayer?.playerName || selectedPlayer?.username}
                                    </Text>
                                    <Text style={styles.detailSub}>
                                        {selectedPlayer?.city ? `${selectedPlayer.city}, ` : ''}{selectedPlayer?.country || 'Italia'}
                                    </Text>
                                </View>

                                {/* Physical Info */}
                                <View style={styles.detailSection}>
                                    <Text style={styles.sectionTitle}>Parametri Fisici</Text>
                                    <View style={styles.gridRow}>
                                        <View style={styles.gridItem}>
                                            <Text style={styles.gridLabel}>Altezza</Text>
                                            <Text style={styles.gridValue}>{playerDetails?.heightCm || selectedPlayer?.heightCm || '--'} cm</Text>
                                        </View>
                                        <View style={styles.gridItem}>
                                            <Text style={styles.gridLabel}>Peso</Text>
                                            <Text style={styles.gridValue}>{playerDetails?.weightKg || selectedPlayer?.weightKg || '--'} kg</Text>
                                        </View>
                                        <View style={styles.gridItem}>
                                            <Text style={styles.gridLabel}>Elevazione</Text>
                                            <Text style={styles.gridValue}>{playerDetails?.verticalJumpCm || '--'} cm</Text>
                                        </View>
                                    </View>
                                </View>

                                {/* Technical Feedback Form */}
                                <View style={styles.detailSection}>
                                    <Text style={styles.sectionTitle}>Invia Feedback Tecnico</Text>
                                    <TextInput
                                        style={styles.feedbackInput}
                                        placeholder="Scrivi una nota o un consiglio di allenamento..."
                                        placeholderTextColor="#6B7280"
                                        multiline
                                        numberOfLines={3}
                                        value={feedbackText}
                                        onChangeText={setFeedbackText}
                                    />
                                    <TouchableOpacity
                                        style={styles.sendButton}
                                        onPress={handleSendFeedback}
                                        disabled={submittingFeedback}
                                    >
                                        {submittingFeedback ? (
                                            <ActivityIndicator color="#FFF" size="small" />
                                        ) : (
                                            <>
                                                <Send size={16} color="#FFF" style={{ marginRight: 8 }} />
                                                <Text style={styles.sendButtonText}>Invia Feedback</Text>
                                            </>
                                        )}
                                    </TouchableOpacity>
                                </View>

                                {/* History Feedbacks */}
                                {playerDetails?.feedbacks && playerDetails.feedbacks.length > 0 && (
                                    <View style={styles.detailSection}>
                                        <Text style={styles.sectionTitle}>Storico Note Tecniche</Text>
                                        {playerDetails.feedbacks.map((fb: any, i: number) => (
                                            <View key={fb.id || i} style={styles.feedbackCard}>
                                                <View style={styles.feedbackCardHeader}>
                                                    <MessageSquare size={14} color={colors.primary} />
                                                    <Text style={styles.feedbackDate}>{fb.createdAt ? new Date(fb.createdAt).toLocaleDateString('it-IT') : 'Recente'}</Text>
                                                </View>
                                                <Text style={styles.feedbackContent}>{fb.feedback}</Text>
                                            </View>
                                        ))}
                                    </View>
                                )}
                            </ScrollView>
                        )}
                    </View>
                </View>
            </Modal>

            <CustomAlert {...alert} />
        </View>
    )
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#0B0F1A',
        padding: 20,
    },
    header: {
        marginBottom: 20,
    },
    title: {
        fontSize: 26,
        fontWeight: 'bold',
        color: '#FFFFFF',
    },
    subtitle: {
        fontSize: 14,
        color: '#9CA3AF',
        marginTop: 4,
    },
    centerContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    loadingText: {
        color: '#9CA3AF',
        marginTop: 10,
    },
    listContent: {
        paddingBottom: 40,
    },
    card: {
        backgroundColor: '#1F2937',
        borderRadius: 16,
        padding: 16,
        marginBottom: 14,
        borderWidth: 1,
        borderColor: '#374151',
    },
    cardHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 14,
    },
    avatarPlaceholder: {
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: colors.primary,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 12,
    },
    avatarText: {
        color: '#FFF',
        fontSize: 18,
        fontWeight: 'bold',
    },
    playerInfo: {
        flex: 1,
    },
    playerName: {
        color: '#FFFFFF',
        fontSize: 17,
        fontWeight: 'bold',
    },
    playerRole: {
        color: '#9CA3AF',
        fontSize: 13,
        marginTop: 2,
    },
    statsRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        backgroundColor: '#111827',
        borderRadius: 12,
        padding: 12,
    },
    statBox: {
        alignItems: 'center',
        flex: 1,
    },
    statValue: {
        color: '#FFF',
        fontSize: 15,
        fontWeight: 'bold',
        marginTop: 4,
    },
    statLabel: {
        color: '#6B7280',
        fontSize: 11,
        marginTop: 2,
    },
    emptyContainer: {
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 60,
        paddingHorizontal: 20,
    },
    emptyTitle: {
        color: '#FFF',
        fontSize: 18,
        fontWeight: 'bold',
        marginTop: 16,
    },
    emptySubtitle: {
        color: '#9CA3AF',
        fontSize: 14,
        textAlign: 'center',
        marginTop: 8,
        lineHeight: 20,
    },
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.75)',
        justifyContent: 'flex-end',
    },
    modalContent: {
        backgroundColor: '#1F2937',
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        maxHeight: '85%',
        padding: 20,
    },
    modalHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 16,
    },
    modalTitle: {
        fontSize: 20,
        fontWeight: 'bold',
        color: '#FFF',
    },
    closeButton: {
        padding: 4,
    },
    modalLoading: {
        paddingVertical: 40,
        alignItems: 'center',
    },
    modalBody: {
        marginBottom: 10,
    },
    playerDetailHeader: {
        alignItems: 'center',
        marginBottom: 20,
    },
    largeAvatar: {
        width: 64,
        height: 64,
        borderRadius: 32,
        backgroundColor: colors.primary,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 8,
    },
    largeAvatarText: {
        color: '#FFF',
        fontSize: 26,
        fontWeight: 'bold',
    },
    detailName: {
        color: '#FFF',
        fontSize: 20,
        fontWeight: 'bold',
    },
    detailSub: {
        color: '#9CA3AF',
        fontSize: 13,
        marginTop: 2,
    },
    detailSection: {
        marginBottom: 20,
    },
    sectionTitle: {
        color: colors.primary,
        fontSize: 14,
        fontWeight: 'bold',
        textTransform: 'uppercase',
        marginBottom: 10,
    },
    gridRow: {
        flexDirection: 'row',
        gap: 10,
    },
    gridItem: {
        flex: 1,
        backgroundColor: '#111827',
        borderRadius: 10,
        padding: 10,
        alignItems: 'center',
    },
    gridLabel: {
        color: '#6B7280',
        fontSize: 11,
    },
    gridValue: {
        color: '#FFF',
        fontSize: 15,
        fontWeight: 'bold',
        marginTop: 4,
    },
    feedbackInput: {
        backgroundColor: '#111827',
        color: '#FFF',
        borderRadius: 12,
        padding: 12,
        fontSize: 14,
        textAlignVertical: 'top',
        marginBottom: 12,
    },
    sendButton: {
        backgroundColor: colors.primary,
        borderRadius: 12,
        paddingVertical: 12,
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
    },
    sendButtonText: {
        color: '#FFF',
        fontWeight: 'bold',
        fontSize: 15,
    },
    feedbackCard: {
        backgroundColor: '#111827',
        borderRadius: 10,
        padding: 12,
        marginBottom: 8,
    },
    feedbackCardHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 6,
    },
    feedbackDate: {
        color: '#6B7280',
        fontSize: 11,
        marginLeft: 6,
    },
    feedbackContent: {
        color: '#D1D5DB',
        fontSize: 13,
        lineHeight: 18,
    },
})
