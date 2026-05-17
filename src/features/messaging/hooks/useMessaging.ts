// src/features/messaging/hooks/useMessaging.ts

import { useState, useEffect, useContext } from 'react'
import { AuthContext } from '@/features/auth/context/AuthContext'
import {
    getConversations,
    getMessages,
    sendMessage,
    markMessagesAsRead,
    getConversationParticipants,
} from '../api/messaging.api'
import {
    Conversation,
    Message,
    SendMessagePayload,
    ConversationParticipant,
} from '../types/messaging.types'

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
            const raw = await getConversations(userId)

            // Per ogni conversazione, carica i partecipanti
            // (il BE non li include nella lista conversazioni)
            const enriched = await Promise.all(
                raw.map(async (conv: Conversation) => {
                    try {
                        const parts: ConversationParticipant[] = await getConversationParticipants(conv.id)
                        return { ...conv, participants: parts }
                    } catch {
                        return conv
                    }
                })
            )

            setConversations(enriched)
        } catch (error) {
            console.error('Error loading conversations:', error)
        } finally {
            setLoading(false)
        }
    }

    const loadMessages = async (conversationId: string) => {
        try {
            const data = await getMessages(conversationId)
            setMessages(
                data.sort(
                    (a: Message, b: Message) =>
                        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
                )
            )
        } catch (error) {
            console.error('Error loading messages:', error)
        }
    }

    const selectConversation = async (conversation: Conversation) => {
        // Assicura che i partecipanti siano caricati
        let conv = conversation
        if (!conv.participants) {
            try {
                const parts: ConversationParticipant[] = await getConversationParticipants(conv.id)
                conv = { ...conv, participants: parts }
            } catch {
                // procedi senza partecipanti
            }
        }

        setCurrentConversation(conv)
        await loadMessages(conv.id)
        await markMessagesAsRead(conv.id)

        setConversations(prev =>
            prev.map(c => (c.id === conv.id ? { ...c, unreadCount: 0 } : c))
        )
    }

    const sendNewMessage = async (conversationId: string, payload: SendMessagePayload) => {
        try {
            const request = {
                senderId: auth!.user!.id,
                content: payload.content,
                messageType: payload.type,
            }
            const newMessage = await sendMessage(conversationId, request)
            setMessages(prev => [...prev, newMessage])
            await loadConversations()
            return newMessage
        } catch (error) {
            console.error('Error sending message:', error)
            throw error
        }
    }

    return {
        conversations,
        currentConversation,
        messages,
        loading,
        selectConversation,
        // Firma unificata: accetta sia conversationId esplicito sia usa currentConversation
        sendNewMessage: (payload: SendMessagePayload, conversationId?: string) =>
            sendNewMessage(conversationId ?? currentConversation?.id ?? '', payload),
        refreshConversations: loadConversations,
    }
}
