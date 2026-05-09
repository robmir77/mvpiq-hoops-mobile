import apiClient from '@/shared/api/apiClient'
import { Message, Conversation, SendMessagePayload } from '../types/messaging.types'

// Export types for use in other components
export type { Message, Conversation, SendMessagePayload }

export interface CreateConversationRequest {
  title: string
  participantIds: string[]
}

export interface SendMessageRequest {
  senderId: string
  content: string
  messageType?: string
  mediaId?: string
}

export const createConversation = async (
  request: CreateConversationRequest
): Promise<Conversation> => {
  try {
    const response = await apiClient.post('/conversations', request)
    return response.data
  } catch (error) {
    console.error('Error creating conversation:', error)
    throw error
  }
}

export const sendMessage = async (
  conversationId: string,
  message: SendMessageRequest
): Promise<Message> => {
  try {
    const response = await apiClient.post(`/conversations/${conversationId}/messages`, message)
    return response.data
  } catch (error) {
    console.error('Error sending message:', error)
    throw error
  }
}

export const getConversation = async (
  conversationId: string
): Promise<Conversation> => {
  try {
    const response = await apiClient.get(`/conversations/${conversationId}`)
    return response.data
  } catch (error) {
    console.error('Error fetching conversation:', error)
    throw error
  }
}

export const getMessages = async (conversationId: string): Promise<Message[]> => {
  try {
    const response = await apiClient.get(`/conversations/${conversationId}/messages`)
    return response.data
  } catch (error) {
    console.error('Error fetching messages:', error)
    return []
  }
}

export const getConversationParticipants = async (
  conversationId: string
): Promise<any[]> => {
  try {
    const response = await apiClient.get(`/conversations/${conversationId}/participants`)
    return response.data
  } catch (error) {
    console.error('Error fetching conversation participants:', error)
    return []
  }
}

export const getUserConversations = async (userId: string): Promise<Conversation[]> => {
  try {
    const response = await apiClient.get(`/conversations/user/${userId}`)
    return response.data
  } catch (error) {
    console.error('Error fetching user conversations:', error)
    return []
  }
}

export const addConversationParticipant = async (
  conversationId: string,
  userId: string
): Promise<void> => {
  try {
    await apiClient.post(`/conversations/${conversationId}/participants`, { userId })
  } catch (error) {
    console.error('Error adding conversation participant:', error)
    throw error
  }
}

export const removeConversationParticipant = async (
  conversationId: string,
  userId: string
): Promise<void> => {
  try {
    await apiClient.delete(`/conversations/${conversationId}/participants/${userId}`)
  } catch (error) {
    console.error('Error removing conversation participant:', error)
    throw error
  }
}

// Backward compatibility
export const getConversations = getUserConversations

export const markMessagesAsRead = async (conversationId: string): Promise<void> => {
  try {
    await apiClient.put(`/conversations/${conversationId}/read`)
  } catch (error) {
    console.error('Error marking messages as read:', error)
  }
}

export const deleteMessage = async (messageId: string): Promise<void> => {
  try {
    await apiClient.delete(`/messages/${messageId}`)
  } catch (error) {
    console.error('Error deleting message:', error)
    throw error
  }
}

export const searchUsers = async (query: string): Promise<any[]> => {
  try {
    const response = await apiClient.get(`/users/search?q=${encodeURIComponent(query)}`)
    return response.data
  } catch (error) {
    console.error('Error searching users:', error)
    return []
  }
}

export const uploadAttachment = async (file: any, type: string): Promise<any> => {
  try {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('type', type)

    const response = await apiClient.post('/messages/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    })
    return response.data
  } catch (error) {
    console.error('Error uploading attachment:', error)
    throw error
  }
}
