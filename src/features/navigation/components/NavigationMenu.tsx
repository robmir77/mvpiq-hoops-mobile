// src/features/navigation/components/NavigationMenu.tsx

import React, { useState } from 'react'
import {
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    ScrollView,
    ActivityIndicator,
    Modal,
} from 'react-native'
import { useNavigation } from '@react-navigation/native'
import * as LucideIcons from 'lucide-react-native'

import { useNavigationSections } from '@/features/navigation/hooks/useNavigationSections'
import { NavigationSection } from '@/features/auth/types/auth.types'
import { colors } from '@/shared/theme/colors'

// ─── Icona Lucide dinamica ────────────────────────────────────
// Il DB salva nomi kebab-case (es. "notebook-pen").
// Lucide esporta PascalCase (es. "NotebookPen").
const toPascalCase = (kebab: string): string =>
    kebab.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('')

interface LucideIconProps {
    name: string | null
    size?: number
    color?: string
}

const LucideIcon: React.FC<LucideIconProps> = ({ name, size = 22, color = '#888' }) => {
    if (!name) return <Text style={{ fontSize: size - 2 }}>📱</Text>
    const pascal = toPascalCase(name)
    const Icon = (LucideIcons as any)[pascal]
    if (!Icon) return <Text style={{ fontSize: size - 2 }}>📱</Text>
    return <Icon size={size} color={color} strokeWidth={2} />
}

// ─── Componente ───────────────────────────────────────────────
interface NavigationMenuProps {
    onSectionPress?: (section: NavigationSection) => void
}

export const NavigationMenu: React.FC<NavigationMenuProps> = ({ onSectionPress }) => {
    const navigation = useNavigation()
    const [showMoreModal, setShowMoreModal] = useState(false)
    const { accessibleSections, isLoading, isError, refetch } = useNavigationSections()

    const MAX_VISIBLE_ITEMS = 5
    const visibleSections = accessibleSections.slice(0, MAX_VISIBLE_ITEMS)
    const hiddenSections  = accessibleSections.slice(MAX_VISIBLE_ITEMS)

    const handleSectionPress = (section: NavigationSection) => {
        if (onSectionPress) {
            onSectionPress(section)
        } else {
            navigation.navigate(section.id as never)
        }
    }

    if (isLoading) {
        return (
            <View style={styles.centerContainer}>
                <ActivityIndicator size="large" color={colors.primary} />
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

    const MenuItem = ({ section, onPress }: { section: NavigationSection; onPress: () => void }) => (
        <TouchableOpacity style={styles.menuItem} onPress={onPress} activeOpacity={0.7}>
            <View style={styles.menuItemLeft}>
                <View style={styles.iconContainer}>
                    <LucideIcon
                        name={section.icon}
                        size={22}
                        color={section.iconColor ?? colors.primary}
                    />
                </View>
                <View style={styles.menuItemContent}>
                    <Text style={styles.menuItemTitle}>{section.title}</Text>
                    {section.description ? (
                        <Text style={styles.menuItemDescription} numberOfLines={1}>
                            {section.description}
                        </Text>
                    ) : null}
                </View>
            </View>
            <Text style={styles.arrowIcon}>›</Text>
        </TouchableOpacity>
    )

    return (
        <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Menu Principale</Text>

                {visibleSections.map((section: NavigationSection) => (
                    <MenuItem
                        key={section.id}
                        section={section}
                        onPress={() => handleSectionPress(section)}
                    />
                ))}

                {hiddenSections.length > 0 && (
                    <TouchableOpacity
                        style={styles.menuItem}
                        onPress={() => setShowMoreModal(true)}
                        activeOpacity={0.7}
                    >
                        <View style={styles.menuItemLeft}>
                            <View style={styles.iconContainer}>
                                <LucideIcon name="ellipsis" size={22} color={colors.primary} />
                            </View>
                            <View style={styles.menuItemContent}>
                                <Text style={styles.menuItemTitle}>Altro</Text>
                                <Text style={styles.menuItemDescription}>
                                    {hiddenSections.length} altre sezioni
                                </Text>
                            </View>
                        </View>
                        <Text style={styles.arrowIcon}>›</Text>
                    </TouchableOpacity>
                )}
            </View>

            <Modal
                visible={showMoreModal}
                animationType="slide"
                transparent={true}
                onRequestClose={() => setShowMoreModal(false)}
            >
                <View style={styles.modalOverlay}>
                    <View style={styles.modalContent}>
                        <View style={styles.modalHeader}>
                            <Text style={styles.modalTitle}>Altre Sezioni</Text>
                            <TouchableOpacity
                                style={styles.closeButton}
                                onPress={() => setShowMoreModal(false)}
                            >
                                <LucideIcon name="x" size={18} color={colors.textPrimary} />
                            </TouchableOpacity>
                        </View>

                        <ScrollView style={styles.modalScroll}>
                            {hiddenSections.map((section: NavigationSection) => (
                                <MenuItem
                                    key={section.id}
                                    section={section}
                                    onPress={() => {
                                        handleSectionPress(section)
                                        setShowMoreModal(false)
                                    }}
                                />
                            ))}
                        </ScrollView>
                    </View>
                </View>
            </Modal>
        </ScrollView>
    )
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: colors.background,
    },
    centerContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: colors.background,
        paddingHorizontal: 20,
    },
    loadingText: {
        color: colors.textSecondary,
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
        backgroundColor: colors.primary,
        paddingHorizontal: 20,
        paddingVertical: 10,
        borderRadius: 8,
    },
    retryText: {
        color: '#fff',
        fontWeight: 'bold',
    },
    emptyText: {
        color: colors.textSecondary,
        fontSize: 16,
        textAlign: 'center',
    },
    section: {
        padding: 16,
    },
    sectionTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        color: colors.textPrimary,
        marginBottom: 16,
    },
    menuItem: {
        backgroundColor: colors.card,
        borderRadius: 12,
        padding: 14,
        marginBottom: 10,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderWidth: 1,
        borderColor: colors.cardBorder,
    },
    menuItemLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
    },
    iconContainer: {
        width: 40,
        height: 40,
        borderRadius: 10,
        backgroundColor: 'rgba(255,140,0,0.1)',
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 14,
    },
    menuItemContent: {
        flex: 1,
    },
    menuItemTitle: {
        fontSize: 15,
        fontWeight: '600',
        color: colors.textPrimary,
        marginBottom: 2,
    },
    menuItemDescription: {
        fontSize: 12,
        color: colors.textSecondary,
        lineHeight: 16,
    },
    arrowIcon: {
        fontSize: 20,
        color: colors.primary,
        fontWeight: 'bold',
    },
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.7)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    modalContent: {
        backgroundColor: colors.card,
        borderRadius: 16,
        width: '90%',
        maxHeight: '80%',
        borderWidth: 1,
        borderColor: colors.cardBorder,
    },
    modalHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 16,
        borderBottomWidth: 1,
        borderBottomColor: colors.cardBorder,
    },
    modalTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        color: colors.textPrimary,
    },
    closeButton: {
        padding: 8,
        backgroundColor: colors.cardBorder,
        borderRadius: 20,
        width: 36,
        height: 36,
        justifyContent: 'center',
        alignItems: 'center',
    },
    modalScroll: {
        padding: 16,
    },
})
