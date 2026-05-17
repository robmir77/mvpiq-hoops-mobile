import React from "react"
import { View, Text, FlatList, StyleSheet, ActivityIndicator } from "react-native"
import { useAnalysisTypes } from "../hooks/useAnalysisTypes"
import { AnalysisTypeCard } from "../components/AnalysisTypeCard"
import { colors } from "@/shared/theme/colors"

import { NativeStackNavigationProp } from "@react-navigation/native-stack"
import { RootStackParamList } from "@/app/navigation/types"
import { VideoAnalysisType } from "../types/videoAnalysis.types"

type Props = {
    navigation: NativeStackNavigationProp<
        RootStackParamList,
        "video_analysis"
    >
}

export default function VideoAnalysisHomeScreen({ navigation }: Props) {
    const { types, loading } = useAnalysisTypes()

    if (loading) {
        return (
            <View style={styles.centerContainer}>
                <ActivityIndicator size="large" color={colors.primary} />
            </View>
        )
    }

    return (
        <View style={styles.container}>
            <Text style={styles.title}>Analisi Video</Text>
            <FlatList<VideoAnalysisType>
                data={types}
                keyExtractor={(item) => item.id}
                contentContainerStyle={styles.listContainer}
                renderItem={({ item }) => (
                    <AnalysisTypeCard
                        type={item}
                        onPress={() => navigation.navigate("VideoRecorder", { type: item })}
                    />
                )}
            />
        </View>
    )
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: colors.background,
    },
    centerContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: colors.background,
    },
    title: {
        fontSize: 28,
        fontWeight: '700',
        color: colors.textPrimary,
        margin: 20,
    },
    listContainer: {
        padding: 16,
    },
})