import AsyncStorage from '@react-native-async-storage/async-storage'
import { PersistentOutbox, OutboxItem } from '../services/persistentOutbox'

// Mock AsyncStorage
jest.mock('@react-native-async-storage/async-storage')

describe('PersistentOutbox', () => {
  let outbox: PersistentOutbox
  const sessionId = 'test-session-123'
  const userId = 'user-456'

  beforeEach(() => {
    jest.clearAllMocks()
    outbox = new PersistentOutbox(sessionId, userId)
  })

  describe('add', () => {
    it('should add item to outbox and persist to storage', async () => {
      const mockItem = {
        type: 'SHOT' as const,
        sessionId,
        userId,
        payload: { shotData: 'test' },
      }

      ;(AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined)

      const result = await outbox.add(mockItem)

      expect(result).toBe(true)
      expect(AsyncStorage.setItem).toHaveBeenCalled()
      expect(outbox.size).toBe(1)
    })

    it('should handle storage persistence failure', async () => {
      const mockItem = {
        type: 'SHOT' as const,
        sessionId,
        userId,
        payload: { shotData: 'test' },
      }

      ;(AsyncStorage.setItem as jest.Mock).mockRejectedValue(new Error('Storage error'))

      const result = await outbox.add(mockItem)

      expect(result).toBe(false)
      expect(outbox.size).toBe(0) // Should not be in memory if persistence failed
    })

    it('should not reject items due to size limit (no limit for critical events)', async () => {
      ;(AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined)

      // Add 200 items (more than old MAX_OUTBOX_SIZE of 100)
      for (let i = 0; i < 200; i++) {
        await outbox.add({
          type: 'SHOT',
          sessionId,
          userId,
          payload: { shotIndex: i },
        })
      }

      expect(outbox.size).toBe(200)
    })
  })

  describe('loadPending', () => {
    it('should load pending items from current session', async () => {
      const mockItems: OutboxItem[] = [
        {
          id: `${sessionId}_1`,
          type: 'SHOT',
          sessionId,
          userId,
          payload: { shotData: 'test1' },
          timestamp: 1000,
          retryCount: 0,
        },
        {
          id: `${sessionId}_2`,
          type: 'SESSION_END',
          sessionId,
          userId,
          payload: {},
          timestamp: 2000,
          retryCount: 0,
        },
      ]

      ;(AsyncStorage.getAllKeys as jest.Mock).mockResolvedValue([
        'workout_outbox_' + sessionId + '_1',
        'workout_outbox_' + sessionId + '_2',
      ])
      ;(AsyncStorage.multiGet as jest.Mock).mockResolvedValue([
        ['workout_outbox_' + sessionId + '_1', JSON.stringify(mockItems[0])],
        ['workout_outbox_' + sessionId + '_2', JSON.stringify(mockItems[1])],
      ])

      await outbox.loadPending()

      expect(outbox.size).toBe(2)
    })

    it('should merge loaded items with existing memory queue', async () => {
      // Add item to memory first
      outbox['memoryQueue'].push({
        id: `${sessionId}_0`,
        type: 'SHOT',
        sessionId,
        userId,
        payload: { shotData: 'existing' },
        timestamp: 500,
        retryCount: 0,
      })

      const mockItem: OutboxItem = {
        id: `${sessionId}_1`,
        type: 'SHOT',
        sessionId,
        userId,
        payload: { shotData: 'loaded' },
        timestamp: 1000,
        retryCount: 0,
      }

      ;(AsyncStorage.getAllKeys as jest.Mock).mockResolvedValue([
        'workout_outbox_' + sessionId + '_1',
      ])
      ;(AsyncStorage.multiGet as jest.Mock).mockResolvedValue([
        ['workout_outbox_' + sessionId + '_1', JSON.stringify(mockItem)],
      ])

      await outbox.loadPending()

      expect(outbox.size).toBe(2)
    })

    it('should handle corrupted storage data gracefully', async () => {
      ;(AsyncStorage.getAllKeys as jest.Mock).mockResolvedValue([
        'workout_outbox_' + sessionId + '_1',
        'workout_outbox_' + sessionId + '_2',
      ])
      ;(AsyncStorage.multiGet as jest.Mock).mockResolvedValue([
        ['workout_outbox_' + sessionId + '_1', 'invalid json'],
        ['workout_outbox_' + sessionId + '_2', null],
      ])

      await outbox.loadPending()

      expect(outbox.size).toBe(0)
    })

    it('should sort items by timestamp', async () => {
      const mockItems: OutboxItem[] = [
        {
          id: `${sessionId}_2`,
          type: 'SHOT',
          sessionId,
          userId,
          payload: { shotData: 'test2' },
          timestamp: 2000,
          retryCount: 0,
        },
        {
          id: `${sessionId}_1`,
          type: 'SHOT',
          sessionId,
          userId,
          payload: { shotData: 'test1' },
          timestamp: 1000,
          retryCount: 0,
        },
      ]

      ;(AsyncStorage.getAllKeys as jest.Mock).mockResolvedValue([
        'workout_outbox_' + sessionId + '_2',
        'workout_outbox_' + sessionId + '_1',
      ])
      ;(AsyncStorage.multiGet as jest.Mock).mockResolvedValue([
        ['workout_outbox_' + sessionId + '_2', JSON.stringify(mockItems[0])],
        ['workout_outbox_' + sessionId + '_1', JSON.stringify(mockItems[1])],
      ])

      await outbox.loadPending()

      const allItems = outbox.getAll()
      expect(allItems[0].id).toBe(`${sessionId}_1`)
      expect(allItems[1].id).toBe(`${sessionId}_2`)
    })
  })

  describe('loadAllPending', () => {
    it('should load items from ALL previous sessions (global recovery)', async () => {
      const mockItems: OutboxItem[] = [
        {
          id: 'old-session-1_1',
          type: 'SHOT',
          sessionId: 'old-session-1',
          userId,
          payload: { shotData: 'old1' },
          timestamp: 1000,
          retryCount: 0,
        },
        {
          id: 'old-session-2_1',
          type: 'SESSION_END',
          sessionId: 'old-session-2',
          userId,
          payload: {},
          timestamp: 2000,
          retryCount: 0,
        },
      ]

      ;(AsyncStorage.getAllKeys as jest.Mock).mockResolvedValue([
        'workout_outbox_old-session-1_1',
        'workout_outbox_old-session-2_1',
      ])
      ;(AsyncStorage.multiGet as jest.Mock).mockResolvedValue([
        ['workout_outbox_old-session-1_1', JSON.stringify(mockItems[0])],
        ['workout_outbox_old-session-2_1', JSON.stringify(mockItems[1])],
      ])

      const loadedItems = await outbox.loadAllPending()

      expect(loadedItems).toHaveLength(2)
      expect(loadedItems[0].sessionId).toBe('old-session-1')
      expect(loadedItems[1].sessionId).toBe('old-session-2')
    })

    it('should return empty array when no items exist', async () => {
      ;(AsyncStorage.getAllKeys as jest.Mock).mockResolvedValue([])

      const loadedItems = await outbox.loadAllPending()

      expect(loadedItems).toEqual([])
    })
  })

  describe('peek', () => {
    it('should return first item without removing', async () => {
      const mockItem = {
        type: 'SHOT' as const,
        sessionId,
        userId,
        payload: { shotData: 'test' },
      }

      ;(AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined)
      await outbox.add(mockItem)

      const peeked = outbox.peek()

      expect(peeked).not.toBeNull()
      expect(peeked?.type).toBe('SHOT')
      expect(outbox.size).toBe(1) // Still in queue
    })

    it('should return null when queue is empty', () => {
      const peeked = outbox.peek()
      expect(peeked).toBeNull()
    })
  })

  describe('remove', () => {
    it('should remove item from memory and storage', async () => {
      const mockItem = {
        type: 'SHOT' as const,
        sessionId,
        userId,
        payload: { shotData: 'test' },
      }

      ;(AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined)
      await outbox.add(mockItem)

      const item = outbox.peek()
      expect(item).not.toBeNull()

      ;(AsyncStorage.removeItem as jest.Mock).mockResolvedValue(undefined)
      await outbox.remove(item!.id)

      expect(outbox.size).toBe(0)
      expect(AsyncStorage.removeItem).toHaveBeenCalled()
    })

    it('should handle storage removal failure gracefully', async () => {
      const mockItem = {
        type: 'SHOT' as const,
        sessionId,
        userId,
        payload: { shotData: 'test' },
      }

      ;(AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined)
      await outbox.add(mockItem)

      const item = outbox.peek()
      ;(AsyncStorage.removeItem as jest.Mock).mockRejectedValue(new Error('Storage error'))

      await outbox.remove(item!.id)

      expect(outbox.size).toBe(0) // Still removed from memory
    })
  })

  describe('updateRetryCount', () => {
    it('should update retry count and persist to storage', async () => {
      const mockItem = {
        type: 'SHOT' as const,
        sessionId,
        userId,
        payload: { shotData: 'test' },
      }

      ;(AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined)
      await outbox.add(mockItem)

      const item = outbox.peek()
      ;(AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined)
      await outbox.updateRetryCount(item!.id, 3)

      const updatedItem = outbox.peek()
      expect(updatedItem?.retryCount).toBe(3)
      expect(AsyncStorage.setItem).toHaveBeenCalledTimes(2) // Once for add, once for update
    })

    it('should handle update failure gracefully', async () => {
      const mockItem = {
        type: 'SHOT' as const,
        sessionId,
        userId,
        payload: { shotData: 'test' },
      }

      ;(AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined)
      await outbox.add(mockItem)

      const item = outbox.peek()
      ;(AsyncStorage.setItem as jest.Mock).mockRejectedValue(new Error('Storage error'))

      await outbox.updateRetryCount(item!.id, 3)

      // Memory should still be updated even if storage fails
      const updatedItem = outbox.peek()
      expect(updatedItem?.retryCount).toBe(3)
    })
  })

  describe('clear', () => {
    it('should clear memory queue only', async () => {
      const mockItem = {
        type: 'SHOT' as const,
        sessionId,
        userId,
        payload: { shotData: 'test' },
      }

      ;(AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined)
      await outbox.add(mockItem)

      await outbox.clear()

      expect(outbox.size).toBe(0)
      expect(AsyncStorage.multiRemove).not.toHaveBeenCalled() // Storage not cleared
    })
  })

  describe('clearSession', () => {
    it('should clear both memory and storage', async () => {
      const mockItem = {
        type: 'SHOT' as const,
        sessionId,
        userId,
        payload: { shotData: 'test' },
      }

      ;(AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined)
      await outbox.add(mockItem)

      ;(AsyncStorage.getAllKeys as jest.Mock).mockResolvedValue([
        'workout_outbox_' + sessionId + '_1',
      ])
      ;(AsyncStorage.multiRemove as jest.Mock).mockResolvedValue(undefined)

      await outbox.clearSession()

      expect(outbox.size).toBe(0)
      expect(AsyncStorage.multiRemove).toHaveBeenCalled()
    })
  })

  describe('getAll', () => {
    it('should return copy of memory queue', async () => {
      const mockItem = {
        type: 'SHOT' as const,
        sessionId,
        userId,
        payload: { shotData: 'test' },
      }

      ;(AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined)
      await outbox.add(mockItem)

      const allItems = outbox.getAll()
      const allItems2 = outbox.getAll()

      expect(allItems).not.toBe(allItems2) // Different references
      expect(allItems).toEqual(allItems2) // Same content
    })
  })

  describe('sessionId and userId getters', () => {
    it('should return correct sessionId', () => {
      expect(outbox.sessionId).toBe(sessionId)
    })

    it('should return correct userId', () => {
      expect(outbox.userId).toBe(userId)
    })
  })
})
