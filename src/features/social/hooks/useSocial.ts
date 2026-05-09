import { useState, useEffect, useContext } from 'react'
import { AuthContext } from '@/features/auth/context/AuthContext'
import { 
  followUser,
  unfollowUser,
  getUserFollowStats,
  getSocialFeed,
  likeActivity,
  unlikeActivity,
  commentOnActivity,
  likePost,
  unlikePost,
  commentOnPost,
  trackUserActivity,
  UserFollowStats,
  Activity,
  CommunityPost,
  SocialFeed
} from '../api/social.api'

export const useSocial = () => {
  const auth = useContext(AuthContext)
  const [feed, setFeed] = useState<SocialFeed>({
    activities: [],
    posts: [],
    hasMore: false
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (auth?.user?.id) {
      loadFeed()
    }
  }, [auth?.user?.id])

  const loadFeed = async (cursor?: string) => {
    try {
      setLoading(true)
      const feedData = await getSocialFeed(cursor)
      
      if (cursor) {
        setFeed(prev => ({
          ...feedData,
          activities: [...prev.activities, ...feedData.activities],
          posts: [...prev.posts, ...feedData.posts]
        }))
      } else {
        setFeed(feedData)
      }
    } catch (error) {
      console.error('Error loading social feed:', error)
    } finally {
      setLoading(false)
    }
  }

  const loadMore = () => {
    if (feed.hasMore && feed.nextCursor) {
      loadFeed(feed.nextCursor)
    }
  }

  const handleFollowUser = async (userId: string) => {
    try {
      await followUser(userId)
      // Refresh feed to show new activity
      loadFeed()
    } catch (error) {
      console.error('Error following user:', error)
      throw error
    }
  }

  const handleUnfollowUser = async (userId: string) => {
    try {
      await unfollowUser(userId)
      // Refresh feed
      loadFeed()
    } catch (error) {
      console.error('Error unfollowing user:', error)
      throw error
    }
  }

  const handleLikeActivity = async (activityId: string) => {
    try {
      await likeActivity(activityId)
      setFeed(prev => ({
        ...prev,
        activities: prev.activities.map(activity => 
          activity.id === activityId 
            ? { ...activity, isLiked: true, likes: [...activity.likes, { id: 'temp', userId: auth!.user!.id, activityId, createdAt: new Date().toISOString() }] }
            : activity
        )
      }))
    } catch (error) {
      console.error('Error liking activity:', error)
      throw error
    }
  }

  const handleUnlikeActivity = async (activityId: string) => {
    try {
      await unlikeActivity(activityId)
      setFeed(prev => ({
        ...prev,
        activities: prev.activities.map(activity => 
          activity.id === activityId 
            ? { ...activity, isLiked: false, likes: activity.likes.filter(like => like.userId !== auth!.user!.id) }
            : activity
        )
      }))
    } catch (error) {
      console.error('Error unliking activity:', error)
      throw error
    }
  }

  const handleLikePost = async (postId: string) => {
    try {
      await likePost(postId)
      setFeed(prev => ({
        ...prev,
        posts: prev.posts.map(post => 
          post.id === postId 
            ? { ...post, isLiked: true, likes: post.likes + 1 }
            : post
        )
      }))
    } catch (error) {
      console.error('Error liking post:', error)
      throw error
    }
  }

  const handleUnlikePost = async (postId: string) => {
    try {
      await unlikePost(postId)
      setFeed(prev => ({
        ...prev,
        posts: prev.posts.map(post => 
          post.id === postId 
            ? { ...post, isLiked: false, likes: Math.max(0, post.likes - 1) }
            : post
        )
      }))
    } catch (error) {
      console.error('Error unliking post:', error)
      throw error
    }
  }

  const trackActivity = async (type: string, data?: any) => {
    try {
      const activity = await trackUserActivity(type as any, data)
      // Add to beginning of feed
      setFeed(prev => ({
        ...prev,
        activities: [activity, ...prev.activities]
      }))
      return activity
    } catch (error) {
      console.error('Error tracking activity:', error)
      throw error
    }
  }

  const refresh = () => {
    loadFeed()
  }

  return {
    feed,
    loading,
    loadMore,
    followUser: handleFollowUser,
    unfollowUser: handleUnfollowUser,
    likeActivity: handleLikeActivity,
    unlikeActivity: handleUnlikeActivity,
    likePost: handleLikePost,
    unlikePost: handleUnlikePost,
    trackActivity,
    refresh
  }
}

export const useUserSocial = (userId: string) => {
  const [stats, setStats] = useState<UserFollowStats>({
    followersCount: 0,
    followingCount: 0,
    isFollowing: 'NOT_FOLLOWING'
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadUserStats()
  }, [userId])

  const loadUserStats = async () => {
    try {
      setLoading(true)
      const statsData = await getUserFollowStats(userId)
      setStats(statsData)
    } catch (error) {
      console.error('Error loading user stats:', error)
    } finally {
      setLoading(false)
    }
  }

  return {
    stats,
    loading,
    refresh: loadUserStats
  }
}
