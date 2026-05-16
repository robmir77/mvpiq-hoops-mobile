// src/features/ai-training/navigation/AiTrainingNavigator.tsx

import React from 'react'
import { createNativeStackNavigator } from '@react-navigation/native-stack'

import AiTrainingGeneratorScreen from '../screens/AiTrainingGeneratorScreen'
import AiTrainingProgramScreen from '../screens/AiTrainingProgramScreen'

const Stack = createNativeStackNavigator()

export default function AiTrainingNavigator() {
    return (
        <Stack.Navigator
            screenOptions={{
                headerStyle: { backgroundColor: '#0b0f1a' },
                headerTintColor: '#fff',
            }}
        >
            <Stack.Screen 
                name="AiTrainingGenerator" 
                component={AiTrainingGeneratorScreen} 
                options={{ title: 'AI Training Generator' }}
            />
            <Stack.Screen 
                name="AiTrainingProgram" 
                component={AiTrainingProgramScreen} 
                options={{ title: 'Training Program' }}
            />
        </Stack.Navigator>
    )
}
