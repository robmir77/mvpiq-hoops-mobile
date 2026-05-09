import { useState, useEffect, useContext } from 'react'
import { AuthContext } from '@/features/auth/context/AuthContext'
import { 
  getConversations, 
  getMessages, 
  sendMessage, 
  markMessagesAsRead,
  Conversation, 
  Message,
  SendMessagePayload 
} from '../api/messaging.api'

export const useMessaging = () => {
  const auth = useContext(AuthContext)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [currentConversation, setCurrentConversation] = useState<Conversation | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (auth?.user?.id) {
      loadConversations()
    }
  }, [auth?.user?.id])

  const loadConversations = async () => {
    try {
      const userId = auth!.user!.id
      const conversationsData = await getConversations(userId)
      setConversations(conversationsData)
    } catch (error) {
      console.error('Error loading conversations:', error)
    } finally {
      setLoading(false)
    }
  }

  const loadMessages = async (conversationId: string) => {
    try {
      const messagesData = await getMessages(conversationId)
      setMessages(messagesData.sort((a, b) => 
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      ))
    } catch (error) {
      console.error('Error loading messages:', error)
    }
  }

  const selectConversation = async (conversation: Conversation) => {
    setCurrentConversation(conversation)
    await loadMessages(conversation.id)
    await markMessagesAsRead(conversation.id)
    
    // Update unread count
    setConversations(prev => 
      prev.map(c => c.id === conversation.id ? { ...c, unreadCount: 0 } : c)
    )
  }

  const sendNewMessage = async (payload: SendMessagePayload) => {
    try {
      const newMessage = await sendMessage(payload)
      
      // Update messages in current conversation
      if (currentConversation) {
        setMessages(prev => [...prev, newMessage])
      }
      
      // Update conversations list
      await loadConversations()
      
      return newMessage
    } catch (error) {
      console.error('Error sending message:', error)
      throw error
    }
  }

  const refreshConversations = () => {
    loadConversations()
  }

  return {
    conversations,
    currentConversation,
    messages,
    loading,
    selectConversation,
    sendNewMessage,
    refreshConversations,
  }
}
