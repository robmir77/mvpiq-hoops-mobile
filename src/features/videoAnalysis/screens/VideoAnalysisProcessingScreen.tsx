import React, { useEffect } from "react"
import { View, Text } from "react-native"
import { createAnalysisSession } from "../api/videoAnalysis.api"

export default function VideoAnalysisProcessingScreen({ route, navigation }: any) {

    const { videoUrl, type } = route.params

    useEffect(() => {

        const process = async () => {

            const session = await createAnalysisSession({
                analysisCode: type.code,
                videoUrl: videoUrl.uri,
                videoSeconds: videoUrl.duration,
                videoSizeMb: 5
            })

            navigation.replace("VideoResult", {
                sessionId: session.id
            })
        }

        process()

    }, [])

    return (
        <View>
            <Text>Analyzing your movement...</Text>
        </View>
    )
}