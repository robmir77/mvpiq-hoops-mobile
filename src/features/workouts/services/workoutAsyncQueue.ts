import { saveFrameDataBatch, addShotEvent, addShotEventsBatch, endWorkoutSession, saveCourtCalibration } from '../api/workouts.api'
import { PersistentOutbox } from './persistentOutbox'
import type { FrameDataPayload } from '../types/workouts.types'

// Shared retry configuration
const MAX_RETRY_ATTEMPTS = 5
const RETRY_BASE_DELAY_MS = 1000

interface AsyncQueueItem<T> {
  payload: T
  timestamp: number
  retryCount?: number
}

type OverflowBehavior = 'drop-oldest' | 'reject'

class BoundedQueue<T> {
  private queue: T[] = []
  private droppedCount = 0

  constructor(
    private readonly maxSize: number,
    private readonly overflowBehavior: OverflowBehavior = 'drop-oldest'
  ) {}

  push(item: T): boolean {
    if (this.queue.length >= this.maxSize) {
      if (this.overflowBehavior === 'reject') {
        return false
      }
      this.queue.shift()
      this.droppedCount++
    }

    this.queue.push(item)
    return true
  }

  drain(maxItems: number): T[] {
    return this.queue.splice(0, maxItems)
  }

  get size() {
    return this.queue.length
  }

  get dropped() {
    return this.droppedCount
  }

  clear() {
    this.queue.length = 0
    this.droppedCount = 0
  }
}

interface CriticalPayload {
  type: 'SHOT' | 'SESSION_START' | 'SESSION_END' | 'CALIBRATION'
  sessionId: string
  userId: string
  payload?: any
}

interface WorkoutAsyncQueueOptions {
  sessionId: string
  userId: string
}

class WorkoutAsyncQueue {
  private telemetry = new BoundedQueue<AsyncQueueItem<FrameDataPayload>>(100, 'drop-oldest')
  private criticalOutbox: PersistentOutbox

  private running = false
  private workerPromise: Promise<void> | null = null
  private initialized = false

  // Telemetry metrics
  private telemetryDroppedCount = 0
  private criticalOverflowCount = 0

  private constructor(options: WorkoutAsyncQueueOptions) {
    this.criticalOutbox = new PersistentOutbox(options.sessionId, options.userId)
  }

  /**
   * Initialize the queue - must be called before enqueueing
   */
  static async create(options: WorkoutAsyncQueueOptions): Promise<WorkoutAsyncQueue> {
    const queue = new WorkoutAsyncQueue(options)
    
    // Load pending items from ALL previous sessions (global recovery)
    await queue.criticalOutbox.loadAllPendingAndMerge()
    
    // Load current session items and merge
    await queue.criticalOutbox.loadPending()
    
    queue.initialized = true
    console.log(`[WorkoutQueue] Initialized with ${queue.criticalOutbox.size} pending critical items`)
    
    return queue
  }

  enqueueTelemetry(payload: FrameDataPayload) {
    if (!this.initialized) {
      console.error('[WorkoutQueue] Queue not initialized, cannot enqueue telemetry')
      return
    }

    this.telemetry.push({
      payload,
      timestamp: Date.now(),
    })

    this.ensureWorker()
  }

  async enqueueCritical(payload: CriticalPayload): Promise<boolean> {
    if (!this.initialized) {
      console.error('[WorkoutQueue] Queue not initialized, cannot enqueue critical event')
      return false
    }

    const success = await this.criticalOutbox.add({
      type: payload.type,
      sessionId: payload.sessionId,
      userId: payload.userId,
      payload: payload.payload,
    })

    if (!success) {
      this.criticalOverflowCount++
      console.error('[WorkoutQueue] CRITICAL OUTBOX PERSISTENCE FAILED - data may be lost!', {
        type: payload.type,
        queueSize: this.criticalOutbox.size,
        overflowCount: this.criticalOverflowCount,
      })
    }

    this.ensureWorker()
    return success
  }

  private ensureWorker() {
    if (this.running) return

    this.running = true
    this.workerPromise = this.run()
  }

  private async run() {
    try {
      // Accumulation window for telemetry: wait 250ms to batch frames
      const ACCUMULATION_DELAY_MS = 250
      const MIN_BATCH_SIZE = 5

      while (this.criticalOutbox.size > 0 || this.telemetry.size > 0) {
        // For critical items, only process if there are retryable items (not suspended)
        if (this.criticalOutbox.size > 0 && this.criticalOutbox.getRetryableCount() > 0) {
          await this.flush({ critical: true, telemetry: false })
        } else if (this.criticalOutbox.size > 0 && this.criticalOutbox.getRetryableCount() === 0) {
          // Only suspended items remain - stop processing to avoid useless loops
          console.log(`[WorkoutQueue] Only ${this.criticalOutbox.getSuspendedCount()} suspended items remain, stopping automatic processing`)
          break
        }

        // For telemetry, wait for accumulation or minimum batch size
        if (this.telemetry.size > 0) {
          if (this.telemetry.size >= MIN_BATCH_SIZE) {
            // Flush immediately if we have enough items
            await this.flush({ critical: false, telemetry: true })
          } else {
            // Wait for accumulation window
            await new Promise(resolve => setTimeout(resolve, ACCUMULATION_DELAY_MS))
            // Flush whatever accumulated
            await this.flush({ critical: false, telemetry: true })
          }
        }
      }
    } finally {
      this.running = false
      this.workerPromise = null

      // Only restart if there are retryable items or telemetry
      if (
        this.criticalOutbox.getRetryableCount() > 0 ||
        this.telemetry.size > 0
      ) {
        this.ensureWorker()
      }
    }
  }

  private async flush(options: { critical: boolean; telemetry: boolean; fastFail?: boolean } = { critical: true, telemetry: true, fastFail: false }) {
    // Update telemetry dropped count
    this.telemetryDroppedCount = this.telemetry.dropped

    // Process critical items from outbox
    if (options.critical && this.criticalOutbox.size > 0) {
      await this.processCriticalFromOutbox(options.fastFail)
    }

    // Process telemetry items (frame data) in batch - best effort
    if (options.telemetry && this.telemetry.size > 0) {
      const telemetryItems = this.telemetry.drain(20)
      if (telemetryItems.length > 0) {
        await this.processTelemetryItems(telemetryItems)
      }
    }
  }

  private async processCriticalFromOutbox(fastFail: boolean = false) {
    // Process up to 10 items at a time
    const processedCount = Math.min(10, this.criticalOutbox.size)

    for (let i = 0; i < processedCount; i++) {
      const item = this.criticalOutbox.peek()
      if (!item) break

      // Skip suspended items (e.g., 401 auth errors)
      if (this.criticalOutbox.isSuspended(item.id)) {
        console.log(`[WorkoutQueue] Skipping suspended item ${item.id}, moving to next`)
        await this.criticalOutbox.remove(item.id) // Remove from memory but keep in storage for manual recovery
        continue
      }

      const result = await this.processCriticalItemWithRetry(item, fastFail)
      if (result.success) {
        await this.criticalOutbox.remove(item.id)
      } else {
        // Item failed - keep it in outbox for future retry
        // DO NOT remove - critical events must not be lost
        console.error('[WorkoutQueue] Critical item failed, keeping in outbox for retry:', {
          id: item.id,
          type: item.type,
          retryCount: item.retryCount,
          shouldRetry: result.shouldRetry,
        })
        break // Stop processing this batch to avoid infinite loop
      }
    }
  }

  private async processCriticalItemWithRetry(item: any, fastFail: boolean = false): Promise<{ success: boolean; shouldRetry: boolean }> {
    const { type, sessionId, userId, payload, retryCount, id } = item

    if (type === 'SHOT') {
      return await this.retryShotEvent(sessionId, userId, payload, retryCount, id, fastFail)
    } else if (type === 'SESSION_START' || type === 'SESSION_END' || type === 'CALIBRATION') {
      return await this.retryCriticalEvent(type, sessionId, userId, payload, retryCount, id, fastFail)
    }
    return { success: true, shouldRetry: false }
  }

  private async retryShotEvent(sessionId: string, userId: string, payload: any, retryCount: number, itemId: string, fastFail: boolean = false): Promise<{ success: boolean; shouldRetry: boolean }> {
    // If already exceeded retry limit, don't attempt
    if (retryCount >= MAX_RETRY_ATTEMPTS) {
      console.warn(`[WorkoutQueue] Item ${itemId} already exceeded retry limit (${retryCount}), keeping for manual recovery`)
      return { success: false, shouldRetry: false }
    }

    for (let attempt = retryCount; attempt < MAX_RETRY_ATTEMPTS; attempt++) {
      try {
        // Update retry count before attempt
        await this.criticalOutbox.updateRetryCount(itemId, attempt)

        // Log payload for debugging 500 errors
        console.log('[WorkoutQueue] Sending shot payload:', JSON.stringify(payload, null, 2))

        await addShotEvent(sessionId, userId, payload)
        return { success: true, shouldRetry: false }
      } catch (e: any) {
        console.error(`[WorkoutQueue] Shot event failed (attempt ${attempt + 1}/${MAX_RETRY_ATTEMPTS}):`, e)
        console.error('[WorkoutQueue] Error response:', e?.response?.data)

        // For 401 authentication errors, suspend automatic retries
        if (e?.response?.status === 401) {
          console.warn(`[WorkoutQueue] Authentication failed (401) for item ${itemId}, suspending automatic retries`)
          await this.criticalOutbox.setSuspended(itemId, true)
          return { success: false, shouldRetry: false }
        }

        // Skip backoff during fastFail (shutdown mode)
        if (!fastFail && attempt < MAX_RETRY_ATTEMPTS - 1) {
          const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt)
          await new Promise(resolve => setTimeout(resolve, delay))
        }
      }
    }

    console.error('[WorkoutQueue] Shot event failed after retries, will retry later:', {
      sessionId,
      itemId,
      retryCount: MAX_RETRY_ATTEMPTS
    })
    return { success: false, shouldRetry: true }
  }

  private async retryCriticalEvent(type: string, sessionId: string, userId: string, payload: any, retryCount: number, itemId: string, fastFail: boolean = false): Promise<{ success: boolean; shouldRetry: boolean }> {
    // If already exceeded retry limit, don't attempt
    if (retryCount >= MAX_RETRY_ATTEMPTS) {
      console.warn(`[WorkoutQueue] Item ${itemId} already exceeded retry limit (${retryCount}), keeping for manual recovery`)
      return { success: false, shouldRetry: false }
    }

    for (let attempt = retryCount; attempt < MAX_RETRY_ATTEMPTS; attempt++) {
      try {
        // Update retry count before attempt
        await this.criticalOutbox.updateRetryCount(itemId, attempt)

        if (type === 'SESSION_START') {
          // SESSION_START is handled by createWorkoutSession API call when session is created
          // This event is mainly for tracking purposes, so we mark it as successful
          console.log(`[WorkoutQueue] SESSION_START event acknowledged: ${sessionId}`)
          return { success: true, shouldRetry: false }
        } else if (type === 'SESSION_END') {
          // Call the real SESSION_END API
          await endWorkoutSession(sessionId, userId)
          console.log(`[WorkoutQueue] SESSION_END event processed: ${sessionId}`)
          return { success: true, shouldRetry: false }
        } else if (type === 'CALIBRATION') {
          // Call the real CALIBRATION API
          await saveCourtCalibration(sessionId, userId, payload)
          console.log(`[WorkoutQueue] CALIBRATION event processed: ${sessionId}`)
          return { success: true, shouldRetry: false }
        }
        return { success: true, shouldRetry: false }
      } catch (e: any) {
        // If session not found (404), remove the item from outbox
        // This happens when a session was deleted from backend but item remains in local storage
        if (e?.response?.status === 404 || e?.response?.data?.error?.includes('not found')) {
          console.warn(`[WorkoutQueue] Session ${sessionId} not found (404), removing item ${itemId} from outbox`)
          await this.criticalOutbox.remove(itemId)
          return { success: true, shouldRetry: false } // Item was handled (removed)
        }

        // If session is not active (400 with "Session is not active"), remove the item
        // This happens when a session was already ended or deleted but SESSION_END event remains
        if (e?.response?.status === 400 && e?.response?.data?.message?.includes('not active')) {
          console.warn(`[WorkoutQueue] Session ${sessionId} is not active, removing item ${itemId} from outbox`)
          await this.criticalOutbox.remove(itemId)
          return { success: true, shouldRetry: false } // Mark as success since session is already in correct state
        }

        // For 401 authentication errors, suspend automatic retries
        if (e?.response?.status === 401) {
          console.warn(`[WorkoutQueue] Authentication failed (401) for item ${itemId}, suspending automatic retries`)
          await this.criticalOutbox.setSuspended(itemId, true)
          return { success: false, shouldRetry: false }
        }

        console.error(`[WorkoutQueue] Critical event failed (attempt ${attempt + 1}/${MAX_RETRY_ATTEMPTS}):`, {
          type,
          status: e?.response?.status,
          statusText: e?.response?.statusText,
          data: e?.response?.data,
          message: e?.message,
        })

        // Skip backoff during fastFail (shutdown mode)
        if (!fastFail && attempt < MAX_RETRY_ATTEMPTS - 1) {
          const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt)
          await new Promise(resolve => setTimeout(resolve, delay))
        }
      }
    }

    console.error('[WorkoutQueue] Critical event failed after retries, will retry later:', {
      type,
      sessionId,
      itemId,
      retryCount: MAX_RETRY_ATTEMPTS
    })
    return { success: false, shouldRetry: true }
  }

  private async processTelemetryItems(items: AsyncQueueItem<FrameDataPayload>[]) {
    const frames = items.map(item => item.payload)
    try {
      await saveFrameDataBatch(this.criticalOutbox.sessionId, this.criticalOutbox.userId, frames)
    } catch (e) {
      console.error('[WorkoutQueue] Failed to save frame batch (best-effort, data lost):', e)
      // Telemetry is best-effort - we accept data loss here
    }
  }

  async flushCriticalOnly(maxAttempts: number = 50, timeoutMs: number = 3000) {
    const startTime = Date.now()
    let attempts = 0
    while (this.criticalOutbox.getRetryableCount() > 0 && attempts < maxAttempts) {
      // Check time budget
      if (Date.now() - startTime > timeoutMs) {
        console.warn(`[WorkoutQueue] flushCriticalOnly timed out after ${timeoutMs}ms with ${this.criticalOutbox.getRetryableCount()} retryable items - items remain in outbox for recovery`)
        break
      }
      await this.flush({ critical: true, telemetry: false, fastFail: true })
      attempts++
    }

    if (this.criticalOutbox.getRetryableCount() > 0) {
      console.warn(`[WorkoutQueue] flushCriticalOnly stopped after ${attempts} attempts (${Date.now() - startTime}ms) with ${this.criticalOutbox.getRetryableCount()} retryable items - items remain in outbox for recovery`)
    } else if (this.criticalOutbox.getSuspendedCount() > 0) {
      console.log(`[WorkoutQueue] flushCriticalOnly complete with ${this.criticalOutbox.getSuspendedCount()} suspended items (not retried automatically)`)
    }
  }

  async flushTelemetryOnly() {
    while (this.telemetry.size > 0) {
      await this.flush({ critical: false, telemetry: true })
    }
  }

  async flushAll() {
    while (this.criticalOutbox.getRetryableCount() > 0 || this.telemetry.size > 0) {
      await this.flush({ critical: true, telemetry: true })
    }
  }

  // Legacy methods for backward compatibility
  async flushCritical() {
    return this.flushCriticalOnly()
  }

  async flushTelemetry() {
    return this.flushTelemetryOnly()
  }

  get telemetrySize() {
    return this.telemetry.size
  }

  get criticalSize() {
    return this.criticalOutbox.size
  }

  get telemetryDropped() {
    return this.telemetryDroppedCount
  }

  get criticalOverflow() {
    return this.criticalOverflowCount
  }

  getQueueMetrics() {
    return {
      telemetry: {
        pending: this.telemetrySize,
        dropped: this.telemetryDropped,
      },
      critical: {
        pending: this.criticalSize,
        overflow: this.criticalOverflow,
      },
    }
  }

  async shutdown() {
    // Flush critical events with bounded attempts to prevent infinite loop offline
    await this.flushCriticalOnly(50)
    
    // Flush telemetry (best-effort, no limit needed)
    await this.flushTelemetryOnly()
    
    // Only clear if all critical events are delivered
    if (this.criticalOutbox.size === 0) {
      await this.criticalOutbox.clearSession()
      console.log('[WorkoutQueue] Shutdown complete - all critical events delivered')
    } else {
      console.warn('[WorkoutQueue] Shutdown with pending critical events - keeping in outbox for recovery', {
        pendingCount: this.criticalOutbox.size,
      })
      // Clear memory only, keep storage for recovery
      await this.criticalOutbox.clear()
    }
  }
}

export { WorkoutAsyncQueue }
export const createWorkoutQueue = WorkoutAsyncQueue.create

export type { FrameDataPayload, CriticalPayload, WorkoutAsyncQueueOptions }
