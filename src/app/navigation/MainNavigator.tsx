import React, { useContext } from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';

import HomeScreen from '../../features/home/screens/HomeScreen';
import GoalsScreen from '../../features/goals/screens/GoalsScreen';
import CvScreen from '../../features/cv/screens/CvScreen';
import ProfileNavigator from '../../features/profile/navigation/ProfileNavigator';
import AiTrainingNavigator from '../../features/ai-training/navigation/AiTrainingNavigator';
import RankingScreen from '../../features/ranking/screens/RankingScreen';
import NotificationsScreen from '../../features/notifications/screens/NotificationsScreen';
import { BadgeIcon } from '@/shared/components/BadgeIcon';
import { AuthContext } from '@/features/auth/context/AuthContext';
import { useUnreadNotificationsCount } from '@/features/notifications/hooks/useNotifications';

const Tab = createBottomTabNavigator();

const TabNavigatorWithNotifications = () => {
    const auth = useContext(AuthContext);
    const { data: unreadCount } = useUnreadNotificationsCount(auth?.user?.id);

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
                tabBarLabelStyle: {
                    fontSize: 12,
                    fontWeight: '600',
                },
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
                                name="robot"
                                size={size}
                                color={color}
                            />
                        );
                    }

                    if (route.name === 'Ranking') {
                        return <Ionicons name="trophy" size={size} color={color} />;
                    }

                    if (route.name === 'Notifications') {
                        return (
                            <BadgeIcon
                                name="notifications"
                                size={size}
                                color={color}
                                badgeCount={unreadCount?.count}
                                iconType="ionicons"
                            />
                        );
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

                    
                    if (route.name === 'Profile') {
                        return <Ionicons name="person" size={size} color={color} />;
                    }

                    return null;
                },
            })}
        >
            <Tab.Screen 
                name="Home" 
                component={HomeScreen}
                options={{ tabBarLabel: 'Home' }}
            />
            <Tab.Screen 
                name="Goals" 
                component={GoalsScreen}
                options={{ tabBarLabel: 'Goals' }}
            />
            <Tab.Screen 
                name="Training" 
                component={AiTrainingNavigator}
                options={{ tabBarLabel: 'AI Training' }}
            />
            <Tab.Screen 
                name="Ranking" 
                component={RankingScreen}
                options={{ tabBarLabel: 'Ranking' }}
            />
            <Tab.Screen 
                name="Notifications" 
                component={NotificationsScreen}
                options={{ tabBarLabel: 'Notifications' }}
            />
            <Tab.Screen 
                name="CV" 
                component={CvScreen}
                options={{ tabBarLabel: 'CV' }}
            />
            <Tab.Screen 
                name="Profile" 
                component={ProfileNavigator}
                options={{ tabBarLabel: 'Profile' }}
            />
        </Tab.Navigator>
    );
};

export default function MainNavigator() {
    return <TabNavigatorWithNotifications />;
}