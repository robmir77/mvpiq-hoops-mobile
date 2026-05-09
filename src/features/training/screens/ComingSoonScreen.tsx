// src/features/training/screens/ComingSoonScreen.tsx

import React from 'react'
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
} from 'react-native'
import { useNavigation } from '@react-navigation/native'

export default function ComingSoonScreen({ feature = 'Funzionalità' }: { feature?: string }) {
    const navigation = useNavigation()

    const handleGoBack = () => {
        navigation.goBack()
    }

    return (
        <View style={styles.container}>
            <View style={styles.content}>
                <Text style={styles.icon}>🚧</Text>
                <Text style={styles.title}>Coming Soon</Text>
                <Text style={styles.subtitle}>{feature} in arrivo!</Text>
                <Text style={styles.description}>
                    Stiamo lavorando per portare questa funzionalità su MVPIQ Hoops. 
                    Resta sintonizzato per gli aggiornamenti futuri!
                </Text>
                
                <TouchableOpacity style={styles.button} onPress={handleGoBack}>
                    <Text style={styles.buttonText}>Torna Indietro</Text>
                </TouchableOpacity>
            </View>
        </View>
    )
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#1a1a1a',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 20,
    },
    content: {
        alignItems: 'center',
        maxWidth: 300,
    },
    icon: {
        fontSize: 80,
        marginBottom: 20,
    },
    title: {
        fontSize: 32,
        fontWeight: 'bold',
        color: '#ff8c00',
        marginBottom: 10,
        textAlign: 'center',
    },
    subtitle: {
        fontSize: 20,
        color: '#fff',
        marginBottom: 20,
        textAlign: 'center',
    },
    description: {
        fontSize: 16,
        color: '#ccc',
        textAlign: 'center',
        lineHeight: 24,
        marginBottom: 30,
    },
    button: {
        backgroundColor: '#ff8c00',
        paddingHorizontal: 30,
        paddingVertical: 15,
        borderRadius: 25,
    },
    buttonText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: 'bold',
    },
})
