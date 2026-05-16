// src/features/navigation/hooks/useNavigationSections.ts

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getNavigationSections, checkSectionAccess } from '../api/navigation.api'
import { NavigationSection } from '@/features/auth/types/auth.types'
import { isAuthError, isPermissionError } from '@/shared/utils/errorHandler'

export const useNavigationSections = () => {
    const queryClient = useQueryClient()

    const {
        data: navigationData,
        isLoading,
        isError,
        error,
        refetch,
    } = useQuery({
        queryKey: ['navigation-sections'],
        queryFn: async () => {
            try {
                return await getNavigationSections()
            } catch (err: any) {
                console.error('Errore caricamento navigazione:', err)
                throw err
            }
        },
        staleTime: 5 * 60 * 1000, // 5 minuti
        retry: (failureCount, error: any) => {
            if (isAuthError(error) || isPermissionError(error)) {
                return false
            }
            return failureCount < 1
        },
    })

    const sections = navigationData?.data || []

    const getAccessibleSections = (): NavigationSection[] => {
        return sections
            .filter(section => section.accessible)
            .sort((a, b) => a.sortOrder - b.sortOrder)
    }

    const hasSectionAccess = async (sectionId: string): Promise<boolean> => {
        try {
            const cachedSection = sections.find(s => s.id === sectionId)
            if (cachedSection) return cachedSection.accessible
            const response = await checkSectionAccess(sectionId)
            return response.data
        } catch (error) {
            console.error(`Errore verifica accesso sezione ${sectionId}:`, error)
            return false
        }
    }

    const invalidateNavigation = () => {
        queryClient.invalidateQueries({ queryKey: ['navigation-sections'] })
    }

    return {
        sections,
        accessibleSections: getAccessibleSections(),
        isLoading,
        isError,
        error,
        refetch,
        hasSectionAccess,
        invalidateNavigation,
    }
}
