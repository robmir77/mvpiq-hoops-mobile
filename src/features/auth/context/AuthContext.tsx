import React, { createContext, useState, useEffect } from 'react'
import { logout } from '../api/auth'
import { loadAuth } from '@/shared/storage/authStorage'
import { AuthContextType, User } from '../types/auth.types'

export const AuthContext = createContext<AuthContextType | null>(null)

export const AuthProvider = ({ children }: any) => {
    const [user, setUser] = useState<User | null>(null)
    const [isLoading, setIsLoading] = useState(true)

    // Carica l'utente salvato all'avvio
    useEffect(() => {
        const loadUser = async () => {
            try {
                const { user: savedUser } = await loadAuth()
                setUser(savedUser)
            } catch (error) {
                console.error('Error loading user:', error)
            } finally {
                setIsLoading(false)
            }
        }

        loadUser()
    }, [])

    const handleLogout = async () => {
        try {
            await logout()
            setUser(null)
        } catch (error) {
            console.error('Logout failed:', error)
        }
    }

    return (
        <AuthContext.Provider value={{ user, setUser, logout: handleLogout, isLoading }}>
            {children}
        </AuthContext.Provider>
    )
}