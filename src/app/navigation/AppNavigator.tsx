//C:\MVPiQHoopsMobile\src\app\navigation\AppNavigator.tsx

import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { useContext } from 'react'
import { AuthContext } from '@/features/auth/context/AuthContext'

import MainNavigator from './MainNavigator'
import LoginScreen from '@/features/auth/screens/LoginScreen'
import EditProfileScreen from '@/features/profile/screens/EditProfileScreen'
import EditCvScreen from '@/features/cv/screens/EditCvScreen'

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
                        options={{ title: 'Curriculum Sportivo' }}
                    />
                </>
            ) : (
                <Stack.Screen
                    name="Login"
                    component={LoginScreen}
                    options={{ headerShown: false }}
                />
            )}
        </Stack.Navigator>
    )
}