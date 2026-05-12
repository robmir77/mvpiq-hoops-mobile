// src/features/ai-training/screens/AiTrainingGeneratorScreen.tsx

import React, { useContext, useState, useEffect } from 'react'
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    TouchableOpacity,
    TextInput,
} from 'react-native'

import { useNavigation } from '@react-navigation/native'
import { AuthContext } from '@/features/auth/context/AuthContext'
import { useGenerateTrainingProgram } from '../hooks/useAiTraining'
import { 
    TrainingGenerationRequest, 
    SkillLevel 
} from '../types/ai-training.types'
import { PositionCard } from '@/shared/components/PositionCard'
import { getAllPositions } from '@/features/positions/api/positions.api'
import { PositionMetadata } from '@/features/positions/types/positions.types'
import { useCustomAlert, CustomAlert } from '@/shared/components/CustomAlert'

export default function AiTrainingGeneratorScreen() {
    const navigation = useNavigation<any>()
    const auth = useContext(AuthContext)
    
    if (!auth) return null

    const { user } = auth
    const generateMutation = useGenerateTrainingProgram()
    const { alert, showError, showSuccess } = useCustomAlert()

    const [goal, setGoal] = useState('')
    const [skillLevel, setSkillLevel] = useState<SkillLevel>(SkillLevel.INTERMEDIATE)
    const [positionId, setPositionId] = useState<string | undefined>(undefined)
    const [sessionsPerWeek, setSessionsPerWeek] = useState(3)
    const [sessionDurationMinutes, setSessionDurationMinutes] = useState(60)
    const [weeks, setWeeks] = useState(4)

    const [positions, setPositions] = useState<PositionMetadata[]>([])
    const [loadingPositions, setLoadingPositions] = useState(true)

    useEffect(() => {
        const loadPositions = async () => {
            try {
                const data = await getAllPositions()
                setPositions(data)
            } catch {
                showError('Errore', 'Impossibile caricare posizioni')
            } finally {
                setLoadingPositions(false)
            }
        }

        loadPositions()
    }, [])

    const handleGenerate = () => {
        if (!goal.trim()) {
            showError('Errore', 'Inserisci un obiettivo valido')
            return
        }

        // Trova il codice della posizione selezionata
        const selectedPosition = positions.find(p => p.id === positionId)
        const positionCode = selectedPosition?.code

        const request: TrainingGenerationRequest = {
            goal: goal.trim(),
            skillLevel,
            position: positionCode || undefined,
            sessionsPerWeek,
            sessionDurationMinutes,
            weeks
        }

        generateMutation.mutate(request, {
            onSuccess: (data: any) => {
                if (data?.program) {
                    showSuccess(
                        'Successo',
                        'Programma di allenamento generato con successo!',
                        () => navigation.navigate('AiTrainingProgram', { programId: data.program.id })
                    )
                }
            }
        })
    }

    const isGenerating = generateMutation.isPending

    return (
        <View style={styles.container}>
            <ScrollView contentContainerStyle={{ padding: 20 }}>
                <Text style={styles.title}>Genera Programma con AI</Text>
                
                <View style={styles.form}>
                    <View style={styles.field}>
                        <Text style={styles.label}>Obiettivo *</Text>
                        <TextInput
                            style={styles.input}
                            value={goal}
                            onChangeText={setGoal}
                            placeholder="es. Migliorare il tiro da 3 punti"
                            multiline
                            numberOfLines={3}
                            editable={!isGenerating}
                        />
                    </View>

                    <View style={styles.field}>
                        <Text style={styles.label}>Livello Tecnico</Text>
                        <View style={styles.switchRow}>
                            {Object.values(SkillLevel).map((level) => (
                                <TouchableOpacity
                                    key={level}
                                    style={[
                                        styles.switchButton,
                                        skillLevel === level && styles.activeSwitch
                                    ]}
                                    onPress={() => setSkillLevel(level)}
                                    disabled={isGenerating}
                                >
                                    <Text style={styles.switchText}>
                                        {level === SkillLevel.BEGINNER && 'Principiante'}
                                        {level === SkillLevel.INTERMEDIATE && 'Intermedio'}
                                        {level === SkillLevel.ADVANCED && 'Avanzato'}
                                    </Text>
                                </TouchableOpacity>
                            ))}
                        </View>
                    </View>

                    <View style={styles.field}>
                        <Text style={styles.label}>Posizione</Text>
                        {loadingPositions ? (
                            <Text style={{ color: '#aaa', marginTop: 10 }}>
                                Caricamento posizioni...
                            </Text>
                        ) : (
                            <View style={styles.positionsGrid}>
                                {positions.map(pos => {
                                    const isSelected = positionId === pos.id

                                    return (
                                        <PositionCard
                                            key={pos.id}
                                            label={`${pos.code} - ${pos.name}`}
                                            selected={isSelected}
                                            disabled={isGenerating}
                                            onPress={() => {
                                                setPositionId(pos.id)
                                            }}
                                        />
                                    )
                                })}
                            </View>
                        )}
                    </View>

                    <View style={styles.row}>
                        <View style={[styles.field, styles.halfField]}>
                            <Text style={styles.label}>Sessioni/Settimana</Text>
                            <TextInput
                                style={[styles.input, styles.numberInput]}
                                value={sessionsPerWeek.toString()}
                                onChangeText={(text) => setSessionsPerWeek(parseInt(text) || 1)}
                                keyboardType="numeric"
                                editable={!isGenerating}
                            />
                        </View>

                        <View style={[styles.field, styles.halfField]}>
                            <Text style={styles.label}>Durata Sessione (min)</Text>
                            <TextInput
                                style={[styles.input, styles.numberInput]}
                                value={sessionDurationMinutes.toString()}
                                onChangeText={(text) => setSessionDurationMinutes(parseInt(text) || 30)}
                                keyboardType="numeric"
                                editable={!isGenerating}
                            />
                        </View>
                    </View>

                    <View style={styles.field}>
                        <Text style={styles.label}>Numero Settimane</Text>
                        <TextInput
                            style={[styles.input, styles.numberInput]}
                            value={weeks.toString()}
                            onChangeText={(text) => setWeeks(parseInt(text) || 1)}
                            keyboardType="numeric"
                            editable={!isGenerating}
                        />
                    </View>

                    <TouchableOpacity
                        style={[styles.generateButton, isGenerating && styles.disabledButton]}
                        onPress={handleGenerate}
                        disabled={isGenerating || !goal.trim()}
                    >
                        <Text style={styles.generateButtonText}>
                            {isGenerating ? 'Generazione in corso...' : 'Genera Programma'}
                        </Text>
                    </TouchableOpacity>
                </View>

                {isGenerating && (
                    <View style={styles.loadingOverlay}>
                        <Text style={styles.loadingText}>Sto generando il tuo programma personalizzato...</Text>
                        <Text style={styles.loadingSubtext}>Questo potrebbe richiedere alcuni secondi</Text>
                    </View>
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
    title: {
        fontSize: 28,
        fontWeight: '700',
        color: '#fff',
        marginBottom: 30,
        textAlign: 'center',
    },
    form: {
        gap: 20,
    },
    field: {
        gap: 8,
    },
    row: {
        flexDirection: 'row',
        gap: 15,
    },
    halfField: {
        flex: 1,
    },
    label: {
        fontSize: 16,
        fontWeight: '600',
        color: '#fff',
        marginBottom: 8,
    },
    input: {
        backgroundColor: '#2a2a2a',
        color: '#fff',
        borderRadius: 12,
        padding: 15,
        fontSize: 16,
        borderWidth: 1,
        borderColor: '#333',
    },
    numberInput: {
        textAlign: 'center',
    },
    switchRow: {
        flexDirection: 'row',
        gap: 10,
    },
    switchButton: {
        flex: 1,
        padding: 12,
        borderRadius: 8,
        backgroundColor: '#2a2a2a',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: '#333',
    },
    activeSwitch: {
        backgroundColor: '#ff8c00',
        borderColor: '#ff8c00',
    },
    switchText: {
        color: '#fff',
        fontWeight: '600',
        fontSize: 14,
    },
    generateButton: {
        backgroundColor: '#ff8c00',
        padding: 18,
        borderRadius: 12,
        alignItems: 'center',
        marginTop: 20,
    },
    disabledButton: {
        backgroundColor: '#666',
        opacity: 0.6,
    },
    generateButtonText: {
        color: '#fff',
        fontSize: 18,
        fontWeight: '700',
    },
    loadingOverlay: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0,0,0,0.8)',
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 1000,
    },
    loadingText: {
        color: '#fff',
        fontSize: 18,
        fontWeight: '600',
        textAlign: 'center',
        marginBottom: 10,
    },
    loadingSubtext: {
        color: '#ccc',
        fontSize: 14,
        textAlign: 'center',
    },
    positionsGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 10,
        marginTop: 10,
    },
})
