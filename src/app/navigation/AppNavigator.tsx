//C:\MVPiQHoopsMobile\src\app\navigation\AppNavigator.tsx

import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { useContext } from 'react'
import { AuthContext } from '@/features/auth/context/AuthContext'

import MainNavigator from './MainNavigator'
import AuthNavigator from './AuthNavigator'
import EditProfileScreen from '@/features/profile/screens/EditProfileScreen'
import EditCvScreen from '@/features/cv/screens/EditCvScreen'
import GoalWizardScreen from '@/features/goals/screens/GoalWizardScreen'

// Import screen components per le sezioni di navigazione
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
import { View, Text } from "react-native"

const Stack = createNativeStackNavigator()

export default function AppNavigator() {
    const auth = useContext(AuthContext)

    if (!auth) {
        return null
    }

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

                    {/* Screen per le sezioni di navigazione */}
                    <Stack.Screen
                        name="home"
                        component={HomeScreen}
                        options={{ headerShown: false }}
                    />
                    <Stack.Screen
                        name="profile"
                        component={ProfileScreen}
                        options={{ headerShown: false }}
                    />
                    <Stack.Screen
                        name="player_profile"
                        component={ProfileScreen}
                        options={{ headerShown: false }}
                    />
                    <Stack.Screen
                        name="player_cv"
                        component={CvScreen}
                        options={{ headerShown: false }}
                    />
                    <Stack.Screen
                        name="player_goals"
                        component={GoalsScreen}
                        options={{ headerShown: false }}
                    />
                    <Stack.Screen
                        name="player_journal"
                        component={JournalNavigator}
                        options={{ headerShown: false }}
                    />
                    <Stack.Screen
                        name="player_training"
                        component={AiTrainingNavigator}
                        options={{ headerShown: false }}
                    />
                    <Stack.Screen
                        name="player_workouts"
                        component={WorkoutNavigator}
                        options={{ headerShown: false }}
                    />
                    <Stack.Screen
                        name="ai_training_tools"
                        component={AiTrainingNavigator}
                        options={{ headerShown: false }}
                    />
                    <Stack.Screen
                        name="scout_rankings"
                        component={RankingScreen}
                        options={{ headerShown: false }}
                    />
                    <Stack.Screen
                        name="trainer_ai"
                        component={AiTrainingNavigator}
                        options={{ headerShown: false }}
                    />
                    <Stack.Screen
                        name="admin_checklist"
                        component={ChecklistTemplatesNavigator}
                        options={{ headerShown: false }}
                    />
                    <Stack.Screen
                        name="messages"
                        component={MessagingHomeScreen}
                        options={{ headerShown: false }}
                    />
                    <Stack.Screen
                        name="notifications"
                        component={NotificationsScreen}
                        options={{ headerShown: false }}
                    />
                    <Stack.Screen
                        name="admin_notifications"
                        component={NotificationsScreen}
                        options={{ headerShown: false }}
                    />
                    <Stack.Screen
                        name="admin_users"
                        component={OnlineUsersScreen}
                        options={{ headerShown: false }}
                    />
                    <Stack.Screen
                        name="settings"
                        component={() => (
                            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0b0f1a' }}>
                                <Text style={{ color: '#fff', fontSize: 18, fontWeight: 'bold' }}>Impostazioni</Text>
                            </View>
                        )}
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
                            headerShown: true
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