import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { useContext } from 'react'
import { Text, View } from 'react-native'
import { AuthContext } from '@/features/auth/context/AuthContext'
import { colors } from '@/shared/theme/colors'

import MainNavigator from './MainNavigator'
import AuthNavigator from './AuthNavigator'
import EditProfileScreen from '@/features/profile/screens/EditProfileScreen'
import EditCvScreen from '@/features/cv/screens/EditCvScreen'
import GoalWizardScreen from '@/features/goals/screens/GoalWizardScreen'
import ChatScreen from '@/features/messaging/screens/ChatScreen'
import NewChatScreen from '@/features/messaging/screens/NewChatScreen'
import MessagingHomeScreen from '@/features/messaging/screens/MessagingHomeScreen'
import NotificationsScreen from '@/features/notifications/screens/NotificationsScreen'
import HomeScreen from '@/features/home/screens/HomeScreen'
import ProfileScreen from '@/features/profile/screens/ProfileScreen'
import GoalsScreen from '@/features/goals/screens/GoalsScreen'
import CvScreen from '@/features/cv/screens/CvScreen'
import RankingScreen from '@/features/ranking/screens/RankingScreen'
import OnlineUsersScreen from '@/features/users/screens/OnlineUsersScreen'
import AiTrainingNavigator from '@/features/ai-training/navigation/AiTrainingNavigator'
import JournalNavigator from '@/features/journal/navigation/JournalNavigator'
import WorkoutNavigator from '@/features/workouts/navigation/WorkoutNavigator'
import ChecklistTemplatesNavigator from '@/features/checklist-templates/navigation/ChecklistTemplatesNavigator'

// Placeholder components for screens not yet implemented
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

const StatsPlaceholder = makePlaceholder('Statistiche')
const ScoutSearchScreen = makePlaceholder('Ricerca Atleti')
const TrainerProgramsScreen = makePlaceholder('Programmi')
const TrainerClientsScreen = makePlaceholder('Clienti')
const TrainerExercisesScreen = makePlaceholder('Esercizi')
const CreatorContentScreen = makePlaceholder('Contenuti')
const CreatorTemplatesScreen = makePlaceholder('Template')
const CreatorAnalyticsScreen = makePlaceholder('Analytics')
const AdminSubscriptionsScreen = makePlaceholder('Abbonamenti')
const AdminGamificationScreen = makePlaceholder('Gamification')
const MediaScreen = makePlaceholder('Media')
const SettingsScreen = makePlaceholder('Impostazioni')
const VideoAnalysisScreen = makePlaceholder('Analisi Video')
const LiveShotTrackingScreen = makePlaceholder('Conteggio Live')
const ComingSoonScreen = makePlaceholder('Coming Soon')

const Stack = createNativeStackNavigator()

export default function AppNavigator() {
    const auth = useContext(AuthContext)

    if (!auth) return null

    const { user } = auth

    return (
        <Stack.Navigator>
            {user ? (
                <>
                    <Stack.Screen
                        name="Main"
                        component={MainNavigator}
                        options={{ headerShown: false }}
                    />

                    <Stack.Screen
                        name="EditProfile"
                        component={EditProfileScreen}
                        options={{
                            title: 'Modifica Profilo',
                            headerStyle: { backgroundColor: '#0b0f1a' },
                            headerTintColor: '#fff',
                        }}
                    />

                    <Stack.Screen
                        name="EditCv"
                        component={EditCvScreen}
                        options={{
                            title: 'Curriculum Sportivo',
                            headerStyle: { backgroundColor: '#0b0f1a' },
                            headerTintColor: '#fff',
                        }}
                    />

                    <Stack.Screen
                        name="GoalWizard"
                        component={GoalWizardScreen}
                        options={{
                            title: 'Imposta i tuoi obiettivi',
                            headerStyle: { backgroundColor: '#0b0f1a' },
                            headerTintColor: '#fff',
                            headerShown: true,
                        }}
                    />

                    <Stack.Screen
                        name="ChatScreen"
                        component={ChatScreen}
                        options={{
                            headerShown: false,
                        }}
                    />

                    <Stack.Screen
                        name="NewChat"
                        component={NewChatScreen}
                        options={{
                            title: 'Nuova conversazione',
                            headerStyle: { backgroundColor: '#0b0f1a' },
                            headerTintColor: '#fff',
                        }}
                    />

                    <Stack.Screen
                        name="messages"
                        component={MessagingHomeScreen}
                        options={{
                            headerShown: false,
                        }}
                    />

                    <Stack.Screen
                        name="notifications"
                        component={NotificationsScreen}
                        options={{
                            headerShown: false,
                        }}
                    />

                    <Stack.Screen
                        name="home"
                        component={HomeScreen}
                        options={{
                            headerShown: false,
                        }}
                    />

                    <Stack.Screen
                        name="profile"
                        component={ProfileScreen}
                        options={{
                            headerShown: false,
                        }}
                    />

                    <Stack.Screen
                        name="player_profile"
                        component={ProfileScreen}
                        options={{
                            headerShown: false,
                        }}
                    />

                    <Stack.Screen
                        name="player_goals"
                        component={GoalsScreen}
                        options={{
                            headerShown: false,
                        }}
                    />

                    <Stack.Screen
                        name="player_cv"
                        component={CvScreen}
                        options={{
                            headerShown: false,
                        }}
                    />

                    <Stack.Screen
                        name="scout_rankings"
                        component={RankingScreen}
                        options={{
                            headerShown: false,
                        }}
                    />

                    <Stack.Screen
                        name="admin_users"
                        component={OnlineUsersScreen}
                        options={{
                            headerShown: false,
                        }}
                    />

                    <Stack.Screen
                        name="player_journal"
                        component={JournalNavigator}
                        options={{
                            headerShown: false,
                        }}
                    />

                    <Stack.Screen
                        name="player_training"
                        component={AiTrainingNavigator}
                        options={{
                            headerShown: false,
                        }}
                    />

                    <Stack.Screen
                        name="player_workouts"
                        component={WorkoutNavigator}
                        options={{
                            headerShown: false,
                        }}
                    />

                    <Stack.Screen
                        name="ai_training_tools"
                        component={AiTrainingNavigator}
                        options={{
                            headerShown: false,
                        }}
                    />

                    <Stack.Screen
                        name="trainer_ai"
                        component={AiTrainingNavigator}
                        options={{
                            headerShown: false,
                        }}
                    />

                    <Stack.Screen
                        name="admin_checklist"
                        component={ChecklistTemplatesNavigator}
                        options={{
                            headerShown: false,
                        }}
                    />

                    <Stack.Screen
                        name="player_stats"
                        component={StatsPlaceholder}
                        options={{
                            headerShown: false,
                        }}
                    />

                    <Stack.Screen
                        name="player_media"
                        component={MediaScreen}
                        options={{
                            headerShown: false,
                        }}
                    />

                    <Stack.Screen
                        name="scout_search"
                        component={ScoutSearchScreen}
                        options={{
                            headerShown: false,
                        }}
                    />

                    <Stack.Screen
                        name="scout_reports"
                        component={ComingSoonScreen}
                        options={{
                            headerShown: false,
                        }}
                    />

                    <Stack.Screen
                        name="trainer_programs"
                        component={TrainerProgramsScreen}
                        options={{
                            headerShown: false,
                        }}
                    />

                    <Stack.Screen
                        name="trainer_clients"
                        component={TrainerClientsScreen}
                        options={{
                            headerShown: false,
                        }}
                    />

                    <Stack.Screen
                        name="trainer_exercises"
                        component={TrainerExercisesScreen}
                        options={{
                            headerShown: false,
                        }}
                    />

                    <Stack.Screen
                        name="creator_content"
                        component={CreatorContentScreen}
                        options={{
                            headerShown: false,
                        }}
                    />

                    <Stack.Screen
                        name="creator_templates"
                        component={CreatorTemplatesScreen}
                        options={{
                            headerShown: false,
                        }}
                    />

                    <Stack.Screen
                        name="creator_analytics"
                        component={CreatorAnalyticsScreen}
                        options={{
                            headerShown: false,
                        }}
                    />

                    <Stack.Screen
                        name="admin_subscriptions"
                        component={AdminSubscriptionsScreen}
                        options={{
                            headerShown: false,
                        }}
                    />

                    <Stack.Screen
                        name="admin_gamification"
                        component={AdminGamificationScreen}
                        options={{
                            headerShown: false,
                        }}
                    />

                    <Stack.Screen
                        name="admin_notifications"
                        component={NotificationsScreen}
                        options={{
                            headerShown: false,
                        }}
                    />

                    <Stack.Screen
                        name="settings"
                        component={SettingsScreen}
                        options={{
                            headerShown: false,
                        }}
                    />

                    <Stack.Screen
                        name="video_analysis"
                        component={VideoAnalysisScreen}
                        options={{
                            headerShown: false,
                        }}
                    />

                    <Stack.Screen
                        name="live_shot_tracking"
                        component={LiveShotTrackingScreen}
                        options={{
                            headerShown: false,
                        }}
                    />
                </>
            ) : (
                <Stack.Screen
                    name="Auth"
                    component={AuthNavigator}
                    options={{ headerShown: false }}
                />
            )}
        </Stack.Navigator>
    )
}
