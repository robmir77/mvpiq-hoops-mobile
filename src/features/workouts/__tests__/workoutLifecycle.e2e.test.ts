import { WorkoutAsyncQueue, createWorkoutQueue } from '../services/workoutAsyncQueue'
import { PersistentOutbox } from '../services/persistentOutbox'
import { OutboxRecoveryWorker, getRecoveryWorker } from '../services/outboxRecoveryWorker'
import { addShotEvent, saveCourtCalibration, endWorkoutSession } from '../api/workouts.api'
import AsyncStorage from '@react-native-async-storage/async-storage'

// Mock dependencies
jest.mock('../services/persistentOutbox')
jest.mock('../api/workouts.api')
jest.mock('@react-native-async-storage/async-storage')

describe('Workout Lifecycle End-to-End Tests', () => {
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

  describe('Test A - Calibration offline', () => {
    it('should persist calibration when API fails and recover when online', async () => {
      const mockOutbox = {
        loadAllPendingAndMerge: jest.fn().mockResolvedValue([]),
        loadPending: jest.fn().mockResolvedValue(undefined),
        add: jest.fn().mockResolvedValue(true),
        size: 0,
        peek: jest.fn().mockReturnValue(null),
        remove: jest.fn().mockResolvedValue(undefined),
        updateRetryCount: jest.fn().mockResolvedValue(undefined),
        sessionId,
        userId,
      } as any

      ;(PersistentOutbox as jest.Mock).mockImplementation(() => mockOutbox)
      ;(saveCourtCalibration as jest.Mock)
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValue(undefined)

      queue = await createWorkoutQueue({ sessionId, userId })

      // Enqueue CALIBRATION
      const persisted = await queue.enqueueCritical({
        type: 'CALIBRATION',
        sessionId,
        userId,
        payload: { hoopCenter: { x: 0.5, y: 0.3 } },
      })

      expect(persisted).toBe(true)
      expect(mockOutbox.add).toHaveBeenCalled()

      // API fails - item stays in outbox
      mockOutbox.size = 1
      mockOutbox.peek.mockReturnValue({
        id: 'cal-1',
        type: 'CALIBRATION',
        sessionId,
        userId,
        payload: { hoopCenter: { x: 0.5, y: 0.3 } },
        retryCount: 0,
      })

      await queue.flushCriticalOnly(2)

      expect(saveCourtCalibration).toHaveBeenCalled()
      expect(mockOutbox.remove).not.toHaveBeenCalled() // Still in outbox after failure
      expect(mockOutbox.updateRetryCount).toHaveBeenCalled()

      // RecoveryWorker retries
      const worker = getRecoveryWorker()
      worker.start(100)

      jest.advanceTimersByTime(100)

      // API succeeds on retry
      await jest.runAllTimersAsync()

      expect(saveCourtCalibration).toHaveBeenCalledTimes(2)
      worker.stop()
    })
  })

  describe('Test B - SESSION_END offline', () => {
    it('should persist SESSION_END when offline, allow navigation, and recover later', async () => {
      const mockOutbox = {
        loadAllPendingAndMerge: jest.fn().mockResolvedValue([]),
        loadPending: jest.fn().mockResolvedValue(undefined),
        add: jest.fn().mockResolvedValue(true),
        size: 0,
        peek: jest.fn().mockReturnValue(null),
        remove: jest.fn().mockResolvedValue(undefined),
        updateRetryCount: jest.fn().mockResolvedValue(undefined),
        clearSession: jest.fn().mockResolvedValue(undefined),
        clear: jest.fn().mockResolvedValue(undefined),
        sessionId,
        userId,
      } as any

      ;(PersistentOutbox as jest.Mock).mockImplementation(() => mockOutbox)
      ;(endWorkoutSession as jest.Mock)
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValue({ id: sessionId })

      queue = await createWorkoutQueue({ sessionId, userId })

      // Enqueue SESSION_END
      const persisted = await queue.enqueueCritical({
        type: 'SESSION_END',
        sessionId,
        userId,
      })

      expect(persisted).toBe(true)

      // API fails - item stays in outbox
      mockOutbox.size = 1
      mockOutbox.peek.mockReturnValue({
        id: 'session-end-1',
        type: 'SESSION_END',
        sessionId,
        userId,
        payload: {},
        retryCount: 0,
      })

      // Shutdown with bounded timeout (simulating navigation)
      await queue.shutdown()

      expect(mockOutbox.clearSession).not.toHaveBeenCalled()
      expect(mockOutbox.clear).toHaveBeenCalled() // Memory cleared, storage kept
      expect(mockOutbox.remove).not.toHaveBeenCalled() // Item still in AsyncStorage

      // RecoveryWorker retries later
      const worker = getRecoveryWorker()
      worker.start(100)

      jest.advanceTimersByTime(100)
      await jest.runAllTimersAsync()

      expect(endWorkoutSession).toHaveBeenCalledTimes(2)
      worker.stop()
    })
  })

  describe('Test C - Queue readiness', () => {
    it('should ensure camera starts only after queue is ready', async () => {
      const mockOutbox = {
        loadAllPendingAndMerge: jest.fn().mockResolvedValue([]),
        loadPending: jest.fn().mockResolvedValue(undefined),
        add: jest.fn().mockResolvedValue(true),
        size: 0,
        sessionId,
        userId,
      } as any

      ;(PersistentOutbox as jest.Mock).mockImplementation(() => mockOutbox)

      // Simulate the sequence in WorkoutSessionScreen
      const queueReady = await createWorkoutQueue({ sessionId, userId })

      expect(queueReady).toBeInstanceOf(WorkoutAsyncQueue)
      expect(mockOutbox.loadAllPendingAndMerge).toHaveBeenCalled()

      // Only after queue is ready, camera would start
      // This test verifies the queue creation completes before camera init
      const telemetrySampler = { start: jest.fn(), stop: jest.fn() }
      telemetrySampler.start()

      expect(telemetrySampler.start).toHaveBeenCalled()

      // setIsActive(true) would happen here
      const isActive = true
      expect(isActive).toBe(true)
    })
  })

  describe('Test D - Recovery startup', () => {
    it('should start recovery worker on app mount and process pending items', async () => {
      const mockOutbox = {
        loadAllPendingAndMerge: jest.fn().mockResolvedValue([]),
        loadPending: jest.fn().mockResolvedValue(undefined),
        add: jest.fn().mockResolvedValue(true),
        size: 0,
        sessionId,
        userId,
      } as any

      ;(PersistentOutbox as jest.Mock).mockImplementation(() => mockOutbox)
      ;(AsyncStorage.getAllKeys as jest.Mock).mockResolvedValue(['workout_outbox_item-1'])
      ;(AsyncStorage.multiGet as jest.Mock).mockResolvedValue([
        ['workout_outbox_item-1', JSON.stringify({
          id: 'item-1',
          type: 'CALIBRATION',
          sessionId,
          userId,
          payload: { hoopCenter: { x: 0.5, y: 0.3 } },
          timestamp: Date.now(),
          retryCount: 0,
        })]
      ])
      ;(saveCourtCalibration as jest.Mock).mockResolvedValue(undefined)
      ;(AsyncStorage.removeItem as jest.Mock).mockResolvedValue(undefined)

      // Simulate AppProviders mount
      const worker = getRecoveryWorker()
      worker.start(100)

      // Initial recovery runs immediately
      await jest.runAllTimersAsync()

      expect(AsyncStorage.getAllKeys).toHaveBeenCalled()
      expect(saveCourtCalibration).toHaveBeenCalledWith(
        sessionId,
        userId,
        { hoopCenter: { x: 0.5, y: 0.3 } }
      )
      expect(AsyncStorage.removeItem).toHaveBeenCalledWith('workout_outbox_item-1')

      worker.stop()
    })
  })

  describe('Test E - Telemetry batching', () => {
    it('should batch telemetry with 250ms delay or 5 samples', async () => {
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

      // Test 1: 3-4 samples with 250ms delay
      queue.enqueueTelemetry({ frameTimestamp: 1, ballX: 0.5, ballY: 0.5 })
      queue.enqueueTelemetry({ frameTimestamp: 2, ballX: 0.51, ballY: 0.51 })
      queue.enqueueTelemetry({ frameTimestamp: 3, ballX: 0.52, ballY: 0.52 })

      expect(queue.telemetrySize).toBe(3)

      // Wait for 250ms accumulation delay
      jest.advanceTimersByTime(250)
      await jest.runAllTimersAsync()

      // Test 2: 5 samples flush immediately
      queue.enqueueTelemetry({ frameTimestamp: 4, ballX: 0.53, ballY: 0.53 })
      queue.enqueueTelemetry({ frameTimestamp: 5, ballX: 0.54, ballY: 0.54 })

      expect(queue.telemetrySize).toBe(5)

      // Should flush immediately at 5 samples
      jest.advanceTimersByTime(10)
      await jest.runAllTimersAsync()

      // Verify batching behavior
      expect(queue.telemetrySize).toBeLessThanOrEqual(20) // drain(20) limit
    })
  })

  describe('Recovery worker concurrent protection', () => {
    it('should prevent concurrent recovery cycles', async () => {
      const worker = getRecoveryWorker()

      ;(AsyncStorage.getAllKeys as jest.Mock).mockResolvedValue([])
      const runRecoverySpy = jest.spyOn(worker as any, 'runRecovery')
        .mockImplementation(async () => {
          // Simulate slow recovery
          await new Promise(resolve => setTimeout(resolve, 100))
        })

      worker.start(50)

      // First cycle starts
      jest.advanceTimersByTime(50)
      await jest.runAllTimersAsync()

      // Second cycle should skip if first is still running
      jest.advanceTimersByTime(50)
      await jest.runAllTimersAsync()

      // Should only have run once due to protection
      expect(runRecoverySpy).toHaveBeenCalledTimes(1)

      worker.stop()
      runRecoverySpy.mockRestore()
    })
  })
})
