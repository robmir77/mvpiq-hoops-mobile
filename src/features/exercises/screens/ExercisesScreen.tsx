import React, { useState, useEffect } from 'react'
import {
    View,
    Text,
    StyleSheet,
    FlatList,
    TextInput,
    TouchableOpacity,
    ActivityIndicator,
    ScrollView,
    RefreshControl,
} from 'react-native'
import { colors } from '@/shared/theme/colors'
import {
    getPublicExercises,
    searchExercises,
    getExercisesByCategory,
    Exercise,
} from '@/features/exercises/api/exercises.api'
import { useCustomAlert, CustomAlert } from '@/shared/components/CustomAlert'
import { Dumbbell, Search, Flame, Tag, Filter } from 'lucide-react-native'

const CATEGORIES = ['Tutti', 'SHOOTING', 'BALL_HANDLING', 'PHYSICAL', 'DEFENSE', 'TACTICS']
const DIFFICULTY_COLORS: Record<string, string> = {
    BEGINNER: '#10B981',
    INTERMEDIATE: '#F59E0B',
    ADVANCED: '#EF4444',
}

export default function ExercisesScreen() {
    const [loading, setLoading] = useState(true)
    const [refreshing, setRefreshing] = useState(false)
    const [exercises, setExercises] = useState<Exercise[]>([])
    const [searchQuery, setSearchQuery] = useState('')
    const [selectedCategory, setSelectedCategory] = useState('Tutti')
    const { alert, showError } = useCustomAlert()

    useEffect(() => {
        loadExercises()
    }, [selectedCategory])

    const loadExercises = async () => {
        try {
            setLoading(true)
            let data: Exercise[] = []
            if (selectedCategory === 'Tutti') {
                data = await getPublicExercises()
            } else {
                data = await getExercisesByCategory(selectedCategory)
            }
            setExercises(data || [])
        } catch (error) {
            console.error('Errore caricamento esercizi:', error)
            setExercises([])
        } finally {
            setLoading(false)
            setRefreshing(false)
        }
    }

    const handleSearch = async () => {
        if (!searchQuery.trim()) {
            loadExercises()
            return
        }
        try {
            setLoading(true)
            const results = await searchExercises(searchQuery.trim())
            setExercises(results || [])
        } catch (error) {
            showError('Errore', 'Impossibile eseguire la ricerca per l\'esercizio.')
        } finally {
            setLoading(false)
        }
    }

    const handleRefresh = () => {
        setRefreshing(true)
        loadExercises()
    }

    const renderExerciseCard = ({ item }: { item: Exercise }) => {
        const difficultyColor = DIFFICULTY_COLORS[item.difficulty?.toUpperCase() || ''] || '#6B7280'

        return (
            <View style={styles.card}>
                <View style={styles.cardHeader}>
                    <View style={styles.iconContainer}>
                        <Dumbbell size={20} color={colors.primary} />
                    </View>
                    <View style={styles.headerTitleBox}>
                        <Text style={styles.exerciseTitle}>{item.title}</Text>
                        <View style={styles.tagRow}>
                            {item.category && (
                                <View style={styles.categoryBadge}>
                                    <Tag size={10} color="#9CA3AF" style={{ marginRight: 4 }} />
                                    <Text style={styles.categoryText}>{item.category}</Text>
                                </View>
                            )}
                            {item.difficulty && (
                                <View style={[styles.difficultyBadge, { borderColor: difficultyColor }]}>
                                    <Text style={[styles.difficultyText, { color: difficultyColor }]}>
                                        {item.difficulty}
                                    </Text>
                                </View>
                            )}
                        </View>
                    </View>
                </View>

                {item.description && (
                    <Text style={styles.descriptionText} numberOfLines={3}>
                        {item.description}
                    </Text>
                )}

                <View style={styles.cardFooter}>
                    <View style={styles.calorieBox}>
                        <Flame size={14} color="#F59E0B" />
                        <Text style={styles.calorieText}>Stima: ~8 kcal/min</Text>
                    </View>
                </View>
            </View>
        )
    }

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <Text style={styles.title}>Catalogo Esercizi</Text>
                <Text style={styles.subtitle}>Esplora ed esegui esercizi ufficiali o personalizzati</Text>
            </View>

            {/* Search Bar */}
            <View style={styles.searchContainer}>
                <Search size={18} color="#6B7280" style={{ marginLeft: 12, marginRight: 8 }} />
                <TextInput
                    style={styles.searchInput}
                    placeholder="Cerca esercizio..."
                    placeholderTextColor="#6B7280"
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                    onSubmitEditing={handleSearch}
                    returnKeyType="search"
                />
                {searchQuery.length > 0 && (
                    <TouchableOpacity onPress={handleSearch} style={styles.searchSubmitButton}>
                        <Text style={styles.searchSubmitText}>Cerca</Text>
                    </TouchableOpacity>
                )}
            </View>

            {/* Categories Pills */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.categoryScroll} contentContainerStyle={styles.categoryContent}>
                {CATEGORIES.map((cat) => {
                    const isSelected = selectedCategory === cat
                    return (
                        <TouchableOpacity
                            key={cat}
                            style={[styles.pill, isSelected && styles.pillActive]}
                            onPress={() => setSelectedCategory(cat)}
                        >
                            <Text style={[styles.pillText, isSelected && styles.pillTextActive]}>
                                {cat}
                            </Text>
                        </TouchableOpacity>
                    )
                })}
            </ScrollView>

            {loading ? (
                <View style={styles.centerContainer}>
                    <ActivityIndicator size="large" color={colors.primary} />
                </View>
            ) : (
                <FlatList
                    data={exercises}
                    keyExtractor={(item, index) => item.id || index.toString()}
                    renderItem={renderExerciseCard}
                    contentContainerStyle={styles.listContent}
                    refreshControl={
                        <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.primary} />
                    }
                    ListEmptyComponent={
                        <View style={styles.emptyContainer}>
                            <Dumbbell size={48} color="#4B5563" />
                            <Text style={styles.emptyTitle}>Nessun esercizio trovato</Text>
                            <Text style={styles.emptySubtitle}>Prova a cambiare categoria o ricerca.</Text>
                        </View>
                    }
                />
            )}

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
        marginBottom: 16,
    },
    title: {
        fontSize: 26,
        fontWeight: 'bold',
        color: '#FFFFFF',
    },
    subtitle: {
        fontSize: 14,
        color: '#9CA3AF',
        marginTop: 4,
    },
    searchContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#1F2937',
        borderRadius: 12,
        marginBottom: 14,
        borderWidth: 1,
        borderColor: '#374151',
    },
    searchInput: {
        flex: 1,
        color: '#FFF',
        fontSize: 15,
        paddingVertical: 10,
    },
    searchSubmitButton: {
        backgroundColor: colors.primary,
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 8,
        marginRight: 8,
    },
    searchSubmitText: {
        color: '#FFF',
        fontWeight: 'bold',
        fontSize: 12,
    },
    categoryScroll: {
        maxHeight: 40,
        marginBottom: 16,
    },
    categoryContent: {
        gap: 8,
    },
    pill: {
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 20,
        backgroundColor: '#1F2937',
        borderWidth: 1,
        borderColor: '#374151',
    },
    pillActive: {
        backgroundColor: colors.primary,
        borderColor: colors.primary,
    },
    pillText: {
        color: '#9CA3AF',
        fontSize: 13,
        fontWeight: '600',
    },
    pillTextActive: {
        color: '#FFFFFF',
    },
    centerContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    listContent: {
        paddingBottom: 40,
    },
    card: {
        backgroundColor: '#1F2937',
        borderRadius: 14,
        padding: 16,
        marginBottom: 12,
        borderWidth: 1,
        borderColor: '#374151',
    },
    cardHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 10,
    },
    iconContainer: {
        width: 38,
        height: 38,
        borderRadius: 19,
        backgroundColor: 'rgba(249, 115, 22, 0.15)',
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 12,
    },
    headerTitleBox: {
        flex: 1,
    },
    exerciseTitle: {
        color: '#FFF',
        fontSize: 16,
        fontWeight: 'bold',
    },
    tagRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        marginTop: 4,
    },
    categoryBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#111827',
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 6,
    },
    categoryText: {
        color: '#9CA3AF',
        fontSize: 11,
    },
    difficultyBadge: {
        borderWidth: 1,
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 6,
    },
    difficultyText: {
        fontSize: 10,
        fontWeight: 'bold',
    },
    descriptionText: {
        color: '#D1D5DB',
        fontSize: 13,
        lineHeight: 18,
        marginBottom: 12,
    },
    cardFooter: {
        borderTopWidth: 1,
        borderTopColor: '#374151',
        paddingTop: 10,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    calorieBox: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    calorieText: {
        color: '#9CA3AF',
        fontSize: 12,
        marginLeft: 6,
    },
    emptyContainer: {
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 60,
    },
    emptyTitle: {
        color: '#FFF',
        fontSize: 18,
        fontWeight: 'bold',
        marginTop: 16,
    },
    emptySubtitle: {
        color: '#9CA3AF',
        fontSize: 14,
        marginTop: 4,
    },
})
