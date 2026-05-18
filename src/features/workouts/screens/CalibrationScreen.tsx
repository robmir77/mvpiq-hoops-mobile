// src/features/workouts/screens/CalibrationScreen.tsx

import React, { useState, useContext } from 'react'
import {
    View, Text, StyleSheet, TouchableOpacity,
    Dimensions, ScrollView, Platform,
} from 'react-native'
import Svg, { Circle, Line, Polyline } from 'react-native-svg'
import { CameraView, useCameraPermissions } from 'expo-camera'
import { AuthContext } from '@/features/auth/context/AuthContext'
import { CalibrationData } from '../types/workouts.types'
import { saveCourtCalibration } from '../api/workouts.api'
import { useCustomAlert, CustomAlert } from '@/shared/components/CustomAlert'

const { width: SW, height: SH } = Dimensions.get('window')
const CAM_H = SH * 0.50

type CalibStep = 'hoop' | 'corners' | 'done'
interface Point { x: number; y: number }

// ─── SVG Overlay calibrazione ─────────────────────────────────
const CalibrationOverlay = ({
    hoopCenter, corners,
}: { hoopCenter: Point | null; corners: Point[] }) => {
    // Linee tra angoli consecutivi
    const cornerLines: { x1: number; y1: number; x2: number; y2: number }[] = []
    for (let i = 1; i < corners.length; i++) {
        cornerLines.push({
            x1: corners[i - 1].x, y1: corners[i - 1].y,
            x2: corners[i].x,     y2: corners[i].y,
        })
    }
    // Chiudi il poligono se 4 angoli
    if (corners.length === 4) {
        cornerLines.push({
            x1: corners[3].x, y1: corners[3].y,
            x2: corners[0].x, y2: corners[0].y,
        })
    }

    return (
        <Svg
            style={StyleSheet.absoluteFill}
            width={SW}
            height={CAM_H}
            pointerEvents="none"
        >
            {/* Linee campo */}
            {cornerLines.map((l, i) => (
                <Line
                    key={`l${i}`}
                    x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2}
                    stroke="rgba(74,222,128,0.7)"
                    strokeWidth={1.5}
                />
            ))}

            {/* Marker angoli */}
            {corners.map((c, i) => (
                <React.Fragment key={`c${i}`}>
                    <Circle cx={c.x} cy={c.y} r={14}
                        fill="rgba(74,222,128,0.25)" stroke="#4ade80" strokeWidth={2} />
                    <Circle cx={c.x} cy={c.y} r={4} fill="#4ade80" />
                </React.Fragment>
            ))}

            {/* Marker canestro */}
            {hoopCenter && (
                <>
                    <Circle cx={hoopCenter.x} cy={hoopCenter.y} r={22}
                        fill="rgba(255,140,0,0.2)" stroke="#ff8c00" strokeWidth={2.5} />
                    <Circle cx={hoopCenter.x} cy={hoopCenter.y} r={5} fill="#ff8c00" />
                    {/* Mirino orizzontale */}
                    <Line
                        x1={hoopCenter.x - 30} y1={hoopCenter.y}
                        x2={hoopCenter.x - 24} y2={hoopCenter.y}
                        stroke="#ff8c00" strokeWidth={1.5}
                    />
                    <Line
                        x1={hoopCenter.x + 24} y1={hoopCenter.y}
                        x2={hoopCenter.x + 30} y2={hoopCenter.y}
                        stroke="#ff8c00" strokeWidth={1.5}
                    />
                    {/* Mirino verticale */}
                    <Line
                        x1={hoopCenter.x} y1={hoopCenter.y - 30}
                        x2={hoopCenter.x} y2={hoopCenter.y - 24}
                        stroke="#ff8c00" strokeWidth={1.5}
                    />
                    <Line
                        x1={hoopCenter.x} y1={hoopCenter.y + 24}
                        x2={hoopCenter.x} y2={hoopCenter.y + 30}
                        stroke="#ff8c00" strokeWidth={1.5}
                    />
                </>
            )}
        </Svg>
    )
}

// ─── Schermata ────────────────────────────────────────────────
export default function CalibrationScreen({ navigation, route }: any) {
    const { sessionId } = route.params || {}
    const auth = useContext(AuthContext)
    const { user } = auth || {}

    const [permission, requestPermission] = useCameraPermissions()
    const [step, setStep] = useState<CalibStep>('hoop')
    const [hoopCenter, setHoopCenter] = useState<Point | null>(null)
    const [corners, setCorners] = useState<Point[]>([])
    const [isSaving, setIsSaving] = useState(false)
    const { alert, showError, showSuccess, showWarning } = useCustomAlert()

    if (!permission) return <View style={styles.container} />

    if (!permission.granted) {
        return (
            <View style={[styles.container, styles.center]}>
                <Text style={styles.title}>📷 Permesso Camera</Text>
                <Text style={styles.subtitle}>Necessario per la calibrazione del campo</Text>
                <TouchableOpacity style={styles.primaryBtn} onPress={requestPermission}>
                    <Text style={styles.primaryBtnText}>Concedi Permesso</Text>
                </TouchableOpacity>
            </View>
        )
    }

    const normalizePoint = (rawX: number, rawY: number): Point => ({
        x: Math.max(0, Math.min(1, rawX / SW)),
        y: Math.max(0, Math.min(1, rawY / CAM_H)),
    })

    const handleCameraTouch = (event: any) => {
        const { locationX, locationY } = event.nativeEvent
        if (step === 'hoop') {
            setHoopCenter({ x: locationX, y: locationY })
        } else if (step === 'corners' && corners.length < 4) {
            const updated = [...corners, { x: locationX, y: locationY }]
            setCorners(updated)
            if (updated.length === 4) setStep('done')
        }
    }

    const handleSave = async () => {
        if (!hoopCenter || !user?.id || !sessionId) {
            showError('Errore', 'Seleziona prima il centro del canestro')
            return
        }
        setIsSaving(true)
        try {
            const normHoop = normalizePoint(hoopCenter.x, hoopCenter.y)
            let courtCorners
            if (corners.length === 4) {
                const nc = corners.map(c => normalizePoint(c.x, c.y))
                courtCorners = {
                    topLeft: nc[0], topRight: nc[1],
                    bottomRight: nc[2], bottomLeft: nc[3],
                }
            }
            const calibrationData: CalibrationData = {
                homographyMatrix: corners.length === 4 ? [1,0,0, 0,1,0, 0,0,1] : [],
                hoopCenter: normHoop,
                courtCorners,
            }
            await saveCourtCalibration(sessionId, user.id, calibrationData)
            showSuccess('Calibrazione salvata', 'Il campo è stato calibrato')
            navigation.navigate('WorkoutSession', { sessionId })
        } catch (e: any) {
            showError('Errore', e.message || 'Impossibile salvare la calibrazione')
        } finally {
            setIsSaving(false)
        }
    }

    const handleSkip = () => {
        showWarning(
            'Salta calibrazione',
            'Senza calibrazione il tracking delle coordinate sarà meno preciso.',
            () => navigation.navigate('WorkoutSession', { sessionId })
        )
    }

    const resetAll = () => { setCorners([]); setStep('hoop'); setHoopCenter(null) }

    const CORNER_LABELS = ['Ang. SX alto', 'Ang. DX alto', 'Ang. DX basso', 'Ang. SX basso']
    const si = {
        hoop:    { label: '1/2 — Canestro', hint: 'Tocca il centro del ferro', color: '#ff8c00' },
        corners: { label: '2/2 — Angoli campo', hint: `Tocca: ${CORNER_LABELS[corners.length] ?? ''}`, color: '#4ade80' },
        done:    { label: '✓ Pronto', hint: 'Calibrazione completa', color: '#4ade80' },
    }[step]

    return (
        <View style={styles.container}>
            {/* Header */}
            <View style={styles.header}>
                <TouchableOpacity onPress={handleSkip}>
                    <Text style={styles.skipText}>Salta</Text>
                </TouchableOpacity>
                <View style={styles.headerCenter}>
                    <Text style={[styles.stepLabel, { color: si.color }]}>{si.label}</Text>
                    <Text style={styles.stepHint}>{si.hint}</Text>
                </View>
                <TouchableOpacity onPress={resetAll}>
                    <Text style={styles.resetText}>↺ Reset</Text>
                </TouchableOpacity>
            </View>

            {/* Camera + overlay SVG */}
            <View style={{ height: CAM_H }} onTouchEnd={handleCameraTouch}>
                <CameraView style={StyleSheet.absoluteFill} facing="back">
                    <View style={styles.guideH} />
                    <View style={styles.guideV} />
                    <View style={styles.tapHintWrap}>
                        <Text style={styles.tapHintText}>
                            {step === 'hoop'
                                ? '👆 Tocca il canestro'
                                : step === 'corners'
                                    ? `👆 ${CORNER_LABELS[corners.length] ?? 'Tocca...'}`
                                    : '✅ Tutti i punti posizionati'}
                        </Text>
                    </View>
                </CameraView>
                <CalibrationOverlay hoopCenter={hoopCenter} corners={corners} />
            </View>

            {/* Bottom panel */}
            <ScrollView style={styles.bottomPanel} contentContainerStyle={{ paddingBottom: 24 }}>
                {/* Step indicator */}
                <View style={styles.stepsRow}>
                    <TouchableOpacity
                        style={[styles.stepBtn, step === 'hoop' && styles.stepBtnActive]}
                        onPress={() => setStep('hoop')}
                    >
                        <Text style={styles.stepBtnNum}>1</Text>
                        <Text style={styles.stepBtnLabel}>Canestro{hoopCenter ? ' ✓' : ''}</Text>
                    </TouchableOpacity>
                    <View style={styles.stepConnector} />
                    <TouchableOpacity
                        style={[styles.stepBtn, (step === 'corners' || step === 'done') && styles.stepBtnActive]}
                        onPress={() => hoopCenter && setStep('corners')}
                        disabled={!hoopCenter}
                    >
                        <Text style={styles.stepBtnNum}>2</Text>
                        <Text style={styles.stepBtnLabel}>
                            Angoli {corners.length > 0 ? `${corners.length}/4` : '(opz.)'}
                        </Text>
                    </TouchableOpacity>
                </View>

                {/* Azioni */}
                {step === 'hoop' && hoopCenter && (
                    <TouchableOpacity style={styles.secondaryBtn} onPress={() => setStep('corners')}>
                        <Text style={styles.secondaryBtnText}>Calibra anche gli angoli →</Text>
                    </TouchableOpacity>
                )}

                <TouchableOpacity
                    style={[styles.primaryBtn, (!hoopCenter || isSaving) && styles.primaryBtnDisabled]}
                    onPress={handleSave}
                    disabled={!hoopCenter || isSaving}
                >
                    <Text style={styles.primaryBtnText}>
                        {isSaving ? 'Salvataggio...' : 'Salva e inizia sessione'}
                    </Text>
                </TouchableOpacity>
            </ScrollView>

            <CustomAlert {...alert} />
        </View>
    )
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#0b0f1a' },
    center: { justifyContent: 'center', alignItems: 'center', padding: 24 },
    header: {
        flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
        paddingHorizontal: 16,
        paddingTop: Platform.OS === 'ios' ? 44 : 12,
        paddingBottom: 10,
        backgroundColor: '#121826',
        borderBottomWidth: 1, borderBottomColor: '#2a2a2a',
    },
    skipText: { color: '#888', fontSize: 14 },
    resetText: { color: '#888', fontSize: 14 },
    headerCenter: { flex: 1, alignItems: 'center', paddingHorizontal: 8 },
    stepLabel: { fontSize: 13, fontWeight: '700' },
    stepHint: { fontSize: 11, color: '#888', marginTop: 2 },
    guideH: {
        position: 'absolute', left: 0, right: 0, top: '50%',
        height: 1, backgroundColor: 'rgba(255,140,0,0.25)',
    },
    guideV: {
        position: 'absolute', top: 0, bottom: 0, left: '50%',
        width: 1, backgroundColor: 'rgba(255,140,0,0.25)',
    },
    tapHintWrap: {
        position: 'absolute', bottom: 12, left: 0, right: 0, alignItems: 'center',
    },
    tapHintText: {
        backgroundColor: 'rgba(0,0,0,0.65)', color: '#fff',
        fontSize: 12, fontWeight: '600',
        paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20,
    },
    bottomPanel: { flex: 1, padding: 16 },
    stepsRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
    stepBtn: {
        flex: 1, alignItems: 'center', backgroundColor: '#1e2433',
        borderRadius: 10, padding: 10, borderWidth: 1, borderColor: '#2a2a2a',
    },
    stepBtnActive: { borderColor: '#ff8c00' },
    stepBtnNum: { fontSize: 18, fontWeight: '800', color: '#ff8c00' },
    stepBtnLabel: { fontSize: 11, color: '#888', marginTop: 3 },
    stepConnector: { width: 20, height: 1, backgroundColor: '#2a2a2a', marginHorizontal: 6 },
    primaryBtn: {
        backgroundColor: '#ff8c00', borderRadius: 12,
        paddingVertical: 14, alignItems: 'center', marginBottom: 10,
    },
    primaryBtnDisabled: { opacity: 0.4 },
    primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
    secondaryBtn: {
        borderRadius: 12, paddingVertical: 12, alignItems: 'center',
        borderWidth: 1, borderColor: '#4ade80', marginBottom: 10,
    },
    secondaryBtnText: { color: '#4ade80', fontWeight: '600', fontSize: 14 },
    title: { fontSize: 22, fontWeight: '800', color: '#fff', marginBottom: 12 },
    subtitle: { fontSize: 14, color: '#888', marginBottom: 24 },
})
