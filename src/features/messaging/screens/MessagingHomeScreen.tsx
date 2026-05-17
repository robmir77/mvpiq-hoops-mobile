// src/features/messaging/screens/MessagingHomeScreen.tsx

import React, { useContext, useState } from 'react'
import {
    View, Text, ScrollView, StyleSheet,
    TouchableOpacity, TextInput, ActivityIndicator, Image,
} from 'react-native'
import { useNavigation } from '@react-navigation/native'
import { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { AuthContext } from '@/features/auth/context/AuthContext'
import { useMessaging } from '../hooks/useMessaging'
import { Conversation, getOtherParticipant } from '../types/messaging.types'
import { MainStackParamList } from '@/app/navigation/types'

export default function MessagingHomeScreen() {
    const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>()
    const auth = useContext(AuthContext)
    const currentUserId = auth?.user?.id ?? ''
    const { conversations, loading, selectConversation } = useMessaging()
    const [searchQuery, setSearchQuery] = useState('')

    const filteredConversations = conversations.filter(conv => {
        const other = getOtherParticipant(conv, currentUserId)
        const name = other?.displayName || other?.username || conv.title || ''
        return name.toLowerCase().includes(searchQuery.toLowerCase())
    })

    const formatTime = (dateString?: string) => {
        if (!dateString) return ''
        const date = new Date(dateString)
        const diffH = (Date.now() - date.getTime()) / 3600000
        if (diffH < 1) return 'Ora'
        if (diffH < 24) return `${Math.floor(diffH)}h fa`
        if (diffH < 48) return 'Ieri'
        return date.toLocaleDateString('it-IT', { day: 'numeric', month: 'numeric' })
    }

    const formatLastMessage = (message: any) => {
        if (!message) return 'Nessun messaggio'
        const content = message.content || ''
        return content.length > 40 ? content.substring(0, 40) + '...' : content
    }

    if (loading) {
        return (
            <View style={styles.center}>
                <ActivityIndicator size="large" color="#F97316" />
            </View>
        )
    }

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <Text style={styles.title}>Messaggi</Text>
                <TouchableOpacity
                    style={styles.newChatButton}
                    onPress={() => navigation.navigate('NewChat')}
                >
                    <Text style={styles.newChatButtonText}>+</Text>
                </TouchableOpacity>
            </View>

            <View style={styles.searchContainer}>
                <TextInput
                    style={styles.searchInput}
                    placeholder="Cerca conversazioni..."
                    placeholderTextColor="#6B7280"
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                />
            </View>

            <ScrollView style={styles.conversationsList}>
                {filteredConversations.map(conversation => {
                    // ✅ Fix: usa getOtherParticipant con l'userId corrente
                    const other = getOtherParticipant(conversation, currentUserId)
                    const displayName = other?.displayName || other?.username || conversation.title || 'Sconosciuto'
                    const initial = displayName[0]?.toUpperCase() ?? '?'

                    return (
                        <TouchableOpacity
                            key={conversation.id}
                            style={styles.conversationItem}
                            onPress={async () => {
                                await selectConversation(conversation)
                                navigation.navigate('ChatScreen', { conversationId: conversation.id })
                            }}
                        >
                            <View style={styles.avatarContainer}>
                                {other?.avatarUrl ? (
                                    <Image source={{ uri: other.avatarUrl }} style={styles.avatar} />
                                ) : (
                                    <View style={styles.avatarPlaceholder}>
                                        <Text style={styles.avatarText}>{initial}</Text>
                                    </View>
                                )}
                                {other?.isOnline && <View style={styles.onlineIndicator} />}
                            </View>

                            <View style={styles.conversationContent}>
                                <View style={styles.conversationHeader}>
                                    <Text style={styles.participantName}>{displayName}</Text>
                                    <Text style={styles.messageTime}>
                                        {formatTime(conversation.lastMessage?.createdAt)}
                                    </Text>
                                </View>
                                <View style={styles.conversationFooter}>
                                    <Text style={styles.lastMessage} numberOfLines={1}>
                                        {formatLastMessage(conversation.lastMessage)}
                                    </Text>
                                    {(conversation.unreadCount ?? 0) > 0 && (
                                        <View style={styles.unreadBadge}>
                                            <Text style={styles.unreadCount}>
                                                {(conversation.unreadCount ?? 0) > 99 ? '99+' : conversation.unreadCount}
                                            </Text>
                                        </View>
                                    )}
                                </View>
                            </View>
                        </TouchableOpacity>
                    )
                })}

                {filteredConversations.length === 0 && (
                    <View style={styles.emptyState}>
                        <Text style={styles.emptyText}>
                            {searchQuery ? 'Nessuna conversazione trovata' : 'Nessuna conversazione'}
                        </Text>
                        <TouchableOpacity
                            style={styles.startChatButton}
                            onPress={() => navigation.navigate('NewChat')}
                        >
                            <Text style={styles.startChatButtonText}>Inizia una conversazione</Text>
                        </TouchableOpacity>
                    </View>
                )}
            </ScrollView>
        </View>
    )
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#0B0F1A' },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0B0F1A' },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingBottom: 10 },
    title: { fontSize: 28, fontWeight: 'bold', color: 'white' },
    newChatButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#F97316', justifyContent: 'center', alignItems: 'center' },
    newChatButtonText: { color: 'white', fontSize: 24, fontWeight: 'bold' },
    searchContainer: { paddingHorizontal: 20, paddingBottom: 10 },
    searchInput: { backgroundColor: '#1F2937', color: 'white', padding: 12, borderRadius: 12, fontSize: 16 },
    conversationsList: { flex: 1, paddingHorizontal: 20 },
    conversationItem: { flexDirection: 'row', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#1F2937' },
    avatarContainer: { marginRight: 12, position: 'relative' },
    avatar: { width: 50, height: 50, borderRadius: 25 },
    avatarPlaceholder: { width: 50, height: 50, borderRadius: 25, backgroundColor: '#374151', justifyContent: 'center', alignItems: 'center' },
    avatarText: { color: 'white', fontSize: 18, fontWeight: 'bold' },
    onlineIndicator: { position: 'absolute', bottom: 0, right: 0, width: 14, height: 14, borderRadius: 7, backgroundColor: '#10B981', borderWidth: 2, borderColor: '#0B0F1A' },
    conversationContent: { flex: 1, justifyContent: 'center' },
    conversationHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
    participantName: { color: 'white', fontSize: 16, fontWeight: '600', flex: 1 },
    messageTime: { color: '#6B7280', fontSize: 12 },
    conversationFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    lastMessage: { color: '#9CA3AF', fontSize: 14, flex: 1, marginRight: 8 },
    unreadBadge: { backgroundColor: '#F97316', borderRadius: 10, minWidth: 20, height: 20, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 6 },
    unreadCount: { color: 'white', fontSize: 12, fontWeight: 'bold' },
    emptyState: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 60 },
    emptyText: { color: '#9CA3AF', fontSize: 16, marginBottom: 20 },
    startChatButton: { backgroundColor: '#F97316', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 8 },
    startChatButtonText: { color: 'white', fontSize: 16, fontWeight: '600' },
})
