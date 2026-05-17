// src/features/messaging/types/messaging.types.ts

import { UserRole } from '@/features/auth/types/auth.types'

export type MessageType = 'TEXT' | 'VIDEO' | 'CV' | 'HIGHLIGHT' | 'EVALUATION_REQUEST' | 'text' | 'media' | 'system'

export type MessageStatus = 'SENT' | 'DELIVERED' | 'READ' | 'FAILED'

export type Message = {
    id: string
    senderId: string
    content: string
    type?: MessageType
    messageType?: string
    status?: MessageStatus
    createdAt: string
    updatedAt?: string
    editedAt?: string
    deletedAt?: string
    replyToMessageId?: string
    attachments?: MessageAttachment[]
}

export type MessageAttachment = {
    id: string
    type: 'VIDEO' | 'IMAGE' | 'CV' | 'HIGHLIGHT'
    url: string
    name: string
    size?: number
    thumbnail?: string
}

// Partecipante come restituito dal BE (ConversationParticipant)
export type ConversationParticipant = {
    id: string
    user: ConversationUser
    joinedAt: string
}

export type ConversationUser = {
    id: string
    username: string
    displayName: string
    avatarUrl?: string
    isOnline?: boolean
    lastSeen?: string
}

// Conversation allineata al modello BE:
// il BE non ha participant1Id/participant2Id come campi fissi —
// usa una tabella junction conversation_participants.
// I partecipanti arrivano come array dalla chiamata /participants.
export type Conversation = {
    id: string
    title?: string
    createdAt: string
    lastMessage?: Message
    unreadCount?: number
    // Partecipanti: popolati dopo chiamata a getConversationParticipants
    participants?: ConversationParticipant[]
}

// Helper: dato l'userId corrente, restituisce l'altro partecipante
export const getOtherParticipant = (
    conversation: Conversation,
    currentUserId: string
): ConversationUser | null => {
    const other = conversation.participants?.find(p => p.user.id !== currentUserId)
    return other?.user ?? null
}

export type SendMessagePayload = {
    receiverId: string
    content: string
    type: MessageType
    replyTo?: string
    attachments?: Omit<MessageAttachment, 'id'>[]
}

// Legacy - mantenuto per retrocompatibilità
export type User = ConversationUser & { role?: UserRole }
