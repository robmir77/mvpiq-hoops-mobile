// src/features/workouts/screens/CalibrationScreen.tsx
//
// - Migrato da expo-camera a react-native-vision-camera v4
// - Guide SVG differenziate per ANGLE_45 / LATERAL / FRONTAL
// - Overlay "fantasma" che indica dove posizionare canestro e angoli
// - Debug overlay persistente: mostra i dati di calibrazione salvati
//   sopra la camera per verificare la correttezza prima di procedere

import React, { useState, useContext } from 'react'
import {
    View, Text, StyleSheet, TouchableOpacity,
    Dimensions, ScrollView, Platform,
} from 'react-native'
import Svg, {
    Circle, Line, Polygon, Defs,
    LinearGradient, Stop, G, Text as SvgText,
} from 'react-native-svg'
import { Camera } from 'react-native-vision-camera'
import { AuthContext } from '@/features/auth/context/AuthContext'
import { CameraMode, CalibrationData } from '../types/workouts.types'
import { useVisionCamera } from '../hooks/useVisionCamera'
import { saveCourtCalibration } from '../api/workouts.api'
import { useCustomAlert, CustomAlert } from '@/shared/components/CustomAlert'

const { width: SW, height: SH } = Dimensions.get('window')
const CAM_H = SH * 0.52

type CalibStep = 'hoop' | 'corners' | 'done'
interface Point { x: number; y: number }

// ─── Configurazioni guide per ogni modalità ───────────────────────────────────
const GUIDE_CONFIGS: Record<CameraMode, {
    title: string
    description: string
    icon: string
    expectedHoop: { x: number; y: number }
    courtLines: Array<[number, number, number, number]>
    shootingZone: Array<{ x: number; y: number }>
    labels: Array<{ x: number; y: number; text: string }>
    cameraHint: string
    positioningTips: string[]
}> = {
    ANGLE_45: {
        title: 'Angolo 45°',
        description: 'Camera a 45° laterale rispetto al canestro, altezza spalle',
        icon: '↗',
        expectedHoop: { x: 0.68, y: 0.28 },
        cameraHint: 'Posizionati a lato del canestro con la camera rivolta verso il ferro a 45°',
        positioningTips: [
            '📍 Camera a circa 4-5m dal canestro',
            '📐 Angolo di 45° rispetto alla linea di fondo',
            '📏 Altezza camera: livello spalle (~1.5m)',
            '🎯 Canestro visibile a destra nel frame',
        ],
        courtLines: [
            [0.05, 0.85, 0.95, 0.75],   // linea di fondo
            [0.05, 0.85, 0.35, 0.20],   // laterale sx
            [0.95, 0.75, 0.72, 0.18],   // laterale dx
            [0.35, 0.20, 0.72, 0.18],   // tiro libero
            [0.18, 0.70, 0.45, 0.22],   // paint sx
            [0.60, 0.65, 0.65, 0.20],   // paint dx
            [0.05, 0.72, 0.20, 0.35],   // arco 3pt sx
            [0.90, 0.62, 0.75, 0.30],   // arco 3pt dx
        ],
        shootingZone: [
            { x: 0.15, y: 0.72 }, { x: 0.50, y: 0.65 },
            { x: 0.55, y: 0.30 }, { x: 0.40, y: 0.22 },
            { x: 0.18, y: 0.38 },
        ],
        labels: [
            { x: 0.68, y: 0.17, text: '🏀 CANESTRO' },
            { x: 0.30, y: 0.55, text: 'Paint' },
            { x: 0.10, y: 0.58, text: '3PT' },
        ],
    },
    LATERAL: {
        title: 'Vista Laterale',
        description: 'Camera esattamente di lato, allineata con il ferro del canestro',
        icon: '→',
        expectedHoop: { x: 0.78, y: 0.32 },
        cameraHint: 'Metti la camera perfettamente di fianco al canestro, allineata con il ferro',
        positioningTips: [
            '📍 Camera a 90° rispetto alla linea di tiro',
            '📏 Allineata orizzontalmente con il ferro',
            '📐 Distanza: 6-8m laterale dal canestro',
            '🎯 Palo e tabellone visibili a destra nel frame',
        ],
        courtLines: [
            [0.02, 0.88, 0.98, 0.88],   // pavimento
            [0.78, 0.88, 0.78, 0.24],   // palo canestro
            [0.70, 0.24, 0.88, 0.24],   // tabellone top
            [0.70, 0.24, 0.70, 0.38],   // tabellone sx
            [0.88, 0.24, 0.88, 0.38],   // tabellone dx
            [0.70, 0.38, 0.88, 0.38],   // tabellone bottom
            [0.28, 0.88, 0.28, 0.28],   // linea tiro libero
            [0.08, 0.88, 0.08, 0.38],   // linea 3pt
            [0.22, 0.68, 0.76, 0.34],   // freccia traiettoria
        ],
        shootingZone: [
            { x: 0.05, y: 0.88 }, { x: 0.40, y: 0.88 },
            { x: 0.40, y: 0.78 }, { x: 0.05, y: 0.78 },
        ],
        labels: [
            { x: 0.79, y: 0.16, text: '🏀 CANESTRO' },
            { x: 0.28, y: 0.74, text: 'T.Libero' },
            { x: 0.08, y: 0.74, text: '3PT' },
            { x: 0.40, y: 0.54, text: '↗ Tiro' },
        ],
    },
    FRONTAL: {
        title: 'Vista Frontale',
        description: 'Camera centrata direttamente sotto il canestro, inquadratura frontale',
        icon: '↑',
        expectedHoop: { x: 0.50, y: 0.28 },
        cameraHint: 'Posizionati sotto il canestro con la camera rivolta verso il giocatore',
        positioningTips: [
            '📍 Camera centrata sotto il canestro',
            '📏 A circa 1-2m oltre la linea di fondo',
            '📐 Puntata verso il centro del campo',
            '🎯 Canestro centrato e in alto nel frame',
        ],
        courtLines: [
            [0.02, 0.85, 0.98, 0.85],   // fondo
            [0.02, 0.85, 0.02, 0.08],   // laterale sx
            [0.98, 0.85, 0.98, 0.08],   // laterale dx
            [0.22, 0.85, 0.22, 0.40],   // paint sx
            [0.78, 0.85, 0.78, 0.40],   // paint dx
            [0.22, 0.40, 0.78, 0.40],   // tiro libero
            [0.35, 0.16, 0.65, 0.16],   // tabellone top
            [0.35, 0.16, 0.35, 0.30],   // tabellone sx
            [0.65, 0.16, 0.65, 0.30],   // tabellone dx
            [0.35, 0.30, 0.65, 0.30],   // tabellone bottom
            [0.50, 0.88, 0.50, 0.28],   // palo canestro
        ],
        shootingZone: [
            { x: 0.22, y: 0.85 }, { x: 0.78, y: 0.85 },
            { x: 0.78, y: 0.40 }, { x: 0.22, y: 0.40 },
        ],
        labels: [
            { x: 0.50, y: 0.10, text: '🏀 CANESTRO' },
            { x: 0.50, y: 0.62, text: 'Paint' },
            { x: 0.10, y: 0.62, text: '← 3PT' },
            { x: 0.90, y: 0.62, text: '3PT →' },
        ],
    },
}

// ─── Overlay guide SVG ────────────────────────────────────────────────────────
const CalibrationGuideOverlay = ({
    cameraMode, hoopCenter, corners, step,
}: {
    cameraMode: CameraMode
    hoopCenter: Point | null
    corners: Point[]
    step: CalibStep
}) => {
    const cfg = GUIDE_CONFIGS[cameraMode]
    const px = (nx: number) => nx * SW
    const py = (ny: number) => ny * CAM_H
    const shootingZonePoints = cfg.shootingZone.map(p => `${px(p.x)},${py(p.y)}`).join(' ')
    const ghostHoop = { x: px(cfg.expectedHoop.x), y: py(cfg.expectedHoop.y) }

    return (
        <Svg style={StyleSheet.absoluteFill} width={SW} height={CAM_H} pointerEvents="none">
            <Defs>
                <LinearGradient id="zg" x1="0" y1="0" x2="0" y2="1">
                    <Stop offset="0" stopColor="#ff8c00" stopOpacity="0.04" />
                    <Stop offset="1" stopColor="#ff8c00" stopOpacity="0.12" />
                </LinearGradient>
            </Defs>

            {/* Zona di tiro */}
            <Polygon points={shootingZonePoints} fill="url(#zg)"
                stroke="rgba(255,140,0,0.18)" strokeWidth={1} strokeDasharray="6,4" />

            {/* Linee campo */}
            {cfg.courtLines.map(([x1n, y1n, x2n, y2n], i) => (
                <Line key={i} x1={px(x1n)} y1={py(y1n)} x2={px(x2n)} y2={py(y2n)}
                    stroke="rgba(255,255,255,0.20)" strokeWidth={1}
                    strokeDasharray={i > 5 ? '7,4' : undefined} />
            ))}

            {/* Label zone */}
            {cfg.labels.map((lbl, i) => (
                <SvgText key={i} x={px(lbl.x)} y={py(lbl.y)} textAnchor="middle"
                    fill="rgba(255,255,255,0.40)" fontSize={10} fontWeight="600">
                    {lbl.text}
                </SvgText>
            ))}

            {/* Canestro fantasma */}
            {!hoopCenter && (
                <G>
                    <Circle cx={ghostHoop.x} cy={ghostHoop.y} r={34}
                        fill="rgba(255,140,0,0.05)" stroke="rgba(255,140,0,0.25)"
                        strokeWidth={1.5} strokeDasharray="5,3" />
                    <Circle cx={ghostHoop.x} cy={ghostHoop.y} r={20}
                        fill="rgba(255,140,0,0.10)" stroke="rgba(255,140,0,0.50)"
                        strokeWidth={2} strokeDasharray="4,3" />
                    <Circle cx={ghostHoop.x} cy={ghostHoop.y} r={5} fill="rgba(255,140,0,0.55)" />
                    {[[-38,0,-26,0],[26,0,38,0],[0,-38,0,-26],[0,26,0,38]].map(([x1,y1,x2,y2], i) => (
                        <Line key={i}
                            x1={ghostHoop.x+x1} y1={ghostHoop.y+y1}
                            x2={ghostHoop.x+x2} y2={ghostHoop.y+y2}
                            stroke="rgba(255,140,0,0.55)" strokeWidth={1.5} />
                    ))}
                    <SvgText x={ghostHoop.x} y={ghostHoop.y - 44} textAnchor="middle"
                        fill="rgba(255,140,0,0.85)" fontSize={11} fontWeight="700">
                        👆 tocca qui
                    </SvgText>
                </G>
            )}

            {/* Canestro confermato */}
            {hoopCenter && (
                <G>
                    <Circle cx={hoopCenter.x} cy={hoopCenter.y} r={28}
                        fill="rgba(255,140,0,0.15)" stroke="#ff8c00" strokeWidth={2.5} />
                    <Circle cx={hoopCenter.x} cy={hoopCenter.y} r={6} fill="#ff8c00" />
                    {[[-36,0,-24,0],[24,0,36,0],[0,-36,0,-24],[0,24,0,36]].map(([x1,y1,x2,y2], i) => (
                        <Line key={i}
                            x1={hoopCenter.x+x1} y1={hoopCenter.y+y1}
                            x2={hoopCenter.x+x2} y2={hoopCenter.y+y2}
                            stroke="#ff8c00" strokeWidth={2} />
                    ))}
                    <SvgText x={hoopCenter.x} y={hoopCenter.y - 38} textAnchor="middle"
                        fill="#ff8c00" fontSize={11} fontWeight="700">
                        ✓ Canestro
                    </SvgText>
                </G>
            )}

            {/* Angoli campo confermati */}
            {corners.map((c, i) => (
                <G key={i}>
                    <Circle cx={c.x} cy={c.y} r={16}
                        fill="rgba(74,222,128,0.2)" stroke="#4ade80" strokeWidth={2} />
                    <Circle cx={c.x} cy={c.y} r={4} fill="#4ade80" />
                    <SvgText x={c.x} y={c.y - 22} textAnchor="middle" fill="#4ade80" fontSize={13}>
                        {['↖','↗','↘','↙'][i]}
                    </SvgText>
                </G>
            ))}

            {/* Linee perimetro campo */}
            {corners.length > 1 && corners.map((c, i) => {
                if (i === 0) return null
                return <Line key={i}
                    x1={corners[i-1].x} y1={corners[i-1].y} x2={c.x} y2={c.y}
                    stroke="#4ade80" strokeWidth={1.5} strokeOpacity={0.6} />
            })}
            {corners.length === 4 && (
                <Line x1={corners[3].x} y1={corners[3].y} x2={corners[0].x} y2={corners[0].y}
                    stroke="#4ade80" strokeWidth={1.5} strokeOpacity={0.6} />
            )}

            {/* Angolo fantasma successivo */}
            {step === 'corners' && corners.length < 4 && (() => {
                const ghostPos = [
                    { x: 0.08, y: 0.12 }, { x: 0.92, y: 0.12 },
                    { x: 0.92, y: 0.90 }, { x: 0.08, y: 0.90 },
                ]
                const gc = ghostPos[corners.length]
                return (
                    <G>
                        <Circle cx={px(gc.x)} cy={py(gc.y)} r={18}
                            fill="rgba(74,222,128,0.07)" stroke="rgba(74,222,128,0.38)"
                            strokeWidth={1.5} strokeDasharray="4,3" />
                        <SvgText x={px(gc.x)} y={py(gc.y) - 26} textAnchor="middle"
                            fill="rgba(74,222,128,0.65)" fontSize={10} fontWeight="600">
                            👆 angolo {corners.length + 1}
                        </SvgText>
                    </G>
                )
            })()}
        </Svg>
    )
}

// ─── Debug overlay calibrazione (visibile dopo salvataggio) ───────────────────
// Mostra i dati normalizzati salvati in sovraimpressione sulla camera
// come pannello semitrasparente — utile per verificare la calibrazione
const CalibrationDebugOverlay = ({
    calibration,
    cameraMode,
    hoopCenter,
    corners,
}: {
    calibration: CalibrationData | null
    cameraMode: CameraMode
    hoopCenter: Point | null
    corners: Point[]
}) => {
    const cfg = GUIDE_CONFIGS[cameraMode]
    const normHoop = hoopCenter
        ? { x: (hoopCenter.x / SW).toFixed(3), y: (hoopCenter.y / CAM_H).toFixed(3) }
        : null

    return (
        <View style={dbg.panel} pointerEvents="none">
            <View style={dbg.row}>
                <View style={[dbg.modeBadge, { borderColor: '#ff8c00' }]}>
                    <Text style={dbg.modeIcon}>{cfg.icon}</Text>
                    <Text style={dbg.modeText}>{cfg.title}</Text>
                </View>
                <Text style={dbg.title}>DEBUG CAL</Text>
            </View>

            {normHoop && (
                <View style={dbg.dataRow}>
                    <Text style={dbg.key}>Canestro</Text>
                    <Text style={dbg.val}>
                        x={normHoop.x}  y={normHoop.y}
                    </Text>
                </View>
            )}

            {corners.length > 0 && (
                <View style={dbg.dataRow}>
                    <Text style={dbg.key}>Angoli</Text>
                    <Text style={dbg.val}>{corners.length}/4 definiti</Text>
                </View>
            )}

            {calibration && (
                <>
                    <View style={dbg.dataRow}>
                        <Text style={dbg.key}>Hoop norm.</Text>
                        <Text style={dbg.val}>
                            ({calibration.hoopCenter.x.toFixed(3)}, {calibration.hoopCenter.y.toFixed(3)})
                        </Text>
                    </View>
                    <View style={dbg.dataRow}>
                        <Text style={dbg.key}>Homography</Text>
                        <Text style={dbg.val}>
                            {calibration.homographyMatrix.length > 0
                                ? `${calibration.homographyMatrix.length} coefficienti`
                                : 'identità (no angoli)'}
                        </Text>
                    </View>
                    {calibration.courtCorners && (
                        <View style={dbg.dataRow}>
                            <Text style={dbg.key}>Corners</Text>
                            <Text style={dbg.val}>
                                TL({calibration.courtCorners.topLeft.x.toFixed(2)},{calibration.courtCorners.topLeft.y.toFixed(2)})
                                {'  '}
                                BR({calibration.courtCorners.bottomRight.x.toFixed(2)},{calibration.courtCorners.bottomRight.y.toFixed(2)})
                            </Text>
                        </View>
                    )}
                    <View style={[dbg.dataRow, { marginTop: 3 }]}>
                        <View style={dbg.savedBadge}>
                            <Text style={dbg.savedText}>✓ SALVATA</Text>
                        </View>
                    </View>
                </>
            )}
        </View>
    )
}

// ─── Schermata ────────────────────────────────────────────────────────────────
export default function CalibrationScreen({ navigation, route }: any) {
    const { sessionId, cameraMode: rawMode } = route.params || {}
    const cameraMode: CameraMode = rawMode || 'ANGLE_45'
    const { user } = useContext(AuthContext) || {}

    const { device, hasPermission, isActive, requestPermission } = useVisionCamera()
    const [step, setStep] = useState<CalibStep>('hoop')
    const [hoopCenter, setHoopCenter] = useState<Point | null>(null)
    const [corners, setCorners] = useState<Point[]>([])
    const [isSaving, setIsSaving] = useState(false)
    const [savedCalibration, setSavedCalibration] = useState<CalibrationData | null>(null)
    const [showDebug, setShowDebug] = useState(false)
    const { alert, showError, showSuccess, showWarning } = useCustomAlert()

    const cfg = GUIDE_CONFIGS[cameraMode]

    if (!hasPermission) {
        return (
            <View style={[styles.container, styles.center]}>
                <Text style={styles.permTitle}>📷 Permesso Camera</Text>
                <Text style={styles.permDesc}>Necessario per la calibrazione del campo</Text>
                <TouchableOpacity style={styles.primaryBtn} onPress={requestPermission}>
                    <Text style={styles.primaryBtnText}>Concedi Permesso</Text>
                </TouchableOpacity>
            </View>
        )
    }

    if (!device) {
        return (
            <View style={[styles.container, styles.center]}>
                <Text style={styles.permDesc}>Nessuna camera disponibile</Text>
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
            const cal: CalibrationData = {
                homographyMatrix: corners.length === 4 ? [1,0,0,0,1,0,0,0,1] : [],
                hoopCenter: normHoop,
                courtCorners,
            }
            await saveCourtCalibration(sessionId, user.id, cal)
            setSavedCalibration(cal)
            setShowDebug(true)
            showSuccess('Calibrazione salvata', 'Controlla il debug overlay per verificare i dati')
        } catch (e: any) {
            showError('Errore', e.message || 'Impossibile salvare')
        } finally {
            setIsSaving(false)
        }
    }

    const handleProceed = () => {
        navigation.navigate('WorkoutSession', { sessionId, cameraMode })
    }

    const handleSkip = () => {
        showWarning(
            'Salta calibrazione',
            'Senza calibrazione il tracking delle coordinate sarà meno preciso.',
            () => navigation.navigate('WorkoutSession', { sessionId, cameraMode })
        )
    }

    const resetAll = () => {
        setCorners([]); setStep('hoop'); setHoopCenter(null)
        setSavedCalibration(null); setShowDebug(false)
    }

    const CORNER_LABELS = ['Ang. SX alto', 'Ang. DX alto', 'Ang. DX basso', 'Ang. SX basso']

    const stepInfo = {
        hoop:    { label: '1/2 — Canestro', hint: 'Tocca il centro del ferro', color: '#ff8c00' },
        corners: { label: '2/2 — Angoli campo', hint: `Tocca: ${CORNER_LABELS[corners.length] ?? '✓'}`, color: '#4ade80' },
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
                <View style={styles.headerRight}>
                    {savedCalibration && (
                        <TouchableOpacity onPress={() => setShowDebug(v => !v)} style={styles.debugToggle}>
                            <Text style={styles.debugToggleText}>{showDebug ? '🔍 ON' : '🔍 OFF'}</Text>
                        </TouchableOpacity>
                    )}
                    <TouchableOpacity onPress={resetAll}>
                        <Text style={styles.resetText}>↺</Text>
                    </TouchableOpacity>
                </View>
            </View>

            {/* Camera + guide + debug */}
            <View style={{ height: CAM_H }} onTouchEnd={handleCameraTouch}>
                <Camera
                    style={StyleSheet.absoluteFill}
                    device={device}
                    isActive={isActive}
                />

                {/* Guide SVG */}
                <CalibrationGuideOverlay
                    cameraMode={cameraMode}
                    hoopCenter={hoopCenter}
                    corners={corners}
                    step={step}
                />

                {/* Debug overlay calibrazione */}
                {showDebug && (
                    <CalibrationDebugOverlay
                        calibration={savedCalibration}
                        cameraMode={cameraMode}
                        hoopCenter={hoopCenter}
                        corners={corners}
                    />
                )}

                {/* Crosshair */}
                <View style={styles.guideH} pointerEvents="none" />
                <View style={styles.guideV} pointerEvents="none" />

                {/* Hint in basso */}
                <View style={styles.tapHintWrap} pointerEvents="none">
                    <Text style={styles.tapHintText}>
                        {step === 'hoop'
                            ? hoopCenter ? '✅ Canestro — tocca di nuovo per spostare' : '👆 Tocca il centro del canestro'
                            : step === 'corners'
                                ? `👆 ${CORNER_LABELS[corners.length] ?? 'Completo'}`
                                : '✅ Tutti i punti definiti'}
                    </Text>
                </View>
            </View>

            {/* Pannello info */}
            <ScrollView style={styles.bottomPanel} contentContainerStyle={{ paddingBottom: 24 }}>

                {/* Card modalità con suggerimenti specifici */}
                <View style={styles.modeCard}>
                    <View style={styles.modeCardHeader}>
                        <Text style={styles.modeCardIcon}>{cfg.icon}</Text>
                        <View style={{ flex: 1 }}>
                            <Text style={styles.modeCardTitle}>{cfg.title}</Text>
                            <Text style={styles.modeCardDesc}>{cfg.description}</Text>
                        </View>
                    </View>
                    <View style={styles.tipsGrid}>
                        {cfg.positioningTips.map((tip, i) => (
                            <Text key={i} style={styles.tipText}>{tip}</Text>
                        ))}
                    </View>
                </View>

                {/* Step buttons */}
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

                {/* CTA angoli */}
                {step === 'hoop' && hoopCenter && (
                    <TouchableOpacity style={styles.secondaryBtn} onPress={() => setStep('corners')}>
                        <Text style={styles.secondaryBtnText}>+ Aggiungi angoli campo →</Text>
                    </TouchableOpacity>
                )}

                {/* Salva / Procedi */}
                {!savedCalibration ? (
                    <TouchableOpacity
                        style={[styles.primaryBtn, (!hoopCenter || isSaving) && styles.primaryBtnDisabled]}
                        onPress={handleSave}
                        disabled={!hoopCenter || isSaving}
                    >
                        <Text style={styles.primaryBtnText}>
                            {isSaving ? 'Salvataggio...' : 'Salva calibrazione'}
                        </Text>
                    </TouchableOpacity>
                ) : (
                    <TouchableOpacity style={styles.proceedBtn} onPress={handleProceed}>
                        <Text style={styles.proceedBtnText}>▶ Inizia sessione</Text>
                    </TouchableOpacity>
                )}
            </ScrollView>

            <CustomAlert {...alert} />
        </View>
    )
}

// ─── Stili debug overlay ──────────────────────────────────────────────────────
const dbg = StyleSheet.create({
    panel: {
        position: 'absolute', top: 10, left: 10,
        backgroundColor: 'rgba(0,0,0,0.75)',
        borderRadius: 10, padding: 10,
        borderWidth: 1, borderColor: 'rgba(255,140,0,0.4)',
        maxWidth: SW * 0.65,
    },
    row: { flexDirection: 'row', alignItems: 'center', marginBottom: 6, gap: 8 },
    title: { fontSize: 10, fontWeight: '800', color: '#ff8c00', letterSpacing: 1 },
    modeBadge: {
        flexDirection: 'row', alignItems: 'center',
        borderWidth: 1, borderRadius: 6,
        paddingHorizontal: 5, paddingVertical: 2, gap: 3,
    },
    modeIcon: { fontSize: 10 },
    modeText: { fontSize: 9, color: '#ff8c00', fontWeight: '700' },
    dataRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 3, gap: 6 },
    key: { fontSize: 9, color: '#888', fontWeight: '600', minWidth: 60 },
    val: { fontSize: 9, color: '#fff', fontWeight: '500', flex: 1 },
    savedBadge: {
        backgroundColor: 'rgba(74,222,128,0.2)', borderWidth: 1,
        borderColor: '#4ade80', borderRadius: 4,
        paddingHorizontal: 6, paddingVertical: 2,
    },
    savedText: { fontSize: 9, color: '#4ade80', fontWeight: '800', letterSpacing: 0.5 },
})

// ─── Stili schermata ──────────────────────────────────────────────────────────
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
    headerCenter: { flex: 1, alignItems: 'center', paddingHorizontal: 8 },
    stepLabel: { fontSize: 13, fontWeight: '700' },
    stepHint: { fontSize: 11, color: '#888', marginTop: 2 },
    headerRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    debugToggle: {
        backgroundColor: 'rgba(255,140,0,0.15)', borderWidth: 1,
        borderColor: '#ff8c00', borderRadius: 6,
        paddingHorizontal: 7, paddingVertical: 3,
    },
    debugToggleText: { fontSize: 10, color: '#ff8c00', fontWeight: '700' },
    resetText: { color: '#888', fontSize: 18 },
    guideH: {
        position: 'absolute', left: 0, right: 0, top: '50%',
        height: 1, backgroundColor: 'rgba(255,255,255,0.07)',
    },
    guideV: {
        position: 'absolute', top: 0, bottom: 0, left: '50%',
        width: 1, backgroundColor: 'rgba(255,255,255,0.07)',
    },
    tapHintWrap: { position: 'absolute', bottom: 12, left: 0, right: 0, alignItems: 'center' },
    tapHintText: {
        backgroundColor: 'rgba(0,0,0,0.7)', color: '#fff',
        fontSize: 12, fontWeight: '600',
        paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20,
    },
    bottomPanel: { flex: 1, padding: 14 },
    modeCard: {
        backgroundColor: '#121826', borderRadius: 12,
        padding: 12, marginBottom: 12,
        borderWidth: 1, borderColor: '#2a2a2a',
    },
    modeCardHeader: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 10 },
    modeCardIcon: { fontSize: 24, marginRight: 10, marginTop: 1 },
    modeCardTitle: { fontSize: 14, fontWeight: '700', color: '#fff', marginBottom: 2 },
    modeCardDesc: { fontSize: 12, color: '#888', lineHeight: 17 },
    tipsGrid: { gap: 5 },
    tipText: { fontSize: 11, color: '#aaa', lineHeight: 16 },
    stepsRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
    stepBtn: {
        flex: 1, alignItems: 'center', backgroundColor: '#1e2433',
        borderRadius: 10, padding: 10, borderWidth: 1, borderColor: '#2a2a2a',
    },
    stepBtnActive: { borderColor: '#ff8c00' },
    stepBtnNum: { fontSize: 18, fontWeight: '800' },
    stepBtnLabel: { fontSize: 11, color: '#888', marginTop: 3 },
    stepConnector: { width: 20, height: 1, backgroundColor: '#2a2a2a', marginHorizontal: 6 },
    primaryBtn: {
        backgroundColor: '#ff8c00', borderRadius: 12,
        paddingVertical: 14, alignItems: 'center', marginBottom: 10,
    },
    primaryBtnDisabled: { opacity: 0.4 },
    primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
    proceedBtn: {
        backgroundColor: '#22c55e', borderRadius: 12,
        paddingVertical: 14, alignItems: 'center', marginBottom: 10,
    },
    proceedBtnText: { color: '#fff', fontWeight: '800', fontSize: 15 },
    secondaryBtn: {
        borderRadius: 12, paddingVertical: 12, alignItems: 'center',
        borderWidth: 1, borderColor: '#4ade80', marginBottom: 10,
    },
    secondaryBtnText: { color: '#4ade80', fontWeight: '600', fontSize: 13 },
    permTitle: { fontSize: 22, fontWeight: '800', color: '#fff', marginBottom: 12 },
    permDesc: { fontSize: 14, color: '#888', textAlign: 'center', marginBottom: 24 },
})
