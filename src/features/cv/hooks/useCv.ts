// src/features/cv/hooks/useCv.ts

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getPlayerCv, updatePlayerCv } from '../api/cv.api'
import { PlayerCv } from '../types/cv.types'

export const useCv = (playerId?: string) => {
    return useQuery({
        queryKey: ['cv', playerId],
        queryFn: () => getPlayerCv(playerId!),
        enabled: !!playerId,
    })
}

export const useUpdateCv = () => {
    const queryClient = useQueryClient()
    
    return useMutation({
        mutationFn: ({ playerId, data }: { playerId: string; data: PlayerCv }) => 
            updatePlayerCv(playerId, data),
        onSuccess: (data, variables) => {
            // Invalida la cache del CV per il player
            queryClient.invalidateQueries({ queryKey: ['cv', variables.playerId] })
        },
    })
}
