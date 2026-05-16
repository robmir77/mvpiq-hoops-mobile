import React, { useState, useContext } from 'react'
import {
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native'
import { useNavigation } from '@react-navigation/native'
import { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { AuthContext } from '@/features/auth/context/AuthContext'
import { searchUsers, createConversation } from '../api/messaging.api'
import { MainStackParamList } from '@/app/navigation/types'

type NavigationProp = NativeStackNavigationProp<MainStackParamList>

type SearchUser = {
  id: string
  username: string
  displayName: string
  avatar?: string
}

export default function NewChatScreen() {
  const navigation = useNavigation<NavigationProp>()
  const auth = useContext(AuthContext)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchUser[]>([])
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState<string | null>(null) // userId in creazione

  const handleSearch = async (text: string) => {
    setQuery(text)
    if (text.trim().length < 2) {
      setResults([])
      return
    }
    setLoading(true)
    try {
      const users = await searchUsers(text.trim())
      // Escludi l'utente corrente dai risultati
      setResults(users.filter((u: SearchUser) => u.id !== auth?.user?.id))
    } catch (e) {
      console.error('Ricerca utenti fallita:', e)
    } finally {
      setLoading(false)
    }
  }

  const handleStartChat = async (user: SearchUser) => {
    if (!auth?.user?.id) return
    setCreating(user.id)
    try {
      const conversation = await createConversation({
        title: user.displayName || user.username,
        participantIds: [auth.user.id, user.id],
      })
      // Vai alla chat appena creata
      navigation.replace('ChatScreen', { conversationId: conversation.id })
    } catch (e) {
      console.error('Creazione conversazione fallita:', e)
    } finally {
      setCreating(null)
    }
  }

  const renderUser = ({ item }: { item: SearchUser }) => {
    const isCreating = creating === item.id
    return (
      <TouchableOpacity
        style={styles.userItem}
        onPress={() => handleStartChat(item)}
        disabled={isCreating}
        activeOpacity={0.7}
      >
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {(item.displayName || item.username)?.[0]?.toUpperCase() || '?'}
          </Text>
        </View>
        <View style={styles.userInfo}>
          <Text style={styles.displayName}>{item.displayName || item.username}</Text>
          {item.displayName ? (
            <Text style={styles.username}>@{item.username}</Text>
          ) : null}
        </View>
        {isCreating ? (
          <ActivityIndicator size="small" color="#F97316" />
        ) : (
          <Text style={styles.arrow}>›</Text>
        )}
      </TouchableOpacity>
    )
  }

  return (
    <View style={styles.container}>
      <View style={styles.searchContainer}>
        <TextInput
          style={styles.searchInput}
          placeholder="Cerca per nome o username..."
          placeholderTextColor="#6B7280"
          value={query}
          onChangeText={handleSearch}
          autoFocus
          autoCapitalize="none"
        />
      </View>

      {loading && (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#F97316" />
        </View>
      )}

      {!loading && query.length >= 2 && results.length === 0 && (
        <View style={styles.center}>
          <Text style={styles.emptyText}>Nessun utente trovato</Text>
        </View>
      )}

      {!loading && query.length < 2 && (
        <View style={styles.center}>
          <Text style={styles.hintText}>Digita almeno 2 caratteri per cercare</Text>
        </View>
      )}

      <FlatList
        data={results}
        keyExtractor={(item) => item.id}
        renderItem={renderUser}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0B0F1A' },
  searchContainer: { padding: 16 },
  searchInput: {
    backgroundColor: '#1F2937',
    color: 'white',
    padding: 14,
    borderRadius: 12,
    fontSize: 16,
  },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 40 },
  emptyText: { color: '#6B7280', fontSize: 16 },
  hintText: { color: '#4B5563', fontSize: 14 },
  list: { paddingHorizontal: 16 },
  userItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1F2937',
  },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: '#374151',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  avatarText: { color: 'white', fontSize: 18, fontWeight: 'bold' },
  userInfo: { flex: 1 },
  displayName: { color: 'white', fontSize: 16, fontWeight: '600' },
  username: { color: '#6B7280', fontSize: 13, marginTop: 2 },
  arrow: { color: '#F97316', fontSize: 22, fontWeight: 'bold' },
})
