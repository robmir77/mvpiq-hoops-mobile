export interface VideoAnalysisType {
    id: string
    code: string
    name: string
    description?: string
    sport: string
    maxVideoSeconds: number
    maxVideoSizeMb: number
    framesToExtract: number
    referenceImageUrl?: string
}

export interface VideoAnalysisSession {
    id: string
    analysisTypeId: string
    videoUrl: string
    status: "UPLOADED" | "PROCESSING" | "COMPLETED" | "FAILED"
    // New fields from database migration
    errorMessage?: string
    retryCount?: number
}

export interface VideoAnalysisResult {
    id: string
    score: number
    detectedErrors: string[]
    suggestions: string[]
}