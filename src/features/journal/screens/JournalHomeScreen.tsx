import React from 'react'
import { View, Text, StyleSheet, Button } from 'react-native'

export default function JournalHomeScreen({ navigation }: any) {
    return (
        <View style={styles.container}>
            <Text style={styles.title}>Diario</Text>

            <Button
                title="Nuovo Diario Partita"
                onPress={() =>
                    navigation.navigate('JournalCreate', { entryType: 'MATCH' })
                }
            />

            <View style={{ height: 10 }} />

            <Button
                title="Nuovo Diario Allenamento"
                onPress={() =>
                    navigation.navigate('JournalCreate', { entryType: 'TRAINING' })
                }
            />
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