import { useQuery } from '@tanstack/react-query'
import { fetchDynamicChecklistOptions } from '../api/journal.api'
import { SelectSource } from '../types/journal.types'

export const useDynamicChecklistOptions = (selectSource?: SelectSource, selectQuery?: string) => {
    return useQuery({
        queryKey: ['dynamicChecklistOptions', selectSource, selectQuery],
        queryFn: () => fetchDynamicChecklistOptions(selectSource!, selectQuery),
        enabled: !!selectSource && selectSource !== 'STATIC',
        retry: (failureCount, error: any) => {
            if (error?.response?.status === 401 || error?.response?.status === 403) {
                return false
            }
            return failureCount < 1
        },
        refetchOnWindowFocus: false,
    })
}
