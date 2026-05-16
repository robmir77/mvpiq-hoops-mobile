import React from 'react'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import JournalHomeScreen from '../screens/JournalHomeScreen'
import JournalCreateScreen from '../screens/JournalCreateScreen'
import JournalDetailScreen from '../screens/JournalDetailScreen'

export type JournalStackParamList = {
    JournalHome: undefined
    JournalCreate: { entryType: 'MATCH' | 'TRAINING' }
    JournalDetail: { id: string }
}

const Stack = createNativeStackNavigator<JournalStackParamList>()

export default function JournalNavigator() {
    return (
        <Stack.Navigator screenOptions={{
            headerStyle: { backgroundColor: '#0b0f1a' },
            headerTintColor: '#fff',
        }}>
            <Stack.Screen name="JournalHome" component={JournalHomeScreen} />
            <Stack.Screen name="JournalCreate" component={JournalCreateScreen} />
            <Stack.Screen name="JournalDetail" component={JournalDetailScreen} />
        </Stack.Navigator>
    )
}