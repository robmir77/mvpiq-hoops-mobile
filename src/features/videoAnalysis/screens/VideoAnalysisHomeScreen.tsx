import React from "react"
import { View, Text, FlatList, TouchableOpacity } from "react-native"
import { useAnalysisTypes } from "../hooks/useAnalysisTypes"

export default function VideoAnalysisHomeScreen({ navigation }) {

    const { types, loading } = useAnalysisTypes()

    if (loading) {
        return <Text>Loading...</Text>
    }

    return (
        <FlatList
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