// src/features/navigation/components/DynamicTabNavigator.tsx

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Text, View, Platform, TouchableOpacity, ScrollView } from 'react-native'
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import { useNavigation, useNavigationState, useFocusEffect } from '@react-navigation/native'
import * as LucideIcons from 'lucide-react-native'

import { useNavigationSections } from '../hooks/useNavigationSections'
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

// ─── Icona Lucide dinamica ────────────────────────────────────
// Il DB salva nomi kebab-case (es. "notebook-pen").
// Lucide esporta PascalCase (es. "NotebookPen").
// Convertiamo al volo senza mappe hardcoded.
const toPascalCase = (kebab: string): string =>
    kebab.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('')

interface LucideIconProps {
    name: string | null
    size?: number
    color?: string
}

const LucideIcon: React.FC<LucideIconProps> = ({ name, size = 22, color = '#888' }) => {
    if (!name) return <Text style={{ fontSize: size - 2 }}>📱</Text>
    const Icon = (LucideIcons as any)[toPascalCase(name)]
    if (!Icon) {
        console.warn(`[Nav] Lucide icon not found: "${name}"`)
        return <Text style={{ fontSize: size - 2 }}>📱</Text>
    }
    return <Icon size={size} color={color} strokeWidth={2} />
}

// ─── Placeholder stabili ──────────────────────────────────────
// REGOLA CRITICA: mai definire componenti inline dentro render()
// o dentro un Record dinamico. React Navigation crea un nuovo
// componente a ogni render → smonta e rimonta il tab continuamente.
// Tutti i placeholder devono essere istanziati UNA VOLTA qui.

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

const StatsScreen              = makePlaceholder('Statistiche')
const ScoutSearchScreen        = makePlaceholder('Ricerca Atleti')
const ScoutReportsScreen       = makePlaceholder('Report Scout')
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
const ComingSoonScreen         = makePlaceholder('Coming Soon')

// ─── Mappa section_key → componente ──────────────────────────
// Tutte referenze STABILI (mai arrow functions inline).
const SCREEN_MAP: Record<string, React.ComponentType<any>> = {
    home:                HomeScreen,
    profile:             ProfileScreen,
    player_profile:      ProfileScreen,
    player_stats:        StatsScreen,
    player_goals:        GoalsScreen,
    player_journal:      JournalNavigator,
    player_training:     AiTrainingNavigator,
    player_workouts:     WorkoutNavigator,
    player_media:        MediaScreen,
    player_cv:           CvScreen,
    ai_training_tools:   AiTrainingNavigator,
    scout_search:        ScoutSearchScreen,
    scout_rankings:      RankingScreen,
    scout_reports:       ScoutReportsScreen,
    trainer_programs:    TrainerProgramsScreen,
    trainer_clients:     TrainerClientsScreen,
    trainer_exercises:   TrainerExercisesScreen,
    trainer_ai:          AiTrainingNavigator,
    creator_content:     CreatorContentScreen,
    creator_templates:   CreatorTemplatesScreen,
    creator_analytics:   CreatorAnalyticsScreen,
    admin_users:         OnlineUsersScreen,
    admin_subscriptions: AdminSubscriptionsScreen,
    admin_gamification:  AdminGamificationScreen,
    admin_notifications: NotificationsScreen,
    admin_checklist:     ChecklistTemplatesNavigator,
    messages:            MessagingHomeScreen,
    notifications:       NotificationsScreen,
    settings:            SettingsScreen,
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

    // Se l'utente clicca "Altro" quando è già aperto, torna al tab precedente
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
                            padding: 14,
                            marginBottom: 10,
                            flexDirection: 'row',
                            alignItems: 'center',
                            borderWidth: 1,
                            borderColor: colors.cardBorder,
                        }}
                        onPress={() => onSectionPress(section)}
                        activeOpacity={0.7}
                    >
                        <View style={{
                            width: 40,
                            height: 40,
                            borderRadius: 10,
                            backgroundColor: 'rgba(255,140,0,0.1)',
                            justifyContent: 'center',
                            alignItems: 'center',
                            marginRight: 14,
                        }}>
                            <LucideIcon
                                name={section.icon}
                                size={22}
                                color={section.iconColor ?? colors.primary}
                            />
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
                        <Text style={{ fontSize: 20, color: colors.primary }}>›</Text>
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
    icon: 'house',
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
        ...accessibleSections.filter(s => s.id !== 'home'),
    ].sort((a, b) => {
        if (a.id === 'home') return -1
        if (b.id === 'home') return 1
        return a.sortOrder - b.sortOrder
    })

    const visibleTabs = allTabs.slice(0, MAX_VISIBLE_TABS)
    const hiddenTabs  = allTabs.slice(MAX_VISIBLE_TABS)

    const handleSectionPress = (section: NavigationSection) => {
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
                    // Icona: nome Lucide direttamente dal DB, nessuna mappa hardcoded
                    tabBarIcon: ({ focused, color }) => (
                        <LucideIcon
                            name={section?.icon ?? null}
                            size={22}
                            color={focused ? (section?.iconColor ?? colors.primary) : '#555'}
                        />
                    ),
                    // Label: title dal DB
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
