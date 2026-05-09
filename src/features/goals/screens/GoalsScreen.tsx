// src/features/goals/screens/GoalsScreen.tsx

import React, { useContext } from 'react'
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    TouchableOpacity,
    ActivityIndicator,
    Alert,
    RefreshControl,
} from 'react-native'
import { useNavigation } from '@react-navigation/native'
import { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { MainStackParamList } from '@/app/navigation/types'
import { useGoals } from '../hooks/useGoals'
import { AuthContext } from '@/features/auth/context/AuthContext'
import { Goal } from '../types/goals.types'

type NavigationProp = NativeStackNavigationProp<MainStackParamList>

const GoalCard = ({ goal, onPress }: { goal: Goal; onPress: () => void }) => {
    const getStatusColor = (completed: boolean) => {
        return completed ? '#4CAF50' : '#ff8c00'
    }

    const getStatusText = (completed: boolean) => {
        return completed ? 'Completato' : 'Attivo'
    }

    return (
        <TouchableOpacity style={styles.goalCard} onPress={onPress}>
            <View style={styles.goalHeader}>
                <Text style={styles.goalTitle}>{goal.title}</Text>
                <View style={[styles.statusBadge, { backgroundColor: getStatusColor(goal.completed) }]}>
                    <Text style={styles.statusText}>{getStatusText(goal.completed)}</Text>
                </View>
            </View>
            {goal.description && (
                <Text style={styles.goalDescription}>{goal.description}</Text>
            )}
                    </TouchableOpacity>
    )
}

export default function GoalsScreen() {
    const navigation = useNavigation<NavigationProp>()
    const auth = useContext(AuthContext)

    if (!auth) return null

    const { user } = auth
    const { data: goals, isLoading, isError, refetch } = useGoals(user?.id)

    const handleGoalPress = (goal: Goal) => {
        // Naviga ai dettagli del goal o permette di modificarlo
        Alert.alert(
            'Dettagli Goal',
            `${goal.title}\n\n${goal.description || 'Nessuna descrizione'}`,
            [
                { text: 'Chiudi', style: 'cancel' },
                { text: 'Modifica', onPress: () => console.log('Modifica goal:', goal.id) }
            ]
        )
    }

    const handleCreateGoal = () => {
        navigation.navigate('GoalWizard' as any)
    }

    if (isLoading) {
        return (
            <View style={styles.center}>
                <ActivityIndicator size="large" color="#ff8c00" />
                <Text style={styles.loadingText}>Caricamento goals...</Text>
            </View>
        )
    }

    if (isError) {
        return (
            <View style={styles.center}>
                <Text style={styles.errorText}>Errore caricamento goals</Text>
                <TouchableOpacity style={styles.retryButton} onPress={() => refetch()}>
                    <Text style={styles.retryText}>Riprova</Text>
                </TouchableOpacity>
            </View>
        )
    }

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <Text style={styles.headerTitle}>I Miei Obiettivi</Text>
                <TouchableOpacity style={styles.createButton} onPress={handleCreateGoal}>
                    <Text style={styles.createButtonText}>+ Nuovo Goal</Text>
                </TouchableOpacity>
            </View>

            <ScrollView
                style={styles.scrollView}
                refreshControl={
                    <RefreshControl refreshing={isLoading} onRefresh={refetch} />
                }
            >
                {!goals || goals.length === 0 ? (
                    <View style={styles.emptyState}>
                        <Text style={styles.emptyTitle}>Nessun obiettivo</Text>
                        <Text style={styles.emptyDescription}>
                            Crea il tuo primo obiettivo per iniziare a tracciare i tuoi progressi
                        </Text>
                        <TouchableOpacity style={styles.createFirstButton} onPress={handleCreateGoal}>
                            <Text style={styles.createFirstButtonText}>Crea Goal</Text>
                        </TouchableOpacity>
                    </View>
                ) : (
                    goals.map((goal) => (
                        <GoalCard
                            key={goal.id}
                            goal={goal}
                            onPress={() => handleGoalPress(goal)}
                        />
                    ))
                )}
            </ScrollView>
        </View>
    )
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#1a1a1a',
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 20,
        borderBottomWidth: 1,
        borderBottomColor: '#333',
    },
    headerTitle: {
        fontSize: 24,
        fontWeight: 'bold',
        color: '#fff',
    },
    createButton: {
        backgroundColor: '#ff8c00',
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: 20,
    },
    createButtonText: {
        color: '#fff',
        fontWeight: 'bold',
        fontSize: 14,
    },
    scrollView: {
        flex: 1,
    },
    goalCard: {
        backgroundColor: '#2a2a2a',
        margin: 10,
        padding: 16,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#333',
    },
    goalHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 8,
    },
    goalTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#fff',
        flex: 1,
    },
    statusBadge: {
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 12,
    },
    statusText: {
        color: '#fff',
        fontSize: 12,
        fontWeight: 'bold',
    },
    goalDescription: {
        color: '#ccc',
        fontSize: 14,
        marginBottom: 12,
    },
    progressContainer: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    progressText: {
        color: '#888',
        fontSize: 12,
    },
    currentValue: {
        color: '#ff8c00',
        fontSize: 12,
        fontWeight: 'bold',
    },
    center: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    loadingText: {
        color: '#fff',
        marginTop: 10,
    },
    errorText: {
        color: '#ff4444',
        fontSize: 16,
        marginBottom: 20,
    },
    retryButton: {
        backgroundColor: '#ff8c00',
        paddingHorizontal: 20,
        paddingVertical: 10,
        borderRadius: 8,
    },
    retryText: {
        color: '#fff',
        fontWeight: 'bold',
    },
    emptyState: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingVertical: 60,
    },
    emptyTitle: {
        fontSize: 20,
        fontWeight: 'bold',
        color: '#fff',
        marginBottom: 8,
    },
    emptyDescription: {
        color: '#888',
        textAlign: 'center',
        marginBottom: 20,
        paddingHorizontal: 40,
    },
    createFirstButton: {
        backgroundColor: '#ff8c00',
        paddingHorizontal: 24,
        paddingVertical: 12,
        borderRadius: 8,
    },
    createFirstButtonText: {
        color: '#fff',
        fontWeight: 'bold',
        fontSize: 16,
    },
})
