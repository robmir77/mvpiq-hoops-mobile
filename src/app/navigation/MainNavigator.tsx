import React, { useContext } from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';

import { DynamicTabNavigator } from '@/features/navigation/components/DynamicTabNavigator';
import { AuthContext } from '@/features/auth/context/AuthContext';

export default function MainNavigator() {
    return <DynamicTabNavigator />;
}