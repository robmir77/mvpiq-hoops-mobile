import React, { useState, useContext, useRef } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, Dimensions } from 'react-native'
import { globalStyles } from '@/shared/theme/globalStyles'
import { AuthContext } from '@/features/auth/context/AuthContext'
import { CameraMode, CalibrationData } from '../types/workouts.types'
import { saveCourtCalibration } from '../api/workouts.api'
import { useCustomAlert, CustomAlert } from '@/shared/components/CustomAlert'
import { CameraView, useCameraPermissions } from 'expo-camera'

const { width, height } = Dimensions.get('window')

export default function CalibrationScreen({ navigation, route }: any) {
    const { sessionId, cameraMode } = route.params || {}
    const auth = useContext(AuthContext)
    const { user } = auth || {}

    const [permission, requestPermission] = useCameraPermissions()
    const [isCalibrating, setIsCalibrating] = useState(false)
    const [hoopCenter, setHoopCenter] = useState<{ x: number; y: number } | null>(null)
    const { alert, showError, showSuccess } = useCustomAlert()

    if (!permission) {
        return <View />
    }

    if (!permission.granted) {
        return (
            <View style={styles.container}>
                <Text style={styles.title}>Permesso Camera Richiesto</Text>
                <Text style={styles.subtitle}>
                    Abbiamo bisogno del permesso per accedere alla camera per calibrare il campo
                </Text>
                <TouchableOpacity
                    style={[globalStyles.button, styles.permissionButton]}
                    onPress={requestPermission}
                >
                    <Text style={globalStyles.buttonText}>Concedi Permesso</Text>
                </TouchableOpacity>
            </View>
        )
    }

    const handleCameraTouch = (event: any) => {
        const { locationX, locationY } = event.nativeEvent
        setHoopCenter({ x: locationX, y: locationY })
    }

    const handleSaveCalibration = async () => {
        if (!hoopCenter || !user?.id || !sessionId) {
            showError('Errore', 'Seleziona prima il centro del canestro')
            return
        }

        setIsCalibrating(true)
        try {
            const calibrationData: CalibrationData = {
                homographyMatrix: [], // Sarà calcolata dal backend o da un algoritmo più complesso
                hoopCenter,
                freeThrowLine: undefined,
                courtCorners: undefined,
            }

            await saveCourtCalibration(sessionId, user.id, calibrationData)
            showSuccess('Calibrazione Completata', 'Il campo è stato calibrato con successo')
            
            // Naviga alla sessione attiva
            navigation.navigate('WorkoutSession', { sessionId })
        } catch (error: any) {
            console.error('Errore salvataggio calibrazione:', error)
            showError('Errore', error.message || 'Impossibile salvare la calibrazione')
        } finally {
            setIsCalibrating(false)
        }
    }

    const handleSkipCalibration = () => {
        // Naviga alla sessione senza calibrazione
        navigation.navigate('WorkoutSession', { sessionId })
    }

    return (
        <View style={styles.container}>
            <Text style={styles.title}>Calibrazione Campo</Text>
            <Text style={styles.subtitle}>
                Tocca il centro del canestro nella vista camera per calibrare
            </Text>

            {/* Camera View */}
            <View style={styles.cameraContainer}>
                <CameraView
                    style={styles.camera}
                    facing="back"
                    onTouchStart={handleCameraTouch}
                >
                    {/* Overlay Overlay */}
                    <View style={styles.overlayContainer}>
                        {/* Linee guida */}
                        <View style={styles.guidelineHorizontal} />
                        <View style={styles.guidelineVertical} />
                        
                        {/* Cerchio centrale */}
                        <View style={styles.centerCircle} />
                        
                        {/* Marker per il canestro selezionato */}
                        {hoopCenter && (
                            <View style={[
                                styles.hoopMarker,
                                { left: hoopCenter.x - 20, top: hoopCenter.y - 20 }
                            ]}>
                                <View style={styles.hoopMarkerInner} />
                            </View>
                        )}

                        {/* Informazioni overlay */}
                        <View style={styles.overlayInfo}>
                            <Text style={styles.overlayInfoText}>
                                Modalità: {cameraMode === 'ANGLE_45' ? '45°' : cameraMode === 'LATERAL' ? 'Laterale' : 'Frontale'}
                            </Text>
                        </View>
                    </View>
                </CameraView>
            </View>

            {/* Pulsanti */}
            <View style={styles.buttonContainer}>
                <TouchableOpacity
                    style={[globalStyles.button, styles.skipButton]}
                    onPress={handleSkipCalibration}
                    disabled={isCalibrating}
                >
                    <Text style={globalStyles.buttonText}>Salta</Text>
                </TouchableOpacity>

                <TouchableOpacity
                    style={[
                        globalStyles.button,
                        styles.saveButton,
                        (!hoopCenter || isCalibrating) && styles.disabledButton
                    ]}
                    onPress={handleSaveCalibration}
                    disabled={!hoopCenter || isCalibrating}
                >
                    <Text style={[
                        globalStyles.buttonText,
                        (!hoopCenter || isCalibrating) && styles.disabledButtonText
                    ]}>
                        {isCalibrating ? 'Salvataggio...' : 'Salva Calibrazione'}
                    </Text>
                </TouchableOpacity>
            </View>

            {/* Istruzioni */}
            <View style={styles.instructionsContainer}>
                <Text style={styles.instructionTitle}>Istruzioni:</Text>
                <Text style={styles.instructionText}>1. Posiziona il telefono stabilmente</Text>
                <Text style={styles.instructionText}>2. Assicurati che il canestro sia visibile</Text>
                <Text style={styles.instructionText}>3. Tocca il centro del ferro del canestro</Text>
                <Text style={styles.instructionText}>4. Premi "Salva Calibrazione"</Text>
            </View>

            <CustomAlert {...alert} />
        </View>
    )
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#0b0f1a',
        padding: 20,
        paddingBottom: 40,
    },
    title: {
        fontSize: 22,
        fontWeight: 'bold',
        color: 'white',
        marginBottom: 5,
    },
    subtitle: {
        fontSize: 14,
        color: '#888',
        marginBottom: 15,
    },
    permissionButton: {
        marginTop: 20,
    },
    cameraContainer: {
        width: '100%',
        height: height * 0.45,
        borderRadius: 12,
        overflow: 'hidden',
        marginBottom: 15,
    },
    camera: {
        flex: 1,
    },
    overlayContainer: {
        flex: 1,
        position: 'relative',
    },
    guidelineHorizontal: {
        position: 'absolute',
        left: 0,
        right: 0,
        top: '50%',
        height: 1,
        backgroundColor: 'rgba(255, 140, 0, 0.5)',
    },
    guidelineVertical: {
        position: 'absolute',
        top: 0,
        bottom: 0,
        left: '50%',
        width: 1,
        backgroundColor: 'rgba(255, 140, 0, 0.5)',
    },
    centerCircle: {
        position: 'absolute',
        left: '50%',
        top: '50%',
        width: 40,
        height: 40,
        marginLeft: -20,
        marginTop: -20,
        borderRadius: 20,
        borderWidth: 2,
        borderColor: 'rgba(255, 140, 0, 0.8)',
        borderStyle: 'dashed',
    },
    hoopMarker: {
        position: 'absolute',
        width: 40,
        height: 40,
        borderRadius: 20,
        borderWidth: 3,
        borderColor: '#ff8c00',
        backgroundColor: 'rgba(255, 140, 0, 0.2)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    hoopMarkerInner: {
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: '#ff8c00',
    },
    overlayInfo: {
        position: 'absolute',
        top: 10,
        left: 10,
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 6,
    },
    overlayInfoText: {
        color: '#fff',
        fontSize: 12,
        fontWeight: '600',
    },
    instructionsContainer: {
        backgroundColor: '#121826',
        borderRadius: 12,
        padding: 15,
        marginBottom: 15,
    },
    instructionTitle: {
        fontSize: 14,
        fontWeight: 'bold',
        color: '#fff',
        marginBottom: 8,
    },
    instructionText: {
        fontSize: 13,
        color: '#aaa',
        marginBottom: 4,
    },
    buttonContainer: {
        flexDirection: 'row',
        gap: 10,
    },
    skipButton: {
        flex: 1,
        backgroundColor: '#2a2a2a',
    },
    saveButton: {
        flex: 2,
        backgroundColor: '#ff8c00',
    },
    disabledButton: {
        backgroundColor: '#3a3a3a',
        opacity: 0.6,
    },
    disabledButtonText: {
        color: '#888',
    },
})
