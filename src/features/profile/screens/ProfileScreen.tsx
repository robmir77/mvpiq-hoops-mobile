// features/profile/screens/ProfileScreen.tsx

import React, { useContext } from 'react'
import {
    View,
    Text,
    ActivityIndicator,
    StyleSheet,
    Image,
    ScrollView,
    TouchableOpacity,
} from 'react-native'
import { useNavigation } from '@react-navigation/native'
import { AuthContext } from '@/features/auth/context/AuthContext'
import { useProfile } from '../hooks/useProfile'

export default function ProfileScreen() {
    const navigation = useNavigation<any>()
    const auth = useContext(AuthContext)

    if (!auth) return null

    const { user } = auth
    const { data, isLoading, isError } = useProfile(user?.id)

    if (isLoading) {
        return (
            <View style={styles.center}>
                <ActivityIndicator size="large" color="#ff8c00" />
            </View>
        )
    }

    if (isError || !data) {
        return (
            <View style={styles.center}>
                <Text style={{ color: 'white' }}>Errore caricamento profilo</Text>
            </View>
        )
    }

    return (
        <ScrollView style={styles.container}>
            {/* Header */}
            <View style={styles.header}>
                <Image
                    source={{
                        uri: data.avatarUrl || 'https://i.pravatar.cc/300',
                    }}
                    style={styles.avatar}
                />

                <Text style={styles.name}>{data.displayName}</Text>

                <Text style={styles.position}>
                    {data.mainPositionLabel
                        ? `${data.mainPositionLabel}${data.level ? ` • ${data.level}` : ''}`
                        : data.level ?? ''}
                </Text>

                {/* Pulsante Edit */}
                <TouchableOpacity
                    style={styles.editButton}
                    onPress={() =>
                        navigation.navigate('EditProfile', { playerId: data.userId })
                    }
                >
                    <Text style={styles.editButtonText}>Modifica Profilo</Text>
                </TouchableOpacity>

                {/* Edit CV */}
                <TouchableOpacity
                    style={styles.editButton}
                    onPress={() =>
                        navigation.navigate('EditCv', { playerId: data.userId })
                    }
                >
                    <Text style={styles.editButtonText}>Modifica CV sportivo</Text>
                </TouchableOpacity>
            </View>

            {/* Stats Card */}
            <View style={styles.card}>
                <View style={styles.statItem}>
                    <Text style={styles.statValue}>{data.heightCm} cm</Text>
                    <Text style={styles.statLabel}>Height</Text>
                </View>

                <View style={styles.statItem}>
                    <Text style={styles.statValue}>{data.weightKg} kg</Text>
                    <Text style={styles.statLabel}>Weight</Text>
                </View>

                <View style={styles.statItem}>
                    <Text style={styles.statValue}>{data.dominantHand}</Text>
                    <Text style={styles.statLabel}>Hand</Text>
                </View>
            </View>

            {/* Info Section */}
            <View style={styles.infoSection}>
                <Text style={styles.infoTitle}>Info</Text>

                <Text style={styles.infoText}>
                    📍 {data.city}, {data.country}
                </Text>

                <Text style={styles.infoText}>
                    🎂 {data.birthDate}
                </Text>
            </View>
        </ScrollView>
    )
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#0b0f1a',
    },
    center: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#0b0f1a',
    },
    header: {
        alignItems: 'center',
        paddingVertical: 30,
    },
    avatar: {
        width: 140,
        height: 140,
        borderRadius: 70,
        borderWidth: 3,
        borderColor: '#ff8c00',
    },
    name: {
        marginTop: 15,
        fontSize: 24,
        fontWeight: 'bold',
        color: 'white',
    },
    position: {
        marginTop: 5,
        fontSize: 16,
        color: '#aaa',
    },
    editButton: {
        marginTop: 15,
        backgroundColor: '#ff8c00',
        paddingVertical: 8,
        paddingHorizontal: 20,
        borderRadius: 20,
    },
    editButtonText: {
        color: '#0b0f1a',
        fontWeight: 'bold',
    },
    card: {
        flexDirection: 'row',
        justifyContent: 'space-around',
        backgroundColor: '#121826',
        marginHorizontal: 20,
        borderRadius: 15,
        paddingVertical: 20,
    },
    statItem: {
        alignItems: 'center',
    },
    statValue: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#ff8c00',
    },
    statLabel: {
        fontSize: 12,
        color: '#aaa',
        marginTop: 5,
    },
    infoSection: {
        marginTop: 30,
        paddingHorizontal: 20,
    },
    infoTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        color: 'white',
        marginBottom: 10,
    },
    infoText: {
        fontSize: 15,
        color: '#ccc',
        marginBottom: 8,
    },
})