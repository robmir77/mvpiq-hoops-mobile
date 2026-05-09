// src/shared/api/apiHealthCheck.ts
// Utilità per testare la salute degli endpoint API supportati

import apiClient from './apiClient'
import { SUPPORTED_ENDPOINTS } from './supportedEndpoints'

export interface HealthCheckResult {
    endpoint: string
    status: 'success' | 'error' | 'not_tested'
    error?: string
    responseTime?: number
}

export interface ApiHealthReport {
    total: number
    working: number
    failing: number
    results: HealthCheckResult[]
}

export const testEndpoint = async (
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    testData?: any
): Promise<HealthCheckResult> => {
    const startTime = Date.now()
    
    try {
        let response
        
        switch (method) {
            case 'GET':
                response = await apiClient.get(path)
                break
            case 'POST':
                response = await apiClient.post(path, testData || {})
                break
            case 'PUT':
                response = await apiClient.put(path, testData || {})
                break
            case 'DELETE':
                response = await apiClient.delete(path)
                break
        }
        
        const responseTime = Date.now() - startTime
        
        return {
            endpoint: `${method} ${path}`,
            status: 'success',
            responseTime
        }
    } catch (error: any) {
        const responseTime = Date.now() - startTime
        
        return {
            endpoint: `${method} ${path}`,
            status: 'error',
            error: error?.response?.data?.message || error.message,
            responseTime
        }
    }
}

export const runApiHealthCheck = async (): Promise<ApiHealthReport> => {
    const results: HealthCheckResult[] = []
    
    // Testiamo solo gli endpoint GET che non richiedono dati specifici
    const testEndpoints = [
        { method: 'GET' as const, path: '/positions' },
        { method: 'GET' as const, path: '/athletes' },
        // Aggiungi altri endpoint GET sicuri da testare
    ]
    
    for (const endpoint of testEndpoints) {
        const result = await testEndpoint(endpoint.method, endpoint.path)
        results.push(result)
    }
    
    const working = results.filter(r => r.status === 'success').length
    const failing = results.filter(r => r.status === 'error').length
    
    return {
        total: results.length,
        working,
        failing,
        results
    }
}

// Funzione per testare un endpoint specifico
export const testSpecificEndpoint = async (endpointPath: string): Promise<HealthCheckResult> => {
    return testEndpoint('GET', endpointPath)
}
