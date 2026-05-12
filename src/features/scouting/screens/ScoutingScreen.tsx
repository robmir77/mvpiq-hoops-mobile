import React, {useState, useEffect} from 'react'
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
} from 'react-native'
import { searchTrainers, TrainerProfile, TrainerSpecialization } from '@/features/trainer/api/trainer.api'
import { getGlobalRanking } from '@/features/ranking/api/ranking.api'
import { useCustomAlert, CustomAlert } from '@/shared/components/CustomAlert'

type SearchFilters = {
  ageRange: [number, number]
  heightRange: [number, number]
  position: string
  location: string
  minRating: number
  hasVideos: boolean
  isVerified: boolean
}

export default function ScoutingScreen() {
  const [loading, setLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [filters, setFilters] = useState<SearchFilters>({
    ageRange: [16, 35],
    heightRange: [160, 220],
    position: '',
    location: '',
    minRating: 0,
    hasVideos: false,
    isVerified: false,
  })
  const [results, setResults] = useState<any[]>([])
  const [showFilters, setShowFilters] = useState(false)
  const [searchType, setSearchType] = useState<'athletes' | 'trainers'>('athletes')
  const { alert, showError } = useCustomAlert()

  useEffect(() => {
    loadInitialData()
  }, [])

  const loadInitialData = async () => {
    // Load top ranked athletes as default
    try {
      setLoading(true)
      const rankingData = await getGlobalRanking()
      setResults(rankingData.slice(0, 20))
    } catch (error) {
      console.error('Error loading initial data:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleSearch = async () => {
    if (!searchQuery.trim() && !hasActiveFilters()) {
      showError('Attenzione', 'Inserisci una query di ricerca o seleziona dei filtri')
      return
    }

    setLoading(true)
    try {
      if (searchType === 'trainers') {
        const trainerFilters = {
          specialization: (filters.position as TrainerSpecialization) || undefined,
          minRating: filters.minRating || undefined,
          isVerified: filters.isVerified || undefined,
        }
        const trainerResults = await searchTrainers(trainerFilters)
        setResults(trainerResults)
      } else {
        // Search athletes (mock implementation)
        const athleteResults = await searchAthletes()
        setResults(athleteResults)
      }
    } catch (error) {
      console.error('Error searching:', error)
      showError('Errore', 'Impossibile eseguire la ricerca')
    } finally {
      setLoading(false)
    }
  }

  const searchAthletes = async (): Promise<any[]> => {
    // Mock implementation - in real app this would call the backend
    const rankingData = await getGlobalRanking()
    return rankingData.filter(athlete => {
      const matchesQuery = !searchQuery || 
        athlete.playerName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        athlete.playerId?.toLowerCase().includes(searchQuery.toLowerCase())
      
      return matchesQuery
    })
  }

  const hasActiveFilters = () => {
    return filters.position !== '' ||
           filters.location !== '' ||
           filters.minRating > 0 ||
           filters.hasVideos ||
           filters.isVerified ||
           filters.ageRange[0] !== 16 ||
           filters.ageRange[1] !== 35 ||
           filters.heightRange[0] !== 160 ||
           filters.heightRange[1] !== 220
  }

  const clearFilters = () => {
    setFilters({
      ageRange: [16, 35],
      heightRange: [160, 220],
      position: '',
      location: '',
      minRating: 0,
      hasVideos: false,
      isVerified: false,
    })
  }

  const renderAthleteCard = (athlete: any) => (
    <TouchableOpacity key={athlete.id} style={styles.athleteCard}>
      <View style={styles.athleteHeader}>
        <View style={styles.athleteInfo}>
          <Text style={styles.athleteName}>{athlete.playerName}</Text>
          <Text style={styles.athleteDetails}>
            {athlete.roleCode} • Score: {athlete.score} • Rank: #{athlete.rankPosition}
          </Text>
        </View>
        <View style={styles.athleteStats}>
          <Text style={styles.rankText}>#{athlete.rankPosition}</Text>
          <Text style={styles.ratingText}>⭐ {athlete.score}</Text>
        </View>
      </View>
      
      <View style={styles.athleteActions}>
        <TouchableOpacity style={styles.actionButton}>
          <Text style={styles.actionButtonText}>Vedi Profilo</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionButtonSecondary}>
          <Text style={styles.actionButtonTextSecondary}>Contatta</Text>
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  )

  const renderTrainerCard = (trainer: TrainerProfile) => (
    <TouchableOpacity key={trainer.id} style={styles.trainerCard}>
      <View style={styles.trainerHeader}>
        <View style={styles.trainerInfo}>
          <Text style={styles.trainerName}>{trainer.userId}</Text>
          <Text style={styles.trainerDetails}>
            {trainer.experience} anni exp • ⭐ {trainer.rating}
          </Text>
          <View style={styles.specializations}>
            {trainer.specializations.slice(0, 3).map(spec => (
              <View key={spec} style={styles.specializationTag}>
                <Text style={styles.specializationText}>{spec}</Text>
              </View>
            ))}
          </View>
        </View>
        {trainer.isVerified && (
          <View style={styles.verifiedBadge}>
            <Text style={styles.verifiedText}>✓</Text>
          </View>
        )}
      </View>
      
      <View style={styles.trainerActions}>
        <TouchableOpacity style={styles.actionButton}>
          <Text style={styles.actionButtonText}>Vedi Programmi</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionButtonSecondary}>
          <Text style={styles.actionButtonTextSecondary}>Segui</Text>
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  )

  return (
    <View style={styles.container}>
      <ScrollView>
        <View style={styles.header}>
          <Text style={styles.title}>Scouting</Text>
          <View style={styles.searchTypeToggle}>
            <TouchableOpacity
              style={[
                styles.typeButton,
                searchType === 'athletes' && styles.typeButtonActive
              ]}
              onPress={() => setSearchType('athletes')}
            >
              <Text style={[
                styles.typeButtonText,
                searchType === 'athletes' && styles.typeButtonTextActive
              ]}>
                Atleti
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.typeButton,
                searchType === 'trainers' && styles.typeButtonActive
              ]}
              onPress={() => setSearchType('trainers')}
            >
              <Text style={[
                styles.typeButtonText,
                searchType === 'trainers' && styles.typeButtonTextActive
              ]}>
                Trainer
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.searchSection}>
          <TextInput
            style={styles.searchInput}
            placeholder={`Cerca ${searchType === 'athletes' ? 'atleti' : 'trainer'}...`}
            placeholderTextColor="#6B7280"
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          
          <View style={styles.searchActions}>
            <TouchableOpacity style={styles.filterButton} onPress={() => setShowFilters(!showFilters)}>
              <Text style={styles.filterButtonText}>Filtri {hasActiveFilters() && '•'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.searchButton} onPress={handleSearch}>
              <Text style={styles.searchButtonText}>Cerca</Text>
            </TouchableOpacity>
          </View>
        </View>

        {showFilters && (
          <View style={styles.filtersSection}>
            <View style={styles.filterRow}>
              <Text style={styles.filterLabel}>Età: {filters.ageRange[0]}-{filters.ageRange[1]}</Text>
              <Text style={styles.filterLabel}>Altezza: {filters.heightRange[0]}-{filters.heightRange[1]}cm</Text>
            </View>
            
            <View style={styles.filterRow}>
              <TextInput
                style={styles.filterInput}
                placeholder="Posizione"
                placeholderTextColor="#6B7280"
                value={filters.position}
                onChangeText={(text) => setFilters(prev => ({ ...prev, position: text }))}
              />
              <TextInput
                style={styles.filterInput}
                placeholder="Località"
                placeholderTextColor="#6B7280"
                value={filters.location}
                onChangeText={(text) => setFilters(prev => ({ ...prev, location: text }))}
              />
            </View>

            <View style={styles.filterActions}>
              <TouchableOpacity style={styles.clearButton} onPress={clearFilters}>
                <Text style={styles.clearButtonText}>Pulisci</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        <View style={styles.resultsSection}>
          <Text style={styles.resultsTitle}>
            Risultati ({results.length})
          </Text>
          
          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#F97316" />
            </View>
          ) : (
            <View style={styles.resultsList}>
              {results.map(item => 
                searchType === 'athletes' ? renderAthleteCard(item) : renderTrainerCard(item)
              )}
              
              {results.length === 0 && !loading && (
                <View style={styles.emptyState}>
                  <Text style={styles.emptyText}>Nessun risultato trovato</Text>
                </View>
              )}
            </View>
          )}
        </View>
      </ScrollView>
      <CustomAlert {...alert} />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0B0F1A',
    padding: 20,
  },
  header: {
    marginBottom: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: 'white',
    marginBottom: 16,
  },
  searchTypeToggle: {
    flexDirection: 'row',
    backgroundColor: '#1F2937',
    borderRadius: 12,
    padding: 4,
  },
  typeButton: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  typeButtonActive: {
    backgroundColor: '#F97316',
  },
  typeButtonText: {
    color: '#9CA3AF',
    fontWeight: '600',
  },
  typeButtonTextActive: {
    color: 'white',
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
    marginBottom: 12,
  },
  searchActions: {
    flexDirection: 'row',
    gap: 8,
  },
  filterButton: {
    flex: 1,
    backgroundColor: '#374151',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  filterButtonText: {
    color: 'white',
    fontWeight: '600',
  },
  searchButton: {
    flex: 1,
    backgroundColor: '#F97316',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  searchButtonText: {
    color: 'white',
    fontWeight: '600',
  },
  filtersSection: {
    backgroundColor: '#1F2937',
    padding: 16,
    borderRadius: 12,
    marginBottom: 24,
  },
  filterRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  filterLabel: {
    color: '#9CA3AF',
    fontSize: 14,
  },
  filterInput: {
    flex: 1,
    backgroundColor: '#374151',
    color: 'white',
    padding: 8,
    borderRadius: 8,
    marginHorizontal: 4,
  },
  filterActions: {
    alignItems: 'flex-end',
  },
  clearButton: {
    backgroundColor: '#6B7280',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
  },
  clearButtonText: {
    color: 'white',
    fontSize: 14,
  },
  resultsSection: {
    flex: 1,
  },
  resultsTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: 'white',
    marginBottom: 16,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 40,
  },
  resultsList: {
    gap: 12,
  },
  athleteCard: {
    backgroundColor: '#1F2937',
    padding: 16,
    borderRadius: 12,
  },
  athleteHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  athleteInfo: {
    flex: 1,
  },
  athleteName: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  athleteDetails: {
    color: '#9CA3AF',
    fontSize: 14,
  },
  athleteStats: {
    alignItems: 'flex-end',
  },
  rankText: {
    color: '#F97316',
    fontSize: 16,
    fontWeight: 'bold',
  },
  ratingText: {
    color: '#FCD34D',
    fontSize: 14,
  },
  athleteActions: {
    flexDirection: 'row',
    gap: 8,
  },
  trainerCard: {
    backgroundColor: '#1F2937',
    padding: 16,
    borderRadius: 12,
  },
  trainerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  trainerInfo: {
    flex: 1,
  },
  trainerName: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  trainerDetails: {
    color: '#9CA3AF',
    fontSize: 14,
    marginBottom: 8,
  },
  specializations: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  specializationTag: {
    backgroundColor: '#374151',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  specializationText: {
    color: 'white',
    fontSize: 12,
  },
  verifiedBadge: {
    backgroundColor: '#10B981',
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  verifiedText: {
    color: 'white',
    fontWeight: 'bold',
  },
  trainerActions: {
    flexDirection: 'row',
    gap: 8,
  },
  actionButton: {
    flex: 1,
    backgroundColor: '#F97316',
    padding: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  actionButtonText: {
    color: 'white',
    fontWeight: '600',
  },
  actionButtonSecondary: {
    flex: 1,
    backgroundColor: '#374151',
    padding: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  actionButtonTextSecondary: {
    color: 'white',
    fontWeight: '600',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyText: {
    color: '#6B7280',
    fontSize: 16,
  },
})