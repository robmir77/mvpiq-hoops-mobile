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
    Alert,
} from 'react-native'
import { useNavigation } from '@react-navigation/native'
import { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { AuthContext } from '@/features/auth/context/AuthContext'
import { useProfile } from '@/features/profile/hooks/useProfile'
import { useGoals } from '@/features/goals/hooks/useGoals'
import { useCreateGoal } from '@/features/goals/hooks/useCreateGoal'
import { MainStackParamList } from '@/app/navigation/types'

type NavigationProp = NativeStackNavigationProp<MainStackParamList>

export default function HomeScreen() {
    const auth = useContext(AuthContext)
    const navigation = useNavigation<NavigationProp>()
    if (!auth) return null

    const { user, isLoading } = auth

    // 🔹 1. Fetch profile
    const {
        data: profile,
        isLoading: profileLoading,
    } = useProfile(user?.id)

    // 🔹 2. Estraggo athleteId in modo esplicito
    //const athleteId = profile?.id
    const athleteId = user?.id

    // 🔹 3. Fetch goals SOLO quando athleteId esiste
    const {
        data: goals = [],
        isLoading: goalsLoading,
    } = useGoals(athleteId)

    const createGoalMutation = useCreateGoal()

    const [modalVisible, setModalVisible] = useState(false)
    const [title, setTitle] = useState('')
    const [description, setDescription] = useState('')

    const completedGoals =
        goals.filter((g) => g.completed).length

    const isDataLoading = profileLoading || goalsLoading || auth.isLoading

    // Check if user has no goals and show wizard
    useEffect(() => {
        if (!isDataLoading && user && user.hasGoals === false) {
            // Show alert to offer wizard setup
            Alert.alert(
                'Benvenuto! 🏀',
                'Non hai ancora impostato nessun obiettivo. Vuoi creare i tuoi primi goal ora?',
                [
                    {
                        text: 'Più tardi',
                        style: 'cancel',
                    },
                    {
                        text: 'Inizia ora',
                        onPress: () => navigation.navigate('GoalWizard'),
                    },
                ]
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
            <ScrollView style={styles.container}>
                {/* Header */}
                <View style={styles.header}>
                    <View>
                        <Text style={styles.greeting}>Bentornato 👋</Text>
                        <Text style={styles.username}>{user?.displayName || user?.username || 'Utente'}</Text>
                    </View>
                    <TouchableOpacity
                        style={styles.logoutButton}
                        onPress={async () => {
                            Alert.alert(
                                'Logout',
                                'Sei sicuro di voler uscire?',
                                [
                                    {
                                        text: 'Annulla',
                                        style: 'cancel',
                                    },
                                    {
                                        text: 'Esci',
                                        style: 'destructive',
                                        onPress: async () => {
                                            await auth?.logout()
                                        },
                                    },
                                ]
                            )
                        }}
                    >
                        <Text style={styles.logoutButtonText}>🚪 Esci</Text>
                    </TouchableOpacity>
                </View>

                {/* Stats */}
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

                {/* Goals Section */}
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
            </ScrollView>

            {/* MODAL CREAZIONE GOAL */}
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
})