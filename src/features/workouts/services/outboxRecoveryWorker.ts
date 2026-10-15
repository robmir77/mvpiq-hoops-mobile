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
  suspended?: boolean // If true, item is suspended from automatic retries (e.g., 401 auth error)
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
      const items = await this.loadAllPendingItems()

      if (items.length === 0) {
        return
      }

      console.log(`[RecoveryWorker] Found ${items.length} pending items`)

      let recovered = 0
      let failed = 0
      let suspended = 0

      for (const item of items) {
        // Skip suspended items (e.g., 401 auth errors)
        if (item.suspended === true) {
          suspended++
          continue
        }

        try {
          const result = await this.retryItem(item)
          if (result.success) {
            await this.removeItem(item.id)
            recovered++
          } else if (!result.shouldRetry) {
            // Item exceeded retry limit or should not be retried - keep for manual recovery
            // Do NOT increment retry count to avoid infinite loop
            failed++
          } else {
            // Item failed but should be retried - increment count
            await this.incrementRetryCount(item)
            failed++
          }
        } catch (e) {
          console.error(`[RecoveryWorker] Failed to process item ${item.id}:`, e)
          failed++
        }
      }

      if (recovered > 0 || failed > 0 || suspended > 0) {
        console.log(`[RecoveryWorker] Recovery pass complete: ${recovered} recovered, ${failed} failed, ${suspended} suspended`)
      }
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
   * Returns { success: boolean, shouldRetry: boolean }
   * - success: true if item was successfully retried or removed
   * - shouldRetry: false if item exceeded retry limit or should not be retried automatically
   */
  private async retryItem(item: OutboxItem): Promise<{ success: boolean; shouldRetry: boolean }> {
    // Check retry limit - remove item if exceeded
    if (item.retryCount >= MAX_RETRY_ATTEMPTS) {
      console.warn(`[RecoveryWorker] Item ${item.id} exceeded retry limit (${item.retryCount}), removing from outbox`)
      await this.removeItem(item.id)
      return { success: false, shouldRetry: false }
    }

    // Calculate backoff delay
    const delay = RETRY_BASE_DELAY_MS * Math.pow(2, item.retryCount)
    await this.sleep(delay)

    try {
      switch (item.type) {
        case 'SHOT':
          await addShotEvent(item.sessionId, item.userId, item.payload)
          console.log(`[RecoveryWorker] Successfully retried SHOT ${item.id}`)
          return { success: true, shouldRetry: false }
        case 'SESSION_END':
          await endWorkoutSession(item.sessionId, item.userId)
          console.log(`[RecoveryWorker] Successfully retried SESSION_END ${item.id}`)
          return { success: true, shouldRetry: false }
        case 'CALIBRATION':
          await saveCourtCalibration(item.sessionId, item.userId, item.payload)
          console.log(`[RecoveryWorker] Successfully retried CALIBRATION ${item.id}`)
          return { success: true, shouldRetry: false }
        case 'SESSION_START':
          console.log(`[RecoveryWorker] SESSION_START ${item.id} is confirmed, skipping retry`)
          return { success: true, shouldRetry: false }
        default:
          console.warn(`[RecoveryWorker] Unknown item type: ${item.type}`)
          return { success: false, shouldRetry: false }
      }
    } catch (e: any) {
      console.error(`[RecoveryWorker] Failed to retry item ${item.id}:`, {
        status: e?.response?.status,
        statusText: e?.response?.statusText,
        data: e?.response?.data,
        message: e?.message,
      })

      // If session not found (404), remove the item from outbox
      // This happens when a session was deleted from backend but item remains in local storage
      if (e?.response?.status === 404 || e?.response?.data?.error?.includes('not found')) {
        console.warn(`[RecoveryWorker] Session ${item.sessionId} not found (404), removing item ${item.id} from outbox`)
        await this.removeItem(item.id)
        return { success: true, shouldRetry: false } // Item was handled (removed)
      }

      // If backend cannot deserialize data (500 with "Not able to deserialize"), remove the item
      // This happens when payload format is incompatible with backend schema
      if (e?.response?.status === 500 && e?.response?.data?.data?.includes('deserialize')) {
        console.warn(`[RecoveryWorker] Backend cannot deserialize payload for ${item.id}, removing from outbox`)
        await this.removeItem(item.id)
        return { success: true, shouldRetry: false } // Item was handled (removed)
      }

      // If session is not active (400 with "Session is not active"), remove the item
      // This happens when a session was already ended or deleted but SESSION_END event remains
      if (e?.response?.status === 400 && e?.response?.data?.message?.includes('not active')) {
        console.warn(`[RecoveryWorker] Session ${item.sessionId} is not active, removing item ${item.id} from outbox`)
        await this.removeItem(item.id)
        return { success: true, shouldRetry: false } // Item was handled (removed)
      }

      // For 401 authentication errors, do not retry automatically
      // User may need to re-login, but we keep the item for manual recovery
      if (e?.response?.status === 401) {
        console.warn(`[RecoveryWorker] Authentication failed (401) for item ${item.id}, suspending automatic retries`)
        await this.setSuspended(item.id, true)
        return { success: false, shouldRetry: false }
      }

      // For other errors, allow retry
      return { success: false, shouldRetry: true }
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
   * Set suspended state for an item (e.g., after 401 auth error)
   */
  private async setSuspended(id: string, suspended: boolean) {
    try {
      const key = `${OUTBOX_KEY_PREFIX}${id}`
      const value = await AsyncStorage.getItem(key)
      if (!value) return

      const item = JSON.parse(value) as OutboxItem
      item.suspended = suspended
      await AsyncStorage.setItem(key, JSON.stringify(item))
      console.log(`[RecoveryWorker] Item ${id} suspended state set to ${suspended}`)
    } catch (e) {
      console.error(`[RecoveryWorker] Failed to update suspended state for ${id}:`, e)
    }
  }

  /**
   * Sleep helper for backoff delay
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  /**
   * Remove all items for a specific session ID
   * Useful for cleaning up items from obsolete sessions
   */
  async removeItemsBySession(sessionId: string): Promise<number> {
    try {
      const keys = await AsyncStorage.getAllKeys()
      const sessionOutboxKeys = keys.filter(k => k.startsWith(OUTBOX_KEY_PREFIX))

      if (sessionOutboxKeys.length === 0) return 0

      const items = await AsyncStorage.multiGet(sessionOutboxKeys)
      const itemsToRemove = items
        .filter(([_, value]) => {
          if (!value) return false
          try {
            const item = JSON.parse(value) as OutboxItem
            return item.sessionId === sessionId
          } catch {
            return false
          }
        })
        .map(([key]) => key)

      if (itemsToRemove.length === 0) return 0

      await AsyncStorage.multiRemove(itemsToRemove)
      console.log(`[RecoveryWorker] Removed ${itemsToRemove.length} items for session ${sessionId}`)
      return itemsToRemove.length
    } catch (e) {
      console.error(`[RecoveryWorker] Failed to remove items for session ${sessionId}:`, e)
      return 0
    }
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

/**
 * Remove all items for a specific session ID
 * Useful for cleaning up items from obsolete sessions
 */
export async function removeOutboxItemsBySession(sessionId: string): Promise<number> {
  const worker = getRecoveryWorker()
  return await worker.removeItemsBySession(sessionId)
}
