import React, { useState, useContext, useEffect } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Dimensions } from 'react-native'
import { globalStyles } from '@/shared/theme/globalStyles'
import { AuthContext } from '@/features/auth/context/AuthContext'
import { ShotChartResponse, CourtZone } from '../types/workouts.types'
import { getShotChart } from '../api/workouts.api'
import { useCustomAlert, CustomAlert } from '@/shared/components/CustomAlert'

const { width, height } = Dimensions.get('window')

export default function ShotChartScreen({ navigation, route }: any) {
    const { sessionId } = route.params || {}
    const auth = useContext(AuthContext)
    const { user } = auth || {}

    const [shotChart, setShotChart] = useState<ShotChartResponse | null>(null)
    const [isLoading, setIsLoading] = useState(true)
    const [selectedZone, setSelectedZone] = useState<CourtZone | 'ALL'>('ALL')
    const { alert, showError } = useCustomAlert()

    useEffect(() => {
        loadShotChart()
    }, [sessionId])

    const loadShotChart = async () => {
        if (!user?.id || !sessionId) return

        setIsLoading(true)
        try {
            const data = await getShotChart(sessionId, user.id)
            setShotChart(data)
        } catch (error: any) {
            console.error('Errore caricamento shot chart:', error)
            showError('Errore', error.message || 'Impossibile caricare lo shot chart')
        } finally {
            setIsLoading(false)
        }
    }

    const renderCourt = () => {
        const courtWidth = width - 40
        const courtHeight = courtWidth * 1.5

        return (
            <View style={[styles.courtContainer, { width: courtWidth, height: courtHeight }]}>
                {/* Campo da basket */}
                <View style={styles.court}>
                    {/* Linea 3 punti */}
                    <View style={styles.threePointLine} />
                    
                    {/* Area paint */}
                    <View style={styles.paintArea}>
                        {/* Ferro */}
                        <View style={styles.hoop} />
                        {/* Tabellone */}
                        <View style={styles.backboard} />
                    </View>

                    {/* Linea tiro libero */}
                    <View style={styles.freeThrowLine} />

                    {/* Punti tiri */}
                    {shotChart?.shots
                        .filter(shot => selectedZone === 'ALL' || shot.zone === selectedZone)
                        .map((shot, index) => (
                            <View
                                key={index}
                                style={[
                                    styles.shotPoint,
                                    {
                                        left: `${(shot.x / 15) * 100}%`,
                                        top: `${(shot.y / 20) * 100}%`,
                                    },
                                    shot.made ? styles.shotMade : styles.shotMiss
                                ]}
                            >
                                <View style={[
                                    styles.shotDot,
                                    shot.made ? styles.shotDotMade : styles.shotDotMiss
                                ]} />
                            </View>
                        ))}
                </View>
            </View>
        )
    }

    const renderZoneFilter = (zone: CourtZone | 'ALL', label: string) => (
        <TouchableOpacity
            style={[
                styles.zoneFilter,
                selectedZone === zone && styles.zoneFilterActive
            ]}
            onPress={() => setSelectedZone(zone)}
        >
            <Text style={[
                styles.zoneFilterText,
                selectedZone === zone && styles.zoneFilterTextActive
            ]}>
                {label}
            </Text>
        </TouchableOpacity>
    )

    const renderZoneStats = () => {
        if (!shotChart) return null

        const zones = [
            { key: 'paint', label: 'Paint', data: shotChart.zoneStats.paint },
            { key: 'midRange', label: 'Mid-Range', data: shotChart.zoneStats.midRange },
            { key: 'threePoint', label: '3 Punti', data: shotChart.zoneStats.threePoint },
            { key: 'corner', label: 'Angoli', data: shotChart.zoneStats.corner },
        ]

        return (
            <View style={styles.zoneStatsContainer}>
                <Text style={styles.sectionTitle}>Statistiche per Zona</Text>
                {zones.map(zone => (
                    <View key={zone.key} style={styles.zoneStatRow}>
                        <Text style={styles.zoneStatLabel}>{zone.label}</Text>
                        <View style={styles.zoneStatValues}>
                            <Text style={styles.zoneStatValue}>{zone.data.attempts} tiri</Text>
                            <Text style={[
                                styles.zoneStatPercentage,
                                zone.data.percentage >= 50 ? styles.goodPercentage : styles.badPercentage
                            ]}>
                                {zone.data.percentage.toFixed(0)}%
                            </Text>
                        </View>
                    </View>
                ))}
            </View>
        )
    }

    const renderSessionStats = () => {
        if (!shotChart) return null

        return (
            <View style={styles.sessionStatsContainer}>
                <Text style={styles.sectionTitle}>Statistiche Sessione</Text>
                
                <View style={styles.statsGrid}>
                    <View style={styles.statItem}>
                        <Text style={styles.statValue}>{shotChart.sessionStats.totalShots}</Text>
                        <Text style={styles.statLabel}>Tiri Totali</Text>
                    </View>
                    <View style={styles.statItem}>
                        <Text style={styles.statValue}>{shotChart.sessionStats.madeShots}</Text>
                        <Text style={styles.statLabel}>Segnati</Text>
                    </View>
                    <View style={styles.statItem}>
                        <Text style={styles.statValue}>{shotChart.sessionStats.shootingPercentage.toFixed(0)}%</Text>
                        <Text style={styles.statLabel}>Percentuale</Text>
                    </View>
                    <View style={styles.statItem}>
                        <Text style={styles.statValue}>{shotChart.sessionStats.averageDistance.toFixed(1)}m</Text>
                        <Text style={styles.statLabel}>Distanza Media</Text>
                    </View>
                </View>

                <View style={styles.bestWorstContainer}>
                    <View style={styles.bestWorstItem}>
                        <Text style={styles.bestWorstLabel}>Miglior Zona</Text>
                        <Text style={styles.bestWorstValue}>{shotChart.sessionStats.bestZone}</Text>
                    </View>
                    <View style={styles.bestWorstItem}>
                        <Text style={styles.bestWorstLabel}>Zona Critica</Text>
                        <Text style={styles.bestWorstValue}>{shotChart.sessionStats.worstZone}</Text>
                    </View>
                </View>
            </View>
        )
    }

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation.goBack()}>
                    <Text style={styles.backButton}>←</Text>
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Shot Chart</Text>
                <View style={{ width: 20 }} />
            </View>

            <ScrollView style={styles.scrollContainer} showsVerticalScrollIndicator={false}>
                {/* Filtri zona */}
                <View style={styles.filtersContainer}>
                    {renderZoneFilter('ALL', 'Tutte')}
                    {renderZoneFilter('PAINT', 'Paint')}
                    {renderZoneFilter('MID_RANGE', 'Mid-Range')}
                    {renderZoneFilter('THREE_POINT', '3 Punti')}
                    {renderZoneFilter('CORNER', 'Angoli')}
                </View>

                {/* Shot Chart */}
                <View style={styles.chartContainer}>
                    <Text style={styles.sectionTitle}>Shot Chart</Text>
                    {isLoading ? (
                        <View style={styles.loadingContainer}>
                            <Text style={styles.loadingText}>Caricamento...</Text>
                        </View>
                    ) : shotChart ? (
                        <>
                            {renderCourt()}
                            <View style={styles.legendContainer}>
                                <View style={styles.legendItem}>
                                    <View style={[styles.legendDot, styles.legendDotMade]} />
                                    <Text style={styles.legendText}>Segnato</Text>
                                </View>
                                <View style={styles.legendItem}>
                                    <View style={[styles.legendDot, styles.legendDotMiss]} />
                                    <Text style={styles.legendText}>Mancato</Text>
                                </View>
                            </View>
                        </>
                    ) : (
                        <View style={styles.emptyContainer}>
                            <Text style={styles.emptyText}>Nessun dato disponibile</Text>
                        </View>
                    )}
                </View>

                {/* Statistiche sessione */}
                {renderSessionStats()}

                {/* Statistiche zona */}
                {renderZoneStats()}
            </ScrollView>

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
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 15,
        backgroundColor: '#121826',
        borderBottomWidth: 1,
        borderBottomColor: '#2a2a2a',
    },
    backButton: {
        fontSize: 24,
        color: '#fff',
        fontWeight: 'bold',
    },
    headerTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#fff',
    },
    scrollContainer: {
        flex: 1,
        padding: 15,
    },
    filtersContainer: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        marginBottom: 20,
    },
    zoneFilter: {
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 20,
        backgroundColor: '#1a1a1a',
        borderWidth: 1,
        borderColor: '#2a2a2a',
    },
    zoneFilterActive: {
        backgroundColor: '#ff8c00',
        borderColor: '#ff8c00',
    },
    zoneFilterText: {
        fontSize: 12,
        fontWeight: '600',
        color: '#888',
    },
    zoneFilterTextActive: {
        color: '#fff',
    },
    chartContainer: {
        marginBottom: 20,
    },
    sectionTitle: {
        fontSize: 16,
        fontWeight: 'bold',
        color: '#fff',
        marginBottom: 12,
    },
    courtContainer: {
        alignSelf: 'center',
        backgroundColor: '#1a1a1a',
        borderRadius: 12,
        padding: 10,
        borderWidth: 2,
        borderColor: '#ff8c00',
    },
    court: {
        flex: 1,
        backgroundColor: '#2a2a2a',
        borderRadius: 8,
        position: 'relative',
    },
    threePointLine: {
        position: 'absolute',
        top: '30%',
        left: '10%',
        right: '10%',
        height: 2,
        backgroundColor: 'rgba(255, 140, 0, 0.5)',
        borderRadius: 1,
    },
    paintArea: {
        position: 'absolute',
        bottom: '10%',
        left: '30%',
        right: '30%',
        height: '25%',
        backgroundColor: 'rgba(255, 140, 0, 0.1)',
        borderWidth: 2,
        borderColor: 'rgba(255, 140, 0, 0.3)',
        borderRadius: 4,
    },
    hoop: {
        position: 'absolute',
        bottom: '15%',
        left: '50%',
        width: 30,
        height: 30,
        marginLeft: -15,
        borderRadius: 15,
        borderWidth: 3,
        borderColor: '#ff8c00',
    },
    backboard: {
        position: 'absolute',
        bottom: '25%',
        left: '50%',
        width: 60,
        height: 8,
        marginLeft: -30,
        backgroundColor: '#fff',
    },
    freeThrowLine: {
        position: 'absolute',
        bottom: '35%',
        left: '30%',
        right: '30%',
        height: 2,
        backgroundColor: 'rgba(255, 255, 255, 0.5)',
    },
    shotPoint: {
        position: 'absolute',
        width: 24,
        height: 24,
        marginLeft: -12,
        marginTop: -12,
        justifyContent: 'center',
        alignItems: 'center',
    },
    shotMade: {
        backgroundColor: 'rgba(34, 197, 94, 0.2)',
    },
    shotMiss: {
        backgroundColor: 'rgba(239, 68, 68, 0.2)',
    },
    shotDot: {
        width: 12,
        height: 12,
        borderRadius: 6,
    },
    shotDotMade: {
        backgroundColor: '#22c55e',
    },
    shotDotMiss: {
        backgroundColor: '#ef4444',
    },
    legendContainer: {
        flexDirection: 'row',
        justifyContent: 'center',
        gap: 20,
        marginTop: 15,
    },
    legendItem: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    legendDot: {
        width: 10,
        height: 10,
        borderRadius: 5,
    },
    legendDotMade: {
        backgroundColor: '#22c55e',
    },
    legendDotMiss: {
        backgroundColor: '#ef4444',
    },
    legendText: {
        fontSize: 12,
        color: '#aaa',
    },
    loadingContainer: {
        alignItems: 'center',
        paddingVertical: 40,
    },
    loadingText: {
        color: '#888',
        fontSize: 14,
    },
    emptyContainer: {
        alignItems: 'center',
        paddingVertical: 40,
    },
    emptyText: {
        color: '#888',
        fontSize: 14,
    },
    sessionStatsContainer: {
        backgroundColor: '#121826',
        borderRadius: 12,
        padding: 15,
        marginBottom: 20,
    },
    statsGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        marginBottom: 15,
    },
    statItem: {
        width: '50%',
        alignItems: 'center',
        paddingVertical: 10,
    },
    statValue: {
        fontSize: 24,
        fontWeight: 'bold',
        color: '#ff8c00',
    },
    statLabel: {
        fontSize: 12,
        color: '#888',
        marginTop: 4,
    },
    bestWorstContainer: {
        flexDirection: 'row',
        gap: 10,
    },
    bestWorstItem: {
        flex: 1,
        backgroundColor: '#1a1a1a',
        borderRadius: 8,
        padding: 12,
        alignItems: 'center',
    },
    bestWorstLabel: {
        fontSize: 11,
        color: '#888',
        marginBottom: 4,
    },
    bestWorstValue: {
        fontSize: 14,
        fontWeight: 'bold',
        color: '#fff',
    },
    zoneStatsContainer: {
        backgroundColor: '#121826',
        borderRadius: 12,
        padding: 15,
        marginBottom: 20,
    },
    zoneStatRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 10,
        borderBottomWidth: 1,
        borderBottomColor: '#2a2a2a',
    },
    zoneStatLabel: {
        fontSize: 14,
        color: '#fff',
        fontWeight: '500',
    },
    zoneStatValues: {
        flexDirection: 'row',
        gap: 15,
        alignItems: 'center',
    },
    zoneStatValue: {
        fontSize: 13,
        color: '#888',
    },
    zoneStatPercentage: {
        fontSize: 16,
        fontWeight: 'bold',
    },
    goodPercentage: {
        color: '#22c55e',
    },
    badPercentage: {
        color: '#ef4444',
    },
})
