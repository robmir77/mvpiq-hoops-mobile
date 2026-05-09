import apiClient from '@/shared/api/apiClient'
import { Message, Conversation, SendMessagePayload } from '../types/messaging.types'

// Export types for use in other components
export type { Message, Conversation, SendMessagePayload }

export const getConversations = async (userId: string): Promise<Conversation[]> => {
  try {
    const response = await apiClient.get(`/users/${userId}/conversations`)
    return response.data
  } catch (error) {
    console.error('Error fetching conversations:', error)
    return []
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

export const sendMessage = async (payload: SendMessagePayload): Promise<Message> => {
  try {
    const response = await apiClient.post('/messages', payload)
    return response.data
  } catch (error) {
    console.error('Error sending message:', error)
    throw error
  }
}

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
