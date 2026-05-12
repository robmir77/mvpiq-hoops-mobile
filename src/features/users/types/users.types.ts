import { UserRole } from '@/features/auth/types/auth.types'

export type OnlineUserDTO = {
    userId: string
    username: string
    email: string
    displayName: string
    roles: UserRole[]
    avatarUrl: string
    lastActivityAt: string
    activityType: string
}
