import React from 'react'
import { View, Text, Image } from 'react-native'

export default function ProfileHeader({ profile }: any) {
    return (
        <View style={{ alignItems: 'center', padding: 20 }}>
            <Image
                source={{ uri: profile?.avatar_url }}
                style={{
                    width: 100,
                    height: 100,
                    borderRadius: 50,
                    marginBottom: 10,
                    backgroundColor: '#ddd',
                }}
            />

            <Text style={{ fontSize: 20, fontWeight: 'bold' }}>
                {profile?.full_name}
            </Text>

            <Text style={{ color: '#666' }}>
                {profile?.main_position} • {profile?.level}
            </Text>
        </View>
    )
}