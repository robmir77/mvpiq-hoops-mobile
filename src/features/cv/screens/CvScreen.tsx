// src/features/cv/screens/CvScreen.tsx

import React, { useContext } from 'react'
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    TouchableOpacity,
    ActivityIndicator,
    Alert,
    RefreshControl,
} from 'react-native'
import { useNavigation } from '@react-navigation/native'
import { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { MainStackParamList } from '@/app/navigation/types'
import { useCv } from '../hooks/useCv'
import { AuthContext } from '@/features/auth/context/AuthContext'
import { PlayerCv } from '../types/cv.types'

type NavigationProp = NativeStackNavigationProp<MainStackParamList>

const TeamCard = ({ team }: { team: any }) => {
    return (
        <View style={styles.teamCard}>
            <Text style={styles.teamName}>{team.teamName}</Text>
            <Text style={styles.teamCategory}>Categoria: {team.categoryId}</Text>
            {team.startDate && (
                <Text style={styles.teamDate}>
                    Dal: {new Date(team.startDate).toLocaleDateString()}
                </Text>
            )}
            {team.endDate && (
                <Text style={styles.teamDate}>
                    Al: {new Date(team.endDate).toLocaleDateString()}
                </Text>
            )}
        </View>
    )
}

export default function CvScreen() {
    const navigation = useNavigation<NavigationProp>()
    const auth = useContext(AuthContext)

    if (!auth) return null

    const { user } = auth
    const { data: cv, isLoading, isError, refetch } = useCv(user?.id)

    const handleEditCv = () => {
        navigation.navigate('EditCv' as any, { playerId: user?.id })
    }

    const handleRefresh = () => {
        refetch()
    }

    if (isLoading) {
        return (
            <View style={styles.center}>
                <ActivityIndicator size="large" color="#ff8c00" />
                <Text style={styles.loadingText}>Caricamento CV...</Text>
            </View>
        )
    }

    if (isError) {
        return (
            <View style={styles.center}>
                <Text style={styles.errorText}>Errore caricamento CV</Text>
                <TouchableOpacity style={styles.retryButton} onPress={handleRefresh}>
                    <Text style={styles.retryText}>Riprova</Text>
                </TouchableOpacity>
            </View>
        )
    }

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <Text style={styles.headerTitle}>Il Mio CV</Text>
                <TouchableOpacity style={styles.editButton} onPress={handleEditCv}>
                    <Text style={styles.editButtonText}>Modifica</Text>
                </TouchableOpacity>
            </View>

            <ScrollView
                style={styles.scrollView}
                refreshControl={
                    <RefreshControl refreshing={isLoading} onRefresh={handleRefresh} />
                }
            >
                {/* Headline */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Headline</Text>
                    {cv?.headline ? (
                        <Text style={styles.headlineText}>{cv.headline}</Text>
                    ) : (
                        <Text style={styles.emptyText}>Nessuna headline impostata</Text>
                    )}
                </View>

                {/* Summary */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Riepilogo</Text>
                    {cv?.summary ? (
                        <Text style={styles.summaryText}>{cv.summary}</Text>
                    ) : (
                        <Text style={styles.emptyText}>Nessun riepilogo impostato</Text>
                    )}
                </View>

                {/* Statistics */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Statistiche</Text>
                    {cv?.stats && Object.keys(cv.stats).length > 0 ? (
                        <View style={styles.statsContainer}>
                            {Object.entries(cv.stats).map(([key, value]) => (
                                <View key={key} style={styles.statItem}>
                                    <Text style={styles.statKey}>{key}:</Text>
                                    <Text style={styles.statValue}>{String(value)}</Text>
                                </View>
                            ))}
                        </View>
                    ) : (
                        <Text style={styles.emptyText}>Nessuna statistica impostata</Text>
                    )}
                </View>

                {/* Teams */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Squadre</Text>
                    {cv?.teams && cv.teams.length > 0 ? (
                        cv.teams.map((team, index) => (
                            <TeamCard key={index} team={team} />
                        ))
                    ) : (
                        <Text style={styles.emptyText}>Nessuna squadra registrata</Text>
                    )}
                </View>

                {/* Action Buttons */}
                <View style={styles.actionButtons}>
                    <TouchableOpacity 
                        style={[styles.actionButton, styles.primaryButton]} 
                        onPress={handleEditCv}
                    >
                        <Text style={styles.actionButtonText}>Modifica CV</Text>
                    </TouchableOpacity>
                    
                    <TouchableOpacity 
                        style={[styles.actionButton, styles.secondaryButton]}
                        onPress={() => Alert.alert('Anteprima', 'Funzionalità di anteprima PDF in arrivo')}
                    >
                        <Text style={[styles.actionButtonText, styles.secondaryButtonText]}>
                            Anteprima PDF
                        </Text>
                    </TouchableOpacity>
                </View>
            </ScrollView>
        </View>
    )
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#1a1a1a',
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 20,
        borderBottomWidth: 1,
        borderBottomColor: '#333',
    },
    headerTitle: {
        fontSize: 24,
        fontWeight: 'bold',
        color: '#fff',
    },
    editButton: {
        backgroundColor: '#ff8c00',
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: 20,
    },
    editButtonText: {
        color: '#fff',
        fontWeight: 'bold',
        fontSize: 14,
    },
    scrollView: {
        flex: 1,
    },
    section: {
        margin: 16,
        padding: 16,
        backgroundColor: '#2a2a2a',
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#333',
    },
    sectionTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#fff',
        marginBottom: 12,
    },
    headlineText: {
        color: '#fff',
        fontSize: 16,
        fontStyle: 'italic',
    },
    summaryText: {
        color: '#ccc',
        fontSize: 14,
        lineHeight: 20,
    },
    statsContainer: {
        flexDirection: 'row',
        flexWrap: 'wrap',
    },
    statItem: {
        width: '50%',
        flexDirection: 'row',
        justifyContent: 'space-between',
        paddingVertical: 4,
    },
    statKey: {
        color: '#888',
        fontSize: 14,
    },
    statValue: {
        color: '#ff8c00',
        fontSize: 14,
        fontWeight: 'bold',
    },
    teamCard: {
        backgroundColor: '#333',
        padding: 12,
        borderRadius: 8,
        marginBottom: 8,
    },
    teamName: {
        color: '#fff',
        fontSize: 16,
        fontWeight: 'bold',
        marginBottom: 4,
    },
    teamCategory: {
        color: '#ccc',
        fontSize: 14,
        marginBottom: 2,
    },
    teamDate: {
        color: '#888',
        fontSize: 12,
    },
    emptyText: {
        color: '#888',
        fontStyle: 'italic',
    },
    emptyCvContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingVertical: 60,
        paddingHorizontal: 30,
    },
    emptyCvIcon: {
        width: 80,
        height: 80,
        borderRadius: 40,
        backgroundColor: '#ff8c00',
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 20,
    },
    emptyCvIconText: {
        fontSize: 40,
    },
    emptyCvTitle: {
        fontSize: 24,
        fontWeight: 'bold',
        color: '#fff',
        textAlign: 'center',
        marginBottom: 12,
    },
    emptyCvDescription: {
        fontSize: 16,
        color: '#ccc',
        textAlign: 'center',
        lineHeight: 24,
        marginBottom: 30,
        paddingHorizontal: 20,
    },
    emptyCvButton: {
        backgroundColor: '#ff8c00',
        paddingVertical: 16,
        paddingHorizontal: 32,
        borderRadius: 12,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.2,
        shadowRadius: 4,
        elevation: 4,
    },
    emptyCvButtonText: {
        color: '#fff',
        fontSize: 18,
        fontWeight: 'bold',
    },
    emptySection: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 12,
        paddingHorizontal: 16,
        backgroundColor: '#2a2a2a',
        borderRadius: 8,
        borderLeftWidth: 4,
        borderLeftColor: '#ff8c00',
    },
    emptySectionText: {
        fontSize: 24,
        marginRight: 12,
    },
    emptySectionLabel: {
        color: '#ccc',
        fontSize: 14,
        flex: 1,
    },
    center: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    loadingText: {
        color: '#fff',
        marginTop: 10,
    },
    errorText: {
        color: '#ff4444',
        fontSize: 16,
        marginBottom: 20,
    },
    retryButton: {
        backgroundColor: '#ff8c00',
        paddingHorizontal: 20,
        paddingVertical: 10,
        borderRadius: 8,
    },
    retryText: {
        color: '#fff',
        fontWeight: 'bold',
    },
    actionButtons: {
        padding: 16,
        gap: 12,
    },
    actionButton: {
        paddingVertical: 12,
        borderRadius: 8,
        alignItems: 'center',
    },
    primaryButton: {
        backgroundColor: '#ff8c00',
    },
    secondaryButton: {
        backgroundColor: 'transparent',
        borderWidth: 1,
        borderColor: '#ff8c00',
    },
    actionButtonText: {
        color: '#fff',
        fontWeight: 'bold',
        fontSize: 16,
    },
    secondaryButtonText: {
        color: '#ff8c00',
    },
})
