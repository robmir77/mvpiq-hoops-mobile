export interface TrainingStats {
    sessions: number
    minutes: number
    points: number
}

export type TrainingDifficulty = 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED'

export interface TrainingProgram {
    id: string
    title: string
    description: string
    isPublic: boolean
    createdAt: string
    // New fields from database migration
    estimatedDurationMinutes?: number
    difficulty?: TrainingDifficulty
    tags?: string[] // JSONB
    publishedAt?: string
}

export interface TrainingSession {
    id: string
    userId: string
    programId?: string
    title: string
    description?: string
    duration: number
    completedAt?: string
    status: 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED'
    notes?: string
    createdAt: string
    updatedAt: string
    // New fields from database migration
    caloriesBurned?: number
    averageHeartRate?: number
    perceivedEffort?: number // 1-10
}

export interface Exercise {
    id: string
    name: string
    description?: string
    // New fields from database migration
    equipment?: string[] // JSONB
    tags?: string[] // JSONB
    caloriesEstimate?: number
}