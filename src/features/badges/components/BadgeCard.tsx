import React from 'react'
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native'
import { UserBadge } from '../types/badges.types'

type Props = {
  badge: UserBadge
  onPress?: () => void
  size?: 'small' | 'medium' | 'large'
}

export function BadgeCard({ badge, onPress, size = 'medium' }: Props) {
  const getSizeStyles = () => {
    switch (size) {
      case 'small':
        return {
          container: styles.containerSmall,
          icon: styles.iconSmall,
          name: styles.nameSmall,
          points: styles.pointsSmall
        }
      case 'large':
        return {
          container: styles.containerLarge,
          icon: styles.iconLarge,
          name: styles.nameLarge,
          points: styles.pointsLarge
        }
      default:
        return {
          container: styles.container,
          icon: styles.icon,
          name: styles.name,
          points: styles.points
        }
    }
  }

  const getRarityColor = () => {
    switch (badge.rarity) {
      case 'COMMON': return '#9CA3AF'
      case 'RARE': return '#3B82F6'
      case 'EPIC': return '#8B5CF6'
      case 'LEGENDARY': return '#F59E0B'
      default: return '#9CA3AF'
    }
  }

  const sizeStyles = getSizeStyles()
  const rarityColor = getRarityColor()

  return (
    <TouchableOpacity 
      style={[sizeStyles.container, { borderColor: rarityColor }]}
      onPress={onPress}
      disabled={!onPress}
    >
      <Text style={sizeStyles.icon}>{badge.icon}</Text>
      <Text style={[sizeStyles.name, { color: rarityColor }]}>{badge.name}</Text>
      <Text style={sizeStyles.points}>+{badge.points} pts</Text>
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#1F2937',
    borderWidth: 2,
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
    minWidth: 100,
  },
  containerSmall: {
    backgroundColor: '#1F2937',
    borderWidth: 1,
    borderRadius: 8,
    padding: 8,
    alignItems: 'center',
    minWidth: 70,
  },
  containerLarge: {
    backgroundColor: '#1F2937',
    borderWidth: 3,
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    minWidth: 140,
  },
  icon: {
    fontSize: 32,
    marginBottom: 4,
  },
  iconSmall: {
    fontSize: 20,
    marginBottom: 2,
  },
  iconLarge: {
    fontSize: 48,
    marginBottom: 8,
  },
  name: {
    color: 'white',
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 2,
  },
  nameSmall: {
    color: 'white',
    fontSize: 10,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 1,
  },
  nameLarge: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 4,
  },
  points: {
    color: '#F97316',
    fontSize: 10,
    fontWeight: '600',
  },
  pointsSmall: {
    color: '#F97316',
    fontSize: 8,
    fontWeight: '600',
  },
  pointsLarge: {
    color: '#F97316',
    fontSize: 14,
    fontWeight: '600',
  },
})
