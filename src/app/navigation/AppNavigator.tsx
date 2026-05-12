//C:\MVPiQHoopsMobile\src\app\navigation\AppNavigator.tsx

import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { useContext } from 'react'
import { AuthContext } from '@/features/auth/context/AuthContext'

import MainNavigator from './MainNavigator'
import AuthNavigator from './AuthNavigator'
import EditProfileScreen from '@/features/profile/screens/EditProfileScreen'
import EditCvScreen from '@/features/cv/screens/EditCvScreen'
import GoalWizardScreen from '@/features/goals/screens/GoalWizardScreen'

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