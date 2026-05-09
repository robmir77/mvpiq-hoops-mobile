import React from 'react'
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native'
import { globalStyles } from '@/shared/theme/globalStyles'

export default function JournalHomeScreen({ navigation }: any) {
    return (
        <View style={styles.container}>
            <Text style={styles.title}>Diario</Text>

            <TouchableOpacity
                style={globalStyles.button}
                onPress={() =>
                    navigation.navigate('JournalCreate', { entryType: 'MATCH' })
                }
            >
                <Text style={globalStyles.buttonText}>Nuovo Diario Partita</Text>
            </TouchableOpacity>

            <View style={{ height: 10 }} />

            <TouchableOpacity
                style={globalStyles.button}
                onPress={() =>
                    navigation.navigate('JournalCreate', { entryType: 'TRAINING' })
                }
            >
                <Text style={globalStyles.buttonText}>Nuovo Diario Allenamento</Text>
            </TouchableOpacity>
        </View>
    )
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#0b0f1a',
        padding: 20,
    },
    title: {
        fontSize: 22,
        fontWeight: 'bold',
        color: 'white',
        marginBottom: 20,
    },
})