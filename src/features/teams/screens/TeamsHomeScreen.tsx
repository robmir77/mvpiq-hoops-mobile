import React, { useState } from 'react'
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
} from 'react-native'
import { useNavigation } from '@react-navigation/native'
import { useTeams } from '../hooks/useTeams'
import { Team, TeamInvitation } from '../types/teams.types'
import { TEAM_CATEGORY_LABELS, TEAM_STATUS_LABELS } from '../api/teams.api'

export default function TeamsHomeScreen() {
  const navigation = useNavigation()
  const { teams, invitations, loading, selectTeam, respondToInvitation } = useTeams()
  const [searchQuery, setSearchQuery] = useState('')
  const [showInvitations, setShowInvitations] = useState(false)

  const filteredTeams = teams.filter(team => 
    team.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    team.city.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const handleViewTeam = (team: Team) => {
    selectTeam(team)
    navigation.navigate('TeamDetail' as any, { teamId: team.id })
  }

  const handleRespondToInvitation = async (invitation: TeamInvitation, accept: boolean) => {
    try {
      await respondToInvitation(invitation.id, accept)
      Alert.alert(
        'Successo', 
        accept ? 'Sei entrato nella squadra!' : 'Invito rifiutato'
      )
    } catch (error) {
      Alert.alert('Errore', 'Impossibile rispondere all\'invito')
    }
  }

  const renderTeamCard = (team: Team) => (
    <TouchableOpacity key={team.id} style={styles.teamCard} onPress={() => handleViewTeam(team)}>
      <View style={styles.teamHeader}>
        <View style={styles.teamInfo}>
          <Text style={styles.teamName}>{team.name}</Text>
          <Text style={styles.teamDetails}>
            {TEAM_CATEGORY_LABELS[team.category]} • {team.city}, {team.region}
          </Text>
        </View>
        {team.status === 'RECRUITING' && (
          <View style={styles.recruitingBadge}>
            <Text style={styles.recruitingText}>In cerca</Text>
          </View>
        )}
      </View>
      
      <View style={styles.teamStats}>
        <View style={styles.statItem}>
          <Text style={styles.statNumber}>{team.stats.totalMembers}</Text>
          <Text style={styles.statLabel}>Membri</Text>
        </View>
        <View style={styles.statItem}>
          <Text style={styles.statNumber}>{team.stats.wins}</Text>
          <Text style={styles.statLabel}>Vittorie</Text>
        </View>
        <View style={styles.statItem}>
          <Text style={styles.statNumber}>#{team.stats.ranking}</Text>
          <Text style={styles.statLabel}>Ranking</Text>
        </View>
      </View>

      <View style={styles.teamColors}>
        {team.colors.slice(0, 3).map((color, index) => (
          <View 
            key={index} 
            style={[styles.colorDot, { backgroundColor: color }]}
          />
        ))}
      </View>
    </TouchableOpacity>
  )

  const renderInvitationCard = (invitation: TeamInvitation) => (
    <View key={invitation.id} style={styles.invitationCard}>
      <View style={styles.invitationHeader}>
        <Text style={styles.invitationTitle}>Invito squadra</Text>
        <Text style={styles.invitationRole}>
          Ruolo: {invitation.role}
        </Text>
      </View>
      
      <Text style={styles.invitationMessage}>
        {invitation.message || 'Sei stato invitato a unirti a questa squadra'}
      </Text>
      
      <Text style={styles.invitationDate}>
        Inviato: {new Date(invitation.createdAt).toLocaleDateString('it-IT')}
      </Text>
      
      <View style={styles.invitationActions}>
        <TouchableOpacity 
          style={styles.acceptButton}
          onPress={() => handleRespondToInvitation(invitation, true)}
        >
          <Text style={styles.acceptButtonText}>Accetta</Text>
        </TouchableOpacity>
        <TouchableOpacity 
          style={styles.declineButton}
          onPress={() => handleRespondToInvitation(invitation, false)}
        >
          <Text style={styles.declineButtonText}>Rifiuta</Text>
        </TouchableOpacity>
      </View>
    </View>
  )

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#F97316" />
      </View>
    )
  }

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Le Tue Squadre</Text>
        <TouchableOpacity 
          style={styles.createButton}
          onPress={() => navigation.navigate('CreateTeam' as any)}
        >
          <Text style={styles.createButtonText}>+</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.searchSection}>
        <TextInput
          style={styles.searchInput}
          placeholder="Cerca squadre..."
          placeholderTextColor="#6B7280"
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
      </View>

      {invitations.length > 0 && (
        <View style={styles.invitationsSection}>
          <TouchableOpacity 
            style={styles.invitationsHeader}
            onPress={() => setShowInvitations(!showInvitations)}
          >
            <Text style={styles.invitationsTitle}>
              Inviti ({invitations.length})
            </Text>
            <Text style={styles.invitationsToggle}>
              {showInvitations ? '▼' : '▶'}
            </Text>
          </TouchableOpacity>
          
          {showInvitations && (
            <View style={styles.invitationsList}>
              {invitations.map(renderInvitationCard)}
            </View>
          )}
        </View>
      )}

      <View style={styles.teamsSection}>
        <Text style={styles.sectionTitle}>
          Le Tue Squadre ({filteredTeams.length})
        </Text>
        
        {filteredTeams.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>Nessuna squadra</Text>
            <Text style={styles.emptyDescription}>
              Crea una nuova squadra o unisciti a una esistente
            </Text>
            <TouchableOpacity 
              style={styles.joinButton}
              onPress={() => navigation.navigate('SearchTeams' as any)}
            >
              <Text style={styles.joinButtonText}>Cerca Squadre</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.teamsList}>
            {filteredTeams.map(renderTeamCard)}
          </View>
        )}
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0B0F1A',
    padding: 20,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0B0F1A',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: 'white',
  },
  createButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F97316',
    justifyContent: 'center',
    alignItems: 'center',
  },
  createButtonText: {
    color: 'white',
    fontSize: 24,
    fontWeight: 'bold',
  },
  searchSection: {
    marginBottom: 24,
  },
  searchInput: {
    backgroundColor: '#1F2937',
    color: 'white',
    padding: 16,
    borderRadius: 12,
    fontSize: 16,
  },
  invitationsSection: {
    marginBottom: 24,
  },
  invitationsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#1F2937',
    padding: 16,
    borderRadius: 12,
  },
  invitationsTitle: {
    color: 'white',
    fontSize: 18,
    fontWeight: '600',
  },
  invitationsToggle: {
    color: '#F97316',
    fontSize: 18,
  },
  invitationsList: {
    marginTop: 12,
    gap: 12,
  },
  invitationCard: {
    backgroundColor: '#374151',
    padding: 16,
    borderRadius: 12,
  },
  invitationHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  invitationTitle: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  invitationRole: {
    color: '#F97316',
    fontSize: 14,
    fontWeight: '600',
  },
  invitationMessage: {
    color: '#9CA3AF',
    fontSize: 14,
    marginBottom: 8,
  },
  invitationDate: {
    color: '#6B7280',
    fontSize: 12,
    marginBottom: 12,
  },
  invitationActions: {
    flexDirection: 'row',
    gap: 8,
  },
  acceptButton: {
    flex: 1,
    backgroundColor: '#10B981',
    padding: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  acceptButtonText: {
    color: 'white',
    fontWeight: '600',
  },
  declineButton: {
    flex: 1,
    backgroundColor: '#EF4444',
    padding: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  declineButtonText: {
    color: 'white',
    fontWeight: '600',
  },
  teamsSection: {
    flex: 1,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: 'white',
    marginBottom: 16,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyTitle: {
    color: 'white',
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  emptyDescription: {
    color: '#9CA3AF',
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 24,
  },
  joinButton: {
    backgroundColor: '#F97316',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  joinButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  teamsList: {
    gap: 12,
  },
  teamCard: {
    backgroundColor: '#1F2937',
    padding: 16,
    borderRadius: 12,
  },
  teamHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  teamInfo: {
    flex: 1,
  },
  teamName: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  teamDetails: {
    color: '#9CA3AF',
    fontSize: 14,
  },
  recruitingBadge: {
    backgroundColor: '#10B981',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  recruitingText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '600',
  },
  teamStats: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  statItem: {
    alignItems: 'center',
  },
  statNumber: {
    color: '#F97316',
    fontSize: 16,
    fontWeight: 'bold',
  },
  statLabel: {
    color: '#6B7280',
    fontSize: 12,
    marginTop: 2,
  },
  teamColors: {
    flexDirection: 'row',
    gap: 4,
  },
  colorDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
  },
})
