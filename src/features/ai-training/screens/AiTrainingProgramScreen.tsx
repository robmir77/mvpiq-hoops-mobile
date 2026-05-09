// src/features/ai-training/screens/AiTrainingProgramScreen.tsx

import React, { useContext } from 'react'
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    TouchableOpacity,
    RefreshControl,
} from 'react-native'

import { useNavigation, useRoute } from '@react-navigation/native'
import { AuthContext } from '@/features/auth/context/AuthContext'
import { useTrainingProgram, useRegenerateTrainingProgram } from '../hooks/useAiTraining'
import { TrainingProgram, TrainingWeek, TrainingDay, TrainingExercise, SkillLevel } from '../types/ai-training.types'

export default function AiTrainingProgramScreen() {
    const navigation = useNavigation<any>()
    const route = useRoute<any>()
    const auth = useContext(AuthContext)
    
    if (!auth) return null

    const { programId } = route.params || {}
    const { data: program, isLoading, refetch } = useTrainingProgram(programId)
    const regenerateMutation = useRegenerateTrainingProgram()

    const handleRegenerate = () => {
        if (!program) return
        
        const request = {
            goal: program.goal,
            skillLevel: SkillLevel.INTERMEDIATE, // Default, potrebbe essere migliorato
            position: auth.user?.mainPosition,
            sessionsPerWeek: program.sessionsPerWeek,
            sessionDurationMinutes: program.sessionDurationMinutes,
            weeks: program.weeks.length
        }

        regenerateMutation.mutate({ programId, request }, {
            onSuccess: (data) => {
                if (data.program) {
                    refetch()
                }
            }
        })
    }

    const renderExercise = (exercise: TrainingExercise) => (
        <View key={exercise.id} style={styles.exercise}>
            <View style={styles.exerciseHeader}>
                <Text style={styles.exerciseName}>Esercizio {exercise.orderNumber}</Text>
                <Text style={styles.exerciseDuration}>{exercise.durationMinutes} min</Text>
            </View>
            {exercise.repetitions && (
                <Text style={styles.exerciseReps}>Ripetizioni: {exercise.repetitions}</Text>
            )}
            {exercise.notes && (
                <Text style={styles.exerciseNotes}>{exercise.notes}</Text>
            )}
        </View>
    )

    const renderDay = (day: TrainingDay) => (
        <View key={day.id} style={styles.day}>
            <Text style={styles.dayTitle}>Giorno {day.dayNumber}: {day.title}</Text>
            <View style={styles.exercisesContainer}>
                {day.exercises.map(renderExercise)}
            </View>
        </View>
    )

    const renderWeek = (week: TrainingWeek) => (
        <View key={week.id} style={styles.week}>
            <Text style={styles.weekTitle}>Settimana {week.weekNumber}</Text>
            <View style={styles.daysContainer}>
                {week.days.map(renderDay)}
            </View>
        </View>
    )

    if (isLoading) {
        return (
            <View style={styles.loadingContainer}>
                <Text style={styles.loadingText}>Caricamento programma...</Text>
            </View>
        )
    }

    if (!program) {
        return (
            <View style={styles.errorContainer}>
                <Text style={styles.errorText}>Programma non trovato</Text>
            </View>
        )
    }

    return (
        <View style={styles.container}>
            <ScrollView 
                contentContainerStyle={{ padding: 20 }}
                refreshControl={
                    <RefreshControl refreshing={isLoading} onRefresh={refetch} />
                }
            >
                <View style={styles.header}>
                    <Text style={styles.title}>{program.title}</Text>
                    <Text style={styles.goal}>Obiettivo: {program.goal}</Text>
                    
                    <View style={styles.metaInfo}>
                        <Text style={styles.metaText}>📅 {program.weeks.length} settimane</Text>
                        <Text style={styles.metaText}>⏱️ {program.sessionDurationMinutes} min/sessione</Text>
                        <Text style={styles.metaText}>🔄 {program.sessionsPerWeek} sessioni/sett</Text>
                    </View>

                    {program.generatedByAi && (
                        <View style={styles.aiBadge}>
                            <Text style={styles.aiBadgeText}>🤖 Generato da AI</Text>
                        </View>
                    )}

                    <TouchableOpacity
                        style={[styles.regenerateButton, regenerateMutation.isPending && styles.disabledButton]}
                        onPress={handleRegenerate}
                        disabled={regenerateMutation.isPending}
                    >
                        <Text style={styles.regenerateButtonText}>
                            {regenerateMutation.isPending ? 'Rigenerazione...' : '🔄 Rigenera Programma'}
                        </Text>
                    </TouchableOpacity>
                </View>

                <View style={styles.programContent}>
                    {program.weeks.map(renderWeek)}
                </View>
            </ScrollView>
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
    errorContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#1a1a1a',
    },
    errorText: {
        color: '#ff6b6b',
        fontSize: 18,
        textAlign: 'center',
    },
    header: {
        marginBottom: 30,
        gap: 15,
    },
    title: {
        fontSize: 24,
        fontWeight: '700',
        color: '#fff',
        marginBottom: 5,
    },
    goal: {
        fontSize: 16,
        color: '#ff8c00',
        fontWeight: '600',
    },
    metaInfo: {
        flexDirection: 'row',
        gap: 15,
        marginTop: 10,
    },
    metaText: {
        fontSize: 14,
        color: '#ccc',
    },
    aiBadge: {
        backgroundColor: '#ff8c00',
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 8,
        alignSelf: 'flex-start',
        marginTop: 10,
    },
    aiBadgeText: {
        color: '#fff',
        fontSize: 12,
        fontWeight: '600',
    },
    regenerateButton: {
        backgroundColor: '#ff8c00',
        padding: 12,
        borderRadius: 8,
        alignItems: 'center',
        marginTop: 15,
    },
    disabledButton: {
        backgroundColor: '#666',
        opacity: 0.6,
    },
    regenerateButtonText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: '600',
    },
    programContent: {
        gap: 25,
    },
    week: {
        backgroundColor: '#2a2a2a',
        borderRadius: 12,
        padding: 20,
        marginBottom: 20,
    },
    weekTitle: {
        fontSize: 18,
        fontWeight: '700',
        color: '#ff8c00',
        marginBottom: 15,
    },
    daysContainer: {
        gap: 15,
    },
    day: {
        backgroundColor: '#333',
        borderRadius: 8,
        padding: 15,
    },
    dayTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: '#fff',
        marginBottom: 10,
    },
    exercisesContainer: {
        gap: 10,
    },
    exercise: {
        backgroundColor: '#1a1a1a',
        borderRadius: 6,
        padding: 12,
        borderLeftWidth: 3,
        borderLeftColor: '#ff8c00',
    },
    exerciseHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 8,
    },
    exerciseName: {
        color: '#fff',
        fontWeight: '600',
        fontSize: 14,
        flex: 1,
    },
    exerciseDuration: {
        color: '#ff8c00',
        fontSize: 12,
        fontWeight: '600',
    },
    exerciseReps: {
        color: '#ccc',
        fontSize: 12,
        marginTop: 5,
    },
    exerciseNotes: {
        color: '#aaa',
        fontSize: 12,
        marginTop: 5,
        fontStyle: 'italic',
    },
})
