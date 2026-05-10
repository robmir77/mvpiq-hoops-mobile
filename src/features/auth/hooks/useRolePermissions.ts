// src/features/auth/hooks/useRolePermissions.ts

import { useContext } from 'react'
import { AuthContext } from '../context/AuthContext'
import { UserRole, User } from '../types/auth.types'

export const useRolePermissions = () => {
    const auth = useContext(AuthContext)
    const user = auth?.user

    const hasRole = (role: UserRole): boolean => {
        return user?.role === role
    }

    const hasAnyRole = (roles: UserRole[]): boolean => {
        if (!user?.role) return false
        return roles.includes(user.role)
    }

    const hasAllRoles = (roles: UserRole[]): boolean => {
        if (!user?.role) return false
        return roles.every(role => user.role === role)
    }

    const canScout = (): boolean => {
        return hasAnyRole([UserRole.SCOUT, UserRole.ADMIN, UserRole.TRAINER])
    }

    const canTrain = (): boolean => {
        return hasAnyRole([UserRole.TRAINER, UserRole.ADMIN]) || 
               (user?.is_trainer === true)
    }

    const canCreateContent = (): boolean => {
        return hasAnyRole([UserRole.CREATOR, UserRole.ADMIN]) || 
               (user?.is_creator === true)
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
        if (!user?.role) return 'Sconosciuto'
        
        const roleLabels = {
            [UserRole.ADMIN]: 'Amministratore',
            [UserRole.CREATOR]: 'Creator',
            [UserRole.GUEST]: 'Ospite',
            [UserRole.PLAYER]: 'Giocatore',
            [UserRole.SCOUT]: 'Scout',
            [UserRole.TRAINER]: 'Allenatore',
        }
        
        return roleLabels[user.role] || user.role
    }

    const getRoleColor = (): string => {
        if (!user?.role) return '#94A3B8'
        
        const roleColors = {
            [UserRole.ADMIN]: '#DC2626', // Rosso
            [UserRole.CREATOR]: '#7C3AED', // Viola
            [UserRole.GUEST]: '#6B7280', // Grigio
            [UserRole.PLAYER]: '#059669', // Verde
            [UserRole.SCOUT]: '#2563EB', // Blu
            [UserRole.TRAINER]: '#EA580C', // Arancione
        }
        
        return roleColors[user.role] || '#94A3B8'
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
