export type UserRole = 'admin' | 'player' | 'trainer' | 'scout' | 'creator' | 'guest'

export type OnlineUserDTO = {
    userId: string
    username: string
    email: string
    displayName: string
    role: UserRole
    avatarUrl: string
    lastActivityAt: string
    activityType: string
}
