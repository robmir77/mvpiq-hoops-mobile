// C:\MVPiQHoopsMobile\src\features\profile\hooks\useUpdateProfile.ts

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { updateAthleteProfile } from '../api/profile.api'

export const useUpdateProfile = () => {
    const queryClient = useQueryClient()

    return useMutation({
        mutationFn: updateAthleteProfile,
        onSuccess: (_, variables) => {
            queryClient.invalidateQueries({
                queryKey: ['profile', variables.profileId],
            })
        },
    })
}