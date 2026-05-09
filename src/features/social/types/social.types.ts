export type FollowStatus = 'FOLLOWING' | 'NOT_FOLLOWING' | 'PENDING'

export type Follow = {
  id: string
  followerId: string
  followingId: string
  createdAt: string
}

export type UserFollowStats = {
  followersCount: number
  followingCount: number
  isFollowing: FollowStatus
}

export type ActivityType = 
  | 'NEW_GOAL'
  | 'GOAL_COMPLETED'
  | 'TRAINING_SESSION'
  | 'VIDEO_UPLOADED'
  | 'BADGE_EARNED'
  | 'TEAM_JOINED'
  | 'RANKING_IMPROVED'
  | 'PROFILE_UPDATED'

export type Activity = {
  id: string
  userId: string
  type: ActivityType
  title: string
  description: string
  data?: any
  createdAt: string
  user?: ActivityUser
  likes: ActivityLike[]
  comments: ActivityComment[]
  isLiked: boolean
}

export type ActivityUser = {
  id: string
  username: string
  displayName: string
  avatar?: string
  role: string
}

export type ActivityLike = {
  id: string
  userId: string
  activityId: string
  createdAt: string
  user?: ActivityUser
}

export type ActivityComment = {
  id: string
  userId: string
  activityId: string
  content: string
  createdAt: string
  user?: ActivityUser
}

export type CommunityPost = {
  id: string
  userId: string
  title: string
  content: string
  type: 'TIP' | 'QUESTION' | 'EXPERIENCE' | 'ACHIEVEMENT' | 'DISCUSSION'
  tags: string[]
  attachments: PostAttachment[]
  likes: number
  comments: number
  views: number
  createdAt: string
  updatedAt: string
  user?: ActivityUser
  isLiked: boolean
}

export type PostAttachment = {
  id: string
  type: 'IMAGE' | 'VIDEO' | 'LINK'
  url: string
  thumbnail?: string
  title?: string
}

export type SocialFeed = {
  activities: Activity[]
  posts: CommunityPost[]
  hasMore: boolean
  nextCursor?: string
}

export type UserSocialProfile = {
  userId: string
  followers: Follow[]
  following: Follow[]
  stats: UserFollowStats
  recentActivity: Activity[]
  isPublic: boolean
}
