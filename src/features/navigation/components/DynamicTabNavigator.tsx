// src/features/navigation/components/DynamicTabNavigator.tsx

import React from 'react'
import { Text, View, Platform } from 'react-native'
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import { useNavigationSections } from '../hooks/useNavigationSections'
import { NavigationSection } from '@/features/auth/types/auth.types'

// Import delle schermate
import HomeScreen from '@/features/home/screens/HomeScreen'
import ProfileScreen from '@/features/profile/screens/ProfileScreen'
import CvScreen from '@/features/cv/screens/CvScreen'
import NotificationsScreen from '@/features/notifications/screens/NotificationsScreen'
import GoalsScreen from '@/features/goals/screens/GoalsScreen'
import AiTrainingNavigator from '@/features/ai-training/navigation/AiTrainingNavigator'
import JournalHomeScreen from '@/features/journal/screens/JournalHomeScreen'
import JournalNavigator from '@/features/journal/navigation/JournalNavigator'
import RankingScreen from '@/features/ranking/screens/RankingScreen'

// Placeholder screens per le varie sezioni
const StatsScreen = () => null
const TrainingScreen = () => null
const ScoutingScreen = () => null
const AdminScreen = () => null

const Tab = createBottomTabNavigator()

export const DynamicTabNavigator: React.FC = () => {
    const { accessibleSections, isLoading } = useNavigationSections()

    const getTabIcon = (sectionId: string, focused: boolean): string => {
        const icons: Record<string, { active: string; inactive: string }> = {
            home: { active: '🏠', inactive: '🏠' },
            profile: { active: '👤', inactive: '👤' },
            player_profile: { active: '👤', inactive: '👤' },
            player_stats: { active: '📊', inactive: '📊' },
            player_goals: { active: '🎯', inactive: '🎯' },
            player_journal: { active: '📝', inactive: '📝' },
            player_training: { active: '🏋️', inactive: '🏋️' },
            player_media: { active: '📸', inactive: '📸' },
            player_cv: { active: '📄', inactive: '📄' },
            scout_search: { active: '🔍', inactive: '🔍' },
            scout_rankings: { active: '🏆', inactive: '🏆' },
            scout_reports: { active: '📋', inactive: '📋' },
            trainer_programs: { active: '📋', inactive: '📋' },
            trainer_clients: { active: '👥', inactive: '👥' },
            trainer_exercises: { active: '💪', inactive: '💪' },
            trainer_ai: { active: '🤖', inactive: '🤖' },
            creator_content: { active: '📝', inactive: '📝' },
            creator_templates: { active: '📋', inactive: '📋' },
            creator_analytics: { active: '📈', inactive: '📈' },
            admin_users: { active: '👥', inactive: '👥' },
            admin_subscriptions: { active: '💳', inactive: '💳' },
            admin_gamification: { active: '🎮', inactive: '🎮' },
            admin_notifications: { active: '🔔', inactive: '🔔' },
            messages: { active: '💬', inactive: '💬' },
            notifications: { active: '🔔', inactive: '🔔' },
            settings: { active: '⚙️', inactive: '⚙️' },
        }
        const iconSet = icons[sectionId]
        return iconSet ? (focused ? iconSet.active : iconSet.inactive) : '📱'
    }

    const getScreenComponent = (sectionId: string) => {
        // Componenti placeholder validi per React Navigation
        const PlaceholderScreen = ({ title }: { title?: string }) => (
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0b0f1a' }}>
                <Text style={{ color: '#fff', fontSize: 18, fontWeight: 'bold' }}>
                    {title || 'Coming Soon'}
                </Text>
            </View>
        )

        const screens: Record<string, React.ComponentType> = {
            home: HomeScreen,
            profile: ProfileScreen,
            player_profile: ProfileScreen,
            player_stats: StatsScreen,
            player_goals: GoalsScreen,
            player_journal: JournalNavigator,
            player_training: AiTrainingNavigator,
            player_media: () => <PlaceholderScreen title="Media" />,
            player_cv: CvScreen,
            scout_search: ScoutingScreen,
            scout_rankings: () => <PlaceholderScreen title="Classifiche Scout" />,
            scout_reports: () => <PlaceholderScreen title="Report Scout" />,
            trainer_programs: () => <PlaceholderScreen title="Programmi Allenatore" />,
            trainer_clients: () => <PlaceholderScreen title="Clienti Allenatore" />,
            trainer_exercises: () => <PlaceholderScreen title="Esercizi Allenatore" />,
            trainer_ai: AiTrainingNavigator,
            creator_content: () => <PlaceholderScreen title="Contenuti Creator" />,
            creator_templates: () => <PlaceholderScreen title="Template Creator" />,
            creator_analytics: () => <PlaceholderScreen title="Analytics Creator" />,
            admin_users: AdminScreen,
            admin_subscriptions: () => <PlaceholderScreen title="Abbonamenti Admin" />,
            admin_gamification: () => <PlaceholderScreen title="Gamification Admin" />,
            admin_notifications: NotificationsScreen,
            messages: () => <PlaceholderScreen title="Messaggi" />,
            notifications: NotificationsScreen,
            settings: () => <PlaceholderScreen title="Impostazioni" />,
        }
        return screens[sectionId] || HomeScreen
    }

    const getTabLabel = (section: NavigationSection, focused: boolean): string => {
        // Label più corta per i tab
        const shortLabels: Record<string, string> = {
            home: 'Home',
            profile: 'Profilo',
            player_profile: 'Profilo',
            player_stats: 'Stats',
            player_goals: 'Goals',
            player_journal: 'Diario',
            player_training: 'Training',
            player_media: 'Media',
            player_cv: 'CV',
            scout_search: 'Ricerca',
            scout_rankings: 'Class.',
            scout_reports: 'Report',
            trainer_programs: 'Programmi',
            trainer_clients: 'Clienti',
            trainer_exercises: 'Esercizi',
            trainer_ai: 'AI',
            creator_content: 'Contenuti',
            creator_templates: 'Template',
            creator_analytics: 'Analytics',
            admin_users: 'Utenti',
            admin_subscriptions: 'Abbon.',
            admin_gamification: 'Game',
            admin_notifications: 'Notif.',
            messages: 'Messaggi',
            notifications: 'Notif.',
            settings: 'Impost.',
        }
        return shortLabels[section.id] || section.title
    }

    if (isLoading) {
        // Potresti mostrare uno splash screen qui
        return null
    }

    // Assicuriamoci che Home sia sempre presente come primo tab
    const tabsWithHome = [
        {
            id: 'home',
            title: 'Home',
            description: 'Pagina principale',
            icon: null,
            accessible: true,
            sortOrder: 0,
        } as NavigationSection,
        ...accessibleSections.filter(section => section.id !== 'home')
    ]

    return (
        <Tab.Navigator
            initialRouteName="home"
            screenOptions={({ route }) => ({
                tabBarIcon: ({ focused, color, size }) => {
                    const section = tabsWithHome.find(s => s.id === route.name)
                    if (!section) return null
                    
                    return (
                        <Text style={{ fontSize: 20 }}>
                            {getTabIcon(section.id, focused)}
                        </Text>
                    )
                },
                tabBarLabel: ({ focused, color }) => {
                    const section = tabsWithHome.find(s => s.id === route.name)
                    if (!section) return ''
                    
                    return getTabLabel(section, focused)
                },
                tabBarActiveTintColor: '#ff8c00',
                tabBarInactiveTintColor: '#888',
                tabBarStyle: {
                    backgroundColor: '#0b0f1a',
                    borderTopColor: '#2a2a2a',
                    borderTopWidth: 1,
                    paddingBottom: Platform.OS === 'android' ? 35 : 5,
                    paddingTop: 5,
                    height: Platform.OS === 'android' ? 95 : 65,
                },
                tabBarLabelStyle: {
                    fontSize: 11,
                    fontWeight: '600',
                },
                headerShown: false,
                // Fix per Android
                unmountOnBlur: false,
                lazy: false,
            })}
        >
            {tabsWithHome.map((section) => {
                const ScreenComponent = getScreenComponent(section.id)
                
                return (
                    <Tab.Screen
                        key={section.id}
                        name={section.id}
                        component={ScreenComponent}
                        options={{
                            tabBarLabel: section.title,
                        }}
                    />
                )
            })}
        </Tab.Navigator>
    )
}
