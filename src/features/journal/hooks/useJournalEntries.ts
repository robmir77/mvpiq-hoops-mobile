import { useQuery } from '@tanstack/react-query'
import { fetchJournalEntries } from '../api/journal.api'
import { EntryType } from '../types/journal.types'

export const useJournalEntries = (playerId: string, entryType?: EntryType) => {
    return useQuery({
        queryKey: ['journalEntries', playerId, entryType],
        queryFn: () => fetchJournalEntries(playerId, entryType),
        enabled: !!playerId,
        retry: (failureCount, error: any) => {
            // Non retry per errori di auth/permessi
            if (error?.response?.status === 401 || error?.response?.status === 403) {
                return false
            }
            return failureCount < 1
        },
        refetchOnWindowFocus: false,
    })
}
