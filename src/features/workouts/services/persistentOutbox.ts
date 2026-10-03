import AsyncStorage from '@react-native-async-storage/async-storage'

interface OutboxItem {
  id: string
  type: 'SHOT' | 'SESSION_START' | 'SESSION_END' | 'CALIBRATION'
  sessionId: string
  userId: string
  payload: any
  timestamp: number
  retryCount: number
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

      this.memoryQueue = [...this.memoryQueue, ...loadedItems]
      console.log(`[PersistentOutbox] Loaded ${loadedItems.length} pending items for session ${this._sessionId}`)
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

      // Merge with existing memory queue
      this.memoryQueue = [...this.memoryQueue, ...allItems]
      console.log(`[PersistentOutbox] Loaded and merged ${allItems.length} pending items from ALL sessions`)
    } catch (e) {
      console.error('[PersistentOutbox] Failed to load all pending items:', e)
    }
  }

  /**
   * Add item to outbox (persist to AsyncStorage)
   * No size limit - critical events must not be dropped
   */
  async add(item: Omit<OutboxItem, 'id' | 'timestamp' | 'retryCount'>): Promise<boolean> {
    const outboxItem: OutboxItem = {
      ...item,
      id: `${item.sessionId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
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
