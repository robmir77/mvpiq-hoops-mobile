// src/features/navigation/components/DynamicTabNavigator.tsx

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Text, View, Platform, TouchableOpacity, ScrollView } from 'react-native'
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import { useNavigation, useNavigationState, useFocusEffect } from '@react-navigation/native'
import * as LucideIcons from 'lucide-react-native'

import { useNavigationSections } from '@/features/navigation/hooks/useNavigationSections'
import { NavigationSection } from '@/features/auth/types/auth.types'
import { colors } from '@/shared/theme/colors'

// ─── Schermate ───────────────────────────────────────────────
import HomeScreen from '@/features/home/screens/HomeScreen'
import ProfileScreen from '@/features/profile/screens/ProfileScreen'
import CvScreen from '@/features/cv/screens/CvScreen'
import NotificationsScreen from '@/features/notifications/screens/NotificationsScreen'
import GoalsScreen from '@/features/goals/screens/GoalsScreen'
import AiTrainingNavigator from '@/features/ai-training/navigation/AiTrainingNavigator'
import JournalNavigator from '@/features/journal/navigation/JournalNavigator'
import WorkoutNavigator from '@/features/workouts/navigation/WorkoutNavigator'
import ChecklistTemplatesNavigator from '@/features/checklist-templates/navigation/ChecklistTemplatesNavigator'
import OnlineUsersScreen from '@/features/users/screens/OnlineUsersScreen'
import MessagingHomeScreen from '@/features/messaging/screens/MessagingHomeScreen'
import RankingScreen from '@/features/ranking/screens/RankingScreen'
import VideoAnalysisHomeScreen from '@/features/videoAnalysis/screens/VideoAnalysisHomeScreen'

// ─── Placeholder stabile ─────────────────────────────────────
// IMPORTANTE: mai definire componenti inline dentro render o dentro Record.
// React Navigation tratta ogni nuova referenza come un nuovo componente
// e smonta/rimonta il tab ad ogni render.
const makePlaceholder = (label: string): React.FC => {
    const Screen: React.FC = () => (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background }}>
            <Text style={{ color: colors.textPrimary, fontSize: 18, fontWeight: 'bold' }}>{label}</Text>
            <Text style={{ color: colors.textSecondary, fontSize: 13, marginTop: 6 }}>Coming Soon</Text>
        </View>
    )
    Screen.displayName = `Placeholder_${label}`
    return Screen
}

// Istanziati UNA VOLTA a livello di modulo
const StatsPlaceholder         = makePlaceholder('Statistiche')
const ScoutSearchScreen        = makePlaceholder('Ricerca Atleti')
const TrainerProgramsScreen    = makePlaceholder('Programmi')
const TrainerClientsScreen     = makePlaceholder('Clienti')
const TrainerExercisesScreen   = makePlaceholder('Esercizi')
const CreatorContentScreen     = makePlaceholder('Contenuti')
const CreatorTemplatesScreen   = makePlaceholder('Template')
const CreatorAnalyticsScreen   = makePlaceholder('Analytics')
const AdminSubscriptionsScreen = makePlaceholder('Abbonamenti')
const AdminGamificationScreen  = makePlaceholder('Gamification')
const MediaScreen              = makePlaceholder('Media')
const SettingsScreen           = makePlaceholder('Impostazioni')
const VideoAnalysisScreen      = makePlaceholder('Analisi Video')
const LiveShotTrackingScreen   = makePlaceholder('Conteggio Live')
const ComingSoonScreen         = makePlaceholder('Coming Soon')

// Mappa section_key → componente (referenze stabili)
const SCREEN_MAP: Record<string, React.ComponentType<any>> = {
    home:                 HomeScreen,
    profile:              ProfileScreen,
    player_profile:       ProfileScreen,
    player_stats:         RankingScreen,
    player_goals:         GoalsScreen,
    player_journal:       JournalNavigator,
    player_training:      AiTrainingNavigator,
    player_workouts:      WorkoutNavigator,
    player_media:         MediaScreen,
    player_cv:            CvScreen,
    ai_training_tools:    AiTrainingNavigator,
    scout_search:         ScoutSearchScreen,
    scout_rankings:       RankingScreen,
    ranking:              RankingScreen,
    scout_reports:        ComingSoonScreen,
    trainer_programs:     TrainerProgramsScreen,
    trainer_clients:      TrainerClientsScreen,
    trainer_exercises:    TrainerExercisesScreen,
    trainer_ai:           AiTrainingNavigator,
    creator_content:      CreatorContentScreen,
    creator_templates:    CreatorTemplatesScreen,
    creator_analytics:    CreatorAnalyticsScreen,
    admin_users:          OnlineUsersScreen,
    admin_subscriptions:  AdminSubscriptionsScreen,
    admin_gamification:   AdminGamificationScreen,
    admin_notifications:  NotificationsScreen,
    admin_checklist:      ChecklistTemplatesNavigator,
    messages:             MessagingHomeScreen,
    notifications:        NotificationsScreen,
    settings:             SettingsScreen,
    video_analysis:       VideoAnalysisHomeScreen,
    live_shot_tracking:   LiveShotTrackingScreen,
}

// ─── Icona Lucide dinamica ────────────────────────────────────
// I nomi nel DB sono kebab-case (es. "notebook-pen").
// Lucide esporta in PascalCase (es. "NotebookPen").
// Convertiamo al volo e rendiamo il componente corretto.

const toPascalCase = (kebab: string): string =>
    kebab
        .split('-')
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join('')

interface LucideIconProps {
    name: string | null
    size?: number
    color?: string
}

const LucideIcon: React.FC<LucideIconProps> = ({ name, size = 22, color = '#888' }) => {
    if (!name) return <Text style={{ fontSize: size }}>📱</Text>

    const pascal = toPascalCase(name)
    const Icon = (LucideIcons as any)[pascal]

    if (!Icon) {
        // Icona non trovata in Lucide → fallback testo
        console.warn(`Lucide icon not found: "${name}" (tried "${pascal}")`)
        return <Text style={{ fontSize: size - 2 }}>📱</Text>
    }

    return <Icon size={size} color={color} strokeWidth={2} />
}

// ─── Tab "Altro" ──────────────────────────────────────────────
interface MoreTabProps {
    sections: NavigationSection[]
    onSectionPress: (section: NavigationSection) => void
    previousTab: string
}

const MoreTabScreen: React.FC<MoreTabProps> = ({ sections, onSectionPress, previousTab }) => {
    const navigation = useNavigation()
    const focusCountRef = useRef(0)

    useFocusEffect(
        useCallback(() => {
            focusCountRef.current += 1
            if (focusCountRef.current > 1) {
                navigation.navigate(previousTab as never)
            }
            return () => { focusCountRef.current = 0 }
        }, [previousTab, navigation])
    )

    return (
        <View style={{ flex: 1, backgroundColor: colors.background, padding: 20 }}>
            <Text style={{ fontSize: 22, fontWeight: '700', color: colors.textPrimary, marginBottom: 16 }}>
                Altre sezioni
            </Text>
            <ScrollView showsVerticalScrollIndicator={false}>
                {sections.map((section) => (
                    <TouchableOpacity
                        key={section.id}
                        style={{
                            backgroundColor: colors.card,
                            borderRadius: 12,
                            padding: 16,
                            marginBottom: 10,
                            flexDirection: 'row',
                            alignItems: 'center',
                            borderWidth: 1,
                            borderColor: colors.cardBorder,
                        }}
                        onPress={() => onSectionPress(section)}
                        activeOpacity={0.7}
                    >
                        <View style={{ width: 36, alignItems: 'center', marginRight: 14 }}>
                            <LucideIcon name={section.icon} size={22} color={colors.primary} />
                        </View>
                        <View style={{ flex: 1 }}>
                            <Text style={{ fontSize: 15, fontWeight: '600', color: colors.textPrimary, marginBottom: 2 }}>
                                {section.title}
                            </Text>
                            {section.description ? (
                                <Text style={{ fontSize: 12, color: colors.textSecondary }} numberOfLines={1}>
                                    {section.description}
                                </Text>
                            ) : null}
                        </View>
                        <Text style={{ fontSize: 18, color: colors.primary }}>›</Text>
                    </TouchableOpacity>
                ))}
            </ScrollView>
        </View>
    )
}

// ─── Navigator principale ─────────────────────────────────────
const Tab = createBottomTabNavigator()
const MAX_VISIBLE_TABS = 5

const HOME_SECTION: NavigationSection = {
    id: 'home',
    title: 'Home',
    description: 'Pagina principale',
    icon: 'house',   // nome Lucide
    accessible: true,
    sortOrder: 0,
}

export const DynamicTabNavigator: React.FC = () => {
    const { accessibleSections, isLoading } = useNavigationSections()
    const navigation = useNavigation()
    const navigationState = useNavigationState(state => state)
    const [previousTab, setPreviousTab] = useState('home')
    const isMoreTabActiveRef = useRef(false)

    const currentTab = navigationState?.routes[navigationState.index]?.name || 'home'

    useEffect(() => {
        if (currentTab === 'more') {
            isMoreTabActiveRef.current = true
        } else {
            isMoreTabActiveRef.current = false
            setPreviousTab(currentTab)
        }
    }, [currentTab])

    if (isLoading) return null

    // Home sempre prima, poi le altre ordinate per sortOrder
    const allTabs: NavigationSection[] = [
        HOME_SECTION,
        ...accessibleSections.filter((s: NavigationSection) => s.id !== 'home'),
    ].sort((a, b) => {
        if (a.id === 'home') return -1
        if (b.id === 'home') return 1
        return a.sortOrder - b.sortOrder
    })

    const visibleTabs = allTabs.slice(0, MAX_VISIBLE_TABS)
    const hiddenTabs  = allTabs.slice(MAX_VISIBLE_TABS)

    const handleSectionPress = (section: NavigationSection) => {
        // Naviga nel TabNavigator per tutte le schermate tab
        navigation.navigate(section.id as never)
    }

    return (
        <Tab.Navigator
            initialRouteName="home"
            screenOptions={({ route }) => {
                const section = visibleTabs.find(s => s.id === route.name)
                return {
                    headerShown: false,
                    unmountOnBlur: false,
                    lazy: false,
                    tabBarActiveTintColor: colors.primary,
                    tabBarInactiveTintColor: '#555',
                    tabBarStyle: {
                        backgroundColor: colors.background,
                        borderTopColor: colors.cardBorder,
                        borderTopWidth: 1,
                        paddingBottom: Platform.OS === 'android' ? 35 : 5,
                        paddingTop: 5,
                        height: Platform.OS === 'android' ? 95 : 65,
                    },
                    tabBarLabelStyle: {
                        fontSize: 10,
                        fontWeight: '600',
                        marginTop: 2,
                    },
                    // Icona: usa il nome Lucide dal DB
                    tabBarIcon: ({ focused, color }) => (
                        <LucideIcon
                            name={section?.icon ?? null}
                            size={22}
                            color={color}
                        />
                    ),
                    // Label: usa il title dal DB (già breve)
                    tabBarLabel: section?.title ?? route.name,
                }
            }}
        >
            {visibleTabs.map((section) => (
                <Tab.Screen
                    key={section.id}
                    name={section.id}
                    component={SCREEN_MAP[section.id] ?? ComingSoonScreen}
                />
            ))}

            {hiddenTabs.length > 0 && (
                <Tab.Screen
                    name="more"
                    options={{
                        tabBarLabel: 'Altro',
                        tabBarIcon: ({ color }) => (
                            <LucideIcon name="ellipsis" size={22} color={color} />
                        ),
                    }}
                    listeners={{
                        tabPress: (e) => {
                            if (isMoreTabActiveRef.current) {
                                e.preventDefault()
                                navigation.navigate(previousTab as never)
                            }
                        },
                    }}
                >
                    {() => (
                        <MoreTabScreen
                            sections={hiddenTabs}
                            onSectionPress={handleSectionPress}
                            previousTab={previousTab}
                        />
                    )}
                </Tab.Screen>
            )}
        </Tab.Navigator>
    )
}
