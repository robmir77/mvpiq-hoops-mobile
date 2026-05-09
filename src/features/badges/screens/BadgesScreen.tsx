import React, { useState } from 'react'
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native'
import { useBadges } from '../hooks/useBadges'
import { BadgeCard } from '../components/BadgeCard'
import { UserBadge } from '../types/badges.types'

export default function BadgesScreen() {
  const { badges, progress, loading, totalPoints, unlockedCount } = useBadges()
  const [filter, setFilter] = useState<'all' | 'unlocked' | 'locked'>('all')

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#F97316" />
      </View>
    )
  }

  const filteredBadges = badges.filter(badge => {
    if (filter === 'unlocked') return badge.unlockedAt
    if (filter === 'locked') return !badge.unlockedAt
    return true
  })

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Le Tue Medaglie</Text>
        <View style={styles.stats}>
          <View style={styles.stat}>
            <Text style={styles.statNumber}>{unlockedCount}</Text>
            <Text style={styles.statLabel}>Sbloccate</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statNumber}>{totalPoints}</Text>
            <Text style={styles.statLabel}>Punti</Text>
          </View>
        </View>
      </View>

      <View style={styles.filters}>
        {(['all', 'unlocked', 'locked'] as const).map((filterType) => (
          <TouchableOpacity
            key={filterType}
            style={[
              styles.filterButton,
              filter === filterType && styles.filterButtonActive
            ]}
            onPress={() => setFilter(filterType)}
          >
            <Text style={[
              styles.filterText,
              filter === filterType && styles.filterTextActive
            ]}>
              {filterType === 'all' ? 'Tutte' : 
               filterType === 'unlocked' ? 'Sbloccate' : 'Da Sbloccare'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.badgesGrid}>
        {filteredBadges.map((badge) => (
          <BadgeCard
            key={badge.id}
            badge={badge}
            size="medium"
          />
        ))}
      </View>

      {filteredBadges.length === 0 && (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>
            {filter === 'locked' ? 'Nessuna medaglia da sbloccare' :
             filter === 'unlocked' ? 'Nessuna medaglia sbloccata' :
             'Nessuna medaglia disponibile'}
          </Text>
        </View>
      )}
    </ScrollView>
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
  stats: {
    flexDirection: 'row',
    gap: 24,
  },
  stat: {
    alignItems: 'center',
  },
  statNumber: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#F97316',
  },
  statLabel: {
    fontSize: 14,
    color: '#9CA3AF',
    marginTop: 4,
  },
  filters: {
    flexDirection: 'row',
    marginBottom: 24,
    gap: 8,
  },
  filterButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#1F2937',
  },
  filterButtonActive: {
    backgroundColor: '#F97316',
  },
  filterText: {
    color: '#9CA3AF',
    fontSize: 14,
    fontWeight: '600',
  },
  filterTextActive: {
    color: 'white',
  },
  badgesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 24,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0B0F1A',
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyText: {
    color: '#9CA3AF',
    fontSize: 16,
    textAlign: 'center',
  },
})
