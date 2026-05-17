// src/features/messaging/screens/ChatScreen.tsx

import React, { useState, useRef, useEffect, useContext } from 'react'
import {
    View, Text, ScrollView, StyleSheet, TextInput,
    TouchableOpacity, KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native'
import { useRoute, useNavigation } from '@react-navigation/native'
import { AuthContext } from '@/features/auth/context/AuthContext'
import { useMessaging } from '../hooks/useMessaging'
import { Message, getOtherParticipant } from '../types/messaging.types'

export default function ChatScreen() {
    const route = useRoute()
    const navigation = useNavigation()
    const auth = useContext(AuthContext)
    const { conversationId } = route.params as { conversationId: string }
    const { messages, currentConversation, sendNewMessage } = useMessaging()
    const [newMessage, setNewMessage] = useState('')
    const [sending, setSending] = useState(false)
    const scrollViewRef = useRef<ScrollView>(null)

    const currentUserId = auth?.user?.id ?? ''

    useEffect(() => {
        setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: true }), 100)
    }, [messages])

    // ✅ Fix: confronta senderId con l'ID dell'utente autenticato
    const isMyMessage = (message: Message): boolean =>
        message.senderId === currentUserId

    // ✅ Fix: usa getOtherParticipant per trovare il nome dell'altro
    const getHeaderTitle = (): string => {
        if (!currentConversation) return 'Chat'
        const other = getOtherParticipant(currentConversation, currentUserId)
        return other?.displayName || other?.username || currentConversation.title || 'Chat'
    }

    const handleSend = async () => {
        if (!newMessage.trim()) return
        setSending(true)
        try {
            await sendNewMessage(
                { receiverId: '', content: newMessage.trim(), type: 'TEXT' },
                conversationId
            )
            setNewMessage('')
        } catch (e) {
            console.error('Errore invio:', e)
        } finally {
            setSending(false)
        }
    }

    const formatTime = (dateString: string) =>
        new Date(dateString).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })

    if (!currentConversation) {
        return (
            <View style={styles.center}>
                <ActivityIndicator size="large" color="#F97316" />
            </View>
        )
    }

    return (
        <KeyboardAvoidingView
            style={styles.container}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
            <View style={styles.header}>
                <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
                    <Text style={styles.backText}>←</Text>
                </TouchableOpacity>
                <Text style={styles.headerTitle}>{getHeaderTitle()}</Text>
                <View style={{ width: 40 }} />
            </View>

            <ScrollView
                ref={scrollViewRef}
                style={styles.messagesList}
                contentContainerStyle={styles.messagesContainer}
            >
                {messages.map(message => {
                    const mine = isMyMessage(message)
                    return (
                        <View key={message.id} style={[styles.msgWrap, mine ? styles.myWrap : styles.otherWrap]}>
                            <View style={[styles.bubble, mine ? styles.myBubble : styles.otherBubble]}>
                                <Text style={styles.msgText}>{message.content}</Text>
                                <Text style={[styles.msgTime, mine ? styles.myTime : styles.otherTime]}>
                                    {formatTime(message.createdAt)}
                                </Text>
                            </View>
                        </View>
                    )
                })}
            </ScrollView>

            <View style={styles.inputContainer}>
                <TextInput
                    style={styles.textInput}
                    placeholder="Scrivi un messaggio..."
                    placeholderTextColor="#6B7280"
                    value={newMessage}
                    onChangeText={setNewMessage}
                    multiline
                    maxLength={1000}
                />
                <TouchableOpacity
                    style={[styles.sendBtn, (!newMessage.trim() || sending) && styles.sendBtnDisabled]}
                    onPress={handleSend}
                    disabled={!newMessage.trim() || sending}
                >
                    {sending
                        ? <ActivityIndicator size="small" color="white" />
                        : <Text style={styles.sendBtnText}>Invia</Text>
                    }
                </TouchableOpacity>
            </View>
        </KeyboardAvoidingView>
    )
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#0B0F1A' },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0B0F1A' },
    header: { flexDirection: 'row', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: '#1F2937' },
    backBtn: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
    backText: { color: '#F97316', fontSize: 20, fontWeight: 'bold' },
    headerTitle: { flex: 1, color: 'white', fontSize: 18, fontWeight: '600', textAlign: 'center' },
    messagesList: { flex: 1 },
    messagesContainer: { padding: 16 },
    msgWrap: { marginVertical: 4 },
    myWrap: { alignItems: 'flex-end' },
    otherWrap: { alignItems: 'flex-start' },
    bubble: { maxWidth: '80%', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 18 },
    myBubble: { backgroundColor: '#F97316' },
    otherBubble: { backgroundColor: '#1F2937' },
    msgText: { color: 'white', fontSize: 16, lineHeight: 20 },
    msgTime: { fontSize: 11, marginTop: 4 },
    myTime: { color: 'rgba(255,255,255,0.7)', textAlign: 'right' },
    otherTime: { color: '#6B7280' },
    inputContainer: { flexDirection: 'row', padding: 16, borderTopWidth: 1, borderTopColor: '#1F2937', alignItems: 'flex-end' },
    textInput: { flex: 1, backgroundColor: '#1F2937', color: 'white', paddingHorizontal: 16, paddingVertical: 12, borderRadius: 20, marginRight: 8, maxHeight: 100, fontSize: 16 },
    sendBtn: { backgroundColor: '#F97316', paddingHorizontal: 20, paddingVertical: 12, borderRadius: 20, justifyContent: 'center', alignItems: 'center' },
    sendBtnDisabled: { backgroundColor: '#374151' },
    sendBtnText: { color: 'white', fontSize: 16, fontWeight: '600' },
})
