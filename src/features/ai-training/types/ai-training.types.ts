// src/features/ai-training/types/ai-training.types.ts

export enum SourceType {
    MANUAL = 'MANUAL',
    AI_GENERATED = 'AI_GENERATED',
    AI_ADAPTED = 'AI_ADAPTED'
}

export enum GenerationStatus {
    PENDING = 'PENDING',
    GENERATING = 'GENERATING',
    COMPLETED = 'COMPLETED',
    FAILED = 'FAILED'
}

export enum SkillLevel {
    BEGINNER = 'BEGINNER',
    INTERMEDIATE = 'INTERMEDIATE',
    ADVANCED = 'ADVANCED'
}

export interface TrainingGenerationRequest {
    goal: string
    skillLevel: SkillLevel
    position?: string
    sessionsPerWeek: number
    sessionDurationMinutes: number
    weeks: number
}

export interface TrainingProgram {
    id: string
    athleteId: string
    title: string
    goal: string
    weeks: TrainingWeek[]
    sessionsPerWeek: number
    sessionDurationMinutes: number
    sourceType: SourceType
    generatedByAi: boolean
    aiModel?: string
    aiPrompt?: string
    aiGenerationParameters?: TrainingGenerationRequest
    generationStatus?: GenerationStatus
    generatedAt?: string
    parentProgramId?: string
    createdAt: string
    updatedAt: string
}

export interface TrainingWeek {
    id: string
    programId: string
    weekNumber: number
    days: TrainingDay[]
}

export interface TrainingDay {
    id: string
    weekId: string
    dayNumber: number
    title: string
    exercises: TrainingExercise[]
}

export interface TrainingExercise {
    id: string
    dayId: string
    exerciseId: string
    orderNumber: number
    durationMinutes: number
    repetitions?: number
    notes?: string
}

export interface TrainingGenerationResponse {
    id: string
    generationStatus: GenerationStatus
    program: TrainingProgram | null
}

export interface Exercise {
    id: string
    name: string
    description: string
    category: string
    difficulty: SkillLevel
    equipment?: string[]
}
