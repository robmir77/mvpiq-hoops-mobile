// C:\MVPiQHoopsMobile\src\features\profile\hooks\useProfile.ts

import { useQuery } from '@tanstack/react-query'
import { getPlayerByUserId, getAllAthletes } from '../api/profile.api'

export const useProfile = (userId?: string) => {
    return useQuery({
        queryKey: ['profile', userId],
        queryFn: () => getPlayerByUserId(userId!),
        enabled: !!userId,
    })
}

export const useProfileById = (profileId?: string) => {
    return useQuery({
        queryKey: ['profile', profileId],
        queryFn: () => getPlayerByUserId(profileId!),
        enabled: !!profileId,
    })
}

export const useAllAthletes = () => {
    return useQuery({
        queryKey: ['athletes'],
        queryFn: () => getAllAthletes(),
    })
}