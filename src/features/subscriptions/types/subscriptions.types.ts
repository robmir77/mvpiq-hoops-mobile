export interface Subscription {
    id: string
    userId: string
    plan: string
    status: 'ACTIVE' | 'CANCELLED' | 'EXPIRED' | 'PENDING'
    startDate?: string
    endDate?: string
    features: string[]
    createdAt?: string
    updatedAt?: string
}

export interface SubscriptionLimits {
    videoUploadLimit: number
    videoAnalysisLimit: number
    videoUploadUsed: number
    videoAnalysisUsed: number
}

export interface SubscriptionFeature {
    feature: string
    enabled: boolean
    limit?: number
    used?: number
}
