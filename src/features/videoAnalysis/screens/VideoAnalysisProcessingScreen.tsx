import React, { useEffect } from "react"
import { View, Text, StyleSheet } from "react-native"
import { NativeStackScreenProps } from "@react-navigation/native-stack"
import { useCreateSession } from "../hooks/useCreateSession"
import { RootStackParamList } from "@/app/navigation/types"

const VideoAnalysisProcessingScreen = ({ route, navigation }: NativeStackScreenProps<RootStackParamList, "VideoProcessing">) => {

    const { videoUrl, type } = route.params
    const { createSession, loading, error } = useCreateSession()

    useEffect(() => {

        const process = async () => {

            const session = await createSession({
                analysisCode: type.code,
                videoUrl: videoUrl,
                videoSeconds: 10,
                videoSizeMb: 5
            })

            if (session) {
                navigation.replace("VideoResult", {
                    sessionId: session.id
                })
            }
        }

        process()

    }, [])

    return (
        <View style={styles.container}>
            <Text style={styles.text}>Analyzing your movement...</Text>
            {error && <Text style={styles.error}>{error}</Text>}
        </View>
    )
}

export default VideoAnalysisProcessingScreen

const styles = StyleSheet.create({
    container: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 16,
    },
    text: {
        fontSize: 18,
        color: '#333',
    },
    error: {
        fontSize: 14,
        color: 'red',
        marginTop: 8,
    },
})