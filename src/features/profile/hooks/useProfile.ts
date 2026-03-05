// C:\MVPiQHoopsMobile\src\features\profile\hooks\useProfile.ts

import { useQuery } from '@tanstack/react-query'
import { getAthleteProfile } from '../api/profile.api'

export const useProfile = (userId?: string) => {
    return useQuery({
        queryKey: ['profile', userId],
        queryFn: () => getAthleteProfile(userId!),
        enabled: !!userId,
    })
}