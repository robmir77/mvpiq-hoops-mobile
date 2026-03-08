import React, { useEffect, useState } from "react"
import { View, Text } from "react-native"
import { RouteProp } from "@react-navigation/native"

import { getAnalysisResult } from "../api/videoAnalysis.api"
import { VideoAnalysisResult } from "../types/videoAnalysis.types"

type VideoAnalysisStackParamList = {
    VideoResult: {
        sessionId: string
    }
}

type VideoResultRouteProp = RouteProp<
    VideoAnalysisStackParamList,
    "VideoResult"
>

type Props = {
    route: VideoResultRouteProp
}

export default function VideoAnalysisResultScreen({ route }: Props) {

    const { sessionId } = route.params

    const [result, setResult] = useState<VideoAnalysisResult | null>(null)

    useEffect(() => {

        const load = async () => {
            const data = await getAnalysisResult(sessionId)
            setResult(data)
        }

        load()

    }, [])

    if (!result) return <Text>Loading...</Text>

    return (
        <View>

            <Text>Score: {result.score}</Text>

            <Text>Mistakes</Text>
            {result.detectedErrors.map((e, i) => (
                <Text key={i}>• {e}</Text>
            ))}

            <Text>Suggestions</Text>
            {result.suggestions.map((s, i) => (
                <Text key={i}>• {s}</Text>
            ))}

        </View>
    )
}