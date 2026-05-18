// src/features/workouts/navigation/WorkoutNavigator.tsx

import React from 'react'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import WorkoutHomeScreen from '../screens/WorkoutHomeScreen'
import WorkoutSetupScreen from '../screens/WorkoutSetupScreen'
import CalibrationScreen from '../screens/CalibrationScreen'
import WorkoutSessionScreen from '../screens/WorkoutSessionScreen'
import ShotChartScreen from '../screens/ShotChartScreen'
import StatsScreen from '../screens/StatsScreen'

export type WorkoutStackParamList = {
    WorkoutHome:    undefined
    WorkoutSetup:   undefined
    Calibration:    { sessionId: string; cameraMode?: string }
    WorkoutSession: { sessionId: string }
    ShotChart:      { sessionId: string }
    Stats:          { sessionId: string }
}

const Stack = createNativeStackNavigator<WorkoutStackParamList>()

export default function WorkoutNavigator() {
    return (
        <Stack.Navigator
            screenOptions={{
                headerStyle: { backgroundColor: '#0b0f1a' },
                headerTintColor: '#fff',
                headerTitleStyle: { fontWeight: '700' },
                contentStyle: { backgroundColor: '#0b0f1a' },
            }}
        >
            <Stack.Screen
                name="WorkoutHome"
                component={WorkoutHomeScreen}
                options={{ title: 'Allenamenti Tiro' }}
            />
            <Stack.Screen
                name="WorkoutSetup"
                component={WorkoutSetupScreen}
                options={{ title: 'Nuovo Allenamento' }}
            />
            <Stack.Screen
                name="Calibration"
                component={CalibrationScreen}
                options={{ title: 'Calibrazione Campo', headerShown: false }}
            />
            <Stack.Screen
                name="WorkoutSession"
                component={WorkoutSessionScreen}
                options={{ title: 'Sessione', headerShown: false }}
            />
            <Stack.Screen
                name="ShotChart"
                component={ShotChartScreen}
                options={{ title: 'Shot Chart' }}
            />
            <Stack.Screen
                name="Stats"
                component={StatsScreen}
                options={{ title: 'Statistiche' }}
            />
        </Stack.Navigator>
    )
}
