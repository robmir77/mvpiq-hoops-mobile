// src/features/profile/navigation/ProfileNavigator.tsx

import React from 'react'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import ProfileScreen from '../screens/ProfileScreen'
import EditProfileScreen from '../screens/EditProfileScreen'

const Stack = createNativeStackNavigator()

export type ProfileStackParamList = {
    Profile: undefined
    EditProfile: { playerId: string }
}

export default function ProfileNavigator() {
    return (
        <Stack.Navigator
            screenOptions={{
                headerShown: false,
            }}
        >
            <Stack.Screen name="Profile" component={ProfileScreen} />
            <Stack.Screen name="EditProfile" component={EditProfileScreen} />
        </Stack.Navigator>
    )
}
