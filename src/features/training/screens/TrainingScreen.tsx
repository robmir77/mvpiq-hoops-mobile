import React, { useEffect, useState, useContext } from 'react'
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    TouchableOpacity,
    ActivityIndicator,
} from 'react-native'

import { useNavigation } from '@react-navigation/native'

import { AuthContext } from '@/features/auth/context/AuthContext'
import {
    getTrainingStats,
    getTrainingPrograms,
} from '@/features/training/api/training.api'

import {
    TrainingStats,
    TrainingProgram,
} from '@/features/training/types/training.types'

export default function TrainingScreen() {
    const navigation = useNavigation<any>()

    const auth = useContext(AuthContext)
    if (!auth) return null

    const { user } = auth

    const [stats, setStats] = useState<TrainingStats | null>(null)
    const [programs, setPrograms] = useState<TrainingProgram[]>([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        loadData()
    }, [])

    const loadData = async () => {
        try {
            const statsData = await getTrainingStats(user.id)
            const programsData = await getTrainingPrograms()

            setStats(statsData)
            setPrograms(programsData)
        } catch (error) {
            console.error('Errore caricamento training:', error)
        } finally {
            setLoading(false)
        }
    }

    if (loading) {
        return (
            <View style={styles.loaderContainer}>
                <ActivityIndicator size="large" color="#F97316" />
            </View>
        )
    }

    return (
        <View style={styles.container}>
            <ScrollView contentContainerStyle={{ padding: 20 }}>
                <Text style={styles.title}>Training</Text>

                {/* STATS */}

                <View style={styles.statsRow}>
                    <View style={styles.statCard}>
                        <Text style={styles.statNumber}>
                            {stats?.sessions ?? 0}
                        </Text>
                        <Text style={styles.statLabel}>Sessioni</Text>
                    </View>

                    <View style={styles.statCard}>
                        <Text style={styles.statNumber}>
                            {stats?.minutes ?? 0}
                        </Text>
                        <Text style={styles.statLabel}>Minuti</Text>
                    </View>

                    <View style={styles.statCard}>
                        <Text style={styles.statNumber}>
                            +{stats?.points ?? 0}
                        </Text>
                        <Text style={styles.statLabel}>Punti</Text>
                    </View>
                </View>

                {/* VIDEO ANALYSIS */}

                <Text style={styles.sectionTitle}>AI Training</Text>

                <TouchableOpacity
                    style={styles.videoCard}
                    onPress={() => navigation.navigate('VideoAnalysisHome')}
                >
                    <Text style={styles.videoTitle}>🎥 Video Analysis</Text>

                    <Text style={styles.videoDesc}>
                        Analizza il tuo movimento con l'intelligenza artificiale.
                        Carica un video e ricevi feedback tecnico sul gesto.
                    </Text>

                    <View style={styles.videoButton}>
                        <Text style={styles.videoButtonText}>
                            Inizia Analisi
                        </Text>
                    </View>
                </TouchableOpacity>

                {/* PROGRAMMI */}

                <Text style={styles.sectionTitle}>Programmi</Text>

                {programs.map((program) => (
                    <View key={program.id} style={styles.programCard}>
                        <Text style={styles.programTitle}>
                            {program.title}
                        </Text>

                        <Text style={styles.programDesc}>
                            {program.description}
                        </Text>

                        <TouchableOpacity style={styles.startButton}>
                            <Text style={styles.startButtonText}>
                                Inizia Sessione
                            </Text>
                        </TouchableOpacity>
                    </View>
                ))}
            </ScrollView>
        </View>
    )
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#0F172A',
    },

    loaderContainer: {
        flex: 1,
        justifyContent: 'center',
        backgroundColor: '#0F172A',
    },

    title: {
        fontSize: 28,
        fontWeight: '700',
        color: '#FFFFFF',
        marginBottom: 20,
    },

    statsRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 30,
    },

    statCard: {
        backgroundColor: '#1E293B',
        flex: 1,
        marginHorizontal: 5,
        padding: 20,
        borderRadius: 18,
        alignItems: 'center',
    },

    statNumber: {
        fontSize: 22,
        fontWeight: '700',
        color: '#F97316',
    },

    statLabel: {
        color: '#94A3B8',
        marginTop: 4,
    },

    sectionTitle: {
        fontSize: 18,
        fontWeight: '600',
        color: '#FFFFFF',
        marginBottom: 15,
    },

    videoCard: {
        backgroundColor: '#1E293B',
        padding: 20,
        borderRadius: 18,
        marginBottom: 25,
    },

    videoTitle: {
        color: '#FFFFFF',
        fontWeight: '700',
        fontSize: 16,
        marginBottom: 6,
    },

    videoDesc: {
        color: '#94A3B8',
        marginBottom: 14,
    },

    videoButton: {
        backgroundColor: '#F97316',
        padding: 12,
        borderRadius: 12,
        alignItems: 'center',
    },

    videoButtonText: {
        color: '#FFFFFF',
        fontWeight: '600',
    },

    programCard: {
        backgroundColor: '#1E293B',
        padding: 20,
        borderRadius: 18,
        marginBottom: 15,
    },

    programTitle: {
        color: '#FFFFFF',
        fontWeight: '700',
    },

    programDesc: {
        color: '#94A3B8',
        marginVertical: 8,
    },

    startButton: {
        backgroundColor: '#F97316',
        padding: 12,
        borderRadius: 12,
        alignItems: 'center',
        marginTop: 8,
    },

    startButtonText: {
        color: '#FFFFFF',
        fontWeight: '600',
    },
})