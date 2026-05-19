// src/features/workouts/screens/CalibrationScreen.tsx
//
// NOVITÀ:
//  - Guide grafiche SVG che cambiano in base a cameraMode (ANGLE_45 / LATERAL / FRONTAL)
//  - Ogni modalità mostra: canestro atteso, linee campo prospettiche, zona di tiro, frecce direzionali
//  - Overlay "fantasma" semitrasparente guida il posizionamento PRIMA che l'utente tocchi
//  - Una volta toccato, il marker reale sostituisce il fantasma

import React, { useState, useContext } from 'react'
import {
    View, Text, StyleSheet, TouchableOpacity,
    Dimensions, ScrollView, Platform, Animated,
} from 'react-native'
import Svg, {
    Circle, Line, Path, Rect, Polygon, Defs,
    LinearGradient, Stop, G, Text as SvgText,
} from 'react-native-svg'
import { CameraView, useCameraPermissions } from 'expo-camera'
import { AuthContext } from '@/features/auth/context/AuthContext'
import { CameraMode, CalibrationData } from '../types/workouts.types'
import { saveCourtCalibration } from '../api/workouts.api'
import { useCustomAlert, CustomAlert } from '@/shared/components/CustomAlert'

const { width: SW, height: SH } = Dimensions.get('window')
const CAM_H = SH * 0.52

type CalibStep = 'hoop' | 'corners' | 'done'
interface Point { x: number; y: number }

// ─── Configurazione guide per ogni angolo camera ──────────────────────────────
// Tutte le coordinate sono in pixel relativi a SW × CAM_H

const GUIDE_CONFIGS: Record<CameraMode, {
    title: string
    description: string
    icon: string
    // Posizione attesa del canestro (coordinate normalizzate 0-1)
    expectedHoop: { x: number; y: number }
    // Linee campo prospettiche come array di [x1n,y1n, x2n,y2n] (normalizzate)
    courtLines: Array<[number, number, number, number]>
    // Zona di tiro (poligono normalizzato)
    shootingZone: Array<{ x: number; y: number }>
    // Testo delle zone
    labels: Array<{ x: number; y: number; text: string }>
    // Indicazione posizionamento telecamera
    cameraHint: string
}> = {
    ANGLE_45: {
        title: 'Angolo 45°',
        description: 'Posiziona la camera laterale-frontale al canestro, a circa 45° rispetto alla linea di fondo',
        icon: '↗',
        expectedHoop: { x: 0.68, y: 0.28 },
        cameraHint: 'Camera a ~45° dal canestro, altezza spalle',
        courtLines: [
            // Linea di fondo (prospettica da sinistra a destra)
            [0.05, 0.85, 0.95, 0.75],
            // Linea laterale sinistra
            [0.05, 0.85, 0.35, 0.20],
            // Linea laterale destra (lontana)
            [0.95, 0.75, 0.72, 0.18],
            // Linea tiro libero (prospettica)
            [0.35, 0.20, 0.72, 0.18],
            // Linea paint sinistra
            [0.18, 0.70, 0.45, 0.22],
            // Linea paint destra
            [0.60, 0.65, 0.65, 0.20],
            // Arco 3 punti approssimato (linee angolate)
            [0.05, 0.72, 0.20, 0.35],
            [0.90, 0.62, 0.75, 0.30],
        ],
        shootingZone: [
            { x: 0.15, y: 0.72 }, { x: 0.50, y: 0.65 },
            { x: 0.55, y: 0.30 }, { x: 0.40, y: 0.22 },
            { x: 0.18, y: 0.38 },
        ],
        labels: [
            { x: 0.68, y: 0.18, text: '🏀 CANESTRO' },
            { x: 0.30, y: 0.55, text: 'Paint' },
            { x: 0.12, y: 0.60, text: '3 PT' },
        ],
    },
    LATERAL: {
        title: 'Vista Laterale',
        description: 'Posiziona la camera esattamente di lato rispetto alla linea di tiro, parallela al canestro',
        icon: '→',
        expectedHoop: { x: 0.78, y: 0.32 },
        cameraHint: 'Camera laterale al canestro, allineata con il ferro',
        courtLines: [
            // Pavimento (linea orizzontale)
            [0.02, 0.88, 0.98, 0.88],
            // Palo canestro
            [0.78, 0.88, 0.78, 0.26],
            // Tabellone
            [0.70, 0.26, 0.88, 0.26],
            [0.70, 0.26, 0.70, 0.38],
            [0.88, 0.26, 0.88, 0.38],
            [0.70, 0.38, 0.88, 0.38],
            // Linea di tiro libero (distanza)
            [0.28, 0.88, 0.28, 0.30],
            // Linea 3 punti (distanza)
            [0.08, 0.88, 0.08, 0.40],
            // Freccia traiettoria tiro
            [0.22, 0.68, 0.78, 0.35],
        ],
        shootingZone: [
            { x: 0.05, y: 0.88 }, { x: 0.40, y: 0.88 },
            { x: 0.40, y: 0.78 }, { x: 0.05, y: 0.78 },
        ],
        labels: [
            { x: 0.78, y: 0.20, text: '🏀 CANESTRO' },
            { x: 0.28, y: 0.75, text: 'Tiro libero' },
            { x: 0.08, y: 0.75, text: '3 PT' },
            { x: 0.22, y: 0.56, text: '↗ Traiettoria' },
        ],
    },
    FRONTAL: {
        title: 'Vista Frontale',
        description: 'Posiziona la camera direttamente di fronte al canestro, centrata sotto il ferro',
        icon: '↑',
        expectedHoop: { x: 0.50, y: 0.28 },
        cameraHint: 'Camera centrata sotto il canestro, frontale',
        courtLines: [
            // Linea di fondo orizzontale
            [0.02, 0.85, 0.98, 0.85],
            // Linea laterale sinistra
            [0.02, 0.85, 0.02, 0.10],
            // Linea laterale destra
            [0.98, 0.85, 0.98, 0.10],
            // Paint sinistra
            [0.22, 0.85, 0.22, 0.42],
            // Paint destra
            [0.78, 0.85, 0.78, 0.42],
            // Linea tiro libero
            [0.22, 0.42, 0.78, 0.42],
            // Tabellone
            [0.35, 0.18, 0.65, 0.18],
            [0.35, 0.18, 0.35, 0.32],
            [0.65, 0.18, 0.65, 0.32],
            [0.35, 0.32, 0.65, 0.32],
            // Palo canestro
            [0.50, 0.88, 0.50, 0.28],
        ],
        shootingZone: [
            { x: 0.22, y: 0.85 }, { x: 0.78, y: 0.85 },
            { x: 0.78, y: 0.42 }, { x: 0.22, y: 0.42 },
        ],
        labels: [
            { x: 0.50, y: 0.18, text: '🏀 CANESTRO' },
            { x: 0.50, y: 0.64, text: 'Paint' },
            { x: 0.11, y: 0.64, text: '3 PT ←' },
            { x: 0.89, y: 0.64, text: '→ 3 PT' },
        ],
    },
}

// ─── Guide overlay SVG (fantasma + punti utente) ──────────────────────────────
const CalibrationGuideOverlay = ({
    cameraMode,
    hoopCenter,
    corners,
    step,
}: {
    cameraMode: CameraMode
    hoopCenter: Point | null
    corners: Point[]
    step: CalibStep
}) => {
    const cfg = GUIDE_CONFIGS[cameraMode]

    const px = (nx: number) => nx * SW
    const py = (ny: number) => ny * CAM_H

    // Poligono zona tiro
    const shootingZonePoints = cfg.shootingZone
        .map(p => `${px(p.x)},${py(p.y)}`)
        .join(' ')

    // Posizione attesa canestro (fantasma)
    const ghostHoop = {
        x: px(cfg.expectedHoop.x),
        y: py(cfg.expectedHoop.y),
    }

    return (
        <Svg
            style={StyleSheet.absoluteFill}
            width={SW}
            height={CAM_H}
            pointerEvents="none"
        >
            <Defs>
                <LinearGradient id="zoneGrad" x1="0" y1="0" x2="0" y2="1">
                    <Stop offset="0" stopColor="#ff8c00" stopOpacity="0.05" />
                    <Stop offset="1" stopColor="#ff8c00" stopOpacity="0.15" />
                </LinearGradient>
            </Defs>

            {/* ── Zona di tiro (sfondo sfumato) ── */}
            <Polygon
                points={shootingZonePoints}
                fill="url(#zoneGrad)"
                stroke="rgba(255,140,0,0.2)"
                strokeWidth={1}
                strokeDasharray="6,4"
            />

            {/* ── Linee campo prospettiche ── */}
            {cfg.courtLines.map(([x1n, y1n, x2n, y2n], i) => (
                <Line
                    key={`cl-${i}`}
                    x1={px(x1n)} y1={py(y1n)}
                    x2={px(x2n)} y2={py(y2n)}
                    stroke="rgba(255,255,255,0.18)"
                    strokeWidth={1}
                    strokeDasharray={i > 5 ? '8,5' : undefined}
                />
            ))}

            {/* ── Label zone ── */}
            {cfg.labels.map((lbl, i) => (
                <SvgText
                    key={`lbl-${i}`}
                    x={px(lbl.x)}
                    y={py(lbl.y)}
                    textAnchor="middle"
                    fill="rgba(255,255,255,0.45)"
                    fontSize={10}
                    fontWeight="600"
                >
                    {lbl.text}
                </SvgText>
            ))}

            {/* ── Canestro fantasma (prima che l'utente tocchi) ── */}
            {!hoopCenter && (
                <G>
                    {/* Alone esterno pulsante */}
                    <Circle
                        cx={ghostHoop.x} cy={ghostHoop.y}
                        r={32}
                        fill="rgba(255,140,0,0.06)"
                        stroke="rgba(255,140,0,0.3)"
                        strokeWidth={1.5}
                        strokeDasharray="5,3"
                    />
                    <Circle
                        cx={ghostHoop.x} cy={ghostHoop.y}
                        r={20}
                        fill="rgba(255,140,0,0.12)"
                        stroke="rgba(255,140,0,0.55)"
                        strokeWidth={2}
                        strokeDasharray="4,3"
                    />
                    <Circle cx={ghostHoop.x} cy={ghostHoop.y} r={5}
                        fill="rgba(255,140,0,0.6)"
                    />
                    {/* Mirino tratteggiato */}
                    {[[-38, 0, -26, 0], [26, 0, 38, 0], [0, -38, 0, -26], [0, 26, 0, 38]].map(([x1, y1, x2, y2], i) => (
                        <Line key={`gh-${i}`}
                            x1={ghostHoop.x + x1} y1={ghostHoop.y + y1}
                            x2={ghostHoop.x + x2} y2={ghostHoop.y + y2}
                            stroke="rgba(255,140,0,0.6)"
                            strokeWidth={1.5}
                        />
                    ))}
                    <SvgText
                        x={ghostHoop.x}
                        y={ghostHoop.y - 42}
                        textAnchor="middle"
                        fill="rgba(255,140,0,0.85)"
                        fontSize={11}
                        fontWeight="700"
                    >
                        👆 tocca qui
                    </SvgText>
                </G>
            )}

            {/* ── Canestro reale (dopo tocco) ── */}
            {hoopCenter && (
                <G>
                    <Circle cx={hoopCenter.x} cy={hoopCenter.y} r={28}
                        fill="rgba(255,140,0,0.15)"
                        stroke="#ff8c00" strokeWidth={2.5}
                    />
                    <Circle cx={hoopCenter.x} cy={hoopCenter.y} r={6} fill="#ff8c00" />
                    {[[-36, 0, -24, 0], [24, 0, 36, 0], [0, -36, 0, -24], [0, 24, 0, 36]].map(([x1, y1, x2, y2], i) => (
                        <Line key={`hm-${i}`}
                            x1={hoopCenter.x + x1} y1={hoopCenter.y + y1}
                            x2={hoopCenter.x + x2} y2={hoopCenter.y + y2}
                            stroke="#ff8c00" strokeWidth={2}
                        />
                    ))}
                    <SvgText
                        x={hoopCenter.x}
                        y={hoopCenter.y - 38}
                        textAnchor="middle"
                        fill="#ff8c00"
                        fontSize={11}
                        fontWeight="700"
                    >
                        ✓ Canestro
                    </SvgText>
                </G>
            )}

            {/* ── Angoli campo reali ── */}
            {corners.map((c, i) => {
                const CORNER_LABELS_SHORT = ['↖', '↗', '↘', '↙']
                return (
                    <G key={`corner-${i}`}>
                        <Circle cx={c.x} cy={c.y} r={16}
                            fill="rgba(74,222,128,0.2)"
                            stroke="#4ade80" strokeWidth={2}
                        />
                        <Circle cx={c.x} cy={c.y} r={4} fill="#4ade80" />
                        <SvgText
                            x={c.x}
                            y={c.y - 22}
                            textAnchor="middle"
                            fill="#4ade80"
                            fontSize={14}
                        >
                            {CORNER_LABELS_SHORT[i]}
                        </SvgText>
                    </G>
                )
            })}

            {/* ── Linee tra angoli ── */}
            {corners.length > 1 && corners.map((c, i) => {
                if (i === 0) return null
                return (
                    <Line key={`cl2-${i}`}
                        x1={corners[i - 1].x} y1={corners[i - 1].y}
                        x2={c.x} y2={c.y}
                        stroke="#4ade80" strokeWidth={1.5}
                        strokeOpacity={0.7}
                    />
                )
            })}
            {corners.length === 4 && (
                <Line
                    x1={corners[3].x} y1={corners[3].y}
                    x2={corners[0].x} y2={corners[0].y}
                    stroke="#4ade80" strokeWidth={1.5}
                    strokeOpacity={0.7}
                />
            )}

            {/* ── Angoli fantasma (quando si è in step corners) ── */}
            {step === 'corners' && corners.length < 4 && (() => {
                const nextIdx = corners.length
                const ghostCorners = [
                    { x: 0.08, y: 0.15 }, { x: 0.92, y: 0.15 },
                    { x: 0.92, y: 0.88 }, { x: 0.08, y: 0.88 },
                ]
                const gc = ghostCorners[nextIdx]
                return (
                    <G>
                        <Circle
                            cx={px(gc.x)} cy={py(gc.y)} r={18}
                            fill="rgba(74,222,128,0.08)"
                            stroke="rgba(74,222,128,0.4)"
                            strokeWidth={1.5}
                            strokeDasharray="4,3"
                        />
                        <SvgText
                            x={px(gc.x)}
                            y={py(gc.y) - 26}
                            textAnchor="middle"
                            fill="rgba(74,222,128,0.7)"
                            fontSize={10}
                            fontWeight="600"
                        >
                            👆 angolo {nextIdx + 1}
                        </SvgText>
                    </G>
                )
            })()}
        </Svg>
    )
}

// ─── Card info angolo camera ───────────────────────────────────────────────────
const CameraModeInfoCard = ({ cameraMode }: { cameraMode: CameraMode }) => {
    const cfg = GUIDE_CONFIGS[cameraMode]
    return (
        <View style={styles.modeCard}>
            <Text style={styles.modeCardIcon}>{cfg.icon}</Text>
            <View style={styles.modeCardContent}>
                <Text style={styles.modeCardTitle}>{cfg.title}</Text>
                <Text style={styles.modeCardDesc}>{cfg.description}</Text>
                <View style={styles.cameraHintRow}>
                    <Text style={styles.cameraHintIcon}>📷</Text>
                    <Text style={styles.cameraHintText}>{cfg.cameraHint}</Text>
                </View>
            </View>
        </View>
    )
}

// ─── Schermata principale ─────────────────────────────────────────────────────
export default function CalibrationScreen({ navigation, route }: any) {
    const { sessionId, cameraMode: rawMode } = route.params || {}
    const cameraMode: CameraMode = rawMode || 'ANGLE_45'
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

    const stepInfo = {
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
                    <Text style={[styles.stepLabel, { color: stepInfo.color }]}>{stepInfo.label}</Text>
                    <Text style={styles.stepHint}>{stepInfo.hint}</Text>
                </View>
                <TouchableOpacity onPress={resetAll}>
                    <Text style={styles.resetText}>↺ Reset</Text>
                </TouchableOpacity>
            </View>

            {/* Camera + overlay guide */}
            <View style={{ height: CAM_H }} onTouchEnd={handleCameraTouch}>
                <CameraView style={StyleSheet.absoluteFill} facing="back" />
                
                {/* Overlay elements positioned absolutely over camera */}
                <View style={StyleSheet.absoluteFill}>
                    {/* Griglia centro debole */}
                    <View style={styles.guideH} />
                    <View style={styles.guideV} />
                    {/* Hint in basso */}
                    <View style={styles.tapHintWrap}>
                        <Text style={styles.tapHintText}>
                            {step === 'hoop'
                                ? hoopCenter ? '✅ Canestro posizionato — tocca ancora per spostare' : '👆 Tocca il centro del canestro'
                                : step === 'corners'
                                    ? `👆 ${CORNER_LABELS[corners.length] ?? 'Tocca...'}`
                                    : '✅ Tutti i punti posizionati'}
                        </Text>
                    </View>
                </View>

                {/* Guide SVG sopra la camera */}
                <CalibrationGuideOverlay
                    cameraMode={cameraMode}
                    hoopCenter={hoopCenter}
                    corners={corners}
                    step={step}
                />
            </View>

            {/* Pannello info + step */}
            <ScrollView style={styles.bottomPanel} contentContainerStyle={{ paddingBottom: 24 }}>
                {/* Card modalità camera */}
                <CameraModeInfoCard cameraMode={cameraMode} />

                {/* Step indicator */}
                <View style={styles.stepsRow}>
                    <TouchableOpacity
                        style={[styles.stepBtn, step === 'hoop' && styles.stepBtnActive]}
                        onPress={() => setStep('hoop')}
                    >
                        <Text style={[styles.stepBtnNum, { color: hoopCenter ? '#4ade80' : '#ff8c00' }]}>
                            {hoopCenter ? '✓' : '1'}
                        </Text>
                        <Text style={styles.stepBtnLabel}>Canestro</Text>
                    </TouchableOpacity>
                    <View style={styles.stepConnector} />
                    <TouchableOpacity
                        style={[styles.stepBtn, (step === 'corners' || step === 'done') && styles.stepBtnActive]}
                        onPress={() => hoopCenter && setStep('corners')}
                        disabled={!hoopCenter}
                    >
                        <Text style={[styles.stepBtnNum, { color: corners.length === 4 ? '#4ade80' : '#888' }]}>
                            {corners.length === 4 ? '✓' : '2'}
                        </Text>
                        <Text style={styles.stepBtnLabel}>
                            Angoli {corners.length > 0 ? `${corners.length}/4` : '(opz.)'}
                        </Text>
                    </TouchableOpacity>
                </View>

                {/* CTA secondario angoli */}
                {step === 'hoop' && hoopCenter && (
                    <TouchableOpacity style={styles.secondaryBtn} onPress={() => setStep('corners')}>
                        <Text style={styles.secondaryBtnText}>+ Calibra anche gli angoli campo →</Text>
                    </TouchableOpacity>
                )}

                {/* Salva */}
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
        height: 1, backgroundColor: 'rgba(255,255,255,0.08)',
    },
    guideV: {
        position: 'absolute', top: 0, bottom: 0, left: '50%',
        width: 1, backgroundColor: 'rgba(255,255,255,0.08)',
    },
    tapHintWrap: {
        position: 'absolute', bottom: 12, left: 0, right: 0, alignItems: 'center',
    },
    tapHintText: {
        backgroundColor: 'rgba(0,0,0,0.7)', color: '#fff',
        fontSize: 12, fontWeight: '600',
        paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20,
    },
    bottomPanel: { flex: 1, padding: 14 },

    // Card modalità
    modeCard: {
        flexDirection: 'row', alignItems: 'flex-start',
        backgroundColor: '#121826', borderRadius: 12,
        padding: 12, marginBottom: 12,
        borderWidth: 1, borderColor: '#2a2a2a',
    },
    modeCardIcon: { fontSize: 26, marginRight: 12, marginTop: 2 },
    modeCardContent: { flex: 1 },
    modeCardTitle: { fontSize: 14, fontWeight: '700', color: '#fff', marginBottom: 3 },
    modeCardDesc: { fontSize: 12, color: '#888', lineHeight: 17, marginBottom: 6 },
    cameraHintRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    cameraHintIcon: { fontSize: 12 },
    cameraHintText: { fontSize: 11, color: '#ff8c00', fontWeight: '600' },

    // Steps
    stepsRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
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
    secondaryBtnText: { color: '#4ade80', fontWeight: '600', fontSize: 13 },
    title: { fontSize: 22, fontWeight: '800', color: '#fff', marginBottom: 12 },
    subtitle: { fontSize: 14, color: '#888', marginBottom: 24 },
})
