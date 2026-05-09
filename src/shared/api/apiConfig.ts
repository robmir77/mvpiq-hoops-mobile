// src/shared/api/apiConfig.ts
// Configurazione per abilitare/disabilitare feature basate sul supporto backend

import { UNSUPPORTED_FEATURES } from './supportedEndpoints'

export const FEATURE_FLAGS = {
  // Features supportate dal backend
  AUTHENTICATION: true,
  PLAYER_PROFILES: true,
  GOALS: true,
  CV_MANAGEMENT: true,
  POSITIONS: true,
  USERS: true,

  // Features NON supportate dal backend
  EXERCISES: false,
  SCOUTING: false,
  TRAINER_FOLLOW: false,
  MESSAGING: false,
  RANKING: false,
  TEAMS: false,
  SOCIAL: false,
  BADGES: false,
  JOURNAL: false,
  VIDEO_ANALYSIS: false,
  TRAINING_PROGRAMS: false,
  FEED_UFFICIALE: false
} as const

export const isFeatureSupported = (feature: keyof typeof FEATURE_FLAGS): boolean => {
  return FEATURE_FLAGS[feature]
}

export const getUnsupportedFeatures = (): string[] => {
  return [...UNSUPPORTED_FEATURES] as string[]
}

// Hook per controllare se una feature è disponibile
export const useFeatureFlag = (feature: keyof typeof FEATURE_FLAGS) => {
  return FEATURE_FLAGS[feature]
}
