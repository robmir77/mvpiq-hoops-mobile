import React from 'react'
import { View, Text } from 'react-native'

export default function ProfileStats({ profile }: any) {
    const stats = profile?.cv?.stats || {}

    return (
        <View
            style={{
                marginHorizontal: 16,
                padding: 16,
                borderRadius: 12,
                backgroundColor: '#fff',
                marginBottom: 24,
            }}
        >
            <Text style={{ fontWeight: 'bold', marginBottom: 10 }}>
                📊 Season Stats
            </Text>

            {Object.entries(stats).map(([key, value]) => (
                <View
                    key={key}
                    style={{
                        flexDirection: 'row',
                        justifyContent: 'space-between',
                        marginBottom: 6,
                    }}
                >
                    <Text>{key}</Text>
                    <Text>{String(value)}</Text>
                </View>
            ))}
        </View>
    )
}