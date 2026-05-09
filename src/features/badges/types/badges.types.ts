export type BadgeType = 
  | 'FIRST_GOAL'           // Primo obiettivo creato
  | 'GOAL_STREAK_7'        // 7 giorni consecutivi di obiettivi
  | 'GOAL_STREAK_30'       // 30 giorni consecutivi
  | 'TRAINING_WARRIOR'     // 10 sessioni allenamento
  | 'VIDEO_MASTER'         // 5 video analisi completate
  | 'JOURNAL_KEEPER'       // 10 journal entries
  | 'RANKING_TOP_100'      // Top 100 nel ranking
  | 'RANKING_TOP_10'       // Top 10 nel ranking
  | 'PROFILE_COMPLETE'     // Profilo completo al 100%
  | 'SOCIAL_BUTTERFLY'     // 5 follow ricevuti
  | 'SCOUT_FAVORITE'       // Segnalato da uno scout
  | 'TEAM_PLAYER'          // Membro di una squadra

export type Badge = {
  id: string
  type: BadgeType
  name: string
  description: string
  icon: string
  rarity: 'COMMON' | 'RARE' | 'EPIC' | 'LEGENDARY'
  points: number
  unlockedAt?: string
  progress?: number
  maxProgress?: number
}

export type UserBadge = Badge & {
  unlockedAt: string
  progress: number
  maxProgress: number
}

export type BadgeProgress = {
  badgeType: BadgeType
  current: number
  target: number
  unlocked: boolean
}
