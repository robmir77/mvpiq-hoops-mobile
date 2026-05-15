import apiClient from '@/shared/api/apiClient'
import { Badge, UserBadge, BadgeProgress } from '../types/badges.types'

// Export types for use in other components
export type { Badge, UserBadge, BadgeProgress }

export const getUserBadges = async (userId: string): Promise<UserBadge[]> => {
  try {
    const response = await apiClient.get(`/users/${userId}/badges`)
    return response.data
  } catch (error) {
    console.error('Error fetching user badges:', error)
    return []
  }
}

export const getBadgeProgress = async (userId: string): Promise<BadgeProgress[]> => {
  try {
    const response = await apiClient.get(`/users/${userId}/badges/progress`)
    return response.data
  } catch (error) {
    console.error('Error fetching badge progress:', error)
    return []
  }
}

export const unlockBadge = async (userId: string, badgeType: string): Promise<UserBadge> => {
  try {
    const response = await apiClient.post(`/users/${userId}/badges/unlock`, { badgeType })
    return response.data
  } catch (error) {
    console.error('Error unlocking badge:', error)
    throw error
  }
}

export const getAvailableBadges = async (): Promise<Badge[]> => {
  try {
    const response = await apiClient.get('/badges')
    return response.data
  } catch (error) {
    console.error('Error fetching available badges:', error)
    return []
  }
}

// Badge definitions (in a real app, these would come from the backend)
export const BADGE_DEFINITIONS: Record<string, Omit<Badge, 'id' | 'unlockedAt' | 'progress' | 'maxProgress'>> = {
  FIRST_GOAL: {
    type: 'FIRST_GOAL',
    name: 'Primo Passo',
    description: 'Hai creato il tuo primo obiettivo',
    icon: '🎯',
    rarity: 'COMMON',
    points: 10
  },
  GOAL_STREAK_7: {
    type: 'GOAL_STREAK_7',
    name: 'Costanza',
    description: '7 giorni consecutivi di obiettivi',
    icon: '🔥',
    rarity: 'RARE',
    points: 50
  },
  GOAL_STREAK_30: {
    type: 'GOAL_STREAK_30',
    name: 'Campione',
    description: '30 giorni consecutivi di obiettivi',
    icon: '🏆',
    rarity: 'EPIC',
    points: 200
  },
  TRAINING_WARRIOR: {
    type: 'TRAINING_WARRIOR',
    name: 'Guerriero',
    description: '10 sessioni di allenamento completate',
    icon: '💪',
    rarity: 'RARE',
    points: 75
  },
  VIDEO_MASTER: {
    type: 'VIDEO_MASTER',
    name: 'Video Master',
    description: '5 video analisi completate',
    icon: '📹',
    rarity: 'RARE',
    points: 100
  },
  JOURNAL_KEEPER: {
    type: 'JOURNAL_KEEPER',
    name: 'Diario',
    description: '10 journal entries create',
    icon: '📝',
    rarity: 'COMMON',
    points: 30
  },
  RANKING_TOP_100: {
    type: 'RANKING_TOP_100',
    name: 'Elite',
    description: 'Top 100 nel ranking globale',
    icon: '🌟',
    rarity: 'EPIC',
    points: 150
  },
  RANKING_TOP_10: {
    type: 'RANKING_TOP_10',
    name: 'Leggenda',
    description: 'Top 10 nel ranking globale',
    icon: '👑',
    rarity: 'LEGENDARY',
    points: 500
  },
  PROFILE_COMPLETE: {
    type: 'PROFILE_COMPLETE',
    name: 'Profilo Completo',
    description: 'Profilo compilato al 100%',
    icon: '✨',
    rarity: 'COMMON',
    points: 25
  },
  SOCIAL_BUTTERFLY: {
    type: 'SOCIAL_BUTTERFLY',
    name: 'Social',
    description: '5 follow ricevuti',
    icon: '🦋',
    rarity: 'RARE',
    points: 60
  },
  SCOUT_FAVORITE: {
    type: 'SCOUT_FAVORITE',
    name: 'Scout Choice',
    description: 'Segnalato da uno scout',
    icon: '🎖️',
    rarity: 'EPIC',
    points: 180
  },
  TEAM_PLAYER: {
    type: 'TEAM_PLAYER',
    name: 'Team Player',
    description: 'Membro di una squadra',
    icon: '🤝',
    rarity: 'COMMON',
    points: 20
  }
}
