// src/features/profile/navigation/ProfileNavigator.tsx

import React from 'react'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import ProfileScreen from '../screens/ProfileScreen'
import EditProfileScreen from '../screens/EditProfileScreen'
import EditCvScreen from '@/features/cv/screens/EditCvScreen'

const Stack = createNativeStackNavigator()

export type ProfileStackParamList = {
    UserProfile: undefined
    EditProfile: { playerId: string }
    EditCv: { playerId: string }
}

export default function ProfileNavigator() {
    return (
        <Stack.Navigator
            screenOptions={{
                headerShown: false,
            }}
        >
            <Stack.Screen name="UserProfile" component={ProfileScreen} />
            <Stack.Screen name="EditProfile" component={EditProfileScreen} />
            <Stack.Screen name="EditCv" component={EditCvScreen} />
        </Stack.Navigator>
    )
}
