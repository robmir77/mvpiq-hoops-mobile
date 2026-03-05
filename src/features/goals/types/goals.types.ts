export interface Goal {
    id: string
    title: string
    description?: string
    completed: boolean
    createdAt?: string
}

export interface CreateGoalRequest {
    title: string
    description?: string
}