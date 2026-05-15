import React from "react"
import { View, Text, ScrollView, StyleSheet } from "react-native"
import { NativeStackScreenProps } from "@react-navigation/native-stack"
import { useAnalysisResult } from "../hooks/useAnalysisResult"
import { AnalysisScoreCard } from "../components/AnalysisScoreCard"
import { TrainingStackParamList } from "../../training/navigation/TrainingNavigator"

type Props = NativeStackScreenProps<TrainingStackParamList, "VideoResult">

export default function VideoAnalysisResultScreen({ route }: Props) {
    const { sessionId } = route.params
    const { result, loading, error } = useAnalysisResult(sessionId)

    if (loading) {
        return (
            <View style={styles.centerContainer}>
                <Text>Loading analysis result...</Text>
            </View>
        )
    }

    if (error) {
        return (
            <View style={styles.centerContainer}>
                <Text style={styles.error}>{error}</Text>
            </View>
        )
    }

    if (!result) {
        return (
            <View style={styles.centerContainer}>
                <Text>No result found.</Text>
            </View>
        )
    }

    return (
        <ScrollView style={styles.container}>
            <Text style={styles.title}>Analysis Result</Text>
            <AnalysisScoreCard result={result} />
        </ScrollView>
    )
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        padding: 16,
        backgroundColor: '#f5f5f5',
    },
    centerContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 16,
    },
    title: {
        fontSize: 24,
        fontWeight: 'bold',
        color: '#333',
        marginBottom: 16,
    },
    error: {
        fontSize: 16,
        color: 'red',
    },
})