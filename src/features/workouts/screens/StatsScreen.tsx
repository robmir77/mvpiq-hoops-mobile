import React, { useState, useContext, useEffect } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native'
import { globalStyles } from '@/shared/theme/globalStyles'
import { AuthContext } from '@/features/auth/context/AuthContext'
import { ZoneStatistics, CareerStats } from '../types/workouts.types'
import { getSessionStatistics, getZoneStatistics, getHotZoneShots, getColdZoneShots, getCareerStatistics } from '../api/workouts.api'
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

    useEffect(() => {
        loadAllStats()
    }, [sessionId])

    const loadAllStats = async () => {
        if (!user?.id || !sessionId) return

        setIsLoading(true)
        try {
            const [session, zones, hot, cold, career] = await Promise.all([
                getSessionStatistics(sessionId, user.id),
                getZoneStatistics(sessionId, user.id),
                getHotZoneShots(sessionId, user.id, 5),
                getColdZoneShots(sessionId, user.id, 5),
                getCareerStatistics(sessionId, user.id),
            ])

            setSessionStats(session)
            setZoneStats(zones)
            setHotZoneShots(hot)
            setColdZoneShots(cold)
            setCareerStats(career)
        } catch (error: any) {
            console.error('Errore caricamento statistiche:', error)
            showError('Errore', error.message || 'Impossibile caricare le statistiche')
        } finally {
            setIsLoading(false)
        }
    }

    const renderSessionStats = () => {
        if (!sessionStats) return null

        return (
            <View style={styles.statsCard}>
                <Text style={styles.cardTitle}>Statistiche Sessione</Text>
                
                <View style={styles.statsGrid}>
                    <View style={styles.statItem}>
                        <Text style={styles.statValue}>{sessionStats.totalShots || 0}</Text>
                        <Text style={styles.statLabel}>Tiri Totali</Text>
                    </View>
                    <View style={styles.statItem}>
                        <Text style={styles.statValue}>{sessionStats.madeShots || 0}</Text>
                        <Text style={styles.statLabel}>Segnati</Text>
                    </View>
                    <View style={styles.statItem}>
                        <Text style={styles.statValue}>{sessionStats.missedShots || 0}</Text>
                        <Text style={styles.statLabel}>Mancati</Text>
                    </View>
                    <View style={styles.statItem}>
                        <Text style={styles.statValue}>{sessionStats.shootingPercentage?.toFixed(0) || 0}%</Text>
                        <Text style={styles.statLabel}>Percentuale</Text>
                    </View>
                </View>
            </View>
        )
    }

    const renderZoneStats = () => {
        if (zoneStats.length === 0) return null

        return (
            <View style={styles.statsCard}>
                <Text style={styles.cardTitle}>Statistiche per Zona</Text>
                {zoneStats.map((zone, index) => (
                    <View key={index} style={styles.zoneRow}>
                        <View style={styles.zoneInfo}>
                            <Text style={styles.zoneName}>{zone.zone}</Text>
                            <Text style={styles.zoneAttempts}>{zone.attempts} tiri</Text>
                        </View>
                        <View style={styles.zonePerformance}>
                            <Text style={[
                                styles.zonePercentage,
                                zone.percentage >= 50 ? styles.goodPercentage : styles.badPercentage
                            ]}>
                                {zone.percentage?.toFixed(0) || 0}%
                            </Text>
                            <Text style={styles.zoneDistance}>{zone.averageDistance?.toFixed(1) || 0}m</Text>
                        </View>
                    </View>
                ))}
            </View>
        )
    }

    const renderHotColdZones = () => {
        if (hotZoneShots.length === 0 && coldZoneShots.length === 0) return null

        return (
            <View style={styles.statsCard}>
                <Text style={styles.cardTitle}>Hot & Cold Zones</Text>
                
                {hotZoneShots.length > 0 && (
                    <View style={styles.zoneSection}>
                        <Text style={styles.zoneSectionTitle}>🔥 Hot Zones</Text>
                        {hotZoneShots.map((shot, index) => (
                            <View key={index} style={styles.shotRow}>
                                <Text style={styles.shotZone}>{shot.zone || 'N/A'}</Text>
                                <Text style={[
                                    styles.shotResult,
                                    shot.shotResult === 'MADE' ? styles.shotMade : styles.shotMiss
                                ]}>
                                    {shot.shotResult === 'MADE' ? '✅' : '❌'}
                                </Text>
                                <Text style={styles.shotDistance}>{shot.distanceFromHoop?.toFixed(1)}m</Text>
                            </View>
                        ))}
                    </View>
                )}

                {coldZoneShots.length > 0 && (
                    <View style={[styles.zoneSection, styles.zoneSectionLast]}>
                        <Text style={styles.zoneSectionTitle}>❄️ Cold Zones</Text>
                        {coldZoneShots.map((shot, index) => (
                            <View key={index} style={styles.shotRow}>
                                <Text style={styles.shotZone}>{shot.zone || 'N/A'}</Text>
                                <Text style={[
                                    styles.shotResult,
                                    shot.shotResult === 'MADE' ? styles.shotMade : styles.shotMiss
                                ]}>
                                    {shot.shotResult === 'MADE' ? '✅' : '❌'}
                                </Text>
                                <Text style={styles.shotDistance}>{shot.distanceFromHoop?.toFixed(1)}m</Text>
                            </View>
                        ))}
                    </View>
                )}
            </View>
        )
    }

    const renderCareerStats = () => {
        if (!careerStats) return null

        return (
            <View style={styles.statsCard}>
                <Text style={styles.cardTitle}>Statistiche Carriera</Text>
                
                <View style={styles.careerGrid}>
                    <View style={styles.careerItem}>
                        <Text style={styles.careerValue}>{careerStats.totalSessions}</Text>
                        <Text style={styles.careerLabel}>Sessioni</Text>
                    </View>
                    <View style={styles.careerItem}>
                        <Text style={styles.careerValue}>{careerStats.totalShots}</Text>
                        <Text style={styles.careerLabel}>Tiri Totali</Text>
                    </View>
                    <View style={styles.careerItem}>
                        <Text style={styles.careerValue}>{careerStats.overallPercentage?.toFixed(0) || 0}%</Text>
                        <Text style={styles.careerLabel}>Percentuale</Text>
                    </View>
                    <View style={styles.careerItem}>
                        <Text style={styles.careerValue}>{careerStats.bestSessionPercentage?.toFixed(0) || 0}%</Text>
                        <Text style={styles.careerLabel}>Miglior Sessione</Text>
                    </View>
                </View>

                <View style={styles.careerHighlights}>
                    <View style={styles.highlightItem}>
                        <Text style={styles.highlightLabel}>Zona Preferita</Text>
                        <Text style={styles.highlightValue}>{careerStats.favoriteZone}</Text>
                    </View>
                    <View style={styles.highlightItem}>
                        <Text style={styles.highlightLabel}>Durata Media</Text>
                        <Text style={styles.highlightValue}>
                            {Math.floor((careerStats.averageSessionDuration || 0) / 60)}:{((careerStats.averageSessionDuration || 0) % 60).toFixed(0).padStart(2, '0')}
                        </Text>
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
                <Text style={styles.headerTitle}>Statistiche</Text>
                <TouchableOpacity onPress={() => navigation.navigate('ShotChart', { sessionId })}>
                    <Text style={styles.chartButton}>📊</Text>
                </TouchableOpacity>
            </View>

            <ScrollView style={styles.scrollContainer} showsVerticalScrollIndicator={false}>
                {isLoading ? (
                    <View style={styles.loadingContainer}>
                        <Text style={styles.loadingText}>Caricamento statistiche...</Text>
                    </View>
                ) : (
                    <>
                        {renderSessionStats()}
                        {renderZoneStats()}
                        {renderHotColdZones()}
                        {renderCareerStats()}
                    </>
                )}
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
    chartButton: {
        fontSize: 24,
    },
    scrollContainer: {
        flex: 1,
        padding: 15,
    },
    loadingContainer: {
        alignItems: 'center',
        paddingVertical: 40,
    },
    loadingText: {
        color: '#888',
        fontSize: 14,
    },
    statsCard: {
        backgroundColor: '#121826',
        borderRadius: 12,
        padding: 15,
        marginBottom: 15,
    },
    cardTitle: {
        fontSize: 16,
        fontWeight: 'bold',
        color: '#fff',
        marginBottom: 15,
    },
    statsGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
    },
    statItem: {
        width: '50%',
        alignItems: 'center',
        paddingVertical: 10,
    },
    statValue: {
        fontSize: 28,
        fontWeight: 'bold',
        color: '#ff8c00',
    },
    statLabel: {
        fontSize: 12,
        color: '#888',
        marginTop: 4,
    },
    zoneRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: '#2a2a2a',
    },
    zoneInfo: {
        flex: 1,
    },
    zoneName: {
        fontSize: 14,
        fontWeight: '600',
        color: '#fff',
        marginBottom: 2,
    },
    zoneAttempts: {
        fontSize: 12,
        color: '#888',
    },
    zonePerformance: {
        alignItems: 'flex-end',
    },
    zonePercentage: {
        fontSize: 20,
        fontWeight: 'bold',
    },
    goodPercentage: {
        color: '#22c55e',
    },
    badPercentage: {
        color: '#ef4444',
    },
    zoneDistance: {
        fontSize: 12,
        color: '#888',
        marginTop: 2,
    },
    zoneSection: {
        marginBottom: 15,
    },
    zoneSectionLast: {
        marginBottom: 0,
    },
    zoneSectionTitle: {
        fontSize: 14,
        fontWeight: 'bold',
        color: '#fff',
        marginBottom: 10,
    },
    shotRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 8,
        paddingHorizontal: 12,
        backgroundColor: '#1a1a1a',
        borderRadius: 8,
        marginBottom: 6,
    },
    shotZone: {
        fontSize: 13,
        color: '#fff',
        flex: 1,
    },
    shotResult: {
        fontSize: 16,
        fontWeight: 'bold',
        marginHorizontal: 10,
    },
    shotMade: {
        color: '#22c55e',
    },
    shotMiss: {
        color: '#ef4444',
    },
    shotDistance: {
        fontSize: 12,
        color: '#888',
    },
    careerGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        marginBottom: 15,
    },
    careerItem: {
        width: '50%',
        alignItems: 'center',
        paddingVertical: 12,
    },
    careerValue: {
        fontSize: 24,
        fontWeight: 'bold',
        color: '#ff8c00',
    },
    careerLabel: {
        fontSize: 11,
        color: '#888',
        marginTop: 4,
    },
    careerHighlights: {
        flexDirection: 'row',
        gap: 10,
    },
    highlightItem: {
        flex: 1,
        backgroundColor: '#1a1a1a',
        borderRadius: 8,
        padding: 12,
        alignItems: 'center',
    },
    highlightLabel: {
        fontSize: 11,
        color: '#888',
        marginBottom: 4,
    },
    highlightValue: {
        fontSize: 14,
        fontWeight: 'bold',
        color: '#fff',
    },
})
