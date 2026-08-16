import React, { useState, useEffect, useContext } from 'react'
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    TouchableOpacity,
    ActivityIndicator,
} from 'react-native'
import { AuthContext } from '@/features/auth/context/AuthContext'
import { colors } from '@/shared/theme/colors'
import {
    getSubscriptionPlan,
    getVideoAnalysisLimits,
    upgradeToPremium,
} from '@/features/subscriptions/api/subscriptions.api'
import { useCustomAlert, CustomAlert } from '@/shared/components/CustomAlert'
import { ShieldCheck, Zap, Check, Star, Video, Award } from 'lucide-react-native'

export default function SubscriptionsScreen() {
    const auth = useContext(AuthContext)
    const user = auth?.user
    const { alert, showError, showSuccess } = useCustomAlert()

    const [loading, setLoading] = useState(true)
    const [currentPlan, setCurrentPlan] = useState<string>('FREE')
    const [limits, setLimits] = useState<any>(null)
    const [upgrading, setUpgrading] = useState(false)

    useEffect(() => {
        loadSubscriptionInfo()
    }, [user?.id])

    const loadSubscriptionInfo = async () => {
        if (!user?.id) return
        try {
            setLoading(true)
            const planData = await getSubscriptionPlan(user.id)
            setCurrentPlan(planData.plan || 'FREE')

            const limitData = await getVideoAnalysisLimits(user.id)
            setLimits(limitData)
        } catch (error) {
            console.error('Errore caricamento subscription:', error)
        } finally {
            setLoading(false)
        }
    }

    const handleUpgrade = async () => {
        if (!user?.id) return
        setUpgrading(true)
        try {
            await upgradeToPremium(user.id)
            showSuccess('Ottimo!', 'Il tuo account è stato aggiornato con successo al piano Premium!')
            loadSubscriptionInfo()
        } catch (error: any) {
            showError('Errore', error.message || 'Impossibile completare l\'upgrade.')
        } finally {
            setUpgrading(false)
        }
    }

    return (
        <View style={styles.container}>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
                <View style={styles.header}>
                    <Text style={styles.title}>Piano & Abbonamento</Text>
                    <Text style={styles.subtitle}>Gestisci le tue funzionalità e il livello di accesso</Text>
                </View>

                {loading ? (
                    <View style={styles.centerContainer}>
                        <ActivityIndicator size="large" color={colors.primary} />
                    </View>
                ) : (
                    <>
                        {/* Current Plan Badge */}
                        <View style={styles.currentPlanCard}>
                            <View style={styles.planHeader}>
                                <ShieldCheck size={28} color={colors.primary} />
                                <View style={styles.planTitleBox}>
                                    <Text style={styles.currentPlanLabel}>PIANO ATTIVATO</Text>
                                    <Text style={styles.currentPlanTitle}>{currentPlan.toUpperCase()}</Text>
                                </View>
                                {currentPlan !== 'FREE' && (
                                    <View style={styles.activeBadge}>
                                        <Text style={styles.activeBadgeText}>Attivo</Text>
                                    </View>
                                )}
                            </View>

                            {limits && (
                                <View style={styles.limitsContainer}>
                                    <View style={styles.limitRow}>
                                        <Video size={16} color="#9CA3AF" />
                                        <Text style={styles.limitText}>
                                            Analisi Video usate: {limits.videoAnalysisUsed || 0} / {limits.videoAnalysisLimit || 'Illimitate'}
                                        </Text>
                                    </View>
                                </View>
                            )}
                        </View>

                        {/* Upgrade Banner */}
                        {currentPlan === 'FREE' && (
                            <TouchableOpacity
                                style={styles.upgradeBanner}
                                onPress={handleUpgrade}
                                disabled={upgrading}
                                activeOpacity={0.85}
                            >
                                <Zap size={24} color="#FFF" style={{ marginRight: 12 }} />
                                <View style={{ flex: 1 }}>
                                    <Text style={styles.bannerTitle}>Passa a Pro Athlete</Text>
                                    <Text style={styles.bannerSub}>Sblocca tracking tiri illimitato, AI workout ed export PDF del CV</Text>
                                </View>
                                {upgrading ? (
                                    <ActivityIndicator color="#FFF" />
                                ) : (
                                    <Text style={styles.bannerBtn}>Attiva Ora</Text>
                                )}
                            </TouchableOpacity>
                        )}

                        {/* Tier Comparison */}
                        <Text style={styles.sectionTitle}>Piani Disponibili</Text>

                        {/* Free Tier */}
                        <View style={styles.tierCard}>
                            <View style={styles.tierHeader}>
                                <Text style={styles.tierTitle}>Basic (Free)</Text>
                                <Text style={styles.tierPrice}>€0 / mese</Text>
                            </View>
                            <View style={styles.featureItem}>
                                <Check size={16} color="#10B981" />
                                <Text style={styles.featureText}>Registrazione sessioni tiri base</Text>
                            </View>
                            <View style={styles.featureItem}>
                                <Check size={16} color="#10B981" />
                                <Text style={styles.featureText}>Diario sportivo e checklist</Text>
                            </View>
                            <View style={styles.featureItem}>
                                <Check size={16} color="#10B981" />
                                <Text style={styles.featureText}>Profilo atletico standard</Text>
                            </View>
                        </View>

                        {/* Pro Tier */}
                        <View style={[styles.tierCard, styles.tierCardPro]}>
                            <View style={styles.proTag}>
                                <Star size={12} color="#FFF" />
                                <Text style={styles.proTagText}>CONSIGLIATO</Text>
                            </View>
                            <View style={styles.tierHeader}>
                                <Text style={[styles.tierTitle, { color: colors.primary }]}>Pro Athlete</Text>
                                <Text style={styles.tierPrice}>€9.99 / mese</Text>
                            </View>
                            <View style={styles.featureItem}>
                                <Check size={16} color={colors.primary} />
                                <Text style={styles.featureText}>Tracking tiri avanzato & Kalman Filter</Text>
                            </View>
                            <View style={styles.featureItem}>
                                <Check size={16} color={colors.primary} />
                                <Text style={styles.featureText}>Programmi di allenamento IA generativi</Text>
                            </View>
                            <View style={styles.featureItem}>
                                <Check size={16} color={colors.primary} />
                                <Text style={styles.featureText}>Export CV sportivo in PDF con QR Code</Text>
                            </View>
                            <View style={styles.featureItem}>
                                <Check size={16} color={colors.primary} />
                                <Text style={styles.featureText}>Analisi delle posizioni (Pose landmarking)</Text>
                            </View>
                        </View>
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
        backgroundColor: '#0B0F1A',
        padding: 20,
    },
    scrollContent: {
        paddingBottom: 40,
    },
    header: {
        marginBottom: 20,
    },
    title: {
        fontSize: 26,
        fontWeight: 'bold',
        color: '#FFFFFF',
    },
    subtitle: {
        fontSize: 14,
        color: '#9CA3AF',
        marginTop: 4,
    },
    centerContainer: {
        paddingVertical: 50,
        alignItems: 'center',
    },
    currentPlanCard: {
        backgroundColor: '#1F2937',
        borderRadius: 16,
        padding: 18,
        marginBottom: 18,
        borderWidth: 1,
        borderColor: '#374151',
    },
    planHeader: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    planTitleBox: {
        flex: 1,
        marginLeft: 12,
    },
    currentPlanLabel: {
        color: '#6B7280',
        fontSize: 11,
        fontWeight: 'bold',
    },
    currentPlanTitle: {
        color: '#FFF',
        fontSize: 20,
        fontWeight: 'bold',
        marginTop: 2,
    },
    activeBadge: {
        backgroundColor: 'rgba(16, 185, 129, 0.2)',
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 12,
    },
    activeBadgeText: {
        color: '#10B981',
        fontWeight: 'bold',
        fontSize: 12,
    },
    limitsContainer: {
        marginTop: 14,
        paddingTop: 12,
        borderTopWidth: 1,
        borderTopColor: '#374151',
    },
    limitRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    limitText: {
        color: '#D1D5DB',
        fontSize: 13,
        marginLeft: 8,
    },
    upgradeBanner: {
        backgroundColor: colors.primary,
        borderRadius: 16,
        padding: 16,
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 24,
    },
    bannerTitle: {
        color: '#FFF',
        fontSize: 16,
        fontWeight: 'bold',
    },
    bannerSub: {
        color: 'rgba(255,255,255,0.85)',
        fontSize: 12,
        marginTop: 2,
    },
    bannerBtn: {
        backgroundColor: '#FFF',
        color: colors.primary,
        fontWeight: 'bold',
        fontSize: 12,
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 8,
    },
    sectionTitle: {
        color: '#FFF',
        fontSize: 18,
        fontWeight: 'bold',
        marginBottom: 14,
    },
    tierCard: {
        backgroundColor: '#1F2937',
        borderRadius: 16,
        padding: 18,
        marginBottom: 14,
        borderWidth: 1,
        borderColor: '#374151',
    },
    tierCardPro: {
        borderColor: colors.primary,
        borderWidth: 2,
        position: 'relative',
    },
    proTag: {
        position: 'absolute',
        top: -12,
        right: 16,
        backgroundColor: colors.primary,
        paddingHorizontal: 10,
        paddingVertical: 3,
        borderRadius: 10,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
    proTagText: {
        color: '#FFF',
        fontSize: 10,
        fontWeight: 'bold',
    },
    tierHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 14,
    },
    tierTitle: {
        color: '#FFF',
        fontSize: 18,
        fontWeight: 'bold',
    },
    tierPrice: {
        color: '#9CA3AF',
        fontSize: 15,
        fontWeight: '600',
    },
    featureItem: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 8,
    },
    featureText: {
        color: '#D1D5DB',
        fontSize: 13,
        marginLeft: 10,
    },
})
