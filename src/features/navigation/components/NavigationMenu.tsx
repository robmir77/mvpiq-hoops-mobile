// src/features/navigation/components/NavigationMenu.tsx

import React from 'react'
import {
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    ScrollView,
    ActivityIndicator,
} from 'react-native'
import { useNavigation } from '@react-navigation/native'
import { useNavigationSections } from '../hooks/useNavigationSections'
import { NavigationSection } from '@/features/auth/types/auth.types'

interface NavigationMenuProps {
    onSectionPress?: (section: NavigationSection) => void
}

export const NavigationMenu: React.FC<NavigationMenuProps> = ({ onSectionPress }) => {
    const navigation = useNavigation()
    const {
        accessibleSections,
        isLoading,
        isError,
        error,
        refetch,
    } = useNavigationSections()

    const handleSectionPress = (section: NavigationSection) => {
        if (onSectionPress) {
            onSectionPress(section)
        } else {
            // Navigazione di default basata sull'ID sezione
            navigateToSection(section)
        }
    }

    const navigateToSection = (section: NavigationSection) => {
        switch (section.id) {
            case 'profile':
                navigation.navigate('Profile' as never)
                break
            case 'player_stats':
                navigation.navigate('Stats' as never)
                break
            case 'cv':
                navigation.navigate('Cv' as never)
                break
            case 'goals':
                navigation.navigate('Goals' as never)
                break
            case 'training':
                navigation.navigate('Training' as never)
                break
            case 'scouting':
                navigation.navigate('Scouting' as never)
                break
            case 'admin':
                navigation.navigate('Admin' as never)
                break
            case 'notifications':
                navigation.navigate('Notifications' as never)
                break
            default:
                console.log(`Navigazione non implementata per: ${section.id}`)
        }
    }

    const getSectionIcon = (sectionId: string): string => {
        const icons: Record<string, string> = {
            profile: '👤',
            player_stats: '📊',
            cv: '📄',
            goals: '🎯',
            training: '🏋️',
            scouting: '🔍',
            admin: '⚙️',
            notifications: '🔔',
        }
        return icons[sectionId] || '📱'
    }

    if (isLoading) {
        return (
            <View style={styles.centerContainer}>
                <ActivityIndicator size="large" color="#ff8c00" />
                <Text style={styles.loadingText}>Caricamento navigazione...</Text>
            </View>
        )
    }

    if (isError) {
        return (
            <View style={styles.centerContainer}>
                <Text style={styles.errorText}>Errore caricamento menu</Text>
                <TouchableOpacity style={styles.retryButton} onPress={() => refetch()}>
                    <Text style={styles.retryText}>Riprova</Text>
                </TouchableOpacity>
            </View>
        )
    }

    if (accessibleSections.length === 0) {
        return (
            <View style={styles.centerContainer}>
                <Text style={styles.emptyText}>Nessuna sezione disponibile</Text>
            </View>
        )
    }

    return (
        <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Menu Principale</Text>
                
                {accessibleSections.map((section) => (
                    <TouchableOpacity
                        key={section.id}
                        style={styles.menuItem}
                        onPress={() => handleSectionPress(section)}
                        activeOpacity={0.7}
                    >
                        <View style={styles.menuItemLeft}>
                            <Text style={styles.menuIcon}>
                                {getSectionIcon(section.id)}
                            </Text>
                            <View style={styles.menuItemContent}>
                                <Text style={styles.menuItemTitle}>
                                    {section.title}
                                </Text>
                                <Text style={styles.menuItemDescription}>
                                    {section.description}
                                </Text>
                            </View>
                        </View>
                        <Text style={styles.arrowIcon}>›</Text>
                    </TouchableOpacity>
                ))}
            </View>
        </ScrollView>
    )
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#0b0f1a',
    },
    centerContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#0b0f1a',
        paddingHorizontal: 20,
    },
    loadingText: {
        color: '#aaa',
        marginTop: 10,
        fontSize: 14,
    },
    errorText: {
        color: '#ff4444',
        fontSize: 16,
        marginBottom: 20,
        textAlign: 'center',
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
    emptyText: {
        color: '#aaa',
        fontSize: 16,
        textAlign: 'center',
    },
    section: {
        padding: 16,
    },
    sectionTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#fff',
        marginBottom: 16,
    },
    menuItem: {
        backgroundColor: '#121826',
        borderRadius: 12,
        padding: 16,
        marginBottom: 12,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderWidth: 1,
        borderColor: '#2a2a2a',
    },
    menuItemLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
    },
    menuIcon: {
        fontSize: 24,
        marginRight: 16,
    },
    menuItemContent: {
        flex: 1,
    },
    menuItemTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: '#fff',
        marginBottom: 4,
    },
    menuItemDescription: {
        fontSize: 14,
        color: '#aaa',
        lineHeight: 18,
    },
    arrowIcon: {
        fontSize: 20,
        color: '#ff8c00',
        fontWeight: 'bold',
    },
})
