// src/features/workouts/navigation/WorkoutNavigator.tsx

import React from 'react'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import WorkoutHomeScreen from '../screens/WorkoutHomeScreen'
import WorkoutSetupScreen from '../screens/WorkoutSetupScreen'
import CalibrationScreen from '../screens/CalibrationScreen'
import WorkoutSessionScreen from '../screens/WorkoutSessionScreen'
import ShotChartScreen from '../screens/ShotChartScreen'
import StatsScreen from '../screens/StatsScreen'
import { CameraMode } from '../types/workouts.types'

export type WorkoutStackParamList = {
    WorkoutHome:    undefined
    WorkoutSetup:   undefined
    // cameraMode passato a Calibration E a WorkoutSession per il debug overlay
    Calibration:    { sessionId: string; cameraMode: CameraMode }
    WorkoutSession: { sessionId: string; cameraMode: CameraMode }
    ShotChart:      { sessionId: string; fromSession?: boolean }
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
                options={{ headerShown: false }}
            />
            <Stack.Screen
                name="WorkoutSession"
                component={WorkoutSessionScreen}
                options={{ headerShown: false }}
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
