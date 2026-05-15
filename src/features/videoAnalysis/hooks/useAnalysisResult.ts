import { useState, useEffect } from 'react'
import { getAnalysisResult } from '../api/videoAnalysis.api'
import { VideoAnalysisResult } from '../types/videoAnalysis.types'

export const useAnalysisResult = (sessionId: string) => {
    const [result, setResult] = useState<VideoAnalysisResult | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        const load = async () => {
            try {
                setLoading(true)
                const data = await getAnalysisResult(sessionId)

                // Parse JSON se arrivano come stringhe
                const parsedResult: VideoAnalysisResult = {
                    ...data,
                    detectedErrors: typeof data.detectedErrors === 'string' 
                        ? JSON.parse(data.detectedErrors) 
                        : data.detectedErrors,
                    suggestions: typeof data.suggestions === 'string' 
                        ? JSON.parse(data.suggestions) 
                        : data.suggestions,
                }

                setResult(parsedResult)
                setError(null)
            } catch (err) {
                console.error('Failed to load analysis result:', err)
                setError('Failed to load analysis result')
            } finally {
                setLoading(false)
            }
        }

        load()
    }, [sessionId])

    return { result, loading, error }
}
