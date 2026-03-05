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