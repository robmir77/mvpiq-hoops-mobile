export type GoalPriority = 'LOW' | 'MEDIUM' | 'HIGH'

export interface Goal {
    id: string
    title: string
    description?: string
    completed: boolean
    createdAt?: string
    // New fields from database migration
    priority?: GoalPriority
    progressPercentage?: number
}

export interface CreateGoalRequest {
    title: string
    description?: string
    priority?: GoalPriority
}