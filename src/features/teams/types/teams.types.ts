export type TeamRole = 'PLAYER' | 'COACH' | 'ASSISTANT_COACH' | 'MANAGER' | 'OWNER'

export type TeamCategory = 
  | 'YOUTH'              // Giovanile
  | 'SENIOR'             // Senior
  | 'ACADEMY'            // Academy
  | 'PROFESSIONAL'       // Professionale
  | 'AMATEUR'            // Dilettantistico
  | 'SCHOOL'             // Scolastico

export type TeamStatus = 'ACTIVE' | 'INACTIVE' | 'RECRUITING' | 'SUSPENDED'

export type Team = {
  id: string
  name: string
  logo?: string
  category: TeamCategory
  status: TeamStatus
  foundedYear: number
  city: string
  region: string
  country: string
  description: string
  colors: string[]
  homeVenue?: string
  website?: string
  socialLinks: SocialLink[]
  stats: TeamStats
  createdAt: string
  updatedAt: string
}

export type TeamMember = {
  id: string
  teamId: string
  userId: string
  role: TeamRole
  jerseyNumber?: number
  position?: string
  joinedAt: string
  isActive: boolean
  user?: TeamMemberUser
}

export type TeamMemberUser = {
  id: string
  username: string
  displayName: string
  avatar?: string
  height?: number
  weight?: number
  dateOfBirth?: string
  nationality?: string
}

export type TeamStats = {
  totalMembers: number
  activePlayers: number
  totalGames: number
  wins: number
  losses: number
  draws: number
  points: number
  ranking: number
}

export type SocialLink = {
  platform: 'instagram' | 'twitter' | 'facebook' | 'youtube' | 'website'
  url: string
  username: string
}

export type TeamGame = {
  id: string
  teamId: string
  opponent: string
  isHome: boolean
  date: string
  venue?: string
  result?: 'WIN' | 'LOSS' | 'DRAW'
  teamScore?: number
  opponentScore?: number
  status: 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED'
  competition?: string
  notes?: string
}

export type TeamInvitation = {
  id: string
  teamId: string
  userId: string
  role: TeamRole
  message: string
  status: 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'EXPIRED'
  sentBy: string
  createdAt: string
  expiresAt: string
  respondedAt?: string
}

export type CreateTeamPayload = {
  name: string
  category: TeamCategory
  city: string
  region: string
  country: string
  description: string
  colors: string[]
  foundedYear: number
  homeVenue?: string
  website?: string
}

export type UpdateTeamPayload = Partial<CreateTeamPayload>

export type JoinTeamRequest = {
  teamId: string
  role: TeamRole
  message?: string
  jerseyNumber?: number
  position?: string
}
