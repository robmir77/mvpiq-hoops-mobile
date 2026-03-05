import React from 'react'
import { View, Text } from 'react-native'

export default function ProfileInfoCard({ profile }: any) {
    return (
        <View
            style={{
                marginHorizontal: 16,
                padding: 16,
                borderRadius: 12,
                backgroundColor: '#f4f4f4',
                marginBottom: 16,
            }}
        >
            <Text>📍 {profile?.city}, {profile?.country}</Text>
            <Text>📏 {profile?.height_cm} cm</Text>
            <Text>⚖️ {profile?.weight_kg} kg</Text>
            <Text>✋ {profile?.dominant_hand}</Text>
        </View>
    )
}