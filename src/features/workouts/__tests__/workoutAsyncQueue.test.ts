import { WorkoutAsyncQueue, createWorkoutQueue } from '../services/workoutAsyncQueue'
import { PersistentOutbox } from '../services/persistentOutbox'
import { addShotEvent, saveFrameDataBatch, endWorkoutSession, saveCourtCalibration } from '../api/workouts.api'

// Mock dependencies
jest.mock('../services/persistentOutbox')
jest.mock('../api/workouts.api')

describe('WorkoutAsyncQueue', () => {
  let queue: WorkoutAsyncQueue
  const sessionId = 'test-session-123'
  const userId = 'user-456'

  beforeEach(() => {
    jest.clearAllMocks()
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  describe('create', () => {
    it('should initialize queue with global recovery', async () => {
      const mockOutbox = {
        loadAllPendingAndMerge: jest.fn().mockResolvedValue(undefined),
        loadPending: jest.fn().mockResolvedValue(undefined),
        size: 0,
        sessionId,
        userId,
      } as any

      ;(PersistentOutbox as jest.Mock).mockImplementation(() => mockOutbox)

      const createdQueue = await createWorkoutQueue({ sessionId, userId })

      expect(createdQueue).toBeInstanceOf(WorkoutAsyncQueue)
      expect(mockOutbox.loadAllPendingAndMerge).toHaveBeenCalled()
      expect(mockOutbox.loadPending).toHaveBeenCalled()
    })

    it('should load pending items from storage on initialization', async () => {
      const mockOutbox = {
        loadAllPendingAndMerge: jest.fn().mockResolvedValue(undefined),
        loadPending: jest.fn().mockResolvedValue(undefined),
        size: 1,
        sessionId,
        userId,
      } as any

      ;(PersistentOutbox as jest.Mock).mockImplementation(() => mockOutbox)

      const createdQueue = await createWorkoutQueue({ sessionId, userId })

      expect(mockOutbox.loadAllPendingAndMerge).toHaveBeenCalled()
      expect(createdQueue.criticalSize).toBe(1)
    })

    it('should recover items from previous sessions on app restart', async () => {
      const mockOutbox = {
        loadAllPendingAndMerge: jest.fn().mockImplementation(async () => {
          // Simulate merging items from previous sessions
          mockOutbox.size = 2
        }),
        loadPending: jest.fn().mockResolvedValue(undefined),
        size: 0,
        sessionId,
        userId,
      } as any

      ;(PersistentOutbox as jest.Mock).mockImplementation(() => mockOutbox)

      const createdQueue = await createWorkoutQueue({ sessionId, userId })

      expect(mockOutbox.loadAllPendingAndMerge).toHaveBeenCalled()
      expect(createdQueue.criticalSize).toBe(2)
    })
  })

  describe('enqueueTelemetry', () => {
    it('should enqueue telemetry items', async () => {
      const mockOutbox = {
        loadAllPendingAndMerge: jest.fn().mockResolvedValue([]),
        loadPending: jest.fn().mockResolvedValue(undefined),
        size: 0,
        sessionId,
        userId,
      } as any

      ;(PersistentOutbox as jest.Mock).mockImplementation(() => mockOutbox)
      queue = await createWorkoutQueue({ sessionId, userId })

      queue.enqueueTelemetry({
        frameTimestamp: 12345,
        ballX: 0.5,
        ballY: 0.5,
      })

      expect(queue.telemetrySize).toBe(1)
    })

    it('should reject telemetry if queue not initialized', async () => {
      const mockOutbox = {
        loadAllPendingAndMerge: jest.fn().mockResolvedValue([]),
        loadPending: jest.fn().mockResolvedValue(undefined),
        size: 0,
        sessionId,
        userId,
      } as any

      ;(PersistentOutbox as jest.Mock).mockImplementation(() => mockOutbox)
      queue = await createWorkoutQueue({ sessionId, userId })

      // Force uninitialized state
      queue['initialized'] = false

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation()
      queue.enqueueTelemetry({
        frameTimestamp: 12345,
        ballX: 0.5,
        ballY: 0.5,
      })

      expect(consoleSpy).toHaveBeenCalledWith(
        '[WorkoutQueue] Queue not initialized, cannot enqueue telemetry'
      )
      consoleSpy.mockRestore()
    })

    it('should drop oldest telemetry when queue is full', async () => {
      const mockOutbox = {
        loadAllPendingAndMerge: jest.fn().mockResolvedValue([]),
        loadPending: jest.fn().mockResolvedValue(undefined),
        size: 0,
        sessionId,
        userId,
      } as any

      ;(PersistentOutbox as jest.Mock).mockImplementation(() => mockOutbox)
      queue = await createWorkoutQueue({ sessionId, userId })

      // Add 150 items (queue max is 100)
      for (let i = 0; i < 150; i++) {
        queue.enqueueTelemetry({
          frameTimestamp: i,
          ballX: 0.5,
          ballY: 0.5,
        })
      }

      expect(queue.telemetrySize).toBe(100)
      expect(queue.telemetryDropped).toBeGreaterThan(0)
    })
  })

  describe('enqueueCritical', () => {
    it('should enqueue critical events', async () => {
      const mockOutbox = {
        loadAllPendingAndMerge: jest.fn().mockResolvedValue([]),
        loadPending: jest.fn().mockResolvedValue(undefined),
        add: jest.fn().mockResolvedValue(true),
        size: 0,
        sessionId,
        userId,
      } as any

      ;(PersistentOutbox as jest.Mock).mockImplementation(() => mockOutbox)
      queue = await createWorkoutQueue({ sessionId, userId })

      const result = await queue.enqueueCritical({
        type: 'SHOT',
        sessionId,
        userId,
        payload: { shotData: 'test' },
      })

      expect(result).toBe(true)
      expect(mockOutbox.add).toHaveBeenCalled()
    })

    it('should return false if persistence fails', async () => {
      const mockOutbox = {
        loadAllPendingAndMerge: jest.fn().mockResolvedValue([]),
        loadPending: jest.fn().mockResolvedValue(undefined),
        add: jest.fn().mockResolvedValue(false),
        size: 0,
        sessionId,
        userId,
      } as any

      ;(PersistentOutbox as jest.Mock).mockImplementation(() => mockOutbox)
      queue = await createWorkoutQueue({ sessionId, userId })

      const result = await queue.enqueueCritical({
        type: 'SHOT',
        sessionId,
        userId,
        payload: { shotData: 'test' },
      })

      expect(result).toBe(false)
    })

    it('should reject critical events if queue not initialized', async () => {
      const mockOutbox = {
        loadAllPendingAndMerge: jest.fn().mockResolvedValue([]),
        loadPending: jest.fn().mockResolvedValue(undefined),
        add: jest.fn().mockResolvedValue(true),
        size: 0,
        sessionId,
        userId,
      } as any

      ;(PersistentOutbox as jest.Mock).mockImplementation(() => mockOutbox)
      queue = await createWorkoutQueue({ sessionId, userId })

      // Force uninitialized state
      queue['initialized'] = false

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation()
      const result = await queue.enqueueCritical({
        type: 'SHOT',
        sessionId,
        userId,
        payload: { shotData: 'test' },
      })

      expect(result).toBe(false)
      expect(consoleSpy).toHaveBeenCalledWith(
        '[WorkoutQueue] Queue not initialized, cannot enqueue critical event'
      )
      consoleSpy.mockRestore()
    })
  })

  describe('flushCriticalOnly', () => {
    it('should process only critical events', async () => {
      const mockOutbox = {
        loadAllPendingAndMerge: jest.fn().mockResolvedValue([]),
        loadPending: jest.fn().mockResolvedValue(undefined),
        add: jest.fn().mockResolvedValue(true),
        size: 1,
        peek: jest.fn().mockReturnValue({
          id: 'test-1',
          type: 'SHOT',
          sessionId,
          userId,
          payload: { shotData: 'test' },
          retryCount: 0,
        }),
        remove: jest.fn().mockResolvedValue(undefined),
        updateRetryCount: jest.fn().mockResolvedValue(undefined),
        sessionId,
        userId,
      } as any

      ;(addShotEvent as jest.Mock).mockResolvedValue({ id: 'shot-1' })
      ;(PersistentOutbox as jest.Mock).mockImplementation(() => mockOutbox)
      queue = await createWorkoutQueue({ sessionId, userId })

      await queue.flushCriticalOnly()

      expect(addShotEvent).toHaveBeenCalled()
      expect(mockOutbox.remove).toHaveBeenCalled()
    })

    it('should stop after maxAttempts when backend is offline', async () => {
      const mockOutbox = {
        loadAllPendingAndMerge: jest.fn().mockResolvedValue([]),
        loadPending: jest.fn().mockResolvedValue(undefined),
        add: jest.fn().mockResolvedValue(true),
        size: 1,
        peek: jest.fn().mockReturnValue({
          id: 'test-1',
          type: 'SHOT',
          sessionId,
          userId,
          payload: { shotData: 'test' },
          retryCount: 0,
        }),
        remove: jest.fn().mockResolvedValue(undefined),
        updateRetryCount: jest.fn().mockResolvedValue(undefined),
        sessionId,
        userId,
      } as any

      ;(addShotEvent as jest.Mock).mockRejectedValue(new Error('Network error'))
      ;(PersistentOutbox as jest.Mock).mockImplementation(() => mockOutbox)
      queue = await createWorkoutQueue({ sessionId, userId })

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation()
      await queue.flushCriticalOnly(5) // Low maxAttempts for test

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('flushCriticalOnly stopped after 5 attempts')
      )
      expect(mockOutbox.remove).not.toHaveBeenCalled()
      consoleSpy.mockRestore()
    })

    it('should use default maxAttempts of 50', async () => {
      const mockOutbox = {
        loadAllPendingAndMerge: jest.fn().mockResolvedValue([]),
        loadPending: jest.fn().mockResolvedValue(undefined),
        add: jest.fn().mockResolvedValue(true),
        size: 1,
        peek: jest.fn().mockReturnValue({
          id: 'test-1',
          type: 'SHOT',
          sessionId,
          userId,
          payload: { shotData: 'test' },
          retryCount: 0,
        }),
        remove: jest.fn().mockResolvedValue(undefined),
        updateRetryCount: jest.fn().mockResolvedValue(undefined),
        sessionId,
        userId,
      } as any

      ;(addShotEvent as jest.Mock).mockRejectedValue(new Error('Network error'))
      ;(PersistentOutbox as jest.Mock).mockImplementation(() => mockOutbox)
      queue = await createWorkoutQueue({ sessionId, userId })

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation()
      await queue.flushCriticalOnly()

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('flushCriticalOnly stopped after 50 attempts')
      )
      consoleSpy.mockRestore()
    })
  })

  describe('flushTelemetryOnly', () => {
    it('should process only telemetry events', async () => {
      const mockOutbox = {
        loadAllPendingAndMerge: jest.fn().mockResolvedValue([]),
        loadPending: jest.fn().mockResolvedValue(undefined),
        size: 0,
        sessionId,
        userId,
      } as any

      ;(saveFrameDataBatch as jest.Mock).mockResolvedValue(undefined)
      ;(PersistentOutbox as jest.Mock).mockImplementation(() => mockOutbox)
      queue = await createWorkoutQueue({ sessionId, userId })

      queue.enqueueTelemetry({
        frameTimestamp: 12345,
        ballX: 0.5,
        ballY: 0.5,
      })

      await queue.flushTelemetryOnly()

      expect(saveFrameDataBatch).toHaveBeenCalled()
      expect(queue.telemetrySize).toBe(0)
    })
  })

  describe('shutdown', () => {
    it('should clear session if all critical events are delivered', async () => {
      const mockOutbox = {
        loadAllPendingAndMerge: jest.fn().mockResolvedValue([]),
        loadPending: jest.fn().mockResolvedValue(undefined),
        add: jest.fn().mockResolvedValue(true),
        size: 0,
        clearSession: jest.fn().mockResolvedValue(undefined),
        clear: jest.fn().mockResolvedValue(undefined),
        sessionId,
        userId,
      } as any

      ;(PersistentOutbox as jest.Mock).mockImplementation(() => mockOutbox)
      queue = await createWorkoutQueue({ sessionId, userId })

      await queue.shutdown()

      expect(mockOutbox.clearSession).toHaveBeenCalled()
      expect(mockOutbox.clear).not.toHaveBeenCalled()
    })

    it('should keep pending critical events in storage on shutdown', async () => {
      const mockOutbox = {
        loadAllPendingAndMerge: jest.fn().mockResolvedValue([]),
        loadPending: jest.fn().mockResolvedValue(undefined),
        add: jest.fn().mockResolvedValue(true),
        size: 5, // Pending items
        clearSession: jest.fn().mockResolvedValue(undefined),
        clear: jest.fn().mockResolvedValue(undefined),
        sessionId,
        userId,
      } as any

      ;(PersistentOutbox as jest.Mock).mockImplementation(() => mockOutbox)
      queue = await createWorkoutQueue({ sessionId, userId })

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation()
      await queue.shutdown()

      expect(mockOutbox.clearSession).not.toHaveBeenCalled()
      expect(mockOutbox.clear).toHaveBeenCalled() // Memory only
      expect(consoleSpy).toHaveBeenCalledWith(
        '[WorkoutQueue] Shutdown with pending critical events - keeping in outbox for recovery',
        { pendingCount: 5 }
      )
      consoleSpy.mockRestore()
    })
  })

  describe('retry behavior', () => {
    it('should update retry count on each attempt', async () => {
      const mockOutbox = {
        loadAllPendingAndMerge: jest.fn().mockResolvedValue([]),
        loadPending: jest.fn().mockResolvedValue(undefined),
        add: jest.fn().mockResolvedValue(true),
        size: 1,
        peek: jest.fn().mockReturnValue({
          id: 'test-1',
          type: 'SHOT',
          sessionId,
          userId,
          payload: { shotData: 'test' },
          retryCount: 0,
        }),
        remove: jest.fn().mockResolvedValue(undefined),
        updateRetryCount: jest.fn().mockResolvedValue(undefined),
        sessionId,
        userId,
      } as any

      ;(addShotEvent as jest.Mock)
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValue({ id: 'shot-1' })
      ;(PersistentOutbox as jest.Mock).mockImplementation(() => mockOutbox)
      queue = await createWorkoutQueue({ sessionId, userId })

      await queue.flushCriticalOnly()

      expect(mockOutbox.updateRetryCount).toHaveBeenCalled()
    })

    it('should keep item in outbox after retry exhaustion', async () => {
      const mockOutbox = {
        loadAllPendingAndMerge: jest.fn().mockResolvedValue([]),
        loadPending: jest.fn().mockResolvedValue(undefined),
        add: jest.fn().mockResolvedValue(true),
        size: 1,
        peek: jest.fn().mockReturnValue({
          id: 'test-1',
          type: 'SHOT',
          sessionId,
          userId,
          payload: { shotData: 'test' },
          retryCount: 0,
        }),
        remove: jest.fn().mockResolvedValue(undefined),
        updateRetryCount: jest.fn().mockResolvedValue(undefined),
        sessionId,
        userId,
      } as any

      ;(addShotEvent as jest.Mock).mockRejectedValue(new Error('Network error'))
      ;(PersistentOutbox as jest.Mock).mockImplementation(() => mockOutbox)
      queue = await createWorkoutQueue({ sessionId, userId })

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation()
      await queue.flushCriticalOnly()

      expect(mockOutbox.remove).not.toHaveBeenCalled()
      expect(consoleSpy).toHaveBeenCalledWith(
        '[WorkoutQueue] Critical item failed, keeping in outbox for retry',
        expect.objectContaining({ id: 'test-1' })
      )
      consoleSpy.mockRestore()
    })
  })

  describe('SESSION_END and CALIBRATION events', () => {
    it('should call real SESSION_END API', async () => {
      const mockOutbox = {
        loadAllPendingAndMerge: jest.fn().mockResolvedValue([]),
        loadPending: jest.fn().mockResolvedValue(undefined),
        add: jest.fn().mockResolvedValue(true),
        size: 1,
        peek: jest.fn().mockReturnValue({
          id: 'test-1',
          type: 'SESSION_END',
          sessionId,
          userId,
          payload: {},
          retryCount: 0,
        }),
        remove: jest.fn().mockResolvedValue(undefined),
        updateRetryCount: jest.fn().mockResolvedValue(undefined),
        sessionId,
        userId,
      } as any

      ;(endWorkoutSession as jest.Mock).mockResolvedValue({ id: sessionId })
      ;(PersistentOutbox as jest.Mock).mockImplementation(() => mockOutbox)
      queue = await createWorkoutQueue({ sessionId, userId })

      await queue.flushCriticalOnly()

      expect(endWorkoutSession).toHaveBeenCalledWith(sessionId, userId)
      expect(mockOutbox.remove).toHaveBeenCalled()
    })

    it('should call real CALIBRATION API', async () => {
      const mockOutbox = {
        loadAllPendingAndMerge: jest.fn().mockResolvedValue([]),
        loadPending: jest.fn().mockResolvedValue(undefined),
        add: jest.fn().mockResolvedValue(true),
        size: 1,
        peek: jest.fn().mockReturnValue({
          id: 'test-1',
          type: 'CALIBRATION',
          sessionId,
          userId,
          payload: { hoopCenter: { x: 0.5, y: 0.3 } },
          retryCount: 0,
        }),
        remove: jest.fn().mockResolvedValue(undefined),
        updateRetryCount: jest.fn().mockResolvedValue(undefined),
        sessionId,
        userId,
      } as any

      ;(saveCourtCalibration as jest.Mock).mockResolvedValue(undefined)
      ;(PersistentOutbox as jest.Mock).mockImplementation(() => mockOutbox)
      queue = await createWorkoutQueue({ sessionId, userId })

      await queue.flushCriticalOnly()

      expect(saveCourtCalibration).toHaveBeenCalledWith(
        sessionId,
        userId,
        { hoopCenter: { x: 0.5, y: 0.3 } }
      )
      expect(mockOutbox.remove).toHaveBeenCalled()
    })
  })

  describe('getQueueMetrics', () => {
    it('should return queue metrics', async () => {
      const mockOutbox = {
        loadAllPendingAndMerge: jest.fn().mockResolvedValue([]),
        loadPending: jest.fn().mockResolvedValue(undefined),
        add: jest.fn().mockResolvedValue(true),
        size: 5,
        sessionId,
        userId,
      } as any

      ;(PersistentOutbox as jest.Mock).mockImplementation(() => mockOutbox)
      queue = await createWorkoutQueue({ sessionId, userId })

      queue.enqueueTelemetry({ frameTimestamp: 12345, ballX: 0.5, ballY: 0.5 })

      const metrics = queue.getQueueMetrics()

      expect(metrics).toEqual({
        telemetry: {
          pending: 1,
          dropped: 0,
        },
        critical: {
          pending: 5,
          overflow: 0,
        },
      })
    })
  })
})
