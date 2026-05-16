// src/features/ranking/RankingCard.tsx

import React from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { RankingItem } from './types/ranking.types'

interface Props {
    item: RankingItem
    highlight?: boolean // true se è la riga dell'utente corrente
}

const MEDAL: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' }

export const RankingCard: React.FC<Props> = ({ item, highlight = false }) => {
    const medal = MEDAL[item.rankPosition]

    return (
        <View style={[styles.card, highlight && styles.cardHighlight]}>
            <View style={styles.position}>
                {medal ? (
                    <Text style={styles.medal}>{medal}</Text>
                ) : (
                    <Text style={styles.positionText}>#{item.rankPosition}</Text>
                )}
            </View>

            <View style={styles.info}>
                <Text style={[styles.name, highlight && styles.nameHighlight]} numberOfLines={1}>
                    {item.playerName}
                </Text>
                {item.roleCode ? (
                    <Text style={styles.role}>{item.roleCode}</Text>
                ) : null}
            </View>

            <View style={styles.scoreContainer}>
                <Text style={[styles.score, highlight && styles.scoreHighlight]}>
                    {item.score.toLocaleString('it-IT', { maximumFractionDigits: 0 })}
                </Text>
                <Text style={styles.scorePts}>pts</Text>
            </View>
        </View>
    )
}

const styles = StyleSheet.create({
    card: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#1e2433',
        borderRadius: 12,
        paddingVertical: 12,
        paddingHorizontal: 16,
        marginBottom: 8,
        borderWidth: 1,
        borderColor: '#2a2a2a',
    },
    cardHighlight: {
        borderColor: '#F97316',
        backgroundColor: 'rgba(249,115,22,0.08)',
    },
    position: {
        width: 40,
        alignItems: 'center',
    },
    medal: {
        fontSize: 22,
    },
    positionText: {
        color: '#888',
        fontSize: 14,
        fontWeight: '700',
    },
    info: {
        flex: 1,
        marginLeft: 12,
    },
    name: {
        color: '#fff',
        fontSize: 15,
        fontWeight: '600',
    },
    nameHighlight: {
        color: '#F97316',
    },
    role: {
        color: '#888',
        fontSize: 12,
        marginTop: 2,
    },
    scoreContainer: {
        alignItems: 'flex-end',
    },
    score: {
        color: '#fff',
        fontSize: 16,
        fontWeight: '700',
    },
    scoreHighlight: {
        color: '#F97316',
    },
    scorePts: {
        color: '#555',
        fontSize: 11,
        marginTop: 1,
    },
})
