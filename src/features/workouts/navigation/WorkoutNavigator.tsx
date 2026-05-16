import React from 'react'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import WorkoutHomeScreen from '../screens/WorkoutHomeScreen'
import WorkoutSetupScreen from '../screens/WorkoutSetupScreen'
import CalibrationScreen from '../screens/CalibrationScreen'
import WorkoutSessionScreen from '../screens/WorkoutSessionScreen'
import ShotChartScreen from '../screens/ShotChartScreen'
import StatsScreen from '../screens/StatsScreen'

export type WorkoutStackParamList = {
    WorkoutHome: undefined
    WorkoutSetup: undefined
    Calibration: { sessionId: string; cameraMode?: string }
    WorkoutSession: { sessionId: string }
    ShotChart: { sessionId: string }
    Stats: { sessionId: string }
}

const Stack = createNativeStackNavigator<WorkoutStackParamList>()

export default function WorkoutNavigator() {
    return (
        <Stack.Navigator screenOptions={{
            headerStyle: { backgroundColor: '#0b0f1a' },
            headerTintColor: '#fff',
        }}>
            <Stack.Screen name="WorkoutHome" component={WorkoutHomeScreen} />
            <Stack.Screen name="WorkoutSetup" component={WorkoutSetupScreen} />
            <Stack.Screen name="Calibration" component={CalibrationScreen} />
            <Stack.Screen name="WorkoutSession" component={WorkoutSessionScreen} />
            <Stack.Screen name="ShotChart" component={ShotChartScreen} />
            <Stack.Screen name="Stats" component={StatsScreen} />
        </Stack.Navigator>
    )
}
