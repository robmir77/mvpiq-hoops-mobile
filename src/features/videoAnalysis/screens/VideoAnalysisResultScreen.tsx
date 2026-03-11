import React, { useEffect, useState } from "react"
import { View, Text, ScrollView } from "react-native"
import { RouteProp } from "@react-navigation/native"
import { getAnalysisResult } from "../api/videoAnalysis.api"
import { VideoAnalysisResult } from "../types/videoAnalysis.types"

type VideoAnalysisStackParamList = {
    VideoResult: { sessionId: string }
}

type VideoResultRouteProp = RouteProp<VideoAnalysisStackParamList, "VideoResult">

type Props = { route: VideoResultRouteProp }

export default function VideoAnalysisResultScreen({ route }: Props) {
    const { sessionId } = route.params
    const [result, setResult] = useState<VideoAnalysisResult | null>(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        const load = async () => {
            try {
                const data = await getAnalysisResult(sessionId)

                // 👇 parse JSON se arrivano come stringhe
                const parsedResult: VideoAnalysisResult = {
                    ...data,
                    detectedErrors: typeof data.detectedErrors === "string" ? JSON.parse(data.detectedErrors) : data.detectedErrors,
                    suggestions: typeof data.suggestions === "string" ? JSON.parse(data.suggestions) : data.suggestions,
                }

                setResult(parsedResult)
            } catch (err) {
                console.error("Failed to load analysis result:", err)
            } finally {
                setLoading(false)
            }
        }

        load()
    }, [sessionId])

    if (loading) return <Text>Loading analysis result...</Text>
    if (!result) return <Text>No result found.</Text>

    return (
        <ScrollView style={{ padding: 16 }}>
            <Text style={{ fontSize: 20, fontWeight: "bold" }}>Score: {result.score}</Text>

            <Text style={{ marginTop: 16, fontWeight: "bold" }}>Mistakes:</Text>
            {result.detectedErrors.length ? (
                result.detectedErrors.map((e, i) => <Text key={i}>• {e}</Text>)
            ) : (
                <Text>None</Text>
            )}

            <Text style={{ marginTop: 16, fontWeight: "bold" }}>Suggestions:</Text>
            {result.suggestions.length ? (
                result.suggestions.map((s, i) => <Text key={i}>• {s}</Text>)
            ) : (
                <Text>None</Text>
            )}
        </ScrollView>
    )
}