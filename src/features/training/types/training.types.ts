export interface TrainingStats {
    sessions: number
    minutes: number
    points: number
}

export interface TrainingProgram {
    id: string
    title: string
    description: string
    isPublic: boolean
    createdAt: string
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
}