import React, { useState, useRef, useEffect, useContext } from 'react'
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native'
import { useRoute, useNavigation } from '@react-navigation/native'
import { useMessaging } from '../hooks/useMessaging'
import { AuthContext } from '@/features/auth/context/AuthContext'
import { Message } from '../types/messaging.types'

export default function ChatScreen() {
  const route = useRoute()
  const navigation = useNavigation()
  const auth = useContext(AuthContext)
  const { conversationId } = route.params as { conversationId: string }
  const { messages, currentConversation, sendNewMessage } = useMessaging()
  const [newMessage, setNewMessage] = useState('')
  const [sending, setSending] = useState(false)
  const scrollViewRef = useRef<ScrollView>(null)

  const currentUserId = auth?.user?.id

  useEffect(() => {
    if (scrollViewRef.current) {
      setTimeout(() => {
        scrollViewRef.current?.scrollToEnd({ animated: true })
      }, 100)
    }
  }, [messages])

  const handleSendMessage = async () => {
    if (newMessage.trim() === '' || !currentConversation) return

    setSending(true)
    try {
      await sendNewMessage({
        receiverId: getOtherParticipantId(),
        content: newMessage.trim(),
        type: 'TEXT',
      })
      setNewMessage('')
    } catch (error) {
      console.error('Error sending message:', error)
    } finally {
      setSending(false)
    }
  }

  const formatTime = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleTimeString('it-IT', {
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  // ✅ Fix: confronta con l'ID dell'utente autenticato, non con participant1Id
  const isMyMessage = (message: Message): boolean => {
    return message.senderId === currentUserId
  }

  // ✅ Fix: identifica l'altro partecipante guardando chi NON è l'utente corrente
  const getOtherParticipantId = (): string => {
    if (!currentConversation) return ''
    return currentConversation.participant1Id === currentUserId
      ? currentConversation.participant2Id
      : currentConversation.participant1Id
  }

  // ✅ Fix: mostra il nome dell'altro partecipante, non sempre participant1
  const getParticipantName = (): string => {
    if (!currentConversation) return 'Sconosciuto'
    const isP1 = currentConversation.participant1Id === currentUserId
    const other = isP1 ? currentConversation.participant2 : currentConversation.participant1
    return other?.displayName || other?.username || 'Sconosciuto'
  }

  const renderMessage = (message: Message) => {
    const isMyMsg = isMyMessage(message)

    return (
      <View
        key={message.id}
        style={[styles.messageContainer, isMyMsg ? styles.myMessage : styles.otherMessage]}
      >
        <View style={[styles.messageBubble, isMyMsg ? styles.myBubble : styles.otherBubble]}>
          <Text style={[styles.messageText, isMyMsg ? styles.myMessageText : styles.otherMessageText]}>
            {message.content}
          </Text>
          <Text style={[styles.messageTime, isMyMsg ? styles.myMessageTime : styles.otherMessageTime]}>
            {formatTime(message.createdAt)}
          </Text>
        </View>
      </View>
    )
  }

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
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Text style={styles.backButtonText}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{getParticipantName()}</Text>
        <View style={styles.headerRight} />
      </View>

      <ScrollView
        ref={scrollViewRef}
        style={styles.messagesList}
        contentContainerStyle={styles.messagesContainer}
      >
        {messages.map(renderMessage)}
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
          style={[
            styles.sendButton,
            (newMessage.trim() === '' || sending) && styles.sendButtonDisabled,
          ]}
          onPress={handleSendMessage}
          disabled={newMessage.trim() === '' || sending}
        >
          {sending ? (
            <ActivityIndicator size="small" color="white" />
          ) : (
            <Text style={styles.sendButtonText}>Invia</Text>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0B0F1A' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0B0F1A' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1F2937',
  },
  backButton: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
  backButtonText: { color: '#F97316', fontSize: 20, fontWeight: 'bold' },
  headerTitle: { flex: 1, color: 'white', fontSize: 18, fontWeight: '600', textAlign: 'center' },
  headerRight: { width: 40 },
  messagesList: { flex: 1 },
  messagesContainer: { padding: 16 },
  messageContainer: { marginVertical: 4 },
  myMessage: { alignItems: 'flex-end' },
  otherMessage: { alignItems: 'flex-start' },
  messageBubble: { maxWidth: '80%', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 18 },
  myBubble: { backgroundColor: '#F97316' },
  otherBubble: { backgroundColor: '#1F2937' },
  messageText: { fontSize: 16, lineHeight: 20 },
  myMessageText: { color: 'white' },
  otherMessageText: { color: 'white' },
  messageTime: { fontSize: 11, marginTop: 4 },
  myMessageTime: { color: 'rgba(255,255,255,0.7)', textAlign: 'right' },
  otherMessageTime: { color: '#6B7280' },
  inputContainer: {
    flexDirection: 'row',
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#1F2937',
    alignItems: 'flex-end',
  },
  textInput: {
    flex: 1,
    backgroundColor: '#1F2937',
    color: 'white',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 20,
    marginRight: 8,
    maxHeight: 100,
    fontSize: 16,
  },
  sendButton: {
    backgroundColor: '#F97316',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButtonDisabled: { backgroundColor: '#374151' },
  sendButtonText: { color: 'white', fontSize: 16, fontWeight: '600' },
})
