import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
    fetchAllChecklistTemplates,
    fetchChecklistTemplateById,
    createChecklistTemplate,
    updateChecklistTemplate,
    deleteChecklistTemplate,
} from '../api/checklist-templates.api'

export const useChecklistTemplates = () => {
    return useQuery({
        queryKey: ['checklistTemplates'],
        queryFn: fetchAllChecklistTemplates,
        retry: (failureCount, error: any) => {
            if (error?.response?.status === 401 || error?.response?.status === 403) {
                return false
            }
            return failureCount < 1
        },
        refetchOnWindowFocus: false,
    })
}

export const useChecklistTemplate = (id: string) => {
    return useQuery({
        queryKey: ['checklistTemplate', id],
        queryFn: () => fetchChecklistTemplateById(id),
        enabled: !!id,
        retry: (failureCount, error: any) => {
            if (error?.response?.status === 401 || error?.response?.status === 403) {
                return false
            }
            return failureCount < 1
        },
        refetchOnWindowFocus: false,
    })
}

export const useCreateChecklistTemplate = () => {
    const queryClient = useQueryClient()

    return useMutation({
        mutationFn: createChecklistTemplate,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['checklistTemplates'] })
        },
    })
}

export const useUpdateChecklistTemplate = () => {
    const queryClient = useQueryClient()

    return useMutation({
        mutationFn: ({ id, payload }: { id: string; payload: any }) =>
            updateChecklistTemplate(id, payload),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['checklistTemplates'] })
        },
    })
}

export const useDeleteChecklistTemplate = () => {
    const queryClient = useQueryClient()

    return useMutation({
        mutationFn: deleteChecklistTemplate,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['checklistTemplates'] })
        },
    })
}
