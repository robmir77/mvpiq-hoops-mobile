import React from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { VideoAnalysisResult } from '../types/videoAnalysis.types'

interface AnalysisScoreCardProps {
    result: VideoAnalysisResult
}

export const AnalysisScoreCard: React.FC<AnalysisScoreCardProps> = ({ result }) => {
    return (
        <View style={styles.container}>
            <View style={styles.scoreContainer}>
                <Text style={styles.scoreLabel}>Score</Text>
                <Text style={styles.scoreValue}>{result.score}</Text>
            </View>

            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Mistakes</Text>
                {result.detectedErrors.length ? (
                    result.detectedErrors.map((error, i) => (
                        <Text key={i} style={styles.itemText}>• {error}</Text>
                    ))
                ) : (
                    <Text style={styles.emptyText}>None</Text>
                )}
            </View>

            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Suggestions</Text>
                {result.suggestions.length ? (
                    result.suggestions.map((suggestion, i) => (
                        <Text key={i} style={styles.itemText}>• {suggestion}</Text>
                    ))
                ) : (
                    <Text style={styles.emptyText}>None</Text>
                )}
            </View>
        </View>
    )
}

const styles = StyleSheet.create({
    container: {
        backgroundColor: '#fff',
        borderRadius: 12,
        padding: 16,
        marginBottom: 16,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 3,
    },
    scoreContainer: {
        alignItems: 'center',
        marginBottom: 16,
        paddingBottom: 16,
        borderBottomWidth: 1,
        borderBottomColor: '#e0e0e0',
    },
    scoreLabel: {
        fontSize: 14,
        color: '#666',
        marginBottom: 4,
    },
    scoreValue: {
        fontSize: 48,
        fontWeight: 'bold',
        color: '#4CAF50',
    },
    section: {
        marginBottom: 12,
    },
    sectionTitle: {
        fontSize: 16,
        fontWeight: 'bold',
        marginBottom: 8,
        color: '#333',
    },
    itemText: {
        fontSize: 14,
        color: '#555',
        marginBottom: 4,
    },
    emptyText: {
        fontSize: 14,
        color: '#999',
        fontStyle: 'italic',
    },
})
