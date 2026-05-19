// src/features/workouts/screens/StatsScreen.tsx
//
// FIX #6 — Navigazione: se arriva da ShotChart (replace), goBack non esiste più come
//   percorso sensato → il pulsante ← naviga a WorkoutHome (navigate, non goBack).
//   Il pulsante 📊 ShotChart fa navigate normale così c'è lo stack di ritorno.

import React, { useState, useContext, useEffect } from 'react'
import {
    View, Text, StyleSheet, TouchableOpacity, ScrollView, Platform,
} from 'react-native'
import { AuthContext } from '@/features/auth/context/AuthContext'
import { ZoneStatistics, CareerStats } from '../types/workouts.types'
import {
    getSessionStatistics, getZoneStatistics,
    getHotZoneShots, getColdZoneShots, getCareerStatistics,
} from '../api/workouts.api'
import { useCustomAlert, CustomAlert } from '@/shared/components/CustomAlert'

export default function StatsScreen({ navigation, route }: any) {
    const { sessionId } = route.params || {}
    const auth = useContext(AuthContext)
    const { user } = auth || {}

    const [sessionStats, setSessionStats] = useState<any>(null)
    const [zoneStats, setZoneStats] = useState<ZoneStatistics[]>([])
    const [hotZoneShots, setHotZoneShots] = useState<any[]>([])
    const [coldZoneShots, setColdZoneShots] = useState<any[]>([])
    const [careerStats, setCareerStats] = useState<CareerStats | null>(null)
    const [isLoading, setIsLoading] = useState(true)
    const { alert, showError } = useCustomAlert()

    useEffect(() => { loadAllStats() }, [sessionId])

    const loadAllStats = async () => {
        if (!user?.id || !sessionId) return
        setIsLoading(true)
        try {
            const [session, zones, hot, cold, career] = await Promise.all([
                getSessionStatistics(sessionId, user.id),
                getZoneStatistics(sessionId, user.id),
                getHotZoneShots(sessionId, user.id, 5),
                getColdZoneShots(sessionId, user.id, 5),
                getCareerStatistics(user.id),
            ])
            setSessionStats(session)
            setZoneStats(zones)
            setHotZoneShots(hot)
            setColdZoneShots(cold)
            setCareerStats(career)
        } catch (e: any) {
            showError('Errore', e.message || 'Impossibile caricare le statistiche')
        } finally {
            setIsLoading(false)
        }
    }

    // FIX #6 — Torna alla home invece di goBack() per non finire su ShotChart
    const handleBack = () => {
        navigation.navigate('WorkoutHome')
    }

    // ── Render helpers ────────────────────────────────────────────────────────

    const renderSessionStats = () => {
        if (!sessionStats) return null
        const pct = sessionStats.shootingPercentage?.toFixed(0) ?? 0
        const pctColor = Number(pct) >= 50 ? '#22c55e' : '#ef4444'
        return (
            <View style={styles.card}>
                <Text style={styles.cardTitle}>📊 Riepilogo Sessione</Text>
                <View style={styles.statsGrid}>
                    <StatItem label="Tiri Totali" value={sessionStats.totalShots ?? 0} />
                    <StatItem label="Segnati" value={sessionStats.madeShots ?? 0} color="#22c55e" />
                    <StatItem label="Mancati" value={sessionStats.missedShots ?? 0} color="#ef4444" />
                    <StatItem label="FG%" value={`${pct}%`} color={pctColor} />
                </View>
                {sessionStats.averageDistance != null && (
                    <View style={styles.extraRow}>
                        <View style={styles.extraItem}>
                            <Text style={styles.extraLabel}>Distanza media</Text>
                            <Text style={styles.extraValue}>{sessionStats.averageDistance.toFixed(1)}m</Text>
                        </View>
                        {sessionStats.workoutScore != null && (
                            <View style={styles.extraItem}>
                                <Text style={styles.extraLabel}>Workout score</Text>
                                <Text style={[styles.extraValue, { color: '#ff8c00' }]}>
                                    {sessionStats.workoutScore.toFixed(0)}
                                </Text>
                            </View>
                        )}
                    </View>
                )}
            </View>
        )
    }

    const renderZoneStats = () => {
        if (!zoneStats.length) return null
        return (
            <View style={styles.card}>
                <Text style={styles.cardTitle}>🗺 Statistiche per Zona</Text>
                {zoneStats.map((zone, i) => (
                    <View key={i} style={[styles.zoneRow, i === zoneStats.length - 1 && styles.zoneRowLast]}>
                        <View style={styles.zoneLeft}>
                            <Text style={styles.zoneName}>{formatZoneName(zone.zone)}</Text>
                            <Text style={styles.zoneAttempts}>{zone.attempts} tiri · {zone.averageDistance?.toFixed(1)}m</Text>
                        </View>
                        <View style={styles.zoneRight}>
                            <Text style={[
                                styles.zonePct,
                                zone.percentage >= 50 ? styles.goodPct : styles.badPct,
                            ]}>
                                {zone.percentage?.toFixed(0) ?? 0}%
                            </Text>
                            <Text style={styles.zoneMade}>{zone.made}/{zone.attempts}</Text>
                        </View>
                    </View>
                ))}
            </View>
        )
    }

    const renderHotCold = () => {
        if (!hotZoneShots.length && !coldZoneShots.length) return null
        return (
            <View style={styles.card}>
                <Text style={styles.cardTitle}>🔥❄️ Hot & Cold Zones</Text>
                {hotZoneShots.length > 0 && (
                    <View style={styles.shotSection}>
                        <Text style={styles.shotSectionTitle}>🔥 Hot Zones</Text>
                        {hotZoneShots.map((shot, i) => (
                            <ShotRow key={i} shot={shot} />
                        ))}
                    </View>
                )}
                {coldZoneShots.length > 0 && (
                    <View style={[styles.shotSection, { marginBottom: 0 }]}>
                        <Text style={styles.shotSectionTitle}>❄️ Cold Zones</Text>
                        {coldZoneShots.map((shot, i) => (
                            <ShotRow key={i} shot={shot} />
                        ))}
                    </View>
                )}
            </View>
        )
    }

    const renderCareerStats = () => {
        if (!careerStats) return null
        return (
            <View style={styles.card}>
                <Text style={styles.cardTitle}>🏆 Statistiche Carriera</Text>
                <View style={styles.statsGrid}>
                    <StatItem label="Sessioni" value={careerStats.totalSessions} />
                    <StatItem label="Tiri" value={careerStats.totalShots} />
                    <StatItem label="FG%" value={`${careerStats.overallPercentage?.toFixed(0) ?? 0}%`} color="#ff8c00" />
                    <StatItem label="Miglior sess." value={`${careerStats.bestSessionPercentage?.toFixed(0) ?? 0}%`} color="#22c55e" />
                </View>
                {careerStats.favoriteZone && (
                    <View style={styles.highlightRow}>
                        <View style={styles.highlight}>
                            <Text style={styles.highlightLabel}>Zona preferita</Text>
                            <Text style={styles.highlightValue}>{formatZoneName(careerStats.favoriteZone)}</Text>
                        </View>
                        {'averageSessionDuration' in careerStats && (
                            <View style={styles.highlight}>
                                <Text style={styles.highlightLabel}>Durata media</Text>
                                <Text style={styles.highlightValue}>
                                    {Math.floor(((careerStats as any).averageSessionDuration ?? 0) / 60)}m{' '}
                                    {(((careerStats as any).averageSessionDuration ?? 0) % 60).toFixed(0)}s
                                </Text>
                            </View>
                        )}
                    </View>
                )}
            </View>
        )
    }

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                {/* FIX #6 — back porta a WorkoutHome */}
                <TouchableOpacity onPress={handleBack} style={styles.headerBtn}>
                    <Text style={styles.headerBtnText}>←</Text>
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Statistiche</Text>
                <TouchableOpacity
                    style={styles.chartBtn}
                    onPress={() => navigation.navigate('ShotChart', { sessionId })}
                >
                    <Text style={styles.chartBtnText}>📊</Text>
                </TouchableOpacity>
            </View>

            <ScrollView style={styles.scroll} contentContainerStyle={{ paddingBottom: 32 }}>
                {isLoading ? (
                    <View style={styles.loading}>
                        <Text style={styles.loadingText}>Caricamento statistiche...</Text>
                    </View>
                ) : (
                    <>
                        {renderSessionStats()}
                        {renderZoneStats()}
                        {renderHotCold()}
                        {renderCareerStats()}

                        {/* Torna alla home */}
                        <TouchableOpacity style={styles.homeBtn} onPress={handleBack}>
                            <Text style={styles.homeBtnText}>🏠 Torna agli Allenamenti</Text>
                        </TouchableOpacity>
                    </>
                )}
            </ScrollView>

            <CustomAlert {...alert} />
        </View>
    )
}

// ─── Micro-componenti ─────────────────────────────────────────────────────────
const StatItem = ({ label, value, color }: { label: string; value: any; color?: string }) => (
    <View style={styles.statItem}>
        <Text style={[styles.statValue, color ? { color } : {}]}>{value}</Text>
        <Text style={styles.statLabel}>{label}</Text>
    </View>
)

const ShotRow = ({ shot }: { shot: any }) => (
    <View style={styles.shotRow}>
        <Text style={styles.shotZone}>{formatZoneName(shot.zone ?? 'N/A')}</Text>
        <Text style={shot.shotResult === 'MADE' ? styles.shotMade : styles.shotMiss}>
            {shot.shotResult === 'MADE' ? '✅' : '❌'}
        </Text>
        <Text style={styles.shotDist}>{shot.distanceFromHoop?.toFixed(1) ?? '—'}m</Text>
    </View>
)

function formatZoneName(zone: string): string {
    return zone
        .replace(/_/g, ' ')
        .toLowerCase()
        .replace(/\b\w/g, c => c.toUpperCase())
}

// ─── Stili ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#0b0f1a' },
    header: {
        flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
        paddingHorizontal: 14, paddingBottom: 12,
        paddingTop: Platform.OS === 'ios' ? 52 : 14,
        backgroundColor: '#121826',
        borderBottomWidth: 1, borderBottomColor: '#2a2a2a',
    },
    headerBtn: { width: 36, height: 36, justifyContent: 'center' },
    headerBtnText: { fontSize: 22, color: '#fff', fontWeight: 'bold' },
    headerTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },
    chartBtn: { width: 36, height: 36, justifyContent: 'center', alignItems: 'center' },
    chartBtnText: { fontSize: 22 },
    scroll: { flex: 1, paddingHorizontal: 16, paddingTop: 16 },
    loading: { alignItems: 'center', paddingTop: 60 },
    loadingText: { color: '#888', fontSize: 14 },
    card: {
        backgroundColor: '#121826', borderRadius: 14,
        padding: 16, marginBottom: 16,
    },
    cardTitle: { fontSize: 15, fontWeight: '700', color: '#fff', marginBottom: 14 },
    statsGrid: { flexDirection: 'row', flexWrap: 'wrap' },
    statItem: { width: '50%', alignItems: 'center', paddingVertical: 10 },
    statValue: { fontSize: 26, fontWeight: '800', color: '#fff' },
    statLabel: { fontSize: 11, color: '#888', marginTop: 3 },
    extraRow: { flexDirection: 'row', gap: 10, marginTop: 10 },
    extraItem: {
        flex: 1, backgroundColor: '#1e2433', borderRadius: 10,
        padding: 12, alignItems: 'center',
    },
    extraLabel: { fontSize: 11, color: '#888', marginBottom: 3 },
    extraValue: { fontSize: 16, fontWeight: '700', color: '#fff' },
    zoneRow: {
        flexDirection: 'row', justifyContent: 'space-between',
        alignItems: 'center', paddingVertical: 12,
        borderBottomWidth: 1, borderBottomColor: '#2a2a2a',
    },
    zoneRowLast: { borderBottomWidth: 0 },
    zoneLeft: { flex: 1 },
    zoneName: { fontSize: 14, fontWeight: '600', color: '#fff', marginBottom: 2 },
    zoneAttempts: { fontSize: 11, color: '#888' },
    zoneRight: { alignItems: 'flex-end' },
    zonePct: { fontSize: 20, fontWeight: '800' },
    goodPct: { color: '#22c55e' },
    badPct: { color: '#ef4444' },
    zoneMade: { fontSize: 11, color: '#888', marginTop: 1 },
    shotSection: { marginBottom: 14 },
    shotSectionTitle: { fontSize: 13, fontWeight: '700', color: '#fff', marginBottom: 8 },
    shotRow: {
        flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
        paddingVertical: 8, paddingHorizontal: 12,
        backgroundColor: '#1a2235', borderRadius: 8, marginBottom: 6,
    },
    shotZone: { flex: 1, fontSize: 13, color: '#ccc' },
    shotMade: { fontSize: 16, color: '#22c55e' },
    shotMiss: { fontSize: 16, color: '#ef4444' },
    shotDist: { fontSize: 12, color: '#888', minWidth: 36, textAlign: 'right' },
    highlightRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
    highlight: {
        flex: 1, backgroundColor: '#1e2433',
        borderRadius: 10, padding: 12, alignItems: 'center',
    },
    highlightLabel: { fontSize: 11, color: '#888', marginBottom: 3 },
    highlightValue: { fontSize: 14, fontWeight: '700', color: '#fff' },
    homeBtn: {
        backgroundColor: '#1e2433', borderWidth: 1, borderColor: '#2a2a2a',
        borderRadius: 14, paddingVertical: 14, alignItems: 'center',
        marginBottom: 8,
    },
    homeBtnText: { color: '#888', fontWeight: '600', fontSize: 14 },
})
