import React from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { VideoAnalysisType } from '../types/videoAnalysis.types'

interface AnalysisTypeCardProps {
    type: VideoAnalysisType
    onPress: () => void
}

export const AnalysisTypeCard: React.FC<AnalysisTypeCardProps> = ({ type, onPress }) => {
    return (
        <TouchableOpacity style={styles.container} onPress={onPress} activeOpacity={0.7}>
            <View style={styles.content}>
                <Text style={styles.name}>{type.name}</Text>
                {type.description && (
                    <Text style={styles.description}>{type.description}</Text>
                )}
                <View style={styles.metaContainer}>
                    <Text style={styles.metaText}>
                        Max: {type.maxVideoSeconds}s • {type.maxVideoSizeMb}MB
                    </Text>
                </View>
            </View>
            <View style={styles.arrowContainer}>
                <Text style={styles.arrow}>→</Text>
            </View>
        </TouchableOpacity>
    )
}

const styles = StyleSheet.create({
    container: {
        backgroundColor: '#fff',
        borderRadius: 12,
        padding: 16,
        marginBottom: 12,
        flexDirection: 'row',
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 3,
    },
    content: {
        flex: 1,
    },
    name: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#333',
        marginBottom: 4,
    },
    description: {
        fontSize: 14,
        color: '#666',
        marginBottom: 8,
    },
    metaContainer: {
        marginTop: 4,
    },
    metaText: {
        fontSize: 12,
        color: '#999',
    },
    arrowContainer: {
        marginLeft: 12,
    },
    arrow: {
        fontSize: 24,
        color: '#4CAF50',
        fontWeight: 'bold',
    },
})
