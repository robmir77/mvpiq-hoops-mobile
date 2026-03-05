import React from 'react'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import JournalHomeScreen from '../screens/JournalHomeScreen'
import JournalCreateScreen from '../screens/JournalCreateScreen'

export type JournalStackParamList = {
    JournalHome: undefined
    JournalCreate: { entryType: 'MATCH' | 'TRAINING' }
}

const Stack = createNativeStackNavigator<JournalStackParamList>()

export default function JournalNavigator() {
    return (
        <Stack.Navigator screenOptions={{ headerShown: false }}>
            <Stack.Screen name="JournalHome" component={JournalHomeScreen} />
            <Stack.Screen name="JournalCreate" component={JournalCreateScreen} />
        </Stack.Navigator>
    )
}