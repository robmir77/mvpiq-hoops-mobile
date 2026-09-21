// src/shared/api/keepAliveService.ts
// Servizio per mantenere il backend attivo con polling periodico

import { AppState, AppStateStatus } from 'react-native'
import { API_BASE_URL } from '@/config/appConfig'

const KEEP_ALIVE_INTERVAL_MS = 2 * 60 * 1000 // 2 minuti (ridotto da 10 per mantenere backend attivo)

let intervalId: number | null = null
let isRunning = false

/**
 * Esegue una chiamata health-check al backend per mantenerlo attivo
 */
const pingBackend = async (): Promise<void> => {
  try {
    // Usa l'endpoint /health specifico per il keep-alive
    const healthCheckUrl = API_BASE_URL.endsWith('/')
      ? `${API_BASE_URL}health`
      : `${API_BASE_URL}/health`

    const response = await fetch(healthCheckUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      cache: 'no-cache', // Evita cache per mantenere connessione attiva
    })

    if (__DEV__) {
      console.log('[KeepAlive] Backend ping successful:', response.status)
    }
  } catch (error) {
    if (__DEV__) {
      console.error('[KeepAlive] Backend ping failed:', error)
    }
    // Non facciamo nulla in caso di errore - il polling continua
  }
}

/**
 * Avvia il polling keep-alive
 */
export const startKeepAlive = (): void => {
  if (isRunning) {
    if (__DEV__) {
      console.log('[KeepAlive] Already running, skipping start')
    }
    return
  }

  isRunning = true

  // Ping immediato all'avvio
  pingBackend()

  // Ping periodico ogni 10 minuti
  intervalId = setInterval(() => {
    pingBackend()
  }, KEEP_ALIVE_INTERVAL_MS)

  if (__DEV__) {
    console.log('[KeepAlive] Started - will ping backend every 2 minutes')
  }
}

/**
 * Ferma il polling keep-alive
 */
export const stopKeepAlive = (): void => {
  if (intervalId) {
    clearInterval(intervalId)
    intervalId = null
  }
  isRunning = false

  if (__DEV__) {
    console.log('[KeepAlive] Stopped')
  }
}

/**
 * Hook React per gestire automaticamente il keep-alive in base allo stato dell'app
 * Avvia quando l'app è in foreground, ferma quando va in background
 */
export const useKeepAlive = () => {
  let appStateSubscription: any = null

  const handleAppStateChange = (nextAppState: AppStateStatus) => {
    if (nextAppState === 'active') {
      startKeepAlive()
    } else if (nextAppState === 'background' || nextAppState === 'inactive') {
      stopKeepAlive()
    }
  }

  // Avvia quando il componente monta (app in foreground)
  const start = () => {
    startKeepAlive()
    appStateSubscription = AppState.addEventListener('change', handleAppStateChange)
  }

  // Ferma quando il componente smonta
  const stop = () => {
    stopKeepAlive()
    if (appStateSubscription) {
      appStateSubscription.remove()
      appStateSubscription = null
    }
  }

  return { start, stop }
}
