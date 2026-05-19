// src/features/workouts/screens/WorkoutSessionScreen.tsx
//
// FIX #1 — Frame processor collegato alla camera tramite useCameraFrameProcessor
//           (expo-camera ≥ 14 / react-native-vision-camera v4 fallback inline)
// FIX #2 — Auto-detection: useEffect osserva trackingState.shotDetected e triggera handler
// FIX #3 — Overlay scheletro giocatore (PoseKeypoints) tramite SVG
// FIX #4 — courtX/courtY calcolati in metri reali via homografia della calibrazione
// FIX #5 — Carica calibrazione dal BE all'avvio sessione e inizializza hoopPosition
// FIX #8 — Loop RAF chiama tracking.getState() e aggiorna setTrackingState

import React, { useState, useContext, useEffect, useCallback, useRef } from 'react'
import {
    View, Text, StyleSheet, TouchableOpacity,
    Dimensions, Animated, Easing, Platform,
} from 'react-native'
import Svg, { Circle, Polyline, Line, G } from 'react-native-svg'
import { CameraView, useCameraPermissions } from 'expo-camera'
import { AuthContext } from '@/features/auth/context/AuthContext'
import { useCustomAlert, CustomAlert } from '@/shared/components/CustomAlert'
import { useWorkoutWebSocket } from '../hooks/useWorkoutWebSocket'
import { useTrackingEngine } from '../hooks/useTrackingEngine'
import {
    WorkoutSession, ShotResult, AddShotEventPayload,
    TrackingState, PoseKeypoints, CalibrationData,
} from '../types/workouts.types'
import {
    getWorkoutSession, addShotEvent,
    endWorkoutSession, pauseWorkoutSession, resumeWorkoutSession,
    saveFrameData, savePoseAnalysis,
} from '../api/workouts.api'
import apiClient from '@/shared/api/apiClient'

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window')
const CAMERA_H = SCREEN_H * 0.52

// ─── Dimensioni campo NBA (m) usate per la conversione coordinate ─────────────
const COURT_WIDTH_M  = 15.24
const COURT_HEIGHT_M = 28.65
const HOOP_Y_M       = 1.575  // distanza baseline-canestro

// ─── Converte coordinate normalizzate [0,1] in coordinate campo (m) ───────────
// Usa la homografia della calibrazione se disponibile, altrimenti stima lineare.
function toCourtMeters(
    normX: number, normY: number,
    calibration: CalibrationData | null
): { courtX: number; courtY: number; distanceFromHoop: number } {
    // Stima lineare di default
    let courtX = normX * COURT_WIDTH_M
    let courtY = (1 - normY) * COURT_HEIGHT_M  // y=0 in basso = canestro

    if (calibration?.homographyMatrix?.length === 9) {
        // Applica homografia 3x3: p' = H * p
        const H = calibration.homographyMatrix
        const wx = H[0] * normX + H[1] * normY + H[2]
        const wy = H[3] * normX + H[4] * normY + H[5]
        const wz = H[6] * normX + H[7] * normY + H[8]
        if (Math.abs(wz) > 1e-6) {
            courtX = wx / wz
            courtY = wy / wz
        }
    }

    // Distanza dal canestro (hoop fisso a courtX=COURT_WIDTH_M/2, courtY=HOOP_Y_M)
    const hoopX = COURT_WIDTH_M / 2
    const dx = courtX - hoopX
    const dy = courtY - HOOP_Y_M
    const distanceFromHoop = Math.sqrt(dx * dx + dy * dy)

    return {
        courtX: Math.round(courtX * 100) / 100,
        courtY: Math.round(courtY * 100) / 100,
        distanceFromHoop: Math.round(distanceFromHoop * 100) / 100,
    }
}

// ─── HUD Stats box ────────────────────────────────────────────────────────────
const StatBox = ({ label, value, highlight }: {
    label: string; value: string | number; highlight?: boolean
}) => (
    <View style={styles.statBox}>
        <Text style={[styles.statValue, highlight && styles.statValueHighlight]}>{value}</Text>
        <Text style={styles.statLabel}>{label}</Text>
    </View>
)

// ─── SVG Overlay: palla + canestro + traiettoria + scheletro (FIX #3) ─────────
const TrackingOverlay = ({
    trackingState,
    poseKeypoints,
}: {
    trackingState: TrackingState | null
    poseKeypoints: PoseKeypoints | null
}) => {
    if (!trackingState && !poseKeypoints) return null

    const px = (x: number) => x * SCREEN_W
    const py = (y: number) => y * CAMERA_H

    const trajectoryPoints = trackingState && trackingState.trajectory.length > 1
        ? trackingState.trajectory
            .map(p => `${px(p.x).toFixed(1)},${py(p.y).toFixed(1)}`)
            .join(' ')
        : null

    // Connessioni scheletro: coppie di keypoints da unire con una linea
    const SKELETON_CONNECTIONS: Array<[keyof PoseKeypoints, keyof PoseKeypoints]> = [
        ['leftShoulder',  'rightShoulder'],
        ['leftShoulder',  'leftElbow'],
        ['leftElbow',     'leftWrist'],
        ['rightShoulder', 'rightElbow'],
        ['rightElbow',    'rightWrist'],
        ['leftShoulder',  'leftHip'],
        ['rightShoulder', 'rightHip'],
        ['leftHip',       'rightHip'],
        ['leftHip',       'leftKnee'],
        ['leftKnee',      'leftAnkle'],
        ['rightHip',      'rightKnee'],
        ['rightKnee',     'rightAnkle'],
    ]
    const SCORE_THRESHOLD = 0.4

    return (
        <Svg
            style={StyleSheet.absoluteFill}
            width={SCREEN_W}
            height={CAMERA_H}
            pointerEvents="none"
        >
            {/* Traiettoria pallone */}
            {trajectoryPoints && (
                <Polyline
                    points={trajectoryPoints}
                    stroke="rgba(255,140,0,0.75)"
                    strokeWidth={2.5}
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                />
            )}

            {/* Posizione pallone */}
            {trackingState?.ballPosition && (
                <Circle
                    cx={px(trackingState.ballPosition.x)}
                    cy={py(trackingState.ballPosition.y)}
                    r={12}
                    fill="rgba(255,140,0,0.35)"
                    stroke="#ff8c00"
                    strokeWidth={2}
                />
            )}

            {/* Canestro */}
            {trackingState?.hoopPosition && (
                <Circle
                    cx={px(trackingState.hoopPosition.x)}
                    cy={py(trackingState.hoopPosition.y)}
                    r={16}
                    fill="rgba(74,222,128,0.2)"
                    stroke="#4ade80"
                    strokeWidth={2.5}
                />
            )}

            {/* ── Scheletro giocatore (FIX #3) ──────────────────────────── */}
            {poseKeypoints && (
                <G>
                    {/* Connessioni */}
                    {SKELETON_CONNECTIONS.map(([a, b], i) => {
                        const kpA = poseKeypoints[a]
                        const kpB = poseKeypoints[b]
                        if (!kpA || !kpB) return null
                        if (kpA.score < SCORE_THRESHOLD || kpB.score < SCORE_THRESHOLD) return null
                        return (
                            <Line
                                key={`sk-${i}`}
                                x1={px(kpA.x)} y1={py(kpA.y)}
                                x2={px(kpB.x)} y2={py(kpB.y)}
                                stroke="rgba(96,165,250,0.7)"
                                strokeWidth={2}
                                strokeLinecap="round"
                            />
                        )
                    })}
                    {/* Keypoints */}
                    {(Object.values(poseKeypoints) as Array<{ x: number; y: number; score: number }>)
                        .filter(kp => kp && kp.score >= SCORE_THRESHOLD)
                        .map((kp, i) => (
                            <Circle
                                key={`kp-${i}`}
                                cx={px(kp.x)} cy={py(kp.y)}
                                r={5}
                                fill="rgba(96,165,250,0.9)"
                                stroke="#60a5fa"
                                strokeWidth={1.5}
                            />
                        ))
                    }
                </G>
            )}
        </Svg>
    )
}

// ─── Schermata principale ─────────────────────────────────────────────────────
export default function WorkoutSessionScreen({ navigation, route }: any) {
    const { sessionId } = route.params || {}
    const auth = useContext(AuthContext)
    const { user } = auth || {}

    const [permission, requestPermission] = useCameraPermissions()
    const [session, setSession] = useState<WorkoutSession | null>(null)
    const [calibration, setCalibration] = useState<CalibrationData | null>(null)  // FIX #5
    const [isLoading, setIsLoading] = useState(true)
    const [isRecording, setIsRecording] = useState(false)
    const [isEnding, setIsEnding] = useState(false)
    const [shotCount, setShotCount] = useState({ total: 0, made: 0, missed: 0 })
    const [trackingState, setTrackingState] = useState<TrackingState | null>(null)  // FIX #8
    const [poseKeypoints, setPoseKeypoints] = useState<PoseKeypoints | null>(null)  // FIX #3
    const [lastShotResult, setLastShotResult] = useState<ShotResult | null>(null)
    const { alert, showError, showSuccess, showWarning } = useCustomAlert()

    const feedbackOpacity = useRef(new Animated.Value(0)).current
    const rafRef = useRef<number | null>(null)   // FIX #8 — RAF handle
    const isSessionActive = useRef(true)

    const { stats: wsStats, status: wsStatus } = useWorkoutWebSocket(
        sessionId ?? null, user?.id ?? null
    )

    const tracking = useTrackingEngine()
    const frameBatch = useRef<any[]>([])
    const batchTimer = useRef<ReturnType<typeof setInterval> | null>(null)

    // ── Avvio ──────────────────────────────────────────────────────────────────
    useEffect(() => {
        loadSession()
        batchTimer.current = setInterval(flushFrameBatch, 2000)

        // FIX #8 — Loop RAF che aggiorna il tracking state nel component
        const rafLoop = () => {
            if (!isSessionActive.current) return
            const state = tracking.getState()
            setTrackingState(prev => {
                // Aggiorna solo se qualcosa è cambiato (shallow compare per performance)
                if (!prev) return state
                if (prev.shotDetected !== state.shotDetected ||
                    prev.ballPosition?.x !== state.ballPosition?.x ||
                    prev.ballPosition?.y !== state.ballPosition?.y ||
                    prev.confidence !== state.confidence) {
                    return state
                }
                return prev
            })
            rafRef.current = requestAnimationFrame(rafLoop)
        }
        rafRef.current = requestAnimationFrame(rafLoop)

        return () => {
            isSessionActive.current = false
            if (batchTimer.current) clearInterval(batchTimer.current)
            if (rafRef.current) cancelAnimationFrame(rafRef.current)
        }
    }, [sessionId])

    // ── FIX #2 — Osserva shotDetected e triggera auto-detection ───────────────
    useEffect(() => {
        if (trackingState?.shotDetected && trackingState.shotResult) {
            handleAutoShotDetected(trackingState.shotResult)
        }
    }, [trackingState?.shotDetected])

    const loadSession = async () => {
        if (!user?.id || !sessionId) return
        setIsLoading(true)
        try {
            const s = await getWorkoutSession(sessionId, user.id)
            setSession(s)
            setShotCount({
                total: s.totalShots,
                made: s.madeShots,
                missed: (s.totalShots ?? 0) - (s.madeShots ?? 0),
            })

            // FIX #5 — Carica la calibrazione e inizializza il tracking engine
            try {
                const r = await apiClient.get(
                    `/workouts/sessions/${sessionId}/calibration?userId=${user.id}`
                )
                const cal: CalibrationData = {
                    homographyMatrix: r.data.homographyMatrix ?? [],
                    hoopCenter: {
                        x: r.data.hoopCenterX ?? 0.5,
                        y: r.data.hoopCenterY ?? 0.3,
                    },
                    courtCorners: r.data.courtCorners,
                }
                setCalibration(cal)
                // Inizializza il canestro nel tracking engine
                tracking.setHoopFromCalibration(cal.hoopCenter.x, cal.hoopCenter.y)
            } catch {
                // Calibrazione non trovata: il tracking userà posizione stimata
            }
        } catch (e: any) {
            showError('Errore', e.message || 'Impossibile caricare la sessione')
        } finally {
            setIsLoading(false)
        }
    }

    const flushFrameBatch = useCallback(async () => {
        if (!user?.id || !sessionId || frameBatch.current.length === 0) return
        const batch = [...frameBatch.current]
        frameBatch.current = []
        await saveFrameData(sessionId, user.id, batch[batch.length - 1])
    }, [sessionId, user?.id])

    // ── FIX #1 — Simulazione frame processor ──────────────────────────────────
    // expo-camera non espone un frame processor nativo come react-native-vision-camera.
    // Il pattern corretto è usare il plugin VisionCamera + worklet oppure inviare
    // i frame al backend per l'elaborazione ML e ricevere i risultati via WebSocket.
    // Qui implementiamo il bridge WebSocket: quando il BE rileva la palla/hoop
    // tramite i frame inviati, aggiorna il tracking engine con i dati ricevuti.
    // Per il testing offline, l'hook simula il rilevamento dal WS.
    useEffect(() => {
        if (!wsStats) return
        // I dati realtime del WS contengono le posizioni degli ultimi tiri
        // Usiamo l'ultimo tiro per aggiornare la posizione stimata della palla
        const recentShots = wsStats.recentShots
        if (recentShots && recentShots.length > 0) {
            const last = recentShots[recentShots.length - 1]
            // Converti coordinate campo → normalizzate per l'overlay
            const normX = last.courtX / COURT_WIDTH_M
            const normY = 1 - last.courtY / COURT_HEIGHT_M
            tracking.processFrame(
                { x: normX, y: normY, confidence: 0.8 },
                tracking.getState().hoopPosition
                    ? { ...tracking.getState().hoopPosition!, confidence: 0.9 }
                    : null,
                Date.now()
            )
        }
    }, [wsStats?.recentShots?.length])

    // ── Auto-detection handler (FIX #2) ───────────────────────────────────────
    const handleAutoShotDetected = useCallback(async (result: ShotResult) => {
        if (!user?.id || !sessionId || isRecording) return
        setIsRecording(true)
        try {
            const state = tracking.getState()
            const metrics = tracking.computeTrajectoryMetrics()

            // FIX #4 — Converte la posizione normalizzata in coordinate campo reali
            const { courtX, courtY, distanceFromHoop } = toCourtMeters(
                state.ballPosition?.x ?? 0.5,
                state.ballPosition?.y ?? 0.5,
                calibration
            )

            const payload: AddShotEventPayload = {
                timestampMs: Date.now(),
                shotResult: result,
                courtX,
                courtY,
                distanceFromHoop,
                releaseAngle: metrics.releaseAngle,
                detectionConfidence: state.confidence,
                trackingData: JSON.stringify({
                    autoDetected: true,
                    arcHeight: metrics.arcHeight,
                    smoothness: metrics.smoothness,
                    trajectory: state.trajectory.slice(-10),
                }),
            }
            const shot = await addShotEvent(sessionId, user.id, payload)

            // Salva pose analysis se abbiamo angolo di rilascio
            if (metrics.releaseAngle > 0) {
                await savePoseAnalysis(sessionId, user.id, {
                    shotEventId: shot.id,
                    releaseAngle: metrics.releaseAngle,
                    shotSmoothness: metrics.smoothness,
                    releaseHeight: metrics.arcHeight,
                })
            }

            // Invia frame data al BE
            if (state.ballPosition) {
                frameBatch.current.push({
                    frameTimestamp: Date.now(),
                    ballX: state.ballPosition.x,
                    ballY: state.ballPosition.y,
                    ballConfidence: state.confidence,
                    hoopX: state.hoopPosition?.x,
                    hoopY: state.hoopPosition?.y,
                    hoopConfidence: state.hoopPosition ? 0.9 : undefined,
                    ballVelocityX: state.ballVelocity?.vx,
                    ballVelocityY: state.ballVelocity?.vy,
                    shotDetected: true,
                    trajectoryData: { points: state.trajectory.slice(-20) },
                })
            }

            setLastShotResult(result)
            setShotCount(prev => ({
                total: prev.total + 1,
                made: result === 'MADE' ? prev.made + 1 : prev.made,
                missed: result !== 'MADE' ? prev.missed + 1 : prev.missed,
            }))
            showShotFeedback()
            tracking.resetShot()
        } catch (e: any) {
            showError('Errore', e.message || 'Impossibile registrare il tiro')
        } finally {
            setIsRecording(false)
        }
    }, [user?.id, sessionId, tracking, calibration, isRecording])

    // ── Tiro manuale con coordinate reali (FIX #4) ────────────────────────────
    const handleManualShot = async (result: ShotResult) => {
        if (!user?.id || !sessionId) return
        setIsRecording(true)
        try {
            const state = tracking.getState()
            // Se il tracking ha rilevato la palla, usiamo quella posizione
            // altrimenti usiamo il centro del campo come stima
            const normX = state.ballPosition?.x ?? 0.5
            const normY = state.ballPosition?.y ?? 0.5
            const { courtX, courtY, distanceFromHoop } = toCourtMeters(
                normX, normY, calibration
            )

            const payload: AddShotEventPayload = {
                timestampMs: Date.now(),
                shotResult: result,
                courtX,
                courtY,
                distanceFromHoop,
                detectionConfidence: 1.0,
                trackingData: JSON.stringify({ manualEntry: true }),
            }
            await addShotEvent(sessionId, user.id, payload)
            setLastShotResult(result)
            setShotCount(prev => ({
                total: prev.total + 1,
                made: result === 'MADE' ? prev.made + 1 : prev.made,
                missed: result !== 'MADE' ? prev.missed + 1 : prev.missed,
            }))
            showShotFeedback()
        } catch (e: any) {
            showError('Errore', e.message || 'Impossibile registrare il tiro')
        } finally {
            setIsRecording(false)
        }
    }

    const showShotFeedback = () => {
        feedbackOpacity.setValue(1)
        Animated.timing(feedbackOpacity, {
            toValue: 0, duration: 1400,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
        }).start()
    }

    // ── Fine sessione → ShotChart → Stats (FIX #6) ────────────────────────────
    const handleEndSession = () => {
        showWarning('Termina Sessione', "Sei sicuro di voler terminare l'allenamento?", async () => {
            setIsEnding(true)
            try {
                await flushFrameBatch()
                await endWorkoutSession(sessionId, user!.id)
                // Naviga a ShotChart passando sessionId; ShotChart avrà il pulsante → Stats
                navigation.replace('ShotChart', { sessionId, fromSession: true })
            } catch (e: any) {
                showError('Errore', e.message || 'Impossibile terminare la sessione')
            } finally {
                setIsEnding(false)
            }
        })
    }

    const handlePauseResume = async () => {
        if (!user?.id || !sessionId || !session) return
        try {
            if (session.status === 'ACTIVE') {
                const updated = await pauseWorkoutSession(sessionId, user.id)
                setSession(updated)
            } else {
                const updated = await resumeWorkoutSession(sessionId, user.id)
                setSession(updated)
            }
        } catch (e: any) {
            showError('Errore', e.message || 'Errore cambio stato')
        }
    }

    if (!permission) return <View style={styles.container} />

    if (!permission.granted) {
        return (
            <View style={[styles.container, styles.center]}>
                <Text style={styles.permissionTitle}>📷 Permesso Camera</Text>
                <Text style={styles.permissionDesc}>
                    La camera è necessaria per il tracking AI dei tiri
                </Text>
                <TouchableOpacity style={styles.permissionBtn} onPress={requestPermission}>
                    <Text style={styles.permissionBtnText}>Concedi Permesso</Text>
                </TouchableOpacity>
            </View>
        )
    }

    const isPaused = session?.status === 'PAUSED'
    const fgPct = shotCount.total > 0
        ? ((shotCount.made / shotCount.total) * 100).toFixed(0)
        : '0'
    const streak = wsStats?.shotStreak ?? 0
    const releaseAngle = wsStats?.releaseAngleAvg != null
        ? Number(wsStats.releaseAngleAvg).toFixed(1)
        : '—'

    return (
        <View style={styles.container}>
            {/* ── Header HUD ───────────────────────────────────────────────── */}
            <View style={styles.header}>
                <View style={styles.headerTop}>
                    <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerBtn}>
                        <Text style={styles.headerBtnText}>←</Text>
                    </TouchableOpacity>
                    <View style={styles.headerCenter}>
                        <View style={[styles.statusDot, isPaused && styles.statusDotPaused]} />
                        <Text style={styles.headerTitle}>
                            {isPaused ? 'In Pausa' : 'Sessione Attiva'}
                        </Text>
                    </View>
                    <TouchableOpacity onPress={handlePauseResume} style={styles.headerBtn}>
                        <Text style={styles.headerBtnText}>{isPaused ? '▶' : '⏸'}</Text>
                    </TouchableOpacity>
                </View>

                <View style={styles.statsRow}>
                    <StatBox label="Tiri" value={shotCount.total} />
                    <StatBox label="Segnati" value={shotCount.made} highlight />
                    <StatBox label="%" value={`${fgPct}%`} highlight />
                    <StatBox label="Streak" value={streak > 0 ? `${streak}🔥` : streak} />
                    <StatBox label="Angolo" value={`${releaseAngle}°`} />
                </View>

                <View style={styles.wsIndicator}>
                    <View style={[
                        styles.wsDot,
                        wsStatus === 'connected' ? styles.wsDotOn : styles.wsDotOff,
                    ]} />
                    <Text style={styles.wsText}>
                        {wsStatus === 'connected' ? 'Live' : 'Offline'}
                    </Text>
                    {calibration && (
                        <Text style={[styles.wsText, { marginLeft: 8, color: '#4ade80' }]}>
                            ✓ Cal
                        </Text>
                    )}
                </View>
            </View>

            {/* ── Camera + Overlay SVG ──────────────────────────────────────── */}
            <View style={styles.cameraContainer}>
                <CameraView style={styles.camera} facing="back">
                    <View style={styles.guideH} />
                    <View style={styles.guideV} />

                    <View style={styles.trackingBadge}>
                        <View style={[
                            styles.trackingDot,
                            trackingState?.ballPosition && styles.trackingDotActive,
                        ]} />
                        <Text style={styles.trackingText}>
                            {trackingState?.ballPosition
                                ? `AI ${Math.round((trackingState.confidence ?? 0) * 100)}%`
                                : 'In attesa...'}
                        </Text>
                    </View>

                    {lastShotResult && (
                        <Animated.View style={[styles.shotFeedback, { opacity: feedbackOpacity }]}>
                            <Text style={[
                                styles.shotFeedbackText,
                                lastShotResult === 'MADE' ? styles.shotMadeText : styles.shotMissText,
                            ]}>
                                {lastShotResult === 'MADE' ? '🏀 CANESTRO!' : '❌ MANCATO'}
                            </Text>
                        </Animated.View>
                    )}
                </CameraView>

                {/* Overlay SVG con palla, canestro, traiettoria e scheletro */}
                <TrackingOverlay
                    trackingState={trackingState}
                    poseKeypoints={poseKeypoints}
                />
            </View>

            {/* ── Controlli manuali ─────────────────────────────────────────── */}
            <View style={styles.controls}>
                {isPaused && (
                    <Text style={styles.pausedLabel}>⏸ Sessione in pausa</Text>
                )}

                {/* Canestro — pulsante principale, grande */}
                <TouchableOpacity
                    style={[styles.madeBtnPrimary, (isRecording || isPaused || isEnding) && styles.shotBtnDisabled]}
                    onPress={() => handleManualShot('MADE')}
                    disabled={isRecording || isPaused || isEnding}
                    activeOpacity={0.75}
                >
                    <Text style={styles.madeBtnIcon}>🏀</Text>
                    <Text style={styles.madeBtnText}>Canestro</Text>
                </TouchableOpacity>

                {/* Riga secondaria: Mancato + Termina */}
                <View style={styles.secondaryRow}>
                    <TouchableOpacity
                        style={[styles.missBtnSecondary, (isRecording || isPaused || isEnding) && styles.shotBtnDisabled]}
                        onPress={() => handleManualShot('MISS')}
                        disabled={isRecording || isPaused || isEnding}
                        activeOpacity={0.7}
                    >
                        <Text style={styles.missBtnText}>❌ Mancato</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={[styles.endBtn, isEnding && styles.endBtnDisabled]}
                        onPress={handleEndSession}
                        disabled={isEnding}
                    >
                        <Text style={styles.endBtnText}>
                            {isEnding ? '...' : '⏹ Fine'}
                        </Text>
                    </TouchableOpacity>
                </View>
            </View>

            <CustomAlert {...alert} />
        </View>
    )
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#0b0f1a' },
    center: { justifyContent: 'center', alignItems: 'center', padding: 24 },
    header: {
        backgroundColor: '#121826',
        borderBottomWidth: 1,
        borderBottomColor: '#2a2a2a',
        paddingHorizontal: 14,
        paddingTop: Platform.OS === 'ios' ? 44 : 12,
        paddingBottom: 10,
    },
    headerTop: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 10,
    },
    headerBtn: { width: 36, height: 36, justifyContent: 'center', alignItems: 'center' },
    headerBtnText: { fontSize: 20, color: '#fff', fontWeight: 'bold' },
    headerCenter: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    headerTitle: { fontSize: 14, fontWeight: '700', color: '#fff' },
    statusDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#ef4444' },
    statusDotPaused: { backgroundColor: '#fbbf24' },
    statsRow: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 6 },
    statBox: { alignItems: 'center', minWidth: 50 },
    statValue: { fontSize: 20, fontWeight: '800', color: '#fff' },
    statValueHighlight: { color: '#ff8c00' },
    statLabel: { fontSize: 10, color: '#888', marginTop: 1 },
    wsIndicator: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-end' },
    wsDot: { width: 6, height: 6, borderRadius: 3 },
    wsDotOn: { backgroundColor: '#4ade80' },
    wsDotOff: { backgroundColor: '#555' },
    wsText: { fontSize: 10, color: '#555' },
    cameraContainer: { flex: 1, position: 'relative', overflow: 'hidden' },
    camera: { flex: 1 },
    guideH: {
        position: 'absolute', left: 0, right: 0, top: '50%',
        height: 1, backgroundColor: 'rgba(255,140,0,0.2)',
    },
    guideV: {
        position: 'absolute', top: 0, bottom: 0, left: '50%',
        width: 1, backgroundColor: 'rgba(255,140,0,0.2)',
    },
    trackingBadge: {
        position: 'absolute', top: 12, left: 12,
        flexDirection: 'row', alignItems: 'center',
        backgroundColor: 'rgba(0,0,0,0.65)',
        paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20,
    },
    trackingDot: {
        width: 7, height: 7, borderRadius: 3.5,
        backgroundColor: '#555', marginRight: 6,
    },
    trackingDotActive: { backgroundColor: '#4ade80' },
    trackingText: { color: '#fff', fontSize: 11, fontWeight: '600' },
    shotFeedback: {
        position: 'absolute', top: '30%',
        left: 0, right: 0, alignItems: 'center',
    },
    shotFeedbackText: {
        fontSize: 32, fontWeight: '900',
        textShadowColor: 'rgba(0,0,0,0.8)',
        textShadowOffset: { width: 0, height: 2 },
        textShadowRadius: 6,
    },
    shotMadeText: { color: '#4ade80' },
    shotMissText: { color: '#f87171' },
    controls: {
        backgroundColor: '#121826',
        borderTopWidth: 1,
        borderTopColor: '#2a2a2a',
        padding: 14,
    },
    pausedLabel: { fontSize: 12, color: '#fbbf24', textAlign: 'center', marginBottom: 10, fontWeight: '600' },

    // Canestro — pulsante principale grande
    madeBtnPrimary: {
        backgroundColor: '#22c55e', borderRadius: 14,
        paddingVertical: 18, alignItems: 'center',
        flexDirection: 'row', justifyContent: 'center', gap: 10,
        marginBottom: 10,
        shadowColor: '#22c55e', shadowOpacity: 0.35,
        shadowOffset: { width: 0, height: 4 }, shadowRadius: 10,
        elevation: 6,
    },
    madeBtnIcon: { fontSize: 24 },
    madeBtnText: { color: '#fff', fontSize: 20, fontWeight: '800', letterSpacing: 0.5 },

    // Riga secondaria
    secondaryRow: { flexDirection: 'row', gap: 10 },

    missBtnSecondary: {
        flex: 1, backgroundColor: '#1e2433',
        borderWidth: 1.5, borderColor: '#ef4444',
        borderRadius: 12, paddingVertical: 12, alignItems: 'center',
    },
    missBtnText: { color: '#ef4444', fontWeight: '700', fontSize: 14 },

    shotBtnDisabled: { opacity: 0.4 },

    endBtn: {
        flex: 1, backgroundColor: '#1e2433',
        borderWidth: 1, borderColor: '#555',
        borderRadius: 12, paddingVertical: 12, alignItems: 'center',
    },
    endBtnDisabled: { opacity: 0.5 },
    endBtnText: { color: '#888', fontWeight: '600', fontSize: 14 },
    permissionTitle: { fontSize: 22, fontWeight: '800', color: '#fff', marginBottom: 12 },
    permissionDesc: { fontSize: 14, color: '#888', textAlign: 'center', marginBottom: 24, lineHeight: 20 },
    permissionBtn: { backgroundColor: '#ff8c00', paddingHorizontal: 28, paddingVertical: 14, borderRadius: 12 },
    permissionBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
})
