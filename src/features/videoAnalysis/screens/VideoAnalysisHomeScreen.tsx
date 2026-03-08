import React from "react"
import { View, Text, FlatList, TouchableOpacity } from "react-native"
import { useAnalysisTypes } from "../hooks/useAnalysisTypes"

import { NativeStackNavigationProp } from "@react-navigation/native-stack"
import { RootStackParamList } from "@/app/navigation/types"
import { VideoAnalysisType } from "../types/videoAnalysis.types"

type Props = {
    navigation: NativeStackNavigationProp<
        RootStackParamList,
        "VideoAnalysisHome"
    >
}

export default function VideoAnalysisHomeScreen({ navigation }: Props) {

    const { types, loading } = useAnalysisTypes()

    if (loading) {
        return <Text>Loading...</Text>
    }

    return (
        <FlatList<VideoAnalysisType>
            data={types}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
                <TouchableOpacity
                    onPress={() =>
                        navigation.navigate("VideoRecorder", { type: item })
                    }
                >
                    <View style={{ padding: 16 }}>
                        <Text>{item.name}</Text>
                        <Text>{item.description}</Text>
                    </View>
                </TouchableOpacity>
            )}
        />
    )
}