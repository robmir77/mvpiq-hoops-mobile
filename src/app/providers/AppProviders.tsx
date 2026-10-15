import React, { ReactNode, useEffect } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from '@/features/auth/context/AuthContext'
import { AlertProvider } from '@/shared/context/AlertContext'
import { startRecoveryWorker, stopRecoveryWorker } from '@/features/workouts/services/outboxRecoveryWorker'

const queryClient = new QueryClient()

export default function AppProviders({ children }: { children: ReactNode }) {
    useEffect(() => {
        // Start recovery worker on app mount
        startRecoveryWorker(30000) // 30 second interval

        // Cleanup on unmount
        return () => {
            stopRecoveryWorker()
        }
    }, [])

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