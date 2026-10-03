import AsyncStorage from '@react-native-async-storage/async-storage'
import { addShotEvent, endWorkoutSession, saveCourtCalibration } from '../api/workouts.api'

const OUTBOX_KEY_PREFIX = 'workout_outbox_'
const MAX_RETRY_ATTEMPTS = 5
const RETRY_BASE_DELAY_MS = 1000

export interface OutboxItem {
  id: string
  type: 'SHOT' | 'SESSION_START' | 'SESSION_END' | 'CALIBRATION'
  sessionId: string
  userId: string
  payload: any
  timestamp: number
  retryCount: number
}

/**
 * Background worker for recovering pending critical events from previous sessions.
 * Runs independently of active workout sessions to retry failed events.
 */
export class OutboxRecoveryWorker {
  private isRunning = false
  private intervalId: number | null = null
  private retryIntervalMs = 30000 // 30 seconds between recovery attempts
  private recoveryInProgress = false

  /**
   * Start the recovery worker
   */
  start(intervalMs: number = 30000) {
    if (this.isRunning) {
      console.warn('[RecoveryWorker] Already running')
      return
    }

    this.retryIntervalMs = intervalMs
    this.isRunning = true
    console.log('[RecoveryWorker] Started with interval:', intervalMs, 'ms')

    // Run immediately on start
    this.runRecovery().catch(e => {
      console.error('[RecoveryWorker] Initial recovery failed:', e)
    })

    // Schedule periodic recovery
    this.intervalId = setInterval(() => {
      if (this.recoveryInProgress) {
        console.warn('[RecoveryWorker] Recovery already in progress, skipping this cycle')
        return
      }
      this.recoveryInProgress = true
      this.runRecovery().catch(e => {
        console.error('[RecoveryWorker] Scheduled recovery failed:', e)
      }).finally(() => {
        this.recoveryInProgress = false
      })
    }, this.retryIntervalMs)
  }

  /**
   * Stop the recovery worker
   */
  stop() {
    if (!this.isRunning) {
      return
    }

    this.isRunning = false
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
    console.log('[RecoveryWorker] Stopped')
  }

  /**
   * Run a single recovery pass
   */
  private async runRecovery() {
    try {
      console.log('[RecoveryWorker] Running recovery pass')
      
      const items = await this.loadAllPendingItems()
      
      if (items.length === 0) {
        console.log('[RecoveryWorker] No pending items to recover')
        return
      }

      console.log(`[RecoveryWorker] Found ${items.length} pending items`)

      let recovered = 0
      let failed = 0

      for (const item of items) {
        try {
          const success = await this.retryItem(item)
          if (success) {
            await this.removeItem(item.id)
            recovered++
          } else {
            await this.incrementRetryCount(item)
            failed++
          }
        } catch (e) {
          console.error(`[RecoveryWorker] Failed to process item ${item.id}:`, e)
          failed++
        }
      }

      console.log(`[RecoveryWorker] Recovery pass complete: ${recovered} recovered, ${failed} failed`)
    } catch (e) {
      console.error('[RecoveryWorker] Recovery pass failed:', e)
    }
  }

  /**
   * Load all pending items from all sessions
   */
  private async loadAllPendingItems(): Promise<OutboxItem[]> {
    try {
      const keys = await AsyncStorage.getAllKeys()
      const allOutboxKeys = keys.filter(k => k.startsWith(OUTBOX_KEY_PREFIX))
      
      if (allOutboxKeys.length === 0) return []

      const items = await AsyncStorage.multiGet(allOutboxKeys)
      const allItems = items
        .map(([_, value]) => {
          if (!value) return null
          try {
            return JSON.parse(value) as OutboxItem
          } catch {
            return null
          }
        })
        .filter((item): item is OutboxItem => item !== null)
        .sort((a, b) => a.timestamp - b.timestamp)

      return allItems
    } catch (e) {
      console.error('[RecoveryWorker] Failed to load pending items:', e)
      return []
    }
  }

  /**
   * Retry a single item
   */
  private async retryItem(item: OutboxItem): Promise<boolean> {
    // Check retry limit
    if (item.retryCount >= MAX_RETRY_ATTEMPTS) {
      console.warn(`[RecoveryWorker] Item ${item.id} exceeded retry limit (${item.retryCount}), keeping for manual recovery`)
      return false
    }

    // Calculate backoff delay
    const delay = RETRY_BASE_DELAY_MS * Math.pow(2, item.retryCount)
    await this.sleep(delay)

    try {
      switch (item.type) {
        case 'SHOT':
          await addShotEvent(item.sessionId, item.userId, item.payload)
          console.log(`[RecoveryWorker] Successfully retried SHOT ${item.id}`)
          return true
        case 'SESSION_END':
          await endWorkoutSession(item.sessionId, item.userId)
          console.log(`[RecoveryWorker] Successfully retried SESSION_END ${item.id}`)
          return true
        case 'CALIBRATION':
          await saveCourtCalibration(item.sessionId, item.userId, item.payload)
          console.log(`[RecoveryWorker] Successfully retried CALIBRATION ${item.id}`)
          return true
        case 'SESSION_START':
          console.log(`[RecoveryWorker] SESSION_START ${item.id} is confirmed, skipping retry`)
          return true
        default:
          console.warn(`[RecoveryWorker] Unknown item type: ${item.type}`)
          return false
      }
    } catch (e) {
      console.error(`[RecoveryWorker] Failed to retry item ${item.id}:`, e)
      return false
    }
  }

  /**
   * Remove item from storage after successful retry
   */
  private async removeItem(id: string) {
    try {
      const key = `${OUTBOX_KEY_PREFIX}${id}`
      await AsyncStorage.removeItem(key)
    } catch (e) {
      console.error(`[RecoveryWorker] Failed to remove item ${id}:`, e)
    }
  }

  /**
   * Increment retry count for failed item
   */
  private async incrementRetryCount(item: OutboxItem) {
    try {
      item.retryCount++
      const key = `${OUTBOX_KEY_PREFIX}${item.id}`
      await AsyncStorage.setItem(key, JSON.stringify(item))
    } catch (e) {
      console.error(`[RecoveryWorker] Failed to update retry count for ${item.id}:`, e)
    }
  }

  /**
   * Sleep helper for backoff delay
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}

// Singleton instance
let recoveryWorkerInstance: OutboxRecoveryWorker | null = null

/**
 * Get or create the recovery worker singleton
 */
export function getRecoveryWorker(): OutboxRecoveryWorker {
  if (!recoveryWorkerInstance) {
    recoveryWorkerInstance = new OutboxRecoveryWorker()
  }
  return recoveryWorkerInstance
}

/**
 * Start the recovery worker
 */
export function startRecoveryWorker(intervalMs: number = 30000) {
  const worker = getRecoveryWorker()
  worker.start(intervalMs)
}

/**
 * Stop the recovery worker
 */
export function stopRecoveryWorker() {
  const worker = getRecoveryWorker()
  worker.stop()
}
