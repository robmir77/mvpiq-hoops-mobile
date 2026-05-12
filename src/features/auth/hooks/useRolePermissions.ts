// src/features/auth/hooks/useRolePermissions.ts

import { useContext } from 'react'
import { AuthContext } from '../context/AuthContext'
import { UserRole, User } from '../types/auth.types'

export const useRolePermissions = () => {
    const auth = useContext(AuthContext)
    const user = auth?.user

    const hasRole = (role: UserRole): boolean => {
        return user?.roles?.includes(role) || false
    }

    const hasAnyRole = (roles: UserRole[]): boolean => {
        if (!user?.roles || user.roles.length === 0) return false
        return roles.some(role => user.roles!.includes(role))
    }

    const hasAllRoles = (roles: UserRole[]): boolean => {
        if (!user?.roles || user.roles.length === 0) return false
        return roles.every(role => user.roles!.includes(role))
    }

    const canScout = (): boolean => {
        return hasAnyRole([UserRole.SCOUT, UserRole.ADMIN, UserRole.TRAINER])
    }

    const canTrain = (): boolean => {
        return hasAnyRole([UserRole.TRAINER, UserRole.ADMIN])
    }

    const canCreateContent = (): boolean => {
        return hasAnyRole([UserRole.CREATOR, UserRole.ADMIN])
    }

    const canManageUsers = (): boolean => {
        return hasRole(UserRole.ADMIN)
    }

    const canAccessAdminFeatures = (): boolean => {
        return hasRole(UserRole.ADMIN)
    }

    const canViewPlayerProfile = (): boolean => {
        return hasAnyRole([UserRole.PLAYER, UserRole.SCOUT, UserRole.TRAINER, UserRole.ADMIN, UserRole.CREATOR])
    }

    const canEditProfile = (profileId?: string): boolean => {
        // Può modificare il proprio profilo o è admin
        return user?.id === profileId || hasRole(UserRole.ADMIN)
    }

    const getRoleLabel = (): string => {
        if (!user?.roles || user.roles.length === 0) return 'Sconosciuto'
        
        const roleLabels = {
            [UserRole.ADMIN]: 'Amministratore',
            [UserRole.CREATOR]: 'Creator',
            [UserRole.GUEST]: 'Ospite',
            [UserRole.PLAYER]: 'Giocatore',
            [UserRole.SCOUT]: 'Scout',
            [UserRole.TRAINER]: 'Allenatore',
        }
        
        // Return the highest priority role label or the first role
        const priorityOrder = [UserRole.ADMIN, UserRole.TRAINER, UserRole.SCOUT, UserRole.CREATOR, UserRole.PLAYER, UserRole.GUEST]
        for (const role of priorityOrder) {
            if (user.roles!.includes(role)) {
                return roleLabels[role]
            }
        }
        
        return roleLabels[user.roles[0]] || user.roles[0]
    }

    const getRoleColor = (): string => {
        if (!user?.roles || user.roles.length === 0) return '#94A3B8'
        
        const roleColors = {
            [UserRole.ADMIN]: '#DC2626', // Rosso
            [UserRole.CREATOR]: '#7C3AED', // Viola
            [UserRole.GUEST]: '#6B7280', // Grigio
            [UserRole.PLAYER]: '#059669', // Verde
            [UserRole.SCOUT]: '#2563EB', // Blu
            [UserRole.TRAINER]: '#EA580C', // Arancione
        }
        
        // Return the highest priority role color or the first role color
        const priorityOrder = [UserRole.ADMIN, UserRole.TRAINER, UserRole.SCOUT, UserRole.CREATOR, UserRole.PLAYER, UserRole.GUEST]
        for (const role of priorityOrder) {
            if (user.roles!.includes(role)) {
                return roleColors[role]
            }
        }
        
        return roleColors[user.roles[0]] || '#94A3B8'
    }

    return {
        user,
        hasRole,
        hasAnyRole,
        hasAllRoles,
        canScout,
        canTrain,
        canCreateContent,
        canManageUsers,
        canAccessAdminFeatures,
        canViewPlayerProfile,
        canEditProfile,
        getRoleLabel,
        getRoleColor,
        isAdmin: hasRole(UserRole.ADMIN),
        isPlayer: hasRole(UserRole.PLAYER),
        isScout: hasRole(UserRole.SCOUT),
        isTrainer: hasRole(UserRole.TRAINER),
        isCreator: hasRole(UserRole.CREATOR),
        isGuest: hasRole(UserRole.GUEST),
    }
}
