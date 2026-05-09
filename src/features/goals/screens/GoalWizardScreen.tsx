import React, { useState } from 'react'
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    ScrollView,
    ActivityIndicator,
    TextInput,
} from 'react-native'
import { useNavigation } from '@react-navigation/native'
import { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { MainStackParamList } from '@/app/navigation/types'
import { useCreateGoal } from '../hooks/useCreateGoal'
import { useContext } from 'react'
import { AuthContext } from '@/features/auth/context/AuthContext'

type NavigationProp = NativeStackNavigationProp<MainStackParamList>

interface GoalSuggestion {
    id: string
    title: string
    description: string
    category: string
}

const GOAL_SUGGESTIONS: GoalSuggestion[] = [
    {
        id: '1',
        title: 'Migliorare il tiro da 3 punti',
        description: 'Aumentare la percentuale di successo da oltre l\'arco',
        category: 'Tiro'
    },
    {
        id: '2',
        title: 'Migliorare il palleggio',
        description: 'Diventare più sicuro nel controllo della palla',
        category: 'Fondamentali'
    },
    {
        id: '3',
        title: 'Aumentare la resistenza',
        description: 'Migliorare la condizione fisica per giocare a lungo',
        category: 'Fisico'
    },
    {
        id: '4',
        title: 'Migliorare la difesa',
        description: 'Diventare un difensore più efficace',
        category: 'Difesa'
    },
    {
        id: '5',
        title: 'Migliorare il passaggio',
        description: 'Aumentare la precisione nei passaggi',
        category: 'Fondamentali'
    },
    {
        id: '6',
        title: 'Lavorare sui tiri liberi',
        description: 'Aumentare la percentuale dalla linea del tiro libero',
        category: 'Tiro'
    }
]

export default function GoalWizardScreen() {
    const navigation = useNavigation<NavigationProp>()
    const createGoalMutation = useCreateGoal()
    const auth = useContext(AuthContext)
    
    if (!auth) return null
    const { user } = auth
    
    const [selectedGoals, setSelectedGoals] = useState<string[]>([])
    const [currentStep, setCurrentStep] = useState(0)
    const [customGoal, setCustomGoal] = useState('')
    const [showCustomInput, setShowCustomInput] = useState(false)

    const toggleGoalSelection = (goalId: string) => {
        setSelectedGoals(prev => 
            prev.includes(goalId) 
                ? prev.filter(id => id !== goalId)
                : [...prev, goalId]
        )
    }

    const handleNext = () => {
        if (currentStep === 0 && selectedGoals.length === 0) {
            return
        }
        
        if (currentStep < 2) {
            setCurrentStep(prev => prev + 1)
        } else {
            handleFinish()
        }
    }

    const handleFinish = async () => {
        const athleteId = user?.id
        if (!athleteId) return
        
        const goalsToCreate = selectedGoals.map(goalId => {
            const suggestion = GOAL_SUGGESTIONS.find(g => g.id === goalId)
            return {
                athleteId,
                data: {
                    title: suggestion?.title || '',
                    description: suggestion?.description || ''
                }
            }
        })

        if (customGoal.trim()) {
            goalsToCreate.push({
                athleteId,
                data: {
                    title: customGoal.trim(),
                    description: 'Goal personalizzato'
                }
            })
        }

        try {
            // Creiamo tutti i goal selezionati
            await Promise.all(
                goalsToCreate.map(goal => 
                    new Promise<void>((resolve, reject) => {
                        createGoalMutation.mutate(goal, {
                            onSuccess: () => resolve(),
                            onError: (error) => reject(error)
                        })
                    })
                )
            )
            
            // Aggiorniamo il flag hasGoals nell'utente
            if (auth?.setUser && user) {
                auth.setUser({ ...user, hasGoals: true })
            }
            
            // Reindirizziamo alla home per refreshare i dati
            navigation.navigate('Main')
        } catch (error) {
            console.error('Errore durante la creazione dei goal:', error)
        }
    }

    const handleSkip = () => {
        navigation.navigate('Main')
    }

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <Text style={styles.title}>Iniziamo la tua crescita 🏀</Text>
                <Text style={styles.subtitle}>
                    {currentStep === 0 && 'Scegli i tuoi obiettivi principali'}
                    {currentStep === 1 && 'Vuoi aggiungere un goal personalizzato?'}
                    {currentStep === 2 && 'Riepilogo dei tuoi goal'}
                </Text>
            </View>

            <ScrollView style={styles.content}>
                {currentStep === 0 && (
                    <View>
                        <Text style={styles.stepTitle}>Cosa vuoi migliorare?</Text>
                        <Text style={styles.stepDescription}>
                            Seleziona gli obiettivi che vuoi raggiungere
                        </Text>
                        
                        {GOAL_SUGGESTIONS.map((goal) => (
                            <TouchableOpacity
                                key={goal.id}
                                style={[
                                    styles.goalCard,
                                    selectedGoals.includes(goal.id) && styles.selectedGoalCard
                                ]}
                                onPress={() => toggleGoalSelection(goal.id)}
                            >
                                <View style={styles.goalHeader}>
                                    <Text style={[
                                        styles.goalTitle,
                                        selectedGoals.includes(goal.id) && styles.selectedGoalTitle
                                    ]}>
                                        {goal.title}
                                    </Text>
                                    <Text style={styles.categoryBadge}>{goal.category}</Text>
                                </View>
                                <Text style={styles.goalDescription}>
                                    {goal.description}
                                </Text>
                            </TouchableOpacity>
                        ))}
                    </View>
                )}

                {currentStep === 1 && (
                    <View>
                        <Text style={styles.stepTitle}>Goal personalizzato</Text>
                        <Text style={styles.stepDescription}>
                            Hai un obiettivo specifico che non è nella lista?
                        </Text>

                        <TouchableOpacity
                            style={[
                                styles.optionCard,
                                showCustomInput && styles.selectedOptionCard
                            ]}
                            onPress={() => setShowCustomInput(!showCustomInput)}
                        >
                            <Text style={styles.optionTitle}>✏️ Crea un goal personalizzato</Text>
                            <Text style={styles.optionDescription}>
                                Definisci il tuo obiettivo personale
                            </Text>
                        </TouchableOpacity>

                        {showCustomInput && (
                            <View style={styles.customInputContainer}>
                                <Text style={styles.inputLabel}>Titolo del goal:</Text>
                                <TextInput
                                    style={styles.textInput}
                                    placeholder="Inserisci il tuo goal..."
                                    placeholderTextColor="#666"
                                    multiline
                                    value={customGoal}
                                    onChangeText={setCustomGoal}
                                />
                            </View>
                        )}

                        <TouchableOpacity
                            style={[styles.optionCard, !showCustomInput && styles.selectedOptionCard]}
                            onPress={() => setShowCustomInput(false)}
                        >
                            <Text style={styles.optionTitle}>⏭️ Continua senza goal personalizzati</Text>
                            <Text style={styles.optionDescription}>
                                Vai direttamente alla home
                            </Text>
                        </TouchableOpacity>
                    </View>
                )}

                {currentStep === 2 && (
                    <View>
                        <Text style={styles.stepTitle}>Riepilogo</Text>
                        <Text style={styles.stepDescription}>
                            Questi sono i goal che hai scelto:
                        </Text>

                        <View style={styles.summaryContainer}>
                            {selectedGoals.map(goalId => {
                                const goal = GOAL_SUGGESTIONS.find(g => g.id === goalId)
                                return (
                                    <View key={goalId} style={styles.summaryItem}>
                                        <Text style={styles.summaryTitle}>🎯 {goal?.title}</Text>
                                        <Text style={styles.summaryDescription}>{goal?.description}</Text>
                                    </View>
                                )
                            })}

                            {customGoal.trim() && (
                                <View style={styles.summaryItem}>
                                    <Text style={styles.summaryTitle}>🎯 {customGoal.trim()}</Text>
                                    <Text style={styles.summaryDescription}>Goal personalizzato</Text>
                                </View>
                            )}

                            {selectedGoals.length === 0 && !customGoal.trim() && (
                                <Text style={styles.emptyMessage}>
                                    Nessun goal selezionato. Potrai aggiungerli più tardi!
                                </Text>
                            )}
                        </View>
                    </View>
                )}
            </ScrollView>

            <View style={styles.footer}>
                <View style={styles.progressDots}>
                    {[0, 1, 2].map(step => (
                        <View
                            key={step}
                            style={[
                                styles.dot,
                                step === currentStep && styles.activeDot,
                                step < currentStep && styles.completedDot
                            ]}
                        />
                    ))}
                </View>

                <View style={styles.buttonContainer}>
                    <TouchableOpacity
                        style={styles.skipButton}
                        onPress={handleSkip}
                    >
                        <Text style={styles.skipButtonText}>Salta</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={[
                            styles.nextButton,
                            (currentStep === 0 && selectedGoals.length === 0) && styles.disabledButton
                        ]}
                        onPress={handleNext}
                        disabled={currentStep === 0 && selectedGoals.length === 0}
                    >
                        {createGoalMutation.isPending ? (
                            <ActivityIndicator color="#fff" />
                        ) : (
                            <Text style={styles.nextButtonText}>
                                {currentStep === 2 ? 'Inizia' : 'Avanti'}
                            </Text>
                        )}
                    </TouchableOpacity>
                </View>
            </View>
        </View>
    )
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#0F172A',
    },
    header: {
        paddingTop: 60,
        paddingHorizontal: 24,
        paddingBottom: 20,
    },
    title: {
        fontSize: 28,
        fontWeight: '700',
        color: '#FFFFFF',
        marginBottom: 8,
    },
    subtitle: {
        fontSize: 16,
        color: '#94A3B8',
    },
    content: {
        flex: 1,
        paddingHorizontal: 24,
    },
    stepTitle: {
        fontSize: 20,
        fontWeight: '600',
        color: '#FFFFFF',
        marginBottom: 8,
    },
    stepDescription: {
        fontSize: 14,
        color: '#94A3B8',
        marginBottom: 24,
    },
    goalCard: {
        backgroundColor: '#1E293B',
        padding: 16,
        borderRadius: 12,
        marginBottom: 12,
        borderWidth: 2,
        borderColor: 'transparent',
    },
    selectedGoalCard: {
        borderColor: '#F97316',
        backgroundColor: '#1E293B',
    },
    goalHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: 8,
    },
    goalTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: '#FFFFFF',
        flex: 1,
        marginRight: 12,
    },
    selectedGoalTitle: {
        color: '#F97316',
    },
    categoryBadge: {
        backgroundColor: '#334155',
        color: '#94A3B8',
        fontSize: 12,
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 6,
    },
    goalDescription: {
        fontSize: 14,
        color: '#94A3B8',
        lineHeight: 20,
    },
    optionCard: {
        backgroundColor: '#1E293B',
        padding: 16,
        borderRadius: 12,
        marginBottom: 12,
        borderWidth: 2,
        borderColor: 'transparent',
    },
    selectedOptionCard: {
        borderColor: '#F97316',
        backgroundColor: '#1E293B',
    },
    optionTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: '#FFFFFF',
        marginBottom: 4,
    },
    optionDescription: {
        fontSize: 14,
        color: '#94A3B8',
    },
    customInputContainer: {
        backgroundColor: '#1E293B',
        padding: 16,
        borderRadius: 12,
        marginBottom: 12,
    },
    inputLabel: {
        fontSize: 14,
        color: '#94A3B8',
        marginBottom: 8,
    },
    textInput: {
        backgroundColor: '#334155',
        color: '#FFFFFF',
        padding: 12,
        borderRadius: 8,
        minHeight: 80,
        textAlignVertical: 'top',
    },
    summaryContainer: {
        backgroundColor: '#1E293B',
        padding: 16,
        borderRadius: 12,
    },
    summaryItem: {
        marginBottom: 16,
        paddingBottom: 16,
        borderBottomWidth: 1,
        borderBottomColor: '#334155',
    },
    summaryTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: '#FFFFFF',
        marginBottom: 4,
    },
    summaryDescription: {
        fontSize: 14,
        color: '#94A3B8',
    },
    emptyMessage: {
        fontSize: 14,
        color: '#94A3B8',
        textAlign: 'center',
        fontStyle: 'italic',
    },
    footer: {
        paddingHorizontal: 24,
        paddingBottom: 32,
        paddingTop: 20,
    },
    progressDots: {
        flexDirection: 'row',
        justifyContent: 'center',
        marginBottom: 24,
    },
    dot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: '#334155',
        marginHorizontal: 4,
    },
    activeDot: {
        backgroundColor: '#F97316',
        width: 24,
    },
    completedDot: {
        backgroundColor: '#F97316',
    },
    buttonContainer: {
        flexDirection: 'row',
        gap: 12,
    },
    skipButton: {
        flex: 1,
        backgroundColor: 'transparent',
        borderWidth: 1,
        borderColor: '#334155',
        padding: 16,
        borderRadius: 12,
        alignItems: 'center',
    },
    skipButtonText: {
        color: '#94A3B8',
        fontWeight: '600',
        fontSize: 16,
    },
    nextButton: {
        flex: 2,
        backgroundColor: '#F97316',
        padding: 16,
        borderRadius: 12,
        alignItems: 'center',
    },
    disabledButton: {
        backgroundColor: '#334155',
        opacity: 0.5,
    },
    nextButtonText: {
        color: '#FFFFFF',
        fontWeight: '600',
        fontSize: 16,
    },
})
