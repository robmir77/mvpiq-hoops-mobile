import React, { useState } from 'react'
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  RefreshControl,
} from 'react-native'
import { useSocial } from '../hooks/useSocial'
import { Activity, CommunityPost } from '../types/social.types'
import { ACTIVITY_TYPE_LABELS, POST_TYPE_LABELS, POST_TYPE_ICONS } from '../api/social.api'

export default function SocialFeedScreen() {
  const { feed, loading, loadMore, likeActivity, unlikeActivity, likePost, unlikePost, refresh } = useSocial()
  const [refreshing, setRefreshing] = useState(false)
  const [newPost, setNewPost] = useState({ title: '', content: '', type: 'DISCUSSION' as const })
  const [showNewPost, setShowNewPost] = useState(false)

  const handleRefresh = async () => {
    setRefreshing(true)
    await refresh()
    setRefreshing(false)
  }

  const handleCreatePost = async () => {
    if (newPost.title.trim() === '' || newPost.content.trim() === '') {
      Alert.alert('Attenzione', 'Compila tutti i campi')
      return
    }

    try {
      // Mock implementation - would call createCommunityPost
      Alert.alert('Successo', 'Post creato!')
      setNewPost({ title: '', content: '', type: 'DISCUSSION' })
      setShowNewPost(false)
      refresh()
    } catch (error) {
      Alert.alert('Errore', 'Impossibile creare il post')
    }
  }

  const handleLikeActivity = async (activity: Activity) => {
    try {
      if (activity.isLiked) {
        await unlikeActivity(activity.id)
      } else {
        await likeActivity(activity.id)
      }
    } catch (error) {
      Alert.alert('Errore', 'Impossibile aggiornare il like')
    }
  }

  const handleLikePost = async (post: CommunityPost) => {
    try {
      if (post.isLiked) {
        await unlikePost(post.id)
      } else {
        await likePost(post.id)
      }
    } catch (error) {
      Alert.alert('Errore', 'Impossibile aggiornare il like')
    }
  }

  const renderActivity = (activity: Activity) => (
    <View key={activity.id} style={styles.activityCard}>
      <View style={styles.activityHeader}>
        <View style={styles.userInfo}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {activity.user?.displayName?.[0]?.toUpperCase() || '?'}
            </Text>
          </View>
          <View style={styles.userDetails}>
            <Text style={styles.userName}>{activity.user?.displayName || 'Utente'}</Text>
            <Text style={styles.userRole}>{activity.user?.role || 'player'}</Text>
          </View>
        </View>
        <Text style={styles.activityTime}>
          {new Date(activity.createdAt).toLocaleDateString('it-IT')}
        </Text>
      </View>

      <View style={styles.activityContent}>
        <Text style={styles.activityType}>
          {ACTIVITY_TYPE_LABELS[activity.type]}
        </Text>
        <Text style={styles.activityTitle}>{activity.title}</Text>
        <Text style={styles.activityDescription}>{activity.description}</Text>
      </View>

      <View style={styles.activityActions}>
        <TouchableOpacity 
          style={[
            styles.actionButton,
            activity.isLiked && styles.actionButtonActive
          ]}
          onPress={() => handleLikeActivity(activity)}
        >
          <Text style={[
            styles.actionButtonText,
            activity.isLiked && styles.actionButtonTextActive
          ]}>
            ❤️ {activity.likes.length}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionButton}>
          <Text style={styles.actionButtonText}>💬 {activity.comments.length}</Text>
        </TouchableOpacity>
      </View>
    </View>
  )

  const renderPost = (post: CommunityPost) => (
    <View key={post.id} style={styles.postCard}>
      <View style={styles.postHeader}>
        <View style={styles.postType}>
          <Text style={styles.postTypeIcon}>{POST_TYPE_ICONS[post.type]}</Text>
          <Text style={styles.postTypeLabel}>{POST_TYPE_LABELS[post.type]}</Text>
        </View>
        <Text style={styles.postTime}>
          {new Date(post.createdAt).toLocaleDateString('it-IT')}
        </Text>
      </View>

      <Text style={styles.postTitle}>{post.title}</Text>
      <Text style={styles.postContent}>{post.content}</Text>

      {post.tags.length > 0 && (
        <View style={styles.tagsContainer}>
          {post.tags.map((tag, index) => (
            <View key={index} style={styles.tag}>
              <Text style={styles.tagText}>#{tag}</Text>
            </View>
          ))}
        </View>
      )}

      <View style={styles.postStats}>
        <View style={styles.stat}>
          <Text style={styles.statNumber}>{post.views}</Text>
          <Text style={styles.statLabel}>visualizzazioni</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statNumber}>{post.comments}</Text>
          <Text style={styles.statLabel}>commenti</Text>
        </View>
      </View>

      <View style={styles.postActions}>
        <TouchableOpacity 
          style={[
            styles.actionButton,
            post.isLiked && styles.actionButtonActive
          ]}
          onPress={() => handleLikePost(post)}
        >
          <Text style={[
            styles.actionButtonText,
            post.isLiked && styles.actionButtonTextActive
          ]}>
            ❤️ {post.likes}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionButton}>
          <Text style={styles.actionButtonText}>💬 Commenta</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionButton}>
          <Text style={styles.actionButtonText}>🔗 Condividi</Text>
        </TouchableOpacity>
      </View>
    </View>
  )

  if (loading && feed.activities.length === 0 && feed.posts.length === 0) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#F97316" />
      </View>
    )
  }

  return (
    <ScrollView 
      style={styles.container}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
      }
    >
      <View style={styles.header}>
        <Text style={styles.title}>Community</Text>
        <TouchableOpacity 
          style={styles.createButton}
          onPress={() => setShowNewPost(true)}
        >
          <Text style={styles.createButtonText}>+</Text>
        </TouchableOpacity>
      </View>

      {showNewPost && (
        <View style={styles.newPostSection}>
          <Text style={styles.newPostTitle}>Crea un Post</Text>
          <TextInput
            style={styles.postTitleInput}
            placeholder="Titolo del post..."
            placeholderTextColor="#6B7280"
            value={newPost.title}
            onChangeText={(text) => setNewPost(prev => ({ ...prev, title: text }))}
          />
          <TextInput
            style={styles.postContentInput}
            placeholder="Contenuto del post..."
            placeholderTextColor="#6B7280"
            value={newPost.content}
            onChangeText={(text) => setNewPost(prev => ({ ...prev, content: text }))}
            multiline
            numberOfLines={4}
          />
          <View style={styles.newPostActions}>
            <TouchableOpacity 
              style={styles.cancelButton}
              onPress={() => setShowNewPost(false)}
            >
              <Text style={styles.cancelButtonText}>Annulla</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={styles.publishButton}
              onPress={handleCreatePost}
            >
              <Text style={styles.publishButtonText}>Pubblica</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <View style={styles.feed}>
        {/* Mix activities and posts chronologically */}
        {[...feed.activities, ...feed.posts]
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
          .map(item => 'user' in item ? renderActivity(item) : renderPost(item))}

        {feed.hasMore && (
          <TouchableOpacity style={styles.loadMoreButton} onPress={loadMore}>
            <Text style={styles.loadMoreText}>Carica altro</Text>
          </TouchableOpacity>
        )}

        {feed.activities.length === 0 && feed.posts.length === 0 && !loading && (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>Nessuna attività nella community</Text>
            <Text style={styles.emptySubtext}>Sii il primo a condividere qualcosa!</Text>
          </View>
        )}
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0B0F1A',
    padding: 20,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0B0F1A',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: 'white',
  },
  createButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F97316',
    justifyContent: 'center',
    alignItems: 'center',
  },
  createButtonText: {
    color: 'white',
    fontSize: 24,
    fontWeight: 'bold',
  },
  newPostSection: {
    backgroundColor: '#1F2937',
    padding: 16,
    borderRadius: 12,
    marginBottom: 24,
  },
  newPostTitle: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 12,
  },
  postTitleInput: {
    backgroundColor: '#374151',
    color: 'white',
    padding: 12,
    borderRadius: 8,
    fontSize: 16,
    marginBottom: 12,
  },
  postContentInput: {
    backgroundColor: '#374151',
    color: 'white',
    padding: 12,
    borderRadius: 8,
    fontSize: 16,
    textAlignVertical: 'top',
    minHeight: 100,
    marginBottom: 16,
  },
  newPostActions: {
    flexDirection: 'row',
    gap: 8,
  },
  cancelButton: {
    flex: 1,
    backgroundColor: '#6B7280',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  cancelButtonText: {
    color: 'white',
    fontWeight: '600',
  },
  publishButton: {
    flex: 1,
    backgroundColor: '#F97316',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  publishButtonText: {
    color: 'white',
    fontWeight: '600',
  },
  feed: {
    gap: 16,
  },
  activityCard: {
    backgroundColor: '#1F2937',
    padding: 16,
    borderRadius: 12,
  },
  activityHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  userInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#374151',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  avatarText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
  userDetails: {
    flex: 1,
  },
  userName: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  userRole: {
    color: '#9CA3AF',
    fontSize: 12,
  },
  activityTime: {
    color: '#6B7280',
    fontSize: 12,
  },
  activityContent: {
    marginBottom: 12,
  },
  activityType: {
    color: '#F97316',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 4,
  },
  activityTitle: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  activityDescription: {
    color: '#9CA3AF',
    fontSize: 14,
    lineHeight: 20,
  },
  postCard: {
    backgroundColor: '#1F2937',
    padding: 16,
    borderRadius: 12,
  },
  postHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  postType: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  postTypeIcon: {
    fontSize: 16,
    marginRight: 4,
  },
  postTypeLabel: {
    color: '#F97316',
    fontSize: 12,
    fontWeight: '600',
  },
  postTime: {
    color: '#6B7280',
    fontSize: 12,
  },
  postTitle: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  postContent: {
    color: '#9CA3AF',
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 12,
  },
  tagsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 12,
  },
  tag: {
    backgroundColor: '#374151',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  tagText: {
    color: '#F97316',
    fontSize: 12,
  },
  postStats: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 12,
  },
  stat: {
    alignItems: 'center',
  },
  statNumber: {
    color: 'white',
    fontSize: 14,
    fontWeight: 'bold',
  },
  statLabel: {
    color: '#6B7280',
    fontSize: 12,
  },
  activityActions: {
    flexDirection: 'row',
    gap: 8,
  },
  postActions: {
    flexDirection: 'row',
    gap: 8,
  },
  actionButton: {
    backgroundColor: '#374151',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  actionButtonActive: {
    backgroundColor: '#F97316',
  },
  actionButtonText: {
    color: '#9CA3AF',
    fontSize: 12,
    fontWeight: '600',
  },
  actionButtonTextActive: {
    color: 'white',
  },
  loadMoreButton: {
    backgroundColor: '#1F2937',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  loadMoreText: {
    color: '#F97316',
    fontSize: 16,
    fontWeight: '600',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyText: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  emptySubtext: {
    color: '#9CA3AF',
    fontSize: 14,
  },
})
