// src/shared/api/supportedEndpoints.ts
// Lista degli endpoint API effettivamente supportati dal backend MVPiQ Hoops

export const SUPPORTED_ENDPOINTS = {
  // Autenticazione
  AUTH: {
    REGISTER: 'POST /api/auth/register',
    LOGIN: 'POST /api/auth/login', 
    LOGOUT: 'POST /api/auth/logout'
  },

  // Player Profile Management
  PLAYER_PROFILES: {
    CREATE: 'POST /api/player-profiles',
    GET_BY_ID: 'GET /api/player-profiles/{id}',
    GET_BY_USER: 'GET /api/player-profiles/user/{userId}',
    UPDATE: 'PUT /api/player-profiles/{id}',
    DELETE: 'DELETE /api/player-profiles/{id}'
  },

  // Athlete Management (Alternative Endpoints)
  ATHLETES: {
    GET_ALL: 'GET /api/athletes',
    GET_BY_ID: 'GET /api/athlet/{id}',
    GET_BY_USER: 'GET /api/athlet/user/{userId}',
    UPDATE: 'PUT /api/athlet/{id}'
  },

  // Goals Management
  GOALS: {
    GET_BY_ATHLETE: 'GET /api/goals/{athleteId}',
    CREATE: 'POST /api/goals/{athleteId}',
    UPDATE: 'PUT /api/goals/{goalId}'
  },

  // Player CV Management
  CV: {
    GET: 'GET /api/players/{playerId}/cv',
    UPDATE: 'PUT /api/players/{playerId}/cv'
  },

  // Position Metadata
  POSITIONS: {
    GET_ALL: 'GET /api/positions'
  },

  // Users
  USERS: {
    GET_ME: 'GET /api/users/me/{userId}'
  }
} as const

export const UNSUPPORTED_FEATURES = [
  'Exercises',
  'Scouting', 
  'TrainerFollow',
  'Messaging',
  'Ranking',
  'Teams',
  'Social',
  'Badges',
  'Journal',
  'Video Analysis',
  'Training Programs',
  'Feed Ufficiale'
] as const

export type SupportedEndpoint = typeof SUPPORTED_ENDPOINTS
