// src/features/auth/types/auth.types.ts

export enum UserRole {
    ADMIN = 'ADMIN',
    CREATOR = 'CREATOR',
    GUEST = 'GUEST',
    PLAYER = 'PLAYER',
    SCOUT = 'SCOUT',
    TRAINER = 'TRAINER'
}

export interface UserRoleAssignment {
    id: string
    userId: string
    role: UserRole
    assignedAt?: string
    assignedBy?: string
}

export interface User {
    id: string
    username: string
    displayName?: string
    email?: string
    verified?: boolean
    hasGoals?: boolean
    publicProfile?: boolean
    bio?: string
    // Roles are now managed through UserRoleAssignment entity (RBAC system)
    // isCreator and isTrainer removed - use role assignments instead
    roles?: UserRole[] // Array of roles for multi-role support
}

export interface LoginResponse {
    token: string
    id: string
    username: string
    displayName?: string
    email?: string
    verified?: boolean
    hasGoals?: boolean
    roles?: UserRole[] // Roles returned from login
}

export interface RegisterRequest {
    username: string
    email: string
    password: string
    displayName?: string
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
