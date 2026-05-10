// src/features/navigation/hooks/useNavigationSections.ts

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getNavigationSections, checkSectionAccess } from '../api/navigation.api'
import { NavigationSection } from '@/features/auth/types/auth.types'
import { showErrorAlert, isAuthError, isPermissionError } from '@/shared/utils/errorHandler'

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
                if (isAuthError(err)) {
                    showErrorAlert('Errore Autenticazione', err)
                } else if (isPermissionError(err)) {
                    showErrorAlert('Errore Permessi', err)
                }
                throw err
            }
        },
        staleTime: 5 * 60 * 1000, // 5 minuti
        retry: (failureCount, error: any) => {
            if (isAuthError(error) || isPermissionError(error)) {
                return false // Non retry per errori di auth/permessi
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
            // Prima controlla nei dati già caricati
            const cachedSection = sections.find(s => s.id === sectionId)
            if (cachedSection) {
                return cachedSection.accessible
            }

            // Se non trovato, fai chiamata API
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
