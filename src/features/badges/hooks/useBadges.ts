import { useState, useEffect, useContext } from 'react'
import { AuthContext } from '@/features/auth/context/AuthContext'
import { getUserBadges, getBadgeProgress, UserBadge, BadgeProgress } from '../api/badges.api'

export const useBadges = () => {
  const auth = useContext(AuthContext)
  const [badges, setBadges] = useState<UserBadge[]>([])
  const [progress, setProgress] = useState<BadgeProgress[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (auth?.user?.id) {
      loadBadges()
    }
  }, [auth?.user?.id])

  const loadBadges = async () => {
    try {
      const userId = auth!.user!.id
      const [badgesData, progressData] = await Promise.all([
        getUserBadges(userId),
        getBadgeProgress(userId)
      ])
      setBadges(badgesData)
      setProgress(progressData)
    } catch (error) {
      console.error('Error loading badges:', error)
    } finally {
      setLoading(false)
    }
  }

  const totalPoints = badges.reduce((sum, badge) => sum + badge.points, 0)
  const unlockedCount = badges.length

  return {
    badges,
    progress,
    loading,
    totalPoints,
    unlockedCount,
    refetch: loadBadges
  }
}
