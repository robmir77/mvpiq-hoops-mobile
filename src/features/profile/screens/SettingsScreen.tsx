import React, { useContext } from 'react'
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    TouchableOpacity,
    Switch,
} from 'react-native'
import { AuthContext } from '@/features/auth/context/AuthContext'
import { colors } from '@/shared/theme/colors'
import { useCustomAlert, CustomAlert } from '@/shared/components/CustomAlert'
import { User, Shield, Bell, Moon, LogOut, ChevronRight, Info } from 'lucide-react-native'

export default function SettingsScreen() {
    const auth = useContext(AuthContext)
    const { alert, showWarning } = useCustomAlert()

    const user = auth?.user
    const [notificationsEnabled, setNotificationsEnabled] = React.useState(true)

    const handleLogout = () => {
        showWarning(
            'Disconnessione',
            'Sei sicuro di voler effettuare il logout?',
            () => {
                auth?.logout()
            }
        )
    }


    return (
        <View style={styles.container}>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
                <View style={styles.header}>
                    <Text style={styles.title}>Impostazioni</Text>
                    <Text style={styles.subtitle}>Gestisci il tuo account e le preferenze dell'app</Text>
                </View>

                {/* Account Summary */}
                <View style={styles.accountCard}>
                    <View style={styles.avatarCircle}>
                        <Text style={styles.avatarText}>
                            {(user?.displayName || user?.username || 'U').charAt(0).toUpperCase()}
                        </Text>
                    </View>
                    <View style={styles.accountInfo}>
                        <Text style={styles.userName}>{user?.displayName || user?.username}</Text>
                        <Text style={styles.userEmail}>{user?.email}</Text>
                        {user?.roles && (
                            <View style={styles.rolesContainer}>
                                {user.roles.map((r) => (
                                    <View key={r} style={styles.roleBadge}>
                                        <Text style={styles.roleText}>{r}</Text>
                                    </View>
                                ))}
                            </View>
                        )}
                    </View>
                </View>

                {/* Settings Sections */}
                <Text style={styles.sectionHeader}>Generale</Text>
                <View style={styles.sectionCard}>
                    <View style={styles.settingItem}>
                        <View style={styles.settingIconLabel}>
                            <Bell size={20} color={colors.primary} />
                            <Text style={styles.settingLabel}>Notifiche Push</Text>
                        </View>
                        <Switch
                            value={notificationsEnabled}
                            onValueChange={setNotificationsEnabled}
                            trackColor={{ false: '#374151', true: colors.primary }}
                            thumbColor="#FFF"
                        />
                    </View>

                    <View style={[styles.settingItem, styles.settingItemBorder]}>
                        <View style={styles.settingIconLabel}>
                            <Moon size={20} color={colors.primary} />
                            <Text style={styles.settingLabel}>Tema Scuro</Text>
                        </View>
                        <Text style={styles.settingValueText}>Sempre attivo</Text>
                    </View>
                </View>

                <Text style={styles.sectionHeader}>Sicurezza & Account</Text>
                <View style={styles.sectionCard}>
                    <TouchableOpacity style={styles.settingItem} activeOpacity={0.7}>
                        <View style={styles.settingIconLabel}>
                            <Shield size={20} color={colors.primary} />
                            <Text style={styles.settingLabel}>Permessi e Ruoli (RBAC)</Text>
                        </View>
                        <ChevronRight size={18} color="#6B7280" />
                    </TouchableOpacity>

                    <TouchableOpacity style={[styles.settingItem, styles.settingItemBorder]} activeOpacity={0.7}>
                        <View style={styles.settingIconLabel}>
                            <Info size={20} color={colors.primary} />
                            <Text style={styles.settingLabel}>Informazioni sull'app</Text>
                        </View>
                        <Text style={styles.settingValueText}>v1.0.0-SNAPSHOT</Text>
                    </TouchableOpacity>
                </View>

                {/* Logout Button */}
                <TouchableOpacity style={styles.logoutButton} onPress={handleLogout} activeOpacity={0.8}>
                    <LogOut size={20} color="#EF4444" style={{ marginRight: 10 }} />
                    <Text style={styles.logoutText}>Disconnettiti dall'Account</Text>
                </TouchableOpacity>
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
    scrollContent: {
        paddingBottom: 40,
    },
    header: {
        marginBottom: 20,
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
    accountCard: {
        backgroundColor: '#1F2937',
        borderRadius: 16,
        padding: 16,
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 24,
        borderWidth: 1,
        borderColor: '#374151',
    },
    avatarCircle: {
        width: 52,
        height: 52,
        borderRadius: 26,
        backgroundColor: colors.primary,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 14,
    },
    avatarText: {
        color: '#FFF',
        fontSize: 22,
        fontWeight: 'bold',
    },
    accountInfo: {
        flex: 1,
    },
    userName: {
        color: '#FFF',
        fontSize: 18,
        fontWeight: 'bold',
    },
    userEmail: {
        color: '#9CA3AF',
        fontSize: 13,
        marginTop: 2,
    },
    rolesContainer: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 4,
        marginTop: 6,
    },
    roleBadge: {
        backgroundColor: '#111827',
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 6,
    },
    roleText: {
        color: colors.primary,
        fontSize: 10,
        fontWeight: 'bold',
    },
    sectionHeader: {
        color: '#9CA3AF',
        fontSize: 13,
        fontWeight: 'bold',
        textTransform: 'uppercase',
        marginBottom: 8,
        marginLeft: 4,
    },
    sectionCard: {
        backgroundColor: '#1F2937',
        borderRadius: 16,
        marginBottom: 20,
        borderWidth: 1,
        borderColor: '#374151',
        overflow: 'hidden',
    },
    settingItem: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 16,
    },
    settingItemBorder: {
        borderTopWidth: 1,
        borderTopColor: '#374151',
    },
    settingIconLabel: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    settingLabel: {
        color: '#FFF',
        fontSize: 15,
        fontWeight: '500',
        marginLeft: 12,
    },
    settingValueText: {
        color: '#9CA3AF',
        fontSize: 13,
    },
    logoutButton: {
        backgroundColor: 'rgba(239, 68, 68, 0.12)',
        borderRadius: 16,
        padding: 16,
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: 'rgba(239, 68, 68, 0.3)',
        marginTop: 10,
    },
    logoutText: {
        color: '#EF4444',
        fontSize: 15,
        fontWeight: 'bold',
    },
})
