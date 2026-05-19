// src/features/workouts/screens/ShotChartScreen.tsx
//
// FIX #6 — Navigazione coerente:
//   - Se arriva da WorkoutSession (fromSession=true) mostra il pulsante "Vedi Statistiche →"
//   - Navigation.replace verso Stats così non rimane nello stack intermedio
//   - goBack() da Stats torna alla Home, non a ShotChart (che sarebbe già rimossa dallo stack)

import React, { useState, useContext, useEffect } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Dimensions, Platform } from 'react-native'
import Svg, { Circle, Line, Rect, Path } from 'react-native-svg'
import { AuthContext } from '@/features/auth/context/AuthContext'
import { ShotChartResponse, CourtZone } from '../types/workouts.types'
import { getShotChart } from '../api/workouts.api'
import { useCustomAlert, CustomAlert } from '@/shared/components/CustomAlert'

const { width: SW } = Dimensions.get('window')

// ─── Campo da basket SVG (half-court) ────────────────────────────────────────
// Coordinate normalizzate: x ∈ [0,15.24], y ∈ [0,14] (metà campo NBA)
// Il rendering SVG mappa questi valori su courtW × courtH pixel
const COURT_W_M  = 15.24
const COURT_H_M  = 14.0
const HOOP_X_M   = COURT_W_M / 2
const HOOP_Y_M   = 1.575

const CourtSVG = ({
    shots,
    selectedZone,
    courtW,
    courtH,
}: {
    shots: ShotChartResponse['shots']
    selectedZone: CourtZone | 'ALL'
    courtW: number
    courtH: number
}) => {
    const mx = (v: number) => (v / COURT_W_M) * courtW
    const my = (v: number) => courtH - (v / COURT_H_M) * courtH  // y=0 = baseline (basso)

    const hoopPx = mx(HOOP_X_M)
    const hoopPy = my(HOOP_Y_M)

    const filtered = shots.filter(s => selectedZone === 'ALL' || s.zone === selectedZone)

    return (
        <Svg width={courtW} height={courtH} style={{ alignSelf: 'center' }}>
            {/* Sfondo campo */}
            <Rect x={0} y={0} width={courtW} height={courtH}
                fill="#1a2235" rx={8} />

            {/* Linea di fondo */}
            <Line x1={0} y1={courtH} x2={courtW} y2={courtH}
                stroke="#ff8c00" strokeWidth={2} />

            {/* Area pitturata (paint) ~5.8×5.8m */}
            <Rect
                x={mx((COURT_W_M - 4.9) / 2)} y={my(5.8)}
                width={mx(4.9)} height={my(0) - my(5.8)}
                fill="rgba(255,140,0,0.06)" stroke="rgba(255,140,0,0.35)" strokeWidth={1.5}
            />

            {/* Linea tiro libero ~5.8m */}
            <Line
                x1={mx((COURT_W_M - 4.9) / 2)} y1={my(5.8)}
                x2={mx((COURT_W_M + 4.9) / 2)} y2={my(5.8)}
                stroke="rgba(255,255,255,0.35)" strokeWidth={1.5}
            />

            {/* Arco 3 punti: raggio ~7.24m da canestro */}
            {/* Approssimato con un arco SVG */}
            <Path
                d={`M ${mx(0.9)} ${my(0)} Q ${mx(HOOP_X_M)} ${my(-4)} ${mx(COURT_W_M - 0.9)} ${my(0)}`}
                fill="none"
                stroke="rgba(255,140,0,0.4)"
                strokeWidth={1.5}
            />
            {/* Linee laterali arco 3 */}
            <Line x1={mx(0.9)} y1={my(0)} x2={mx(0.9)} y2={my(2.97)}
                stroke="rgba(255,140,0,0.4)" strokeWidth={1.5} />
            <Line x1={mx(COURT_W_M - 0.9)} y1={my(0)} x2={mx(COURT_W_M - 0.9)} y2={my(2.97)}
                stroke="rgba(255,140,0,0.4)" strokeWidth={1.5} />

            {/* Tabellone */}
            <Rect
                x={hoopPx - mx(0.92)} y={my(1.2)}
                width={mx(1.83)} height={my(0) - my(0.15)}
                fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth={1.5}
            />

            {/* Canestro */}
            <Circle cx={hoopPx} cy={hoopPy} r={8}
                fill="none" stroke="#ff8c00" strokeWidth={2.5} />
            <Circle cx={hoopPx} cy={hoopPy} r={2.5} fill="#ff8c00" />

            {/* Punti tiri */}
            {filtered.map((shot, i) => {
                // I punti nel BE sono in coordinate campo (m) con y dal canestro
                // courtX ∈ [0, 15.24], courtY ∈ distanza baseline
                const dotX = mx(shot.x)
                const dotY = my(shot.y)
                return (
                    <Circle
                        key={i}
                        cx={dotX} cy={dotY}
                        r={6}
                        fill={shot.made ? 'rgba(34,197,94,0.85)' : 'rgba(239,68,68,0.85)'}
                        stroke={shot.made ? '#22c55e' : '#ef4444'}
                        strokeWidth={1.5}
                    />
                )
            })}
        </Svg>
    )
}

// ─── Schermata ────────────────────────────────────────────────────────────────
export default function ShotChartScreen({ navigation, route }: any) {
    const { sessionId, fromSession } = route.params || {}
    const auth = useContext(AuthContext)
    const { user } = auth || {}

    const [shotChart, setShotChart] = useState<ShotChartResponse | null>(null)
    const [isLoading, setIsLoading] = useState(true)
    const [selectedZone, setSelectedZone] = useState<CourtZone | 'ALL'>('ALL')
    const { alert, showError } = useCustomAlert()

    const courtW = SW - 40
    const courtH = courtW * (COURT_H_M / COURT_W_M)

    useEffect(() => { loadShotChart() }, [sessionId])

    const loadShotChart = async () => {
        if (!user?.id || !sessionId) return
        setIsLoading(true)
        try {
            const data = await getShotChart(sessionId, user.id)
            setShotChart(data)
        } catch (e: any) {
            showError('Errore', e.message || 'Impossibile caricare lo shot chart')
        } finally {
            setIsLoading(false)
        }
    }

    const zones: Array<{ key: CourtZone | 'ALL'; label: string }> = [
        { key: 'ALL', label: 'Tutte' },
        { key: 'PAINT', label: 'Paint' },
        { key: 'MID_RANGE', label: 'Mid-R' },
        { key: 'THREE_POINT', label: '3 Punti' },
        { key: 'CORNER', label: 'Angoli' },
    ]

    return (
        <View style={styles.container}>
            {/* Header */}
            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerBtn}>
                    <Text style={styles.headerBtnText}>←</Text>
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Shot Chart</Text>
                {/* FIX #6 — Pulsante "Statistiche" visibile solo se arriva dalla sessione */}
                {fromSession ? (
                    <TouchableOpacity
                        style={styles.statsBtn}
                        onPress={() => navigation.replace('Stats', { sessionId })}
                    >
                        <Text style={styles.statsBtnText}>Statistiche →</Text>
                    </TouchableOpacity>
                ) : (
                    <View style={{ width: 90 }} />
                )}
            </View>

            <ScrollView style={styles.scroll} contentContainerStyle={{ paddingBottom: 32 }}>
                {/* Riepilogo rapido */}
                {shotChart && (
                    <View style={styles.summaryRow}>
                        <View style={styles.summaryItem}>
                            <Text style={styles.summaryValue}>{shotChart.sessionStats.totalShots}</Text>
                            <Text style={styles.summaryLabel}>Tiri</Text>
                        </View>
                        <View style={styles.summaryItem}>
                            <Text style={[styles.summaryValue, { color: '#22c55e' }]}>{shotChart.sessionStats.madeShots}</Text>
                            <Text style={styles.summaryLabel}>Segnati</Text>
                        </View>
                        <View style={styles.summaryItem}>
                            <Text style={[styles.summaryValue, { color: '#ff8c00' }]}>
                                {shotChart.sessionStats.shootingPercentage?.toFixed(0) ?? 0}%
                            </Text>
                            <Text style={styles.summaryLabel}>FG%</Text>
                        </View>
                        <View style={styles.summaryItem}>
                            <Text style={styles.summaryValue}>
                                {shotChart.sessionStats.averageDistance?.toFixed(1) ?? '—'}m
                            </Text>
                            <Text style={styles.summaryLabel}>Dist. media</Text>
                        </View>
                    </View>
                )}

                {/* Filtri zona */}
                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.filtersRow}
                >
                    {zones.map(z => (
                        <TouchableOpacity
                            key={z.key}
                            style={[styles.zoneChip, selectedZone === z.key && styles.zoneChipActive]}
                            onPress={() => setSelectedZone(z.key)}
                        >
                            <Text style={[styles.zoneChipText, selectedZone === z.key && styles.zoneChipTextActive]}>
                                {z.label}
                            </Text>
                        </TouchableOpacity>
                    ))}
                </ScrollView>

                {/* Campo SVG */}
                <View style={[styles.courtWrap, { width: courtW, height: courtH }]}>
                    {isLoading ? (
                        <View style={styles.loadingBox}>
                            <Text style={styles.loadingText}>Caricamento...</Text>
                        </View>
                    ) : shotChart ? (
                        <CourtSVG
                            shots={shotChart.shots}
                            selectedZone={selectedZone}
                            courtW={courtW}
                            courtH={courtH}
                        />
                    ) : (
                        <View style={styles.loadingBox}>
                            <Text style={styles.loadingText}>Nessun dato</Text>
                        </View>
                    )}
                </View>

                {/* Legenda */}
                <View style={styles.legendRow}>
                    <View style={styles.legendItem}>
                        <View style={[styles.legendDot, { backgroundColor: '#22c55e' }]} />
                        <Text style={styles.legendText}>Segnato</Text>
                    </View>
                    <View style={styles.legendItem}>
                        <View style={[styles.legendDot, { backgroundColor: '#ef4444' }]} />
                        <Text style={styles.legendText}>Mancato</Text>
                    </View>
                </View>

                {/* Statistiche per zona */}
                {shotChart && (
                    <View style={styles.card}>
                        <Text style={styles.cardTitle}>Statistiche per Zona</Text>
                        {[
                            { label: 'Paint',     data: shotChart.zoneStats.paint },
                            { label: 'Mid-Range', data: shotChart.zoneStats.midRange },
                            { label: '3 Punti',   data: shotChart.zoneStats.threePoint },
                            { label: 'Angoli',    data: shotChart.zoneStats.corner },
                        ].map(({ label, data }) => (
                            <View key={label} style={styles.zoneRow}>
                                <View style={styles.zoneBarBg}>
                                    <View style={[
                                        styles.zoneBarFill,
                                        { width: `${Math.min(100, data.percentage ?? 0)}%` },
                                        data.percentage >= 50
                                            ? styles.zoneBarGood
                                            : styles.zoneBarBad,
                                    ]} />
                                </View>
                                <View style={styles.zoneRowLabels}>
                                    <Text style={styles.zoneLabel}>{label}</Text>
                                    <Text style={styles.zoneStat}>
                                        {data.made}/{data.attempts} · {(data.percentage ?? 0).toFixed(0)}%
                                    </Text>
                                </View>
                            </View>
                        ))}
                    </View>
                )}

                {/* FIX #6 — CTA finale verso Stats */}
                {fromSession && (
                    <TouchableOpacity
                        style={styles.goStatsBtn}
                        onPress={() => navigation.replace('Stats', { sessionId })}
                    >
                        <Text style={styles.goStatsBtnText}>📊 Vedi Statistiche Complete</Text>
                    </TouchableOpacity>
                )}
            </ScrollView>

            <CustomAlert {...alert} />
        </View>
    )
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#0b0f1a' },
    header: {
        flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
        padding: 14, backgroundColor: '#121826',
        borderBottomWidth: 1, borderBottomColor: '#2a2a2a',
        paddingTop: Platform.OS === 'ios' ? 52 : 14,
    },
    headerBtn: { width: 36, height: 36, justifyContent: 'center' },
    headerBtnText: { fontSize: 22, color: '#fff', fontWeight: 'bold' },
    headerTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },
    statsBtn: {
        backgroundColor: '#ff8c00', paddingHorizontal: 12,
        paddingVertical: 6, borderRadius: 20,
    },
    statsBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },
    scroll: { flex: 1, paddingHorizontal: 20, paddingTop: 16 },
    summaryRow: {
        flexDirection: 'row', justifyContent: 'space-around',
        backgroundColor: '#121826', borderRadius: 12,
        paddingVertical: 14, marginBottom: 16,
    },
    summaryItem: { alignItems: 'center' },
    summaryValue: { fontSize: 22, fontWeight: '800', color: '#fff' },
    summaryLabel: { fontSize: 11, color: '#888', marginTop: 2 },
    filtersRow: { paddingBottom: 14, gap: 8, paddingRight: 8 },
    zoneChip: {
        paddingHorizontal: 14, paddingVertical: 7,
        borderRadius: 20, backgroundColor: '#1e2433',
        borderWidth: 1, borderColor: '#2a2a2a',
    },
    zoneChipActive: { backgroundColor: '#ff8c00', borderColor: '#ff8c00' },
    zoneChipText: { fontSize: 12, fontWeight: '600', color: '#888' },
    zoneChipTextActive: { color: '#fff' },
    courtWrap: {
        alignSelf: 'center', borderRadius: 12,
        overflow: 'hidden', marginBottom: 12,
        borderWidth: 1, borderColor: '#2a2a2a',
    },
    loadingBox: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    loadingText: { color: '#888', fontSize: 14 },
    legendRow: { flexDirection: 'row', justifyContent: 'center', gap: 24, marginBottom: 20 },
    legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    legendDot: { width: 10, height: 10, borderRadius: 5 },
    legendText: { fontSize: 12, color: '#aaa' },
    card: {
        backgroundColor: '#121826', borderRadius: 12,
        padding: 16, marginBottom: 20,
    },
    cardTitle: { fontSize: 15, fontWeight: '700', color: '#fff', marginBottom: 14 },
    zoneRow: { marginBottom: 14 },
    zoneRowLabels: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 },
    zoneLabel: { fontSize: 13, color: '#ccc', fontWeight: '600' },
    zoneStat: { fontSize: 12, color: '#888' },
    zoneBarBg: {
        height: 6, backgroundColor: '#2a2a2a',
        borderRadius: 3, overflow: 'hidden',
    },
    zoneBarFill: { height: '100%', borderRadius: 3 },
    zoneBarGood: { backgroundColor: '#22c55e' },
    zoneBarBad: { backgroundColor: '#ef4444' },
    goStatsBtn: {
        backgroundColor: '#ff8c00', borderRadius: 14,
        paddingVertical: 15, alignItems: 'center',
        marginBottom: 8,
    },
    goStatsBtnText: { color: '#fff', fontWeight: '800', fontSize: 15 },
})
