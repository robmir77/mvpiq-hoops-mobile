import { saveFrameDataBatch, addShotEvent, addShotEventsBatch } from '../api/workouts.api'
import { PersistentOutbox } from './persistentOutbox'

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

interface FrameDataPayload {
  sessionId: string
  userId: string
  frameTimestamp: number
  ballX?: number
  ballY?: number
  ballWidth?: number
  ballHeight?: number
  ballConfidence?: number
  hoopX?: number
  hoopY?: number
  hoopConfidence?: number
  ballVelocityX?: number
  ballVelocityY?: number
  shotDetected?: boolean
  trajectoryData?: {
    points: any[]
  }
}

interface CriticalPayload {
  type: 'SHOT' | 'SESSION_START' | 'SESSION_END' | 'CALIBRATION'
  sessionId: string
  userId: string
  payload: any
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

  // Telemetry metrics
  private telemetryDroppedCount = 0
  private criticalOverflowCount = 0

  constructor(options: WorkoutAsyncQueueOptions) {
    this.criticalOutbox = new PersistentOutbox(options.sessionId, options.userId)
    // Load pending items from previous session
    this.criticalOutbox.loadPending().catch(e => {
      console.error('[WorkoutQueue] Failed to load pending critical items:', e)
    })
  }

  enqueueTelemetry(payload: Omit<FrameDataPayload, 'sessionId' | 'userId'>) {
    this.telemetry.push({
      payload: {
        ...payload,
        sessionId: this.criticalOutbox.sessionId,
        userId: this.criticalOutbox.userId,
      },
      timestamp: Date.now(),
    })

    this.ensureWorker()
  }

  async enqueueCritical(payload: CriticalPayload) {
    const success = await this.criticalOutbox.add({
      type: payload.type,
      sessionId: payload.sessionId,
      userId: payload.userId,
      payload: payload.payload,
    })

    if (!success) {
      this.criticalOverflowCount++
      console.error('[WorkoutQueue] CRITICAL OUTBOX OVERFLOW - data may be lost!', {
        type: payload.type,
        queueSize: this.criticalOutbox.size,
        overflowCount: this.criticalOverflowCount,
      })
    }

    this.ensureWorker()
  }

  private ensureWorker() {
    if (this.running) return

    this.running = true
    this.workerPromise = this.run()
  }

  private async run() {
    try {
      while (
        this.criticalOutbox.size > 0 ||
        this.telemetry.size > 0
      ) {
        await this.flush()
      }
    } finally {
      this.running = false
      this.workerPromise = null

      if (
        this.criticalOutbox.size > 0 ||
        this.telemetry.size > 0
      ) {
        this.ensureWorker()
      }
    }
  }

  private async flush(options: { critical: boolean; telemetry: boolean } = { critical: true, telemetry: true }) {
    // Update telemetry dropped count
    this.telemetryDroppedCount = this.telemetry.dropped

    // Process critical items from outbox
    if (options.critical && this.criticalOutbox.size > 0) {
      await this.processCriticalFromOutbox()
    }

    // Process telemetry items (frame data) in batch - best effort
    if (options.telemetry && this.telemetry.size > 0) {
      const telemetryItems = this.telemetry.drain(20)
      if (telemetryItems.length > 0) {
        await this.processTelemetryItems(telemetryItems)
      }
    }
  }

  private async processCriticalFromOutbox() {
    // Process up to 10 items at a time
    const processedCount = Math.min(10, this.criticalOutbox.size)
    
    for (let i = 0; i < processedCount; i++) {
      const item = this.criticalOutbox.peek()
      if (!item) break

      const success = await this.processCriticalItemWithRetry(item)
      if (success) {
        await this.criticalOutbox.remove(item.id)
      } else {
        // Item failed permanently, remove to avoid blocking queue
        console.error('[WorkoutQueue] Critical item failed permanently, removing from outbox:', item.id)
        await this.criticalOutbox.remove(item.id)
      }
    }
  }

  private async processCriticalItemWithRetry(item: any): Promise<boolean> {
    const { type, sessionId, userId, payload, retryCount } = item

    if (type === 'SHOT') {
      return await this.retryShotEvent(sessionId, userId, payload, retryCount)
    } else if (type === 'SESSION_START' || type === 'SESSION_END' || type === 'CALIBRATION') {
      return await this.retryCriticalEvent(type, sessionId, userId, payload, retryCount)
    }
    return true
  }

  private async retryShotEvent(sessionId: string, userId: string, payload: any, retryCount: number): Promise<boolean> {
    const maxRetries = 5
    const baseDelay = 1000 // 1 second

    for (let attempt = retryCount; attempt < maxRetries; attempt++) {
      try {
        await addShotEvent(sessionId, userId, payload)
        return true
      } catch (e) {
        const delay = baseDelay * Math.pow(2, attempt)
        console.error(`[WorkoutQueue] Shot event failed (attempt ${attempt + 1}/${maxRetries}):`, e)

        if (attempt < maxRetries - 1) {
          await new Promise(resolve => setTimeout(resolve, delay))
        }
      }
    }

    console.error('[WorkoutQueue] Shot event permanently failed after retries:', { sessionId, payload })
    return false
  }

  private async retryCriticalEvent(type: string, sessionId: string, userId: string, payload: any, retryCount: number): Promise<boolean> {
    const maxRetries = 5
    const baseDelay = 1000

    for (let attempt = retryCount; attempt < maxRetries; attempt++) {
      try {
        // For now, session events don't have a dedicated API - they're handled by session management
        // This is a placeholder for future critical event APIs
        console.log(`[WorkoutQueue] Critical event processed: ${type}`)
        return true
      } catch (e) {
        const delay = baseDelay * Math.pow(2, attempt)
        console.error(`[WorkoutQueue] Critical event failed (attempt ${attempt + 1}/${maxRetries}):`, { type, e })

        if (attempt < maxRetries - 1) {
          await new Promise(resolve => setTimeout(resolve, delay))
        }
      }
    }

    console.error('[WorkoutQueue] Critical event permanently failed after retries:', { type, sessionId })
    return false
  }

  private async processTelemetryItems(items: AsyncQueueItem<FrameDataPayload>[]) {
    const frames = items.map(item => item.payload)
    try {
      await saveFrameDataBatch(frames[0].sessionId, frames[0].userId, frames)
    } catch (e) {
      console.error('[WorkoutQueue] Failed to save frame batch (best-effort, data lost):', e)
      // Telemetry is best-effort - we accept data loss here
    }
  }

  async flushCriticalOnly() {
    while (this.criticalOutbox.size > 0) {
      await this.flush({ critical: true, telemetry: false })
    }
  }

  async flushTelemetryOnly() {
    while (this.telemetry.size > 0) {
      await this.flush({ critical: false, telemetry: true })
    }
  }

  async flushAll() {
    while (this.criticalOutbox.size > 0 || this.telemetry.size > 0) {
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
    // Flush all pending items
    await this.flushAll()
    // Clear outbox
    await this.criticalOutbox.clear()
  }
}

export const createWorkoutQueue = (options: WorkoutAsyncQueueOptions): WorkoutAsyncQueue => {
  return new WorkoutAsyncQueue(options)
}

export type { FrameDataPayload, CriticalPayload, WorkoutAsyncQueueOptions }
