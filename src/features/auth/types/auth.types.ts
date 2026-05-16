// src/features/auth/types/auth.types.ts

export enum UserRole {
    ADMIN = 'ADMIN',
    CREATOR = 'CREATOR',
    GUEST = 'GUEST',
    PLAYER = 'PLAYER',
    SCOUT = 'SCOUT',
    TRAINER = 'TRAINER'
}

export enum UserStatus {
    ACTIVE = 'ACTIVE',
    SUSPENDED = 'SUSPENDED',
    DELETED = 'DELETED'
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
    mainPosition?: string
    // Roles are now managed through UserRoleAssignment entity (RBAC system)
    // isCreator and isTrainer removed - use role assignments instead
    roles?: UserRole[] // Array of roles for multi-role support
    // New fields from database migration
    status?: UserStatus
    updatedAt?: string
    deletedAt?: string
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
    icon: string | null        // nome Lucide kebab-case (es. "notebook-pen")
    iconColor?: string | null  // colore HEX opzionale (es. "#ff8c00")
    accessible: boolean
    sortOrder: number
    sectionKey?: string        // alias di id, utile quando il BE lo restituisce separatamente
}

export interface NavigationResponse {
    success: boolean
    data: NavigationSection[]
}

export interface AccessResponse {
    success: boolean
    data: boolean
}
