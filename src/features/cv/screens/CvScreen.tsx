// src/features/cv/screens/CvScreen.tsx

import React, { useContext, useState } from 'react'
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    TouchableOpacity,
    ActivityIndicator,
    RefreshControl,
    Alert,
    Share,
    Clipboard,
} from 'react-native'
import { useNavigation } from '@react-navigation/native'
import { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { MainStackParamList } from '@/app/navigation/types'
import { useCv } from '../hooks/useCv'
import { AuthContext } from '@/features/auth/context/AuthContext'
import { PlayerCv, PlayerCvHighlight } from '../types/cv.types'
import { useCustomAlert, CustomAlert } from '@/shared/components/CustomAlert'
import { enableCvSharing, disableCvSharing } from '../api/cv.api'

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

const HighlightCard = ({ highlight }: { highlight: PlayerCvHighlight }) => {
    return (
        <View style={styles.highlightCard}>
            <Text style={styles.highlightTitle}>{highlight.title || 'Senza titolo'}</Text>
            {highlight.description && (
                <Text style={styles.highlightDescription}>{highlight.description}</Text>
            )}
            {highlight.externalUrl && (
                <Text style={styles.highlightUrl}>{highlight.externalUrl}</Text>
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
    const { alert, showInfo } = useCustomAlert()
    const [isSharing, setIsSharing] = useState(false)

    const handleEditCv = () => {
        navigation.navigate('EditCv' as any, { playerId: user?.id })
    }

    const handleRefresh = () => {
        refetch()
    }

    const handleShareCv = async () => {
        if (!user?.id) return

        try {
            if (cv?.sharing?.shareEnabled) {
                // Already sharing, show options
                const shareUrl = cv.sharing.publicUrl || `https://app.mvpiq-hoops.com/public/cv/${cv.sharing.shareToken}`
                Alert.alert(
                    'Condividi CV',
                    'Scegli come condividere il tuo CV',
                    [
                        {
                            text: 'Copia link',
                            onPress: () => {
                                if (shareUrl) {
                                    Clipboard.setString(shareUrl)
                                    showInfo('Link copiato', 'Il link è stato copiato negli appunti')
                                }
                            }
                        },
                        {
                            text: 'Condividi',
                            onPress: async () => {
                                await Share.share({
                                    message: `Guarda il mio CV sportivo: ${shareUrl}`,
                                    url: shareUrl,
                                })
                            }
                        },
                        { text: 'Annulla', style: 'cancel' }
                    ]
                )
            } else {
                // Enable sharing first
                setIsSharing(true)
                const sharingData = await enableCvSharing(user.id)
                const shareUrl = sharingData.publicUrl
                refetch()
                setIsSharing(false)

                // Show options after enabling
                Alert.alert(
                    'CV Pubblicato!',
                    'Il tuo CV è ora condivisibile',
                    [
                        {
                            text: 'Copia link',
                            onPress: () => {
                                if (shareUrl) {
                                    Clipboard.setString(shareUrl)
                                    showInfo('Link copiato', 'Il link è stato copiato negli appunti')
                                }
                            }
                        },
                        {
                            text: 'Condividi',
                            onPress: async () => {
                                await Share.share({
                                    message: `Guarda il mio CV sportivo: ${shareUrl}`,
                                    url: shareUrl,
                                })
                            }
                        },
                        { text: 'OK', style: 'cancel' }
                    ]
                )
            }
        } catch (error: any) {
            console.error('Errore condivisione CV:', error)
            setIsSharing(false)
            showInfo('Errore', 'Impossibile condividere il CV')
        }
    }

    const handleDisableSharing = async () => {
        if (!user?.id) return

        Alert.alert(
            'Disabilita condivisione',
            'Sei sicuro di voler disabilitare la condivisione del tuo CV? Il link pubblico non sarà più accessibile.',
            [
                { text: 'Annulla', style: 'cancel' },
                {
                    text: 'Disabilita',
                    style: 'destructive',
                    onPress: async () => {
                        try {
                            await disableCvSharing(user.id)
                            showInfo('Condivisione disabilitata', 'Il tuo CV non è più pubblico')
                            refetch()
                        } catch (error: any) {
                            console.error('Errore disabilitazione condivisione:', error)
                            showInfo('Errore', 'Impossibile disabilitare la condivisione')
                        }
                    }
                }
            ]
        )
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
                <View style={styles.headerButtons}>
                    <TouchableOpacity style={styles.editButton} onPress={handleEditCv}>
                        <Text style={styles.editButtonText}>Modifica</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={[styles.shareButton, cv?.sharing?.shareEnabled && styles.shareButtonActive]}
                        onPress={handleShareCv}
                        disabled={isSharing}
                    >
                        <Text style={styles.shareButtonText}>
                            {isSharing ? '...' : cv?.sharing?.shareEnabled ? 'Condividi' : 'Pubblica'}
                        </Text>
                    </TouchableOpacity>
                </View>
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

                {/* Highlights */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Highlights</Text>
                    {cv?.highlights && cv.highlights.length > 0 ? (
                        cv.highlights.map((highlight, index) => (
                            <HighlightCard key={index} highlight={highlight} />
                        ))
                    ) : (
                        <Text style={styles.emptyText}>Nessun highlight aggiunto</Text>
                    )}
                </View>

                {/* Sharing Status */}
                {cv?.sharing?.shareEnabled && (
                    <View style={styles.section}>
                        <Text style={styles.sectionTitle}>Condivisione</Text>
                        <Text style={styles.sharingStatus}>
                            CV pubblico attivo dal {new Date(cv.sharing.publicUpdatedAt || '').toLocaleDateString()}
                        </Text>
                        <TouchableOpacity
                            style={[styles.actionButton, styles.dangerButton]}
                            onPress={handleDisableSharing}
                        >
                            <Text style={styles.actionButtonText}>Disabilita condivisione</Text>
                        </TouchableOpacity>
                    </View>
                )}

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
                        onPress={() => showInfo('Anteprima', 'Funzionalità di anteprima PDF in arrivo')}
                    >
                        <Text style={[styles.actionButtonText, styles.secondaryButtonText]}>
                            Anteprima PDF
                        </Text>
                    </TouchableOpacity>
                </View>
            </ScrollView>
            <CustomAlert {...alert} />
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
    headerButtons: {
        flexDirection: 'row',
        gap: 8,
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
    shareButton: {
        backgroundColor: '#333',
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: '#ff8c00',
    },
    shareButtonActive: {
        backgroundColor: '#ff8c00',
    },
    shareButtonText: {
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
    highlightCard: {
        backgroundColor: '#333',
        padding: 12,
        borderRadius: 8,
        marginBottom: 8,
    },
    highlightTitle: {
        color: '#fff',
        fontSize: 16,
        fontWeight: 'bold',
        marginBottom: 4,
    },
    highlightDescription: {
        color: '#ccc',
        fontSize: 14,
        marginBottom: 4,
    },
    highlightUrl: {
        color: '#ff8c00',
        fontSize: 12,
    },
    sharingStatus: {
        color: '#ccc',
        fontSize: 14,
        marginBottom: 12,
    },
    dangerButton: {
        backgroundColor: '#dc3545',
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
