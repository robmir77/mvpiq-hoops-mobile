import React, { useState, useContext } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native'
import { globalStyles } from '@/shared/theme/globalStyles'
import { AuthContext } from '@/features/auth/context/AuthContext'
import { CameraMode, CourtType, CreateWorkoutSessionPayload } from '../types/workouts.types'
import { createWorkoutSession } from '../api/workouts.api'
import { useCustomAlert, CustomAlert } from '@/shared/components/CustomAlert'

export default function WorkoutSetupScreen({ navigation }: any) {
    const auth = useContext(AuthContext)
    const { user } = auth || {}

    const [cameraMode, setCameraMode] = useState<CameraMode>('ANGLE_45')
    const [courtType, setCourtType] = useState<CourtType>('HALF_COURT')
    const [isCreating, setIsCreating] = useState(false)
    const { alert, showError, showSuccess } = useCustomAlert()

    const handleStartWorkout = async () => {
        if (!user?.id) {
            showError('Errore', 'Utente non autenticato')
            return
        }

        setIsCreating(true)
        try {
            const payload: CreateWorkoutSessionPayload = {
                cameraMode,
                courtType,
            }

            console.log('Creazione sessione con payload:', payload)
            console.log('User ID:', user.id)

            const session = await createWorkoutSession(user.id, payload)
            showSuccess('Sessione creata', 'Allenamento avviato con successo')
            
            // Naviga alla schermata di calibrazione o direttamente alla sessione
            navigation.navigate('Calibration', { sessionId: session.id })
        } catch (error: any) {
            console.error('Errore creazione sessione:', error)
            console.error('Response data:', error?.response?.data)
            console.error('Response status:', error?.response?.status)
            showError('Errore', error?.response?.data?.message || error.message || 'Impossibile creare la sessione')
        } finally {
            setIsCreating(false)
        }
    }

    const renderCameraModeOption = (mode: CameraMode, label: string, description: string) => (
        <TouchableOpacity
            style={[
                styles.optionCard,
                cameraMode === mode && styles.optionCardActive
            ]}
            onPress={() => setCameraMode(mode)}
        >
            <View style={styles.optionHeader}>
                <View style={[
                    styles.radioButton,
                    cameraMode === mode && styles.radioButtonActive
                ]}>
                    {cameraMode === mode && <View style={styles.radioButtonInner} />}
                </View>
                <Text style={[
                    styles.optionTitle,
                    cameraMode === mode && styles.optionTitleActive
                ]}>
                    {label}
                </Text>
            </View>
            <Text style={styles.optionDescription}>{description}</Text>
        </TouchableOpacity>
    )

    const renderCourtTypeOption = (type: CourtType, label: string, description: string) => (
        <TouchableOpacity
            style={[
                styles.optionCard,
                courtType === type && styles.optionCardActive
            ]}
            onPress={() => setCourtType(type)}
        >
            <View style={styles.optionHeader}>
                <View style={[
                    styles.radioButton,
                    courtType === type && styles.radioButtonActive
                ]}>
                    {courtType === type && <View style={styles.radioButtonInner} />}
                </View>
                <Text style={[
                    styles.optionTitle,
                    courtType === type && styles.optionTitleActive
                ]}>
                    {label}
                </Text>
            </View>
            <Text style={styles.optionDescription}>{description}</Text>
        </TouchableOpacity>
    )

    return (
        <View style={styles.container}>
            <Text style={styles.title}>Nuovo Allenamento</Text>
            <Text style={styles.subtitle}>Configura la tua sessione di tiro</Text>

            <ScrollView style={styles.scrollContainer} showsVerticalScrollIndicator={false}>
                {/* Modalità Camera */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Modalità Camera</Text>
                    <Text style={styles.sectionDescription}>
                        Posiziona il telefono e seleziona l'angolazione
                    </Text>

                    {renderCameraModeOption(
                        'ANGLE_45',
                        'Angolo 45°',
                        'Visuale diagonale ottimale per tracking completo'
                    )}
                    {renderCameraModeOption(
                        'LATERAL',
                        'Laterale',
                        'Visuale laterale dal lato del campo'
                    )}
                    {renderCameraModeOption(
                        'FRONTAL',
                        'Frontale',
                        'Visuale frontale dietro il canestro'
                    )}
                </View>

                {/* Tipo Campo */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Tipo Campo</Text>
                    <Text style={styles.sectionDescription}>
                        Seleziona la porzione di campo da utilizzare
                    </Text>

                    {renderCourtTypeOption(
                        'HALF_COURT',
                        'Mezzo Campo',
                        'Solo metà campo (distanze fino a 6.75m)'
                    )}
                    {renderCourtTypeOption(
                        'FULL_COURT',
                        'Campo Intero',
                        'Campo completo (distanze fino a 9.45m)'
                    )}
                </View>

                {/* Info Box */}
                <View style={styles.infoBox}>
                    <Text style={styles.infoIcon}>💡</Text>
                    <Text style={styles.infoText}>
                        Dopo aver configurato la sessione, dovrai calibrare il campo allineando l'overlay con il canestro reale.
                    </Text>
                </View>
            </ScrollView>

            {/* Pulsante Avvia */}
            <TouchableOpacity
                style={[globalStyles.button, styles.startButton]}
                onPress={handleStartWorkout}
                disabled={isCreating}
            >
                <Text style={globalStyles.buttonText}>
                    {isCreating ? 'Creazione...' : 'Avvia Allenamento'}
                </Text>
            </TouchableOpacity>

            <CustomAlert {...alert} />
        </View>
    )
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#0b0f1a',
        padding: 20,
    },
    title: {
        fontSize: 24,
        fontWeight: 'bold',
        color: 'white',
        marginBottom: 5,
    },
    subtitle: {
        fontSize: 14,
        color: '#888',
        marginBottom: 20,
    },
    scrollContainer: {
        flex: 1,
        marginBottom: 20,
    },
    section: {
        marginBottom: 25,
    },
    sectionTitle: {
        fontSize: 16,
        fontWeight: 'bold',
        color: 'white',
        marginBottom: 5,
    },
    sectionDescription: {
        fontSize: 13,
        color: '#888',
        marginBottom: 12,
    },
    optionCard: {
        backgroundColor: '#121826',
        borderRadius: 12,
        padding: 15,
        marginBottom: 10,
        borderWidth: 1,
        borderColor: '#2a2a2a',
    },
    optionCardActive: {
        borderColor: '#ff8c00',
        backgroundColor: '#1a1a1a',
    },
    optionHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 8,
    },
    radioButton: {
        width: 20,
        height: 20,
        borderRadius: 10,
        borderWidth: 2,
        borderColor: '#2a2a2a',
        marginRight: 12,
        justifyContent: 'center',
        alignItems: 'center',
    },
    radioButtonActive: {
        borderColor: '#ff8c00',
    },
    radioButtonInner: {
        width: 10,
        height: 10,
        borderRadius: 5,
        backgroundColor: '#ff8c00',
    },
    optionTitle: {
        fontSize: 15,
        fontWeight: '600',
        color: '#fff',
        flex: 1,
    },
    optionTitleActive: {
        color: '#ff8c00',
    },
    optionDescription: {
        fontSize: 13,
        color: '#888',
        marginLeft: 32,
        lineHeight: 18,
    },
    infoBox: {
        backgroundColor: '#1a1a1a',
        borderRadius: 12,
        padding: 15,
        flexDirection: 'row',
        alignItems: 'flex-start',
        marginBottom: 10,
    },
    infoIcon: {
        fontSize: 20,
        marginRight: 10,
    },
    infoText: {
        fontSize: 13,
        color: '#aaa',
        flex: 1,
        lineHeight: 18,
    },
    startButton: {
        backgroundColor: '#ff8c00',
    },
})
