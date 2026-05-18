// src/features/workouts/screens/WorkoutSessionScreen.tsx

import React, { useState, useContext, useEffect, useCallback, useRef } from 'react'
import {
    View, Text, StyleSheet, TouchableOpacity,
    Dimensions, Animated, Easing, Platform,
} from 'react-native'
import Svg, { Circle, Polyline, Circle as SvgCircle } from 'react-native-svg'
import { CameraView, useCameraPermissions } from 'expo-camera'
import { AuthContext } from '@/features/auth/context/AuthContext'
import { useCustomAlert, CustomAlert } from '@/shared/components/CustomAlert'
import { useWorkoutWebSocket } from '../hooks/useWorkoutWebSocket'
import { useTrackingEngine } from '../hooks/useTrackingEngine'
import {
    WorkoutSession, ShotResult, AddShotEventPayload, TrackingState,
} from '../types/workouts.types'
import {
    getWorkoutSession, addShotEvent,
    endWorkoutSession, pauseWorkoutSession, resumeWorkoutSession,
    saveFrameData, savePoseAnalysis,
} from '../api/workouts.api'

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window')
const CAMERA_H = SCREEN_H * 0.52

// ─── HUD Stats box ───────────────────────────────────────────
const StatBox = ({ label, value, highlight }: {
    label: string; value: string | number; highlight?: boolean
}) => (
    <View style={styles.statBox}>
        <Text style={[styles.statValue, highlight && styles.statValueHighlight]}>{value}</Text>
        <Text style={styles.statLabel}>{label}</Text>
    </View>
)

// ─── SVG Overlay ─────────────────────────────────────────────
// Rimpiazza @shopify/react-native-skia con react-native-svg
// (già nel progetto come dipendenza di lucide-react-native)
const TrackingOverlay = ({ trackingState }: { trackingState: TrackingState | null }) => {
    if (!trackingState) return null

    // Converte coordinate normalizzate [0,1] in pixel
    const px = (x: number) => x * SCREEN_W
    const py = (y: number) => y * CAMERA_H

    // Traiettoria: lista di punti "x,y" per Polyline
    const trajectoryPoints = trackingState.trajectory.length > 1
        ? trackingState.trajectory
            .map(p => `${px(p.x).toFixed(1)},${py(p.y).toFixed(1)}`)
            .join(' ')
        : null

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
            {trackingState.ballPosition && (
                <Circle
                    cx={px(trackingState.ballPosition.x)}
                    cy={py(trackingState.ballPosition.y)}
                    r={12}
                    fill="rgba(255,140,0,0.35)"
                    stroke="#ff8c00"
                    strokeWidth={2}
                />
            )}

            {/* Posizione canestro */}
            {trackingState.hoopPosition && (
                <Circle
                    cx={px(trackingState.hoopPosition.x)}
                    cy={py(trackingState.hoopPosition.y)}
                    r={16}
                    fill="rgba(74,222,128,0.2)"
                    stroke="#4ade80"
                    strokeWidth={2.5}
                />
            )}
        </Svg>
    )
}

// ─── Schermata principale ─────────────────────────────────────
export default function WorkoutSessionScreen({ navigation, route }: any) {
    const { sessionId } = route.params || {}
    const auth = useContext(AuthContext)
    const { user } = auth || {}

    const [permission, requestPermission] = useCameraPermissions()
    const [session, setSession] = useState<WorkoutSession | null>(null)
    const [isLoading, setIsLoading] = useState(true)
    const [isRecording, setIsRecording] = useState(false)
    const [isEnding, setIsEnding] = useState(false)
    const [shotCount, setShotCount] = useState({ total: 0, made: 0, missed: 0 })
    const [trackingState, setTrackingState] = useState<TrackingState | null>(null)
    const [lastShotResult, setLastShotResult] = useState<ShotResult | null>(null)
    const { alert, showError, showSuccess, showWarning } = useCustomAlert()

    const feedbackOpacity = useRef(new Animated.Value(0)).current

    const { stats: wsStats, status: wsStatus } = useWorkoutWebSocket(
        sessionId ?? null, user?.id ?? null
    )

    const tracking = useTrackingEngine()
    const frameBatch = useRef<any[]>([])
    const batchTimer = useRef<ReturnType<typeof setInterval> | null>(null)

    useEffect(() => {
        loadSession()
        batchTimer.current = setInterval(flushFrameBatch, 2000)
        return () => { if (batchTimer.current) clearInterval(batchTimer.current) }
    }, [sessionId])

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

    const handleAutoShotDetected = useCallback(async (result: ShotResult) => {
        if (!user?.id || !sessionId) return
        setIsRecording(true)
        try {
            const metrics = tracking.computeTrajectoryMetrics()
            const payload: AddShotEventPayload = {
                timestampMs: Date.now(),
                shotResult: result,
                courtX: tracking.getState().ballPosition?.x ?? 0,
                courtY: tracking.getState().ballPosition?.y ?? 0,
                distanceFromHoop: 0,
                releaseAngle: metrics.releaseAngle,
                detectionConfidence: tracking.getState().confidence,
                trackingData: JSON.stringify({
                    autoDetected: true,
                    arcHeight: metrics.arcHeight,
                    smoothness: metrics.smoothness,
                }),
            }
            const shot = await addShotEvent(sessionId, user.id, payload)
            if (metrics.releaseAngle > 0) {
                await savePoseAnalysis(sessionId, user.id, {
                    shotEventId: shot.id,
                    releaseAngle: metrics.releaseAngle,
                    shotSmoothness: metrics.smoothness,
                    releaseHeight: metrics.arcHeight,
                })
            }
            setLastShotResult(result)
            setShotCount(prev => ({
                total: prev.total + 1,
                made: result === 'MADE' ? prev.made + 1 : prev.made,
                missed: result === 'MISS' ? prev.missed + 1 : prev.missed,
            }))
            showShotFeedback()
            tracking.resetShot()
        } catch (e: any) {
            showError('Errore', e.message || 'Impossibile registrare il tiro')
        } finally {
            setIsRecording(false)
        }
    }, [user?.id, sessionId, tracking])

    const handleManualShot = async (result: ShotResult) => {
        if (!user?.id || !sessionId) return
        setIsRecording(true)
        try {
            const payload: AddShotEventPayload = {
                timestampMs: Date.now(),
                shotResult: result,
                courtX: 0, courtY: 0, distanceFromHoop: 0,
                detectionConfidence: 1.0,
                trackingData: JSON.stringify({ manualEntry: true }),
            }
            await addShotEvent(sessionId, user.id, payload)
            setLastShotResult(result)
            setShotCount(prev => ({
                total: prev.total + 1,
                made: result === 'MADE' ? prev.made + 1 : prev.made,
                missed: result === 'MISS' ? prev.missed + 1 : prev.missed,
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
            toValue: 0, duration: 1200,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
        }).start()
    }

    const handleEndSession = () => {
        showWarning('Termina Sessione', "Sei sicuro di voler terminare l'allenamento?", async () => {
            setIsEnding(true)
            try {
                await flushFrameBatch()
                await endWorkoutSession(sessionId, user!.id)
                navigation.replace('ShotChart', { sessionId })
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
        ? wsStats.releaseAngleAvg.toFixed(1)
        : '—'

    return (
        <View style={styles.container}>
            {/* ── Header HUD ──────────────────────────────────── */}
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
                </View>
            </View>

            {/* ── Camera + SVG Overlay ─────────────────────────── */}
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
                                ? `AI ${Math.round(trackingState.confidence * 100)}%`
                                : 'Tracking...'}
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

                {/* SVG overlay — nessuna dipendenza Skia */}
                <TrackingOverlay trackingState={trackingState} />
            </View>

            {/* ── Controlli ────────────────────────────────────── */}
            <View style={styles.controls}>
                <Text style={styles.controlsLabel}>
                    {isPaused ? '⏸ Sessione in pausa' : 'Registra tiro manuale'}
                </Text>

                <View style={styles.shotBtns}>
                    <TouchableOpacity
                        style={[styles.shotBtn, styles.missBtn]}
                        onPress={() => handleManualShot('MISS')}
                        disabled={isRecording || isPaused || isEnding}
                        activeOpacity={0.7}
                    >
                        <Text style={styles.shotBtnIcon}>❌</Text>
                        <Text style={styles.shotBtnText}>Mancato</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={[styles.shotBtn, styles.madeBtn]}
                        onPress={() => handleManualShot('MADE')}
                        disabled={isRecording || isPaused || isEnding}
                        activeOpacity={0.7}
                    >
                        <Text style={styles.shotBtnIcon}>🏀</Text>
                        <Text style={styles.shotBtnText}>Canestro</Text>
                    </TouchableOpacity>
                </View>

                <TouchableOpacity
                    style={[styles.endBtn, isEnding && styles.endBtnDisabled]}
                    onPress={handleEndSession}
                    disabled={isEnding}
                >
                    <Text style={styles.endBtnText}>
                        {isEnding ? 'Terminazione...' : 'Termina e Vedi Stats'}
                    </Text>
                </TouchableOpacity>
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
    controlsLabel: { fontSize: 12, color: '#555', textAlign: 'center', marginBottom: 10 },
    shotBtns: { flexDirection: 'row', gap: 10, marginBottom: 12 },
    shotBtn: { flex: 1, paddingVertical: 16, borderRadius: 14, alignItems: 'center' },
    missBtn: { backgroundColor: '#ef4444' },
    madeBtn: { backgroundColor: '#22c55e' },
    shotBtnIcon: { fontSize: 20, marginBottom: 2 },
    shotBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
    endBtn: {
        backgroundColor: '#1e2433', borderWidth: 1,
        borderColor: '#ff8c00', borderRadius: 12,
        paddingVertical: 12, alignItems: 'center',
    },
    endBtnDisabled: { opacity: 0.5 },
    endBtnText: { color: '#ff8c00', fontWeight: '700', fontSize: 14 },
    permissionTitle: { fontSize: 22, fontWeight: '800', color: '#fff', marginBottom: 12 },
    permissionDesc: { fontSize: 14, color: '#888', textAlign: 'center', marginBottom: 24, lineHeight: 20 },
    permissionBtn: { backgroundColor: '#ff8c00', paddingHorizontal: 28, paddingVertical: 14, borderRadius: 12 },
    permissionBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
})
