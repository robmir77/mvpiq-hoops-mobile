// C:\MVPiQHoopsMobile\src\features\profile\api\profile.api.ts

import apiClient from '@/shared/api/apiClient'
import { PlayerProfile, UpdatePlayerProfile } from '@/features/profile/types/profile.types'

export const getAthleteProfile = async (
    userId: string
): Promise<PlayerProfile> => {
    try {
        const response = await apiClient.get<PlayerProfile>(
            `/athlet/user/${userId}`
        )

        return response.data
    } catch (error: any) {
        console.error(
            'Errore caricamento profilo:',
            error?.response?.data || error.message
        )

        throw new Error(
            error?.response?.data?.message || 'Errore caricamento profilo'
        )
    }
}

export const updateAthleteProfile = async ({
                                               profileId,
                                               data,
                                           }: {
    profileId: string
    data: UpdatePlayerProfile
}): Promise<PlayerProfile> => {
    try {
        const response = await apiClient.put<PlayerProfile>(
            `/athlet/${profileId}`,
            data
        )

        return response.data
    } catch (error: any) {
        console.error(
            'Errore aggiornamento profilo:',
            error?.response?.data || error.message
        )

        throw new Error(
            error?.response?.data?.message ||
            'Errore durante aggiornamento profilo'
        )
    }
}