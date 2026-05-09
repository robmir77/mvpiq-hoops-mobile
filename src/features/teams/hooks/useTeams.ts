import { useState, useEffect, useContext } from 'react'
import { AuthContext } from '@/features/auth/context/AuthContext'
import { 
  getUserTeams, 
  createTeam,
  updateTeam,
  deleteTeam,
  getTeamMembers,
  addTeamMember,
  removeTeamMember,
  getTeamInvitations,
  getUserInvitations,
  respondToInvitation,
  joinTeam,
  Team,
  TeamMember,
  TeamInvitation,
  CreateTeamPayload,
  TeamRole
} from '../api/teams.api'

export const useTeams = () => {
  const auth = useContext(AuthContext)
  const [teams, setTeams] = useState<Team[]>([])
  const [currentTeam, setCurrentTeam] = useState<Team | null>(null)
  const [members, setMembers] = useState<TeamMember[]>([])
  const [invitations, setInvitations] = useState<TeamInvitation[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (auth?.user?.id) {
      loadUserData()
    }
  }, [auth?.user?.id])

  const loadUserData = async () => {
    try {
      setLoading(true)
      const userId = auth!.user!.id
      const [teamsData, invitationsData] = await Promise.all([
        getUserTeams(userId),
        getUserInvitations(userId)
      ])
      setTeams(teamsData)
      setInvitations(invitationsData)
    } catch (error) {
      console.error('Error loading user data:', error)
    } finally {
      setLoading(false)
    }
  }

  const selectTeam = async (team: Team) => {
    setCurrentTeam(team)
    try {
      const membersData = await getTeamMembers(team.id)
      setMembers(membersData)
    } catch (error) {
      console.error('Error loading team members:', error)
    }
  }

  const createNewTeam = async (payload: CreateTeamPayload) => {
    try {
      const newTeam = await createTeam(payload)
      setTeams(prev => [...prev, newTeam])
      return newTeam
    } catch (error) {
      console.error('Error creating team:', error)
      throw error
    }
  }

  const updateExistingTeam = async (teamId: string, updates: Partial<CreateTeamPayload>) => {
    try {
      const updatedTeam = await updateTeam(teamId, updates)
      setTeams(prev => prev.map(team => 
        team.id === teamId ? updatedTeam : team
      ))
      if (currentTeam?.id === teamId) {
        setCurrentTeam(updatedTeam)
      }
      return updatedTeam
    } catch (error) {
      console.error('Error updating team:', error)
      throw error
    }
  }

  const deleteExistingTeam = async (teamId: string) => {
    try {
      await deleteTeam(teamId)
      setTeams(prev => prev.filter(team => team.id !== teamId))
      if (currentTeam?.id === teamId) {
        setCurrentTeam(null)
        setMembers([])
      }
    } catch (error) {
      console.error('Error deleting team:', error)
      throw error
    }
  }

  const addMemberToTeam = async (teamId: string, userId: string, role: TeamRole, jerseyNumber?: number) => {
    try {
      const newMember = await addTeamMember(teamId, userId, role, jerseyNumber)
      if (currentTeam?.id === teamId) {
        setMembers(prev => [...prev, newMember])
      }
      return newMember
    } catch (error) {
      console.error('Error adding team member:', error)
      throw error
    }
  }

  const removeMemberFromTeam = async (teamId: string, memberId: string) => {
    try {
      await removeTeamMember(teamId, memberId)
      if (currentTeam?.id === teamId) {
        setMembers(prev => prev.filter(member => member.id !== memberId))
      }
    } catch (error) {
      console.error('Error removing team member:', error)
      throw error
    }
  }

  const respondToTeamInvitation = async (invitationId: string, accept: boolean) => {
    try {
      await respondToInvitation(invitationId, accept)
      
      // Update invitations list
      setInvitations(prev => prev.filter(inv => inv.id !== invitationId))
      
      // If accepted, refresh teams
      if (accept) {
        await loadUserData()
      }
    } catch (error) {
      console.error('Error responding to invitation:', error)
      throw error
    }
  }

  const requestToJoinTeam = async (teamId: string, role: TeamRole, message?: string) => {
    try {
      const invitation = await joinTeam({
        teamId,
        role,
        message,
      })
      return invitation
    } catch (error) {
      console.error('Error requesting to join team:', error)
      throw error
    }
  }

  const refreshTeams = () => {
    loadUserData()
  }

  return {
    teams,
    currentTeam,
    members,
    invitations,
    loading,
    selectTeam,
    createTeam: createNewTeam,
    updateTeam: updateExistingTeam,
    deleteTeam: deleteExistingTeam,
    addMember: addMemberToTeam,
    removeMember: removeMemberFromTeam,
    respondToInvitation: respondToTeamInvitation,
    requestToJoin: requestToJoinTeam,
    refreshTeams,
  }
}
