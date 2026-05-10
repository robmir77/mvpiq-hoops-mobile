import { useQuery } from '@tanstack/react-query'
import { fetchJournalEntry } from '../api/journal.api'

export const useJournalEntry = (playerId: string, entryId: string) => {
    return useQuery({
        queryKey: ['journalEntry', playerId, entryId],
        queryFn: () => fetchJournalEntry(playerId, entryId),
        enabled: !!playerId && !!entryId,
        retry: (failureCount, error: any) => {
            if (error?.response?.status === 401 || error?.response?.status === 403) {
                return false
            }
            return failureCount < 1
        },
        refetchOnWindowFocus: false,
    })
}
