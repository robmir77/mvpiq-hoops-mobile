import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';

import HomeScreen from '../../features/home/screens/HomeScreen';
import GoalsScreen from '../../features/goals/screens/GoalsScreen';
import CvScreen from '../../features/cv/screens/CvScreen';
import PositionsScreen from '../../features/positions/screens/PositionsScreen';
import ProfileNavigator from '../../features/profile/navigation/ProfileNavigator';
import TrainingScreen from '../../features/training/screens/TrainingScreen';
import RankingScreen from '../../features/ranking/screens/RankingScreen';

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

                    if (route.name === 'Goals') {
                        return (
                            <MaterialCommunityIcons
                                name="target"
                                size={size}
                                color={color}
                            />
                        );
                    }

                    if (route.name === 'Training') {
                        return (
                            <MaterialCommunityIcons
                                name="dumbbell"
                                size={size}
                                color={color}
                            />
                        );
                    }

                    if (route.name === 'Ranking') {
                        return <Ionicons name="trophy" size={size} color={color} />;
                    }

                    if (route.name === 'CV') {
                        return (
                            <MaterialCommunityIcons
                                name="file-document-outline"
                                size={size}
                                color={color}
                            />
                        );
                    }

                    if (route.name === 'Positions') {
                        return (
                            <MaterialCommunityIcons
                                name="basketball"
                                size={size}
                                color={color}
                            />
                        );
                    }

                    if (route.name === 'Profile') {
                        return <Ionicons name="person" size={size} color={color} />;
                    }

                    return null;
                },
            })}
        >
            <Tab.Screen name="Home" component={HomeScreen} />
            <Tab.Screen name="Goals" component={GoalsScreen} />
            <Tab.Screen name="Training" component={TrainingScreen} />
            <Tab.Screen name="Ranking" component={RankingScreen} />
            <Tab.Screen name="CV" component={CvScreen} />
            <Tab.Screen name="Positions" component={PositionsScreen} />
            <Tab.Screen name="Profile" component={ProfileNavigator} />
        </Tab.Navigator>
    );
}