// src/features/auth/types/auth.types.ts

export enum UserRole {
    ADMIN = 'admin',
    CREATOR = 'creator',
    GUEST = 'guest',
    PLAYER = 'player',
    SCOUT = 'scout',
    TRAINER = 'trainer'
}

export interface User {
    id: string
    username: string
    displayName?: string
    email?: string
    role: UserRole
    verified?: boolean
    hasGoals?: boolean
    publicProfile?: boolean
    bio?: string
    isCreator?: boolean
    isTrainer?: boolean
}

export interface LoginResponse {
    token: string
    id: string
    username: string
    displayName?: string
    email?: string
    role: UserRole
    verified?: boolean
    hasGoals?: boolean
    isCreator?: boolean
    isTrainer?: boolean
}

export interface RegisterRequest {
    username: string
    email: string
    password: string
    displayName?: string
    role?: UserRole
}

export interface AuthContextType {
    user: User | null
    setUser: (user: User | null) => void
    logout: () => Promise<void>
    isLoading: boolean
}

// Navigation types
export interface NavigationSection {
    id: string
    title: string
    description: string
    icon: string | null
    accessible: boolean
    sortOrder: number
}

export interface NavigationResponse {
    success: boolean
    data: NavigationSection[]
}

export interface AccessResponse {
    success: boolean
    data: boolean
}
