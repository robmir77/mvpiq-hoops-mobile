import apiClient from '@/shared/api/apiClient'
import { 
  Team, 
  TeamMember, 
  TeamGame, 
  TeamInvitation,
  CreateTeamPayload,
  UpdateTeamPayload,
  JoinTeamRequest,
  TeamRole,
  TeamCategory 
} from '../types/teams.types'

export const getUserTeams = async (userId: string): Promise<Team[]> => {
  try {
    const response = await apiClient.get(`/users/${userId}/teams`)
    return response.data
  } catch (error) {
    console.error('Error fetching user teams:', error)
    return []
  }
}

export const getTeamById = async (teamId: string): Promise<Team> => {
  try {
    const response = await apiClient.get(`/teams/${teamId}`)
    return response.data
  } catch (error) {
    console.error('Error fetching team:', error)
    throw error
  }
}

export const createTeam = async (payload: CreateTeamPayload): Promise<Team> => {
  try {
    const response = await apiClient.post('/teams', payload)
    return response.data
  } catch (error) {
    console.error('Error creating team:', error)
    throw error
  }
}

export const updateTeam = async (teamId: string, updates: UpdateTeamPayload): Promise<Team> => {
  try {
    const response = await apiClient.put(`/teams/${teamId}`, updates)
    return response.data
  } catch (error) {
    console.error('Error updating team:', error)
    throw error
  }
}

export const deleteTeam = async (teamId: string): Promise<void> => {
  try {
    await apiClient.delete(`/teams/${teamId}`)
  } catch (error) {
    console.error('Error deleting team:', error)
    throw error
  }
}

export const getTeamMembers = async (teamId: string): Promise<TeamMember[]> => {
  try {
    const response = await apiClient.get(`/teams/${teamId}/members`)
    return response.data
  } catch (error) {
    console.error('Error fetching team members:', error)
    return []
  }
}

export const addTeamMember = async (teamId: string, userId: string, role: TeamRole, jerseyNumber?: number): Promise<TeamMember> => {
  try {
    const response = await apiClient.post(`/teams/${teamId}/members`, {
      userId,
      role,
      jerseyNumber
    })
    return response.data
  } catch (error) {
    console.error('Error adding team member:', error)
    throw error
  }
}

export const removeTeamMember = async (teamId: string, memberId: string): Promise<void> => {
  try {
    await apiClient.delete(`/teams/${teamId}/members/${memberId}`)
  } catch (error) {
    console.error('Error removing team member:', error)
    throw error
  }
}

export const updateTeamMember = async (teamId: string, memberId: string, updates: Partial<TeamMember>): Promise<TeamMember> => {
  try {
    const response = await apiClient.put(`/teams/${teamId}/members/${memberId}`, updates)
    return response.data
  } catch (error) {
    console.error('Error updating team member:', error)
    throw error
  }
}

export const getTeamGames = async (teamId: string, season?: string): Promise<TeamGame[]> => {
  try {
    const params = season ? `?season=${season}` : ''
    const response = await apiClient.get(`/teams/${teamId}/games${params}`)
    return response.data
  } catch (error) {
    console.error('Error fetching team games:', error)
    return []
  }
}

export const createTeamGame = async (teamId: string, game: Partial<TeamGame>): Promise<TeamGame> => {
  try {
    const response = await apiClient.post(`/teams/${teamId}/games`, game)
    return response.data
  } catch (error) {
    console.error('Error creating team game:', error)
    throw error
  }
}

export const updateTeamGame = async (teamId: string, gameId: string, updates: Partial<TeamGame>): Promise<TeamGame> => {
  try {
    const response = await apiClient.put(`/teams/${teamId}/games/${gameId}`, updates)
    return response.data
  } catch (error) {
    console.error('Error updating team game:', error)
    throw error
  }
}

export const joinTeam = async (request: JoinTeamRequest): Promise<TeamInvitation> => {
  try {
    const response = await apiClient.post('/teams/join', request)
    return response.data
  } catch (error) {
    console.error('Error joining team:', error)
    throw error
  }
}

export const inviteToTeam = async (teamId: string, userId: string, role: TeamRole, message?: string): Promise<TeamInvitation> => {
  try {
    const response = await apiClient.post(`/teams/${teamId}/invite`, {
      userId,
      role,
      message
    })
    return response.data
  } catch (error) {
    console.error('Error inviting to team:', error)
    throw error
  }
}

export const getTeamInvitations = async (teamId: string): Promise<TeamInvitation[]> => {
  try {
    const response = await apiClient.get(`/teams/${teamId}/invitations`)
    return response.data
  } catch (error) {
    console.error('Error fetching team invitations:', error)
    return []
  }
}

export const getUserInvitations = async (userId: string): Promise<TeamInvitation[]> => {
  try {
    const response = await apiClient.get(`/users/${userId}/team-invitations`)
    return response.data
  } catch (error) {
    console.error('Error fetching user invitations:', error)
    return []
  }
}

export const respondToInvitation = async (invitationId: string, accept: boolean): Promise<void> => {
  try {
    await apiClient.put(`/team-invitations/${invitationId}/respond`, { accept })
  } catch (error) {
    console.error('Error responding to invitation:', error)
    throw error
  }
}

export const searchTeams = async (query: string, filters?: {
  category?: TeamCategory
  city?: string
  region?: string
  isRecruiting?: boolean
}): Promise<Team[]> => {
  try {
    const params = new URLSearchParams()
    params.append('q', query)
    
    if (filters) {
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined) {
          params.append(key, value.toString())
        }
      })
    }

    const response = await apiClient.get(`/teams/search?${params.toString()}`)
    return response.data
  } catch (error) {
    console.error('Error searching teams:', error)
    return []
  }
}

export const uploadTeamLogo = async (teamId: string, file: any): Promise<string> => {
  try {
    const formData = new FormData()
    formData.append('logo', file)

    const response = await apiClient.post(`/teams/${teamId}/logo`, formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    })
    return response.data.logoUrl
  } catch (error) {
    console.error('Error uploading team logo:', error)
    throw error
  }
}

// Constants for UI
export const TEAM_CATEGORY_LABELS: Record<TeamCategory, string> = {
  YOUTH: 'Giovanile',
  SENIOR: 'Senior',
  ACADEMY: 'Academy',
  PROFESSIONAL: 'Professionale',
  AMATEUR: 'Dilettantistico',
  SCHOOL: 'Scolastico'
}

export const TEAM_ROLE_LABELS: Record<TeamRole, string> = {
  PLAYER: 'Giocatore',
  COACH: 'Coach',
  ASSISTANT_COACH: 'Assistente Coach',
  MANAGER: 'Manager',
  OWNER: 'Proprietario'
}

export const TEAM_STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Attiva',
  INACTIVE: 'Inattiva',
  RECRUITING: 'In cerca di giocatori',
  SUSPENDED: 'Sospesa'
}
