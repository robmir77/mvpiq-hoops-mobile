import React, { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from '@/features/auth/context/AuthContext'
import { AlertProvider } from '@/shared/context/AlertContext'

const queryClient = new QueryClient()

export default function AppProviders({ children }: { children: ReactNode }) {
    return (
        <QueryClientProvider client={queryClient}>
            <AuthProvider>
                <AlertProvider>
                    {children}
                </AlertProvider>
            </AuthProvider>
        </QueryClientProvider>
    )
}