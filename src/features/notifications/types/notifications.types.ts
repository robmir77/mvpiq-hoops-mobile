// src/features/notifications/types/notifications.types.ts

export enum NotificationType {
    TRAINING_PROGRAM_GENERATED = 'TRAINING_PROGRAM_GENERATED',
    TRAINING_REMINDER = 'TRAINING_REMINDER',
    GOAL_ACHIEVED = 'GOAL_ACHIEVED',
    PROFILE_UPDATED = 'PROFILE_UPDATED',
    TEAM_INVITATION = 'TEAM_INVITATION',
    VIDEO_ANALYSIS_COMPLETED = 'VIDEO_ANALYSIS_COMPLETED',
    SYSTEM_ANNOUNCEMENT = 'SYSTEM_ANNOUNCEMENT'
}

export enum DevicePlatform {
    ANDROID = 'ANDROID',
    IOS = 'IOS'
}

export interface Notification {
    id: string
    userId: string
    type: NotificationType
    title: string
    body: string
    data?: Record<string, any>
    isRead: boolean
    createdAt: string
    updatedAt: string
}

export interface DeviceToken {
    id: string
    userId: string
    token: string
    platform: DevicePlatform
    isActive: boolean
    createdAt: string
    updatedAt: string
}

export interface RegisterDeviceTokenRequest {
    token: string
    platform: DevicePlatform
}

export interface NotificationResponse {
    id: string
    userId: string
    type: NotificationType
    title: string
    body: string
    data?: Record<string, any>
    isRead: boolean
    createdAt: string
    updatedAt: string
}

export interface UnreadCountResponse {
    count: number
}

export interface TestNotificationRequest {
    title?: string
    body?: string
    data?: Record<string, any>
}
