import { useQuery } from '@tanstack/react-query'
import { getOnlineUsers } from '../api/users.api'

export const useOnlineUsers = (minutesAgo?: number) => {
    return useQuery({
        queryKey: ['onlineUsers', minutesAgo],
        queryFn: () => getOnlineUsers(minutesAgo || 15),
        enabled: !!minutesAgo, // Only fetch if minutesAgo is provided (admin only)
        refetchInterval: 30000, // Refresh every 30 seconds
        retry: (failureCount, error: any) => {
            if (error?.response?.status === 401 || error?.response?.status === 403) {
                return false
            }
            return failureCount < 1
        },
        refetchOnWindowFocus: false,
    })
}
