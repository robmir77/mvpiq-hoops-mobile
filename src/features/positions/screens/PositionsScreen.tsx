// src/features/positions/screens/PositionsScreen.tsx

import React from 'react'
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    ActivityIndicator,
    TouchableOpacity,
    RefreshControl,
} from 'react-native'
import { usePositions } from '../hooks/usePositions'
import { PositionMetadata } from '../types/positions.types'

const PositionCard = ({ position }: { position: PositionMetadata }) => {
    return (
        <TouchableOpacity style={styles.positionCard}>
            <View style={styles.positionHeader}>
                <Text style={styles.positionCode}>{position.code}</Text>
                {position.abbreviation && (
                    <Text style={styles.positionAbbreviation}>{position.abbreviation}</Text>
                )}
            </View>
            <Text style={styles.positionName}>{position.name}</Text>
            {position.description && (
                <Text style={styles.positionDescription}>{position.description}</Text>
            )}
        </TouchableOpacity>
    )
}

const PositionCategory = ({ title, positions }: { title: string; positions: PositionMetadata[] }) => {
    return (
        <View style={styles.categoryContainer}>
            <Text style={styles.categoryTitle}>{title}</Text>
            <View style={styles.positionsGrid}>
                {positions.map((position) => (
                    <PositionCard key={position.id} position={position} />
                ))}
            </View>
        </View>
    )
}

export default function PositionsScreen() {
    const { data: positions, isLoading, isError, refetch } = usePositions()

    const categorizePositions = (positions: PositionMetadata[]) => {
        const guards = positions.filter(p => 
            p.code.includes('G') || (p.name && p.name.toLowerCase().includes('guard'))
        )
        const forwards = positions.filter(p => 
            p.code.includes('F') || (p.name && p.name.toLowerCase().includes('forward'))
        )
        const centers = positions.filter(p => 
            p.code === 'C' || (p.name && p.name.toLowerCase().includes('center'))
        )
        const others = positions.filter(p => 
            !guards.includes(p) && !forwards.includes(p) && !centers.includes(p)
        )

        return { guards, forwards, centers, others }
    }

    if (isLoading) {
        return (
            <View style={styles.center}>
                <ActivityIndicator size="large" color="#ff8c00" />
                <Text style={styles.loadingText}>Caricamento posizioni...</Text>
            </View>
        )
    }

    if (isError) {
        return (
            <View style={styles.center}>
                <Text style={styles.errorText}>Errore caricamento posizioni</Text>
                <TouchableOpacity style={styles.retryButton} onPress={() => refetch()}>
                    <Text style={styles.retryText}>Riprova</Text>
                </TouchableOpacity>
            </View>
        )
    }

    const categorized = positions ? categorizePositions(positions) : { guards: [], forwards: [], centers: [], others: [] }

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <Text style={styles.headerTitle}>Posizioni Basket</Text>
            </View>

            <ScrollView
                style={styles.scrollView}
                refreshControl={
                    <RefreshControl refreshing={isLoading} onRefresh={refetch} />
                }
            >
                {categorized.guards.length > 0 && (
                    <PositionCategory title="Guardie" positions={categorized.guards} />
                )}
                
                {categorized.forwards.length > 0 && (
                    <PositionCategory title="Ali" positions={categorized.forwards} />
                )}
                
                {categorized.centers.length > 0 && (
                    <PositionCategory title="Centri" positions={categorized.centers} />
                )}
                
                {categorized.others.length > 0 && (
                    <PositionCategory title="Altre Posizioni" positions={categorized.others} />
                )}

                {!positions || positions.length === 0 ? (
                    <View style={styles.emptyState}>
                        <Text style={styles.emptyText}>Nessuna posizione disponibile</Text>
                    </View>
                ) : null}
            </ScrollView>
        </View>
    )
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#1a1a1a',
    },
    header: {
        padding: 20,
        borderBottomWidth: 1,
        borderBottomColor: '#333',
    },
    headerTitle: {
        fontSize: 24,
        fontWeight: 'bold',
        color: '#fff',
    },
    scrollView: {
        flex: 1,
    },
    categoryContainer: {
        margin: 16,
    },
    categoryTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#fff',
        marginBottom: 12,
    },
    positionsGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 12,
    },
    positionCard: {
        backgroundColor: '#2a2a2a',
        padding: 16,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#333',
        width: '48%',
        minHeight: 100,
    },
    positionHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 8,
    },
    positionCode: {
        fontSize: 20,
        fontWeight: 'bold',
        color: '#ff8c00',
    },
    positionAbbreviation: {
        fontSize: 14,
        color: '#888',
        backgroundColor: '#333',
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 8,
    },
    positionName: {
        fontSize: 14,
        fontWeight: 'bold',
        color: '#fff',
        marginBottom: 4,
    },
    positionDescription: {
        fontSize: 12,
        color: '#ccc',
        lineHeight: 16,
    },
    center: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    loadingText: {
        color: '#fff',
        marginTop: 10,
    },
    errorText: {
        color: '#ff4444',
        fontSize: 16,
        marginBottom: 20,
    },
    retryButton: {
        backgroundColor: '#ff8c00',
        paddingHorizontal: 20,
        paddingVertical: 10,
        borderRadius: 8,
    },
    retryText: {
        color: '#fff',
        fontWeight: 'bold',
    },
    emptyState: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingVertical: 60,
    },
    emptyText: {
        color: '#888',
        fontSize: 16,
    },
})
