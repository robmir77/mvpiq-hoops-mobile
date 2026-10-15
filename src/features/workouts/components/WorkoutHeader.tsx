// src/features/workouts/components/WorkoutHeader.tsx
//
// Header component for workout session
// Displays session stats, status, and controls

import React from 'react'
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native'
import type { WorkoutSession } from '../types/workouts.types'
import type { JointAngles } from '@/vision'

interface WorkoutHeaderProps {
    session: WorkoutSession | null
    shotCount: { total: number; made: number }
    wsStatus: string
    wsStats?: { shotStreak?: number } | null
    jointAngles?: Partial<JointAngles>
    modelsReady: boolean
    showTelemetry: boolean
    isVideoRecording: boolean
    videoDuration: number
    isPaused: boolean
    isEnding: boolean
    onGoBack: () => void
    onPauseResume: () => void
    onToggleVideoRecording: () => void
    onToggleTelemetry: () => void
}

const StatBox = ({ label, value, highlight }: { label: string; value: any; highlight?: boolean }) => (
    <View style={styles.statBox}>
        <Text style={[styles.statValue, highlight && styles.statValueHL]}>{value}</Text>
        <Text style={styles.statLabel}>{label}</Text>
    </View>
)

const formatVideoDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
}

export const WorkoutHeader: React.FC<WorkoutHeaderProps> = ({
    session,
    shotCount,
    wsStatus,
    wsStats,
    jointAngles,
    modelsReady,
    showTelemetry,
    isVideoRecording,
    videoDuration,
    isPaused,
    isEnding,
    onGoBack,
    onPauseResume,
    onToggleVideoRecording,
    onToggleTelemetry,
}) => {
    const fgPct = shotCount.total > 0 ? ((shotCount.made / shotCount.total) * 100).toFixed(0) : '0'
    const streak = wsStats?.shotStreak ?? 0
    const elbowAngle = jointAngles?.elbowAngle != null ? `${jointAngles.elbowAngle.toFixed(0)}°` : '—'

    return (
        <View style={styles.header}>
            <View style={styles.headerTop}>
                <TouchableOpacity onPress={onGoBack} style={styles.headerBtn}>
                    <Text style={styles.headerBtnText}>←</Text>
                </TouchableOpacity>
                <View style={styles.headerCenter}>
                    <View style={[styles.statusDot, isPaused && styles.statusDotPaused]} />
                    <Text style={styles.headerTitle}>{isPaused ? 'In Pausa' : 'Sessione Attiva'}</Text>
                    {!modelsReady && <Text style={styles.loadingBadge}>⏳ AI...</Text>}
                </View>
                <View style={styles.headerRightGroup}>
                    <TouchableOpacity
                        onPress={onToggleVideoRecording}
                        style={[
                            styles.recordHeaderBtn,
                            isVideoRecording && styles.recordHeaderBtnActive,
                            (isPaused || isEnding) && styles.btnDisabled,
                        ]}
                        disabled={isPaused || isEnding}
                    >
                        <View style={[styles.recHeaderDot, isVideoRecording && styles.recHeaderDotActive]} />
                        <Text style={[styles.recordHeaderBtnText, isVideoRecording && styles.recordHeaderBtnTextActive]}>
                            {isVideoRecording ? formatVideoDuration(videoDuration) : 'REC'}
                        </Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={onPauseResume} style={styles.headerBtn}>
                        <Text style={styles.headerBtnText}>{isPaused ? '▶' : '⏸'}</Text>
                    </TouchableOpacity>
                </View>
            </View>
            <View style={styles.statsRow}>
                <StatBox label="Tiri" value={shotCount.total} />
                <StatBox label="Segnati" value={shotCount.made} highlight />
                <StatBox label="FG%" value={`${fgPct}%`} highlight />
                <StatBox label="Streak" value={streak > 0 ? `${streak}🔥` : streak} />
                <StatBox label="Gomito" value={elbowAngle} />
            </View>
            <View style={styles.wsRow}>
                <View style={[styles.wsDot, wsStatus === 'connected' ? styles.wsDotOn : styles.wsDotOff]} />
                <Text style={styles.wsText}>{wsStatus === 'connected' ? 'Live' : 'Offline'}</Text>
                <TouchableOpacity
                    onPress={onToggleTelemetry}
                    style={[styles.calDebugBtn, showTelemetry && styles.calDebugBtnOn]}
                >
                    <Text style={[styles.calBadge, showTelemetry && { color: '#fff' }]}>
                        📊 Tel {showTelemetry ? 'ON' : 'OFF'}
                    </Text>
                </TouchableOpacity>
                <View style={[styles.wsDot, modelsReady ? styles.wsDotOn : styles.wsDotOff, { marginLeft: 8 }]} />
                <Text style={styles.wsText}>{modelsReady ? 'AI On' : 'AI Off'}</Text>
            </View>
        </View>
    )
}

const styles = StyleSheet.create({
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
    headerBtn: {
        width: 36,
        height: 36,
        justifyContent: 'center',
    },
    headerBtnText: {
        fontSize: 20,
        color: '#fff',
        fontWeight: 'bold',
    },
    headerCenter: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    headerTitle: {
        fontSize: 14,
        fontWeight: '700',
        color: '#fff',
    },
    headerRightGroup: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    recordHeaderBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        backgroundColor: 'rgba(239,68,68,0.15)',
        borderWidth: 1,
        borderColor: '#ef4444',
        borderRadius: 8,
        paddingHorizontal: 7,
        paddingVertical: 4,
    },
    recordHeaderBtnActive: {
        backgroundColor: '#ef4444',
    },
    recHeaderDot: {
        width: 6,
        height: 6,
        borderRadius: 3,
        backgroundColor: '#ef4444',
    },
    recHeaderDotActive: {
        backgroundColor: '#fff',
    },
    recordHeaderBtnText: {
        color: '#ef4444',
        fontSize: 11,
        fontWeight: '800',
    },
    recordHeaderBtnTextActive: {
        color: '#fff',
    },
    loadingBadge: {
        fontSize: 10,
        color: '#fbbf24',
        marginLeft: 6,
    },
    statusDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: '#ef4444',
    },
    statusDotPaused: {
        backgroundColor: '#fbbf24',
    },
    statsRow: {
        flexDirection: 'row',
        justifyContent: 'space-around',
        marginBottom: 6,
    },
    statBox: {
        alignItems: 'center',
    },
    statValue: {
        fontSize: 20,
        fontWeight: '800',
        color: '#fff',
    },
    statValueHL: {
        color: '#ff8c00',
    },
    statLabel: {
        fontSize: 10,
        color: '#888',
        marginTop: 1,
    },
    wsRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        alignSelf: 'flex-end',
    },
    wsDot: {
        width: 6,
        height: 6,
        borderRadius: 3,
    },
    wsDotOn: {
        backgroundColor: '#4ade80',
    },
    wsDotOff: {
        backgroundColor: '#555',
    },
    wsText: {
        fontSize: 10,
        color: '#555',
    },
    calBadge: {
        fontSize: 10,
        color: '#ff8c00',
        fontWeight: '700',
    },
    calDebugBtn: {
        marginLeft: 6,
        borderWidth: 1,
        borderColor: 'rgba(255,140,0,0.4)',
        borderRadius: 6,
        paddingHorizontal: 6,
        paddingVertical: 2,
        backgroundColor: 'transparent',
    },
    calDebugBtnOn: {
        backgroundColor: '#ff8c00',
    },
    btnDisabled: {
        opacity: 0.4,
    },
})
