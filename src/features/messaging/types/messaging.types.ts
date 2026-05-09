export type MessageType = 'TEXT' | 'VIDEO' | 'CV' | 'HIGHLIGHT' | 'EVALUATION_REQUEST'

export type MessageStatus = 'SENT' | 'DELIVERED' | 'READ' | 'FAILED'

export type Message = {
  id: string
  senderId: string
  receiverId: string
  content: string
  type: MessageType
  status: MessageStatus
  createdAt: string
  updatedAt: string
  attachments?: MessageAttachment[]
  replyTo?: string
}

export type MessageAttachment = {
  id: string
  type: 'VIDEO' | 'IMAGE' | 'CV' | 'HIGHLIGHT'
  url: string
  name: string
  size?: number
  thumbnail?: string
}

export type Conversation = {
  id: string
  participant1Id: string
  participant2Id: string
  lastMessage?: Message
  unreadCount: number
  createdAt: string
  updatedAt: string
  participant1?: User
  participant2?: User
}

export type User = {
  id: string
  username: string
  displayName: string
  avatar?: string
  role: 'player' | 'trainer' | 'scout' | 'creator'
  isOnline: boolean
  lastSeen?: string
}

export type SendMessagePayload = {
  receiverId: string
  content: string
  type: MessageType
  replyTo?: string
  attachments?: Omit<MessageAttachment, 'id'>[]
}
