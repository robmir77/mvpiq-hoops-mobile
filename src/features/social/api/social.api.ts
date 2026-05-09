import apiClient from '@/shared/api/apiClient'
import { 
  Follow, 
  UserFollowStats,
  Activity,
  ActivityType,
  CommunityPost,
  SocialFeed,
  UserSocialProfile
} from '../types/social.types'

export const followUser = async (userId: string): Promise<Follow> => {
  try {
    const response = await apiClient.post(`/social/follow/${userId}`)
    return response.data
  } catch (error) {
    console.error('Error following user:', error)
    throw error
  }
}

export const unfollowUser = async (userId: string): Promise<void> => {
  try {
    await apiClient.delete(`/social/follow/${userId}`)
  } catch (error) {
    console.error('Error unfollowing user:', error)
    throw error
  }
}

export const getUserFollowStats = async (userId: string): Promise<UserFollowStats> => {
  try {
    const response = await apiClient.get(`/social/users/${userId}/stats`)
    return response.data
  } catch (error) {
    console.error('Error fetching user follow stats:', error)
    return {
      followersCount: 0,
      followingCount: 0,
      isFollowing: 'NOT_FOLLOWING'
    }
  }
}

export const getUserFollowers = async (userId: string, limit = 20): Promise<Follow[]> => {
  try {
    const response = await apiClient.get(`/social/users/${userId}/followers?limit=${limit}`)
    return response.data
  } catch (error) {
    console.error('Error fetching user followers:', error)
    return []
  }
}

export const getUserFollowing = async (userId: string, limit = 20): Promise<Follow[]> => {
  try {
    const response = await apiClient.get(`/social/users/${userId}/following?limit=${limit}`)
    return response.data
  } catch (error) {
    console.error('Error fetching user following:', error)
    return []
  }
}

export const getSocialFeed = async (cursor?: string, limit = 20): Promise<SocialFeed> => {
  try {
    const params = new URLSearchParams()
    if (cursor) params.append('cursor', cursor)
    params.append('limit', limit.toString())

    const response = await apiClient.get(`/social/feed?${params.toString()}`)
    return response.data
  } catch (error) {
    console.error('Error fetching social feed:', error)
    return {
      activities: [],
      posts: [],
      hasMore: false
    }
  }
}

export const getUserActivity = async (userId: string, limit = 20): Promise<Activity[]> => {
  try {
    const response = await apiClient.get(`/social/users/${userId}/activity?limit=${limit}`)
    return response.data
  } catch (error) {
    console.error('Error fetching user activity:', error)
    return []
  }
}

export const likeActivity = async (activityId: string): Promise<void> => {
  try {
    await apiClient.post(`/social/activities/${activityId}/like`)
  } catch (error) {
    console.error('Error liking activity:', error)
    throw error
  }
}

export const unlikeActivity = async (activityId: string): Promise<void> => {
  try {
    await apiClient.delete(`/social/activities/${activityId}/like`)
  } catch (error) {
    console.error('Error unliking activity:', error)
    throw error
  }
}

export const commentOnActivity = async (activityId: string, content: string): Promise<any> => {
  try {
    const response = await apiClient.post(`/social/activities/${activityId}/comments`, { content })
    return response.data
  } catch (error) {
    console.error('Error commenting on activity:', error)
    throw error
  }
}

export const createCommunityPost = async (post: {
  title: string
  content: string
  type: 'TIP' | 'QUESTION' | 'EXPERIENCE' | 'ACHIEVEMENT' | 'DISCUSSION'
  tags?: string[]
}): Promise<CommunityPost> => {
  try {
    const response = await apiClient.post('/social/posts', post)
    return response.data
  } catch (error) {
    console.error('Error creating community post:', error)
    throw error
  }
}

export const getCommunityPosts = async (type?: string, limit = 20): Promise<CommunityPost[]> => {
  try {
    const params = new URLSearchParams()
    if (type) params.append('type', type)
    params.append('limit', limit.toString())

    const response = await apiClient.get(`/social/posts?${params.toString()}`)
    return response.data
  } catch (error) {
    console.error('Error fetching community posts:', error)
    return []
  }
}

export const likePost = async (postId: string): Promise<void> => {
  try {
    await apiClient.post(`/social/posts/${postId}/like`)
  } catch (error) {
    console.error('Error liking post:', error)
    throw error
  }
}

export const unlikePost = async (postId: string): Promise<void> => {
  try {
    await apiClient.delete(`/social/posts/${postId}/like`)
  } catch (error) {
    console.error('Error unliking post:', error)
    throw error
  }
}

export const commentOnPost = async (postId: string, content: string): Promise<any> => {
  try {
    const response = await apiClient.post(`/social/posts/${postId}/comments`, { content })
    return response.data
  } catch (error) {
    console.error('Error commenting on post:', error)
    throw error
  }
}

export const getUserSocialProfile = async (userId: string): Promise<UserSocialProfile> => {
  try {
    const response = await apiClient.get(`/social/users/${userId}/profile`)
    return response.data
  } catch (error) {
    console.error('Error fetching user social profile:', error)
    throw error
  }
}

export const searchUsers = async (query: string, limit = 20): Promise<any[]> => {
  try {
    const response = await apiClient.get(`/social/users/search?q=${encodeURIComponent(query)}&limit=${limit}`)
    return response.data
  } catch (error) {
    console.error('Error searching users:', error)
    return []
  }
}

export const trackUserActivity = async (type: ActivityType, data?: any): Promise<Activity> => {
  try {
    const response = await apiClient.post('/social/activities', { type, data })
    return response.data
  } catch (error) {
    console.error('Error tracking user activity:', error)
    throw error
  }
}

// Constants for UI
export const ACTIVITY_TYPE_LABELS: Record<ActivityType, string> = {
  NEW_GOAL: 'Nuovo Obiettivo',
  GOAL_COMPLETED: 'Obiettivo Completato',
  TRAINING_SESSION: 'Sessione di Allenamento',
  VIDEO_UPLOADED: 'Video Caricato',
  BADGE_EARNED: 'Medaglia Ottenuta',
  TEAM_JOINED: 'Squadra Unitasi',
  RANKING_IMPROVED: 'Ranking Migliorato',
  PROFILE_UPDATED: 'Profilo Aggiornato'
}

export const POST_TYPE_LABELS = {
  TIP: 'Consiglio',
  QUESTION: 'Domanda',
  EXPERIENCE: 'Esperienza',
  ACHIEVEMENT: 'Achievement',
  DISCUSSION: 'Discussione'
}

export const POST_TYPE_ICONS = {
  TIP: '💡',
  QUESTION: '❓',
  EXPERIENCE: '🏆',
  ACHIEVEMENT: '🌟',
  DISCUSSION: '💬'
}
