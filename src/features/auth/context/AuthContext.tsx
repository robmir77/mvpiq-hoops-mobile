import React, { createContext, useState } from 'react'

interface AuthContextType {
    user: any
    setUser: (user: any) => void
}

export const AuthContext = createContext<AuthContextType | null>(null)

export const AuthProvider = ({ children }: any) => {
    const [user, setUser] = useState<any>(null)

    return (
        <AuthContext.Provider value={{ user, setUser }}>
            {children}
        </AuthContext.Provider>
    )
}