import { saveFrameDataBatch, addShotEvent, addShotEventsBatch } from '../api/workouts.api'

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

class WorkoutAsyncQueue {
  private telemetry = new BoundedQueue<AsyncQueueItem<FrameDataPayload>>(100, 'drop-oldest')
  private critical = new BoundedQueue<AsyncQueueItem<CriticalPayload>>(1000, 'reject')
  private sessionId: string | null = null
  private userId: string | null = null

  private running = false
  private workerPromise: Promise<void> | null = null

  // Telemetry metrics
  private telemetryDroppedCount = 0
  private criticalOverflowCount = 0

  setSession(sessionId: string, userId: string) {
    this.sessionId = sessionId
    this.userId = userId
  }

  clearSession() {
    this.sessionId = null
    this.userId = null
    this.telemetryDroppedCount = 0
    this.criticalOverflowCount = 0
  }

  enqueueTelemetry(payload: Omit<FrameDataPayload, 'sessionId' | 'userId'>) {
    if (!this.sessionId || !this.userId) {
      console.error('[WorkoutQueue] Cannot enqueue telemetry: no session set')
      return
    }

    this.telemetry.push({
      payload: {
        ...payload,
        sessionId: this.sessionId,
        userId: this.userId,
      },
      timestamp: Date.now(),
    })

    this.ensureWorker()
  }

  enqueueCritical(payload: CriticalPayload) {
    const success = this.critical.push({
      payload,
      timestamp: Date.now(),
      retryCount: 0,
    })

    if (!success) {
      this.criticalOverflowCount++
      console.error('[WorkoutQueue] CRITICAL QUEUE OVERFLOW - data may be lost!', {
        type: payload.type,
        queueSize: this.critical.size,
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
        this.critical.size > 0 ||
        this.telemetry.size > 0
      ) {
        await this.flush()
      }
    } finally {
      this.running = false
      this.workerPromise = null

      if (
        this.critical.size > 0 ||
        this.telemetry.size > 0
      ) {
        this.ensureWorker()
      }
    }
  }

  private async flush() {
    // Update telemetry dropped count
    this.telemetryDroppedCount = this.telemetry.dropped

    // Process critical first, then telemetry
    const criticalItems = this.critical.drain(10)
    const telemetryItems = this.telemetry.drain(20)

    // Process critical items (shots, session events) with retry
    await this.processCriticalItems(criticalItems)

    // Process telemetry items (frame data) in batch - best effort
    if (telemetryItems.length > 0) {
      await this.processTelemetryItems(telemetryItems)
    }
  }

  private async processCriticalItems(items: AsyncQueueItem<CriticalPayload>[]) {
    // Group shots for batch processing
    const shotItems: Array<{ sessionId: string; userId: string; payload: any }> = []
    const otherItems: AsyncQueueItem<CriticalPayload>[] = []

    for (const item of items) {
      const { type, sessionId, userId, payload } = item.payload
      if (type === 'SHOT') {
        shotItems.push({ sessionId, userId, payload })
      } else {
        otherItems.push(item)
      }
    }

    // Process shots in batch if available
    if (shotItems.length > 0) {
      await this.processShotBatch(shotItems)
    }

    // Process other critical events individually with retry
    for (const item of otherItems) {
      await this.processCriticalItemWithRetry(item)
    }
  }

  private async processShotBatch(shots: Array<{ sessionId: string; userId: string; payload: any }>) {
    try {
      // Try batch API first
      await addShotEventsBatch(shots[0].sessionId, shots[0].userId, shots.map(s => s.payload))
    } catch (batchError) {
      console.warn('[WorkoutQueue] Batch shot API failed, falling back to individual:', batchError)
      // Fallback to individual requests with retry
      for (const shot of shots) {
        await this.retryShotEvent(shot.sessionId, shot.userId, shot.payload, 0)
      }
    }
  }

  private async processCriticalItemWithRetry(item: AsyncQueueItem<CriticalPayload>) {
    const { type, sessionId, userId, payload } = item.payload
    const retryCount = item.retryCount || 0

    if (type === 'SESSION_START' || type === 'SESSION_END' || type === 'CALIBRATION') {
      await this.retryCriticalEvent(type, sessionId, userId, payload, retryCount)
    }
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

  async flushCritical() {
    while (this.critical.size > 0) {
      await this.flush()
    }
  }

  async flushTelemetry() {
    while (this.telemetry.size > 0) {
      await this.flush()
    }
  }

  get telemetrySize() {
    return this.telemetry.size
  }

  get criticalSize() {
    return this.critical.size
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
}

// Singleton instance
let queueInstance: WorkoutAsyncQueue | null = null

export const getWorkoutQueue = (): WorkoutAsyncQueue => {
  if (!queueInstance) {
    queueInstance = new WorkoutAsyncQueue()
  }
  return queueInstance
}

export type { FrameDataPayload, CriticalPayload }
