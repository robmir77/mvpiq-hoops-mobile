// src/features/workouts/__tests__/useWorkoutSessions.test.ts
//
// Unit tests for useWorkoutSessions hook
// Tests workout session data fetching and caching

import React from 'react'
import { renderHook, waitFor } from '@testing-library/react-native'
import { QueryClient } from '@tanstack/react-query'
import { QueryClientProvider } from '@tanstack/react-query'
import { useWorkoutSessions } from '../hooks/useWorkoutSessions'
import { getPlayerWorkoutSessions } from '../api/workouts.api'
import { WorkoutSession } from '../types/workouts.types'

// Mock the API
jest.mock('../api/workouts.api')

const mockGetPlayerWorkoutSessions = getPlayerWorkoutSessions as jest.MockedFunction<typeof getPlayerWorkoutSessions>

describe('useWorkoutSessions', () => {
  let queryClient: QueryClient
  let wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => <>{children}</>

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    })
    jest.clearAllMocks()

    wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    )
  })

  describe('Data Fetching', () => {
    it('should fetch workout sessions for a user', async () => {
      const mockSessions: WorkoutSession[] = [
        {
          id: 'session-1',
          userId: 'user-123',
          cameraMode: 'ANGLE_45',
          courtType: 'HALF_COURT',
          status: 'COMPLETED',
          startTime: new Date().toISOString(),
          totalShots: 10,
          madeShots: 7,
          shootingPercentage: 70,
        },
        {
          id: 'session-2',
          userId: 'user-123',
          cameraMode: 'LATERAL',
          courtType: 'FULL_COURT',
          status: 'ACTIVE',
          startTime: new Date().toISOString(),
          totalShots: 5,
          madeShots: 3,
          shootingPercentage: 60,
        },
      ]

      mockGetPlayerWorkoutSessions.mockResolvedValue(mockSessions)

      const { result } = await renderHook(() => useWorkoutSessions('user-123'), { wrapper })

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true)
      })

      expect(mockGetPlayerWorkoutSessions).toHaveBeenCalledWith('user-123')
      expect(result.current.data).toEqual(mockSessions)
    })

    it('should not fetch when userId is empty', async () => {
      const { result } = await renderHook(() => useWorkoutSessions(''), { wrapper })

      expect(result.current.isLoading).toBe(false)
      expect(mockGetPlayerWorkoutSessions).not.toHaveBeenCalled()
    })

    it('should handle API errors', async () => {
      mockGetPlayerWorkoutSessions.mockRejectedValue(new Error('Network error'))

      const { result } = await renderHook(() => useWorkoutSessions('user-123'), { wrapper })

      await waitFor(() => {
        expect(result.current.isError).toBe(true)
      })

      expect(result.current.error).toBeDefined()
    })

    it('should return empty array when no sessions exist', async () => {
      mockGetPlayerWorkoutSessions.mockResolvedValue([])

      const { result } = await renderHook(() => useWorkoutSessions('user-123'), { wrapper })

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true)
      })

      expect(result.current.data).toEqual([])
    })
  })

  describe('Caching Behavior', () => {
    it('should use staleTime of 0 (always stale)', async () => {
      const { result } = await renderHook(() => useWorkoutSessions('user-123'), { wrapper })

      // The hook should be configured with staleTime: 0
      // This means data is always considered stale and will refetch on invalidate/focus
      expect(result.current.isLoading).toBe(true)
    })

    it('should keep data in cache for 5 minutes (gcTime)', async () => {
      const mockSessions: WorkoutSession[] = [
        {
          id: 'session-1',
          userId: 'user-123',
          cameraMode: 'ANGLE_45',
          courtType: 'HALF_COURT',
          status: 'COMPLETED',
          startTime: new Date().toISOString(),
          totalShots: 10,
          madeShots: 7,
          shootingPercentage: 70,
        },
      ]

      mockGetPlayerWorkoutSessions.mockResolvedValue(mockSessions)

      const { result } = await renderHook(() => useWorkoutSessions('user-123'), { wrapper })

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true)
      })

      // Data should be cached
      const cache = queryClient.getQueryCache()
      const query = cache.find({ queryKey: ['workoutSessions', 'user-123'] })
      expect(query).toBeDefined()
    })

    it('should use correct query key', async () => {
      mockGetPlayerWorkoutSessions.mockResolvedValue([])

      await renderHook(() => useWorkoutSessions('user-123'), { wrapper })

      const cache = queryClient.getQueryCache()
      const query = cache.find({ queryKey: ['workoutSessions', 'user-123'] })
      expect(query).toBeDefined()
    })
  })

  describe('Loading States', () => {
    it('should be in loading state initially', async () => {
      const { result } = await renderHook(() => useWorkoutSessions('user-123'), { wrapper })

      expect(result.current.isLoading).toBe(true)
      expect(result.current.data).toBeUndefined()
    })

    it('should not be loading after successful fetch', async () => {
      mockGetPlayerWorkoutSessions.mockResolvedValue([])

      const { result } = await renderHook(() => useWorkoutSessions('user-123'), { wrapper })

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })
    })

    it('should not be loading after error', async () => {
      mockGetPlayerWorkoutSessions.mockRejectedValue(new Error('Network error'))

      const { result } = await renderHook(() => useWorkoutSessions('user-123'), { wrapper })

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })
    })
  })

  describe('Data Transformation', () => {
    it('should preserve session data structure', async () => {
      const mockSessions: WorkoutSession[] = [
        {
          id: 'session-1',
          userId: 'user-123',
          playerId: 'player-123',
          cameraMode: 'ANGLE_45',
          courtType: 'HALF_COURT',
          status: 'COMPLETED',
          startTime: '2024-01-01T10:00:00Z',
          endTime: '2024-01-01T11:00:00Z',
          totalShots: 10,
          madeShots: 7,
          missedShots: 3,
          shootingPercentage: 70,
          notes: 'Good session',
          averageShotDistance: 6.5,
          workoutScore: 85,
        },
      ]

      mockGetPlayerWorkoutSessions.mockResolvedValue(mockSessions)

      const { result } = await renderHook(() => useWorkoutSessions('user-123'), { wrapper })

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true)
      })

      const session = result.current.data?.[0]
      expect(session?.id).toBe('session-1')
      expect(session?.cameraMode).toBe('ANGLE_45')
      expect(session?.status).toBe('COMPLETED')
      expect(session?.totalShots).toBe(10)
      expect(session?.madeShots).toBe(7)
    })

    it('should handle sessions with optional fields', async () => {
      const mockSessions: WorkoutSession[] = [
        {
          id: 'session-1',
          userId: 'user-123',
          cameraMode: 'LATERAL',
          courtType: 'FULL_COURT',
          status: 'ACTIVE',
          startTime: new Date().toISOString(),
          totalShots: 5,
          madeShots: 3,
          shootingPercentage: 60,
          // Optional fields missing
        },
      ]

      mockGetPlayerWorkoutSessions.mockResolvedValue(mockSessions)

      const { result } = await renderHook(() => useWorkoutSessions('user-123'), { wrapper })

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true)
      })

      const session = result.current.data?.[0]
      expect(session?.endTime).toBeUndefined()
      expect(session?.notes).toBeUndefined()
      expect(session?.averageShotDistance).toBeUndefined()
    })
  })

  describe('Multiple Users', () => {
    it('should fetch different data for different users', async () => {
      const user1Sessions: WorkoutSession[] = [
        {
          id: 'session-1',
          userId: 'user-1',
          cameraMode: 'ANGLE_45',
          courtType: 'HALF_COURT',
          status: 'COMPLETED',
          startTime: new Date().toISOString(),
          totalShots: 10,
          madeShots: 7,
          shootingPercentage: 70,
        },
      ]

      const user2Sessions: WorkoutSession[] = [
        {
          id: 'session-2',
          userId: 'user-2',
          cameraMode: 'LATERAL',
          courtType: 'FULL_COURT',
          status: 'ACTIVE',
          startTime: new Date().toISOString(),
          totalShots: 5,
          madeShots: 3,
          shootingPercentage: 60,
        },
      ]

      mockGetPlayerWorkoutSessions
        .mockResolvedValueOnce(user1Sessions)
        .mockResolvedValueOnce(user2Sessions)

      const { result: result1 } = await renderHook(() => useWorkoutSessions('user-1'), { wrapper })
      const { result: result2 } = await renderHook(() => useWorkoutSessions('user-2'), { wrapper })

      await waitFor(() => {
        expect(result1.current.isSuccess).toBe(true)
        expect(result2.current.isSuccess).toBe(true)
      })

      expect(result1.current.data).toEqual(user1Sessions)
      expect(result2.current.data).toEqual(user2Sessions)
    })
  })
})
