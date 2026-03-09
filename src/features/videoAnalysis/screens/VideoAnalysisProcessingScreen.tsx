import React, { useEffect } from "react"
import { View, Text } from "react-native"
import { createAnalysisSession } from "../api/videoAnalysis.api"

export default function VideoAnalysisProcessingScreen({ route, navigation }: any) {

    const { videoUrl, type } = route.params

    useEffect(() => {

        const process = async () => {

            try {

                const session = await createAnalysisSession({
                    analysisCode: type.code,
                    videoUrl: videoUrl,      // ✅ è già una stringa
                    videoSeconds: 10,        // temporaneo
                    videoSizeMb: 5           // temporaneo
                })

                navigation.replace("VideoResult", {
                    sessionId: session.id
                })

            } catch (error) {

                console.error("Analysis session error:", error)

            }
        }

        process()

    }, [])

    return (
        <View>
            <Text>Analyzing your movement...</Text>
        </View>
    )
}