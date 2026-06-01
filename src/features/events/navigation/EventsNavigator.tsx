import React from 'react'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import EventsHomeScreen from '../screens/EventsHomeScreen'
import EventDetailScreen from '../screens/EventDetailScreen'
import EventCreateScreen from '../screens/EventCreateScreen'

export type EventsStackParamList = {
    EventsHome: undefined
    EventDetail: { id: string }
    EventCreate: { eventId?: string } | undefined
}

const Stack = createNativeStackNavigator<EventsStackParamList>()

export default function EventsNavigator() {
    return (
        <Stack.Navigator
            screenOptions={{
                headerStyle: { backgroundColor: '#0b0f1a' },
                headerTintColor: '#fff',
            }}
        >
            <Stack.Screen
                name="EventsHome"
                component={EventsHomeScreen}
                options={{ headerShown: false }}
            />
            <Stack.Screen
                name="EventDetail"
                component={EventDetailScreen}
                options={{ title: 'Dettaglio evento' }}
            />
            <Stack.Screen
                name="EventCreate"
                component={EventCreateScreen}
                options={({ route }) => ({
                    title: route.params?.eventId ? 'Modifica evento' : 'Nuovo evento',
                })}
            />
        </Stack.Navigator>
    )
}
