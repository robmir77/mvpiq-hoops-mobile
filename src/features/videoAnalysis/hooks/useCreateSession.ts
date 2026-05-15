import { useState } from 'react'
import { createAnalysisSession } from '../api/videoAnalysis.api'
import { VideoAnalysisSession } from '../types/videoAnalysis.types'

interface CreateSessionParams {
    analysisCode: string
    videoUrl: string
    videoSeconds: number
    videoSizeMb: number
}

export const useCreateSession = () => {
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const createSession = async (params: CreateSessionParams): Promise<VideoAnalysisSession | null> => {
        try {
            setLoading(true)
            setError(null)
            
            const session = await createAnalysisSession(params)
            return session
        } catch (err) {
            console.error('Failed to create analysis session:', err)
            setError('Failed to create analysis session')
            return null
        } finally {
            setLoading(false)
        }
    }

    return { createSession, loading, error }
}
