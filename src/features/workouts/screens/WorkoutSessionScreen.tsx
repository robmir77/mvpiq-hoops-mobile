import React, { useState, useContext, useEffect } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, Dimensions } from 'react-native'
import { globalStyles } from '@/shared/theme/globalStyles'
import { AuthContext } from '@/features/auth/context/AuthContext'
import { WorkoutSession, ShotResult, AddShotEventPayload } from '../types/workouts.types'
import { getWorkoutSession, addShotEvent, endWorkoutSession, pauseWorkoutSession, resumeWorkoutSession } from '../api/workouts.api'
import { useCustomAlert, CustomAlert } from '@/shared/components/CustomAlert'
import { CameraView, useCameraPermissions } from 'expo-camera'

const { width, height } = Dimensions.get('window')

export default function WorkoutSessionScreen({ navigation, route }: any) {
    const { sessionId } = route.params || {}
    const auth = useContext(AuthContext)
    const { user } = auth || {}

    const [permission, requestPermission] = useCameraPermissions()
    const [session, setSession] = useState<WorkoutSession | null>(null)
    const [isLoading, setIsLoading] = useState(true)
    const [isRecording, setIsRecording] = useState(false)
    const [currentShot, setCurrentShot] = useState<ShotResult | null>(null)
    const [shotCount, setShotCount] = useState({ total: 0, made: 0, missed: 0 })
    const [isEnding, setIsEnding] = useState(false)
    const { alert, showError, showSuccess, showWarning } = useCustomAlert()

    useEffect(() => {
        loadSession()
    }, [sessionId])

    const loadSession = async () => {
        if (!user?.id || !sessionId) return

        setIsLoading(true)
        try {
            const sessionData = await getWorkoutSession(sessionId, user.id)
            setSession(sessionData)
            // ✅ Fix: missedShots non è nel BE response — calcolalo localmente
            setShotCount({
                total: sessionData.totalShots,
                made: sessionData.madeShots,
                missed: (sessionData.totalShots ?? 0) - (sessionData.madeShots ?? 0),
            })
        } catch (error: any) {
            console.error('Errore caricamento sessione:', error)
            showError('Errore', error.message || 'Impossibile caricare la sessione')
        } finally {
            setIsLoading(false)
        }
    }

    if (!permission) {
        return <View />
    }

    if (!permission.granted) {
        return (
            <View style={styles.container}>
                <Text style={styles.title}>Permesso Camera Richiesto</Text>
                <TouchableOpacity
                    style={[globalStyles.button, styles.permissionButton]}
                    onPress={requestPermission}
                >
                    <Text style={globalStyles.buttonText}>Concedi Permesso</Text>
                </TouchableOpacity>
            </View>
        )
    }

    const handleRecordShot = async (result: ShotResult) => {
        if (!user?.id || !sessionId) return

        setCurrentShot(result)
        setIsRecording(true)

        try {
            const payload: AddShotEventPayload = {
                timestampMs: Date.now(),
                shotResult: result,
                courtX: 0,
                courtY: 0,
                distanceFromHoop: 0,
                detectionConfidence: 0.85,
                trackingData: JSON.stringify({ manualEntry: true }),
            }

            await addShotEvent(sessionId, user.id, payload)

            // ✅ Fix: aggiorna i contatori localmente invece di ricaricare tutta la sessione.
            // loadSession() dopo ogni tiro introduceva 1-2s di latenza bloccando i pulsanti.
            setShotCount(prev => ({
                total: prev.total + 1,
                made: result === 'MADE' ? prev.made + 1 : prev.made,
                missed: result === 'MISS' ? prev.missed + 1 : prev.missed,
            }))

            showSuccess(
                result === 'MADE' ? 'Canestro! 🏀' : 'Mancato',
                result === 'MADE' ? 'Ottimo tiro!' : 'Continua a provare!'
            )
        } catch (error: any) {
            showError('Errore', error.message || 'Impossibile registrare il tiro')
        } finally {
            setIsRecording(false)
            setCurrentShot(null)
        }
    }

    const handleEndSession = async () => {
        if (!user?.id || !sessionId) return

        showWarning(
            'Termina Sessione',
            'Sei sicuro di voler terminare l\'allenamento?',
            async () => {
                setIsEnding(true)
                try {
                    await endWorkoutSession(sessionId, user.id)
                    showSuccess('Sessione Terminata', 'Allenamento salvato con successo')
                    navigation.navigate('WorkoutHome')
                } catch (error: any) {
                    console.error('Errore termine sessione:', error)
                    showError('Errore', error.message || 'Impossibile terminare la sessione')
                } finally {
                    setIsEnding(false)
                }
            }
        )
    }

    const handlePauseResume = async () => {
        if (!user?.id || !sessionId || !session) return

        try {
            if (session.status === 'ACTIVE') {
                await pauseWorkoutSession(sessionId, user.id)
                showSuccess('Pausa', 'Sessione messa in pausa')
            } else if (session.status === 'PAUSED') {
                await resumeWorkoutSession(sessionId, user.id)
                showSuccess('Ripresa', 'Sessione ripresa')
            }
            await loadSession()
        } catch (error: any) {
            console.error('Errore pausa/ripresa:', error)
            showError('Errore', error.message || 'Impossibile cambiare stato sessione')
        }
    }

    const isPaused = session?.status === 'PAUSED'

    return (
        <View style={styles.container}>
            {/* Header con statistiche */}
            <View style={styles.header}>
                <View style={styles.headerTop}>
                    <TouchableOpacity onPress={() => navigation.goBack()}>
                        <Text style={styles.backButton}>←</Text>
                    </TouchableOpacity>
                    <Text style={styles.headerTitle}>
                        {isPaused ? '⏸️ In Pausa' : '🔴 Sessione Attiva'}
                    </Text>
                    <TouchableOpacity onPress={handlePauseResume}>
                        <Text style={styles.pauseButton}>
                            {isPaused ? '▶️' : '⏸️'}
                        </Text>
                    </TouchableOpacity>
                </View>

                <View style={styles.statsRow}>
                    <View style={styles.statBox}>
                        <Text style={styles.statValue}>{shotCount.total}</Text>
                        <Text style={styles.statLabel}>Tiri</Text>
                    </View>
                    <View style={styles.statBox}>
                        <Text style={styles.statValue}>{shotCount.made}</Text>
                        <Text style={styles.statLabel}>Segnati</Text>
                    </View>
                    <View style={styles.statBox}>
                        <Text style={styles.statValue}>
                            {shotCount.total > 0 ? ((shotCount.made / shotCount.total) * 100).toFixed(0) : 0}%
                        </Text>
                        <Text style={styles.statLabel}>%</Text>
                    </View>
                </View>
            </View>

            {/* Camera View */}
            <View style={styles.cameraContainer}>
                <CameraView
                    style={styles.camera}
                    facing="back"
                >
                    {/* Overlay tracking */}
                    <View style={styles.overlayContainer}>
                        <View style={styles.trackingIndicator}>
                            <View style={[
                                styles.trackingDot,
                                isRecording && styles.trackingDotActive
                            ]} />
                            <Text style={styles.trackingText}>
                                {isRecording ? 'Registrazione...' : 'Tracking Attivo'}
                            </Text>
                        </View>

                        {/* Linee guida */}
                        <View style={styles.guidelineHorizontal} />
                        <View style={styles.guidelineVertical} />
                    </View>
                </CameraView>
            </View>

            {/* Controlli tiro */}
            <View style={styles.controlsContainer}>
                <Text style={styles.controlsTitle}>Registra Tiro</Text>
                
                <View style={styles.shotButtons}>
                    <TouchableOpacity
                        style={[styles.shotButton, styles.missButton]}
                        onPress={() => handleRecordShot('MISS')}
                        disabled={isRecording || isPaused || isEnding}
                    >
                        <Text style={styles.shotButtonText}>❌ Mancato</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={[styles.shotButton, styles.madeButton]}
                        onPress={() => handleRecordShot('MADE')}
                        disabled={isRecording || isPaused || isEnding}
                    >
                        <Text style={styles.shotButtonText}>✅ Canestro</Text>
                    </TouchableOpacity>
                </View>

                <TouchableOpacity
                    style={[globalStyles.button, styles.endButton]}
                    onPress={handleEndSession}
                    disabled={isEnding}
                >
                    <Text style={globalStyles.buttonText}>
                        {isEnding ? 'Terminazione...' : 'Termina Sessione'}
                    </Text>
                </TouchableOpacity>
            </View>

            <CustomAlert {...alert} />
        </View>
    )
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#0b0f1a',
    },
    header: {
        padding: 15,
        backgroundColor: '#121826',
        borderBottomWidth: 1,
        borderBottomColor: '#2a2a2a',
    },
    headerTop: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 15,
    },
    backButton: {
        fontSize: 24,
        color: '#fff',
        fontWeight: 'bold',
    },
    headerTitle: {
        fontSize: 16,
        fontWeight: 'bold',
        color: '#fff',
    },
    pauseButton: {
        fontSize: 24,
    },
    statsRow: {
        flexDirection: 'row',
        justifyContent: 'space-around',
    },
    statBox: {
        alignItems: 'center',
    },
    statValue: {
        fontSize: 28,
        fontWeight: 'bold',
        color: '#ff8c00',
    },
    statLabel: {
        fontSize: 12,
        color: '#888',
        marginTop: 4,
    },
    cameraContainer: {
        flex: 1,
        margin: 15,
        borderRadius: 12,
        overflow: 'hidden',
    },
    camera: {
        flex: 1,
    },
    overlayContainer: {
        flex: 1,
        position: 'relative',
    },
    trackingIndicator: {
        position: 'absolute',
        top: 15,
        left: 15,
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 20,
    },
    trackingDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: '#22c55e',
        marginRight: 8,
    },
    trackingDotActive: {
        backgroundColor: '#ff8c00',
    },
    trackingText: {
        color: '#fff',
        fontSize: 12,
        fontWeight: '600',
    },
    guidelineHorizontal: {
        position: 'absolute',
        left: 0,
        right: 0,
        top: '50%',
        height: 1,
        backgroundColor: 'rgba(255, 140, 0, 0.3)',
    },
    guidelineVertical: {
        position: 'absolute',
        top: 0,
        bottom: 0,
        left: '50%',
        width: 1,
        backgroundColor: 'rgba(255, 140, 0, 0.3)',
    },
    controlsContainer: {
        padding: 15,
        backgroundColor: '#121826',
        borderTopWidth: 1,
        borderTopColor: '#2a2a2a',
    },
    controlsTitle: {
        fontSize: 14,
        fontWeight: 'bold',
        color: '#fff',
        marginBottom: 12,
        textAlign: 'center',
    },
    shotButtons: {
        flexDirection: 'row',
        gap: 10,
        marginBottom: 15,
    },
    shotButton: {
        flex: 1,
        paddingVertical: 15,
        borderRadius: 12,
        alignItems: 'center',
    },
    missButton: {
        backgroundColor: '#ef4444',
    },
    madeButton: {
        backgroundColor: '#22c55e',
    },
    shotButtonText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: 'bold',
    },
    endButton: {
        backgroundColor: '#2a2a2a',
    },
    permissionButton: {
        marginTop: 20,
    },
    title: {
        fontSize: 22,
        fontWeight: 'bold',
        color: 'white',
        marginBottom: 15,
        textAlign: 'center',
    },
})
