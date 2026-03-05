import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';

import HomeScreen from '../../features/home/screens/HomeScreen';
import TrainingScreen from '../../features/training/screens/TrainingScreen';
import RankingScreen from '../../features/ranking/screens/RankingScreen';
import ProfileScreen from '../../features/profile/screens/ProfileScreen';
import JournalNavigator from '../../features/journal/navigation/JournalNavigator';

const Tab = createBottomTabNavigator();

export default function MainNavigator() {
    return (
        <Tab.Navigator
            screenOptions={({ route }) => ({
                headerShown: false,
                tabBarStyle: {
                    backgroundColor: '#0b0f1a',
                    borderTopColor: '#222',
                },
                tabBarActiveTintColor: '#ff8c00',
                tabBarInactiveTintColor: '#aaa',
                tabBarIcon: ({ color, size }) => {
                    if (route.name === 'Home') {
                        return <Ionicons name="home" size={size} color={color} />;
                    }

                    if (route.name === 'Diario') {
                        return (
                            <MaterialCommunityIcons
                                name="notebook-outline"
                                size={size}
                                color={color}
                            />
                        );
                    }

                    if (route.name === 'Training') {
                        return (
                            <MaterialCommunityIcons
                                name="basketball"
                                size={size}
                                color={color}
                            />
                        );
                    }

                    if (route.name === 'Ranking') {
                        return <Ionicons name="trophy" size={size} color={color} />;
                    }

                    if (route.name === 'Profile') {
                        return <Ionicons name="person" size={size} color={color} />;
                    }

                    return null;
                },
            })}
        >
            <Tab.Screen name="Home" component={HomeScreen} />
            <Tab.Screen name="Diario" component={JournalNavigator} />
            <Tab.Screen name="Training" component={TrainingScreen} />
            <Tab.Screen name="Ranking" component={RankingScreen} />
            <Tab.Screen name="Profile" component={ProfileScreen} />
        </Tab.Navigator>
    );
}