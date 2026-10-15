import AsyncStorage from '@react-native-async-storage/async-storage'

interface OutboxItem {
  id: string
  type: 'SHOT' | 'SESSION_START' | 'SESSION_END' | 'CALIBRATION'
  sessionId: string
  userId: string
  payload: any
  timestamp: number
  retryCount: number
  suspended?: boolean // If true, item is suspended from automatic retries (e.g., 401 auth error)
}

const OUTBOX_KEY_PREFIX = 'workout_outbox_'

class PersistentOutbox {
  private _sessionId: string
  private _userId: string
  private memoryQueue: OutboxItem[] = []

  constructor(sessionId: string, userId: string) {
    this._sessionId = sessionId
    this._userId = userId
  }

  /**
   * Load pending items from current session only
   */
  async loadPending(): Promise<void> {
    try {
      const keys = await AsyncStorage.getAllKeys()
      const sessionKeys = keys.filter(k => k.startsWith(`${OUTBOX_KEY_PREFIX}${this._sessionId}_`))

      if (sessionKeys.length === 0) return

      const items = await AsyncStorage.multiGet(sessionKeys)
      const loadedItems = items
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

      // Deduplicate by id to avoid duplicates when called after loadAllPendingAndMerge
      const existingIds = new Set(this.memoryQueue.map(item => item.id))
      const newItems = loadedItems.filter(item => !existingIds.has(item.id))

      this.memoryQueue = [...this.memoryQueue, ...newItems]
      console.log(`[PersistentOutbox] Loaded ${newItems.length} pending items for session ${this._sessionId} (${loadedItems.length - newItems.length} duplicates skipped)`)
    } catch (e) {
      console.error('[PersistentOutbox] Failed to load pending items:', e)
    }
  }

  /**
   * Load ALL pending items from ALL previous sessions (global recovery)
   * and merge them into the memory queue
   */
  async loadAllPendingAndMerge(): Promise<void> {
    try {
      const keys = await AsyncStorage.getAllKeys()
      const allOutboxKeys = keys.filter(k => k.startsWith(OUTBOX_KEY_PREFIX))

      if (allOutboxKeys.length === 0) return

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

      // Deduplicate by id to avoid duplicates when called multiple times
      const existingIds = new Set(this.memoryQueue.map(item => item.id))
      const newItems = allItems.filter(item => !existingIds.has(item.id))

      // Merge with existing memory queue
      this.memoryQueue = [...this.memoryQueue, ...newItems]
      console.log(`[PersistentOutbox] Loaded and merged ${newItems.length} pending items from ALL sessions (${allItems.length - newItems.length} duplicates skipped)`)
    } catch (e) {
      console.error('[PersistentOutbox] Failed to load all pending items:', e)
    }
  }

  /**
   * Add item to outbox (persist to AsyncStorage)
   * No size limit - critical events must not be dropped
   * For SHOT events, uses shotId from payload for deduplication
   */
  async add(item: Omit<OutboxItem, 'id' | 'timestamp' | 'retryCount'>): Promise<boolean> {
    // For SHOT events, extract shotId for deduplication
    const shotId = item.type === 'SHOT' && item.payload?.shotId ? item.payload.shotId : null

    // Check for duplicate shotId to prevent duplicate shots on retry
    if (shotId) {
      const existingShot = this.memoryQueue.find(
        i => i.type === 'SHOT' && i.payload?.shotId === shotId
      )
      if (existingShot) {
        console.log(`[PersistentOutbox] Duplicate shotId ${shotId} detected, skipping add`)
        return false
      }
    }

    const outboxItem: OutboxItem = {
      ...item,
      id: shotId ? `${item.sessionId}_shot_${shotId}` : `${item.sessionId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
      retryCount: 0,
    }

    this.memoryQueue.push(outboxItem)

    try {
      const key = `${OUTBOX_KEY_PREFIX}${outboxItem.id}`
      await AsyncStorage.setItem(key, JSON.stringify(outboxItem))
      return true
    } catch (e) {
      console.error('[PersistentOutbox] Failed to persist item:', e)
      // Remove from memory if persistence failed
      this.memoryQueue.pop()
      return false
    }
  }

  /**
   * Get next item to process (without removing)
   */
  peek(): OutboxItem | null {
    return this.memoryQueue[0] || null
  }

  /**
   * Remove item after successful processing
   */
  async remove(id: string): Promise<void> {
    const index = this.memoryQueue.findIndex(item => item.id === id)
    if (index === -1) return

    this.memoryQueue.splice(index, 1)

    try {
      const key = `${OUTBOX_KEY_PREFIX}${id}`
      await AsyncStorage.removeItem(key)
    } catch (e) {
      console.error('[PersistentOutbox] Failed to remove item from storage:', e)
    }
  }

  /**
   * Update retry count for an item
   */
  async updateRetryCount(id: string, retryCount: number): Promise<void> {
    const item = this.memoryQueue.find(i => i.id === id)
    if (!item) return

    item.retryCount = retryCount

    try {
      const key = `${OUTBOX_KEY_PREFIX}${id}`
      await AsyncStorage.setItem(key, JSON.stringify(item))
    } catch (e) {
      console.error('[PersistentOutbox] Failed to update retry count:', e)
    }
  }

  /**
   * Set suspended state for an item (e.g., after 401 auth error)
   */
  async setSuspended(id: string, suspended: boolean): Promise<void> {
    const item = this.memoryQueue.find(i => i.id === id)
    if (!item) return

    item.suspended = suspended

    try {
      const key = `${OUTBOX_KEY_PREFIX}${id}`
      await AsyncStorage.setItem(key, JSON.stringify(item))
      console.log(`[PersistentOutbox] Item ${id} suspended state set to ${suspended}`)
    } catch (e) {
      console.error('[PersistentOutbox] Failed to update suspended state:', e)
    }
  }

  /**
   * Check if an item is suspended
   */
  isSuspended(id: string): boolean {
    const item = this.memoryQueue.find(i => i.id === id)
    return item?.suspended === true
  }

  /**
   * Get count of suspended items
   */
  getSuspendedCount(): number {
    return this.memoryQueue.filter(item => item.suspended === true).length
  }

  /**
   * Get count of non-suspended items (eligible for retry)
   */
  getRetryableCount(): number {
    return this.memoryQueue.filter(item => item.suspended !== true).length
  }

  /**
   * Get queue size
   */
  get size(): number {
    return this.memoryQueue.length
  }

  /**
   * Clear all items for this session from memory only
   * Storage items are only removed when explicitly deleted by ID
   */
  async clear(): Promise<void> {
    this.memoryQueue = []
    console.log(`[PersistentOutbox] Cleared memory queue for session ${this._sessionId}`)
  }

  /**
   * Clear all items for this session from both memory and storage
   * This should only be called when all items are confirmed delivered
   */
  async clearSession(): Promise<void> {
    try {
      const keys = await AsyncStorage.getAllKeys()
      const sessionKeys = keys.filter(k => k.startsWith(`${OUTBOX_KEY_PREFIX}${this._sessionId}_`))
      
      if (sessionKeys.length > 0) {
        await AsyncStorage.multiRemove(sessionKeys)
      }

      this.memoryQueue = []
      console.log(`[PersistentOutbox] Cleared ${sessionKeys.length} items for session ${this._sessionId}`)
    } catch (e) {
      console.error('[PersistentOutbox] Failed to clear session items:', e)
    }
  }

  /**
   * Get all items (for debugging/metrics)
   */
  getAll(): OutboxItem[] {
    return [...this.memoryQueue]
  }

  /**
   * Get session ID
   */
  get sessionId(): string {
    return this._sessionId
  }

  /**
   * Get user ID
   */
  get userId(): string {
    return this._userId
  }
}

export { PersistentOutbox, OutboxItem }
