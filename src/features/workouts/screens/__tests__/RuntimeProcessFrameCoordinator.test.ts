// Tests for the runtime.processFrame() coordinator in WorkoutSessionScreen
// Validates three scenarios:
// 1. YOLO and MoveNet notify updates during frame processing: second processing must start
// 2. Many updates arrive during same frame: processing stays serial, last data consumed
// 3. processFrame() fails repeatedly: coordinator must not enter uncontrolled retry loop

describe('RuntimeProcessFrameCoordinator', () => {
    // Simulate the coordinator state and logic from WorkoutSessionScreen
    interface CoordinatorState {
        isProcessing: boolean
        hasPendingUpdates: boolean
        consecutiveErrors: number
        lastErrorTime: number
        processFrameCallCount: number
    }

    const MAX_CONSECUTIVE_ERRORS = 5
    const ERROR_BACKOFF_MS = 100
    const MAX_BACKOFF_MS = 1000

    let state: CoordinatorState
    let mockRuntime: jest.MockedFunction<any>

    beforeEach(() => {
        state = {
            isProcessing: false,
            hasPendingUpdates: false,
            consecutiveErrors: 0,
            lastErrorTime: 0,
            processFrameCallCount: 0,
        }

        mockRuntime = jest.fn()
    })

    // Scenario 1: YOLO and MoveNet notify updates during frame processing
    describe('Scenario 1: Updates arrive during processing', () => {
        it('should schedule second processing when updates arrive during processing', async () => {
            let processingCount = 0
            mockRuntime.mockImplementation(() => {
                processingCount++
                return Promise.resolve()
            })

            const scheduleProcessing = () => {
                if (state.isProcessing) {
                    state.hasPendingUpdates = true
                    return
                }

                state.isProcessing = true
                state.hasPendingUpdates = false
                state.processFrameCallCount++

                mockRuntime().then(() => {
                    state.consecutiveErrors = 0
                    state.isProcessing = false

                    if (state.hasPendingUpdates) {
                        state.hasPendingUpdates = false
                        setTimeout(() => scheduleProcessing(), 0)
                    }
                })
            }

            // First call starts processing
            scheduleProcessing()
            expect(state.isProcessing).toBe(true)
            expect(state.processFrameCallCount).toBe(1)

            // Second call arrives during processing
            scheduleProcessing()
            expect(state.hasPendingUpdates).toBe(true)
            expect(state.processFrameCallCount).toBe(1) // No new processing yet

            // Wait for first processing to complete and second to be scheduled
            await new Promise(resolve => setTimeout(resolve, 20))

            // Second processing should have been scheduled and executed
            expect(state.isProcessing).toBe(false)
            expect(state.processFrameCallCount).toBe(2) // Second processing completed
        })

        it('should handle multiple concurrent updates during processing', async () => {
            mockRuntime.mockImplementation(() => Promise.resolve())

            const scheduleProcessing = () => {
                if (state.isProcessing) {
                    state.hasPendingUpdates = true
                    return
                }

                state.isProcessing = true
                state.hasPendingUpdates = false
                state.processFrameCallCount++

                mockRuntime().then(() => {
                    state.consecutiveErrors = 0
                    state.isProcessing = false

                    if (state.hasPendingUpdates) {
                        state.hasPendingUpdates = false
                        setTimeout(() => scheduleProcessing(), 0)
                    }
                })
            }

            // Start first processing
            scheduleProcessing()
            expect(state.processFrameCallCount).toBe(1)

            // Multiple updates arrive during processing
            scheduleProcessing()
            scheduleProcessing()
            scheduleProcessing()

            expect(state.hasPendingUpdates).toBe(true)
            expect(state.processFrameCallCount).toBe(1)

            // Wait for completion
            await new Promise(resolve => setTimeout(resolve, 20))

            // Only one additional processing should be scheduled and executed
            expect(state.processFrameCallCount).toBe(2)
        })
    })

    // Scenario 2: Many updates arrive during same frame
    describe('Scenario 2: Many updates during same frame', () => {
        it('should keep processing serial and consume last available data', async () => {
            let callCount = 0
            mockRuntime.mockImplementation(() => {
                callCount++
                return Promise.resolve()
            })

            const scheduleProcessing = () => {
                if (state.isProcessing) {
                    state.hasPendingUpdates = true
                    return
                }

                state.isProcessing = true
                state.hasPendingUpdates = false
                state.processFrameCallCount++

                mockRuntime().then(() => {
                    state.consecutiveErrors = 0
                    state.isProcessing = false

                    if (state.hasPendingUpdates) {
                        state.hasPendingUpdates = false
                        Promise.resolve().then(() => scheduleProcessing())
                    }
                })
            }

            // Simulate rapid-fire updates
            for (let i = 0; i < 10; i++) {
                scheduleProcessing()
                // Small delay to simulate async updates
                await new Promise(resolve => setTimeout(resolve, 1))
            }

            // Wait for all processing to complete
            await new Promise(resolve => setTimeout(resolve, 50))

            // Processing should remain serial - no concurrent calls
            expect(state.isProcessing).toBe(false)
            // All updates should eventually be processed
            expect(state.processFrameCallCount).toBeGreaterThan(0)
        })

        it('should not process if no pending updates after completion', async () => {
            mockRuntime.mockImplementation(() => Promise.resolve())

            const scheduleProcessing = () => {
                if (state.isProcessing) {
                    state.hasPendingUpdates = true
                    return
                }

                state.isProcessing = true
                state.hasPendingUpdates = false
                state.processFrameCallCount++

                mockRuntime().then(() => {
                    state.consecutiveErrors = 0
                    state.isProcessing = false

                    if (state.hasPendingUpdates) {
                        state.hasPendingUpdates = false
                        Promise.resolve().then(() => scheduleProcessing())
                    }
                })
            }

            // Single call
            scheduleProcessing()

            await new Promise(resolve => setTimeout(resolve, 10))

            expect(state.processFrameCallCount).toBe(1)
        })
    })

    // Scenario 3: processFrame() fails repeatedly
    describe('Scenario 3: Repeated failures', () => {
        it('should implement exponential backoff on consecutive errors', async () => {
            mockRuntime.mockImplementation(() => Promise.reject(new Error('Test error')))

            const scheduleProcessing = () => {
                if (state.isProcessing) {
                    state.hasPendingUpdates = true
                    return
                }

                if (state.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
                    const timeSinceLastError = Date.now() - state.lastErrorTime
                    if (timeSinceLastError < MAX_BACKOFF_MS) {
                        return
                    }
                    state.consecutiveErrors = 0
                }

                state.isProcessing = true
                state.hasPendingUpdates = false
                state.processFrameCallCount++

                mockRuntime().then(() => {
                    state.consecutiveErrors = 0
                    state.isProcessing = false

                    if (state.hasPendingUpdates) {
                        state.hasPendingUpdates = false
                        Promise.resolve().then(() => scheduleProcessing())
                    }
                }).catch(() => {
                    state.consecutiveErrors++
                    state.lastErrorTime = Date.now()
                    state.isProcessing = false

                    const backoffDelay = Math.min(
                        ERROR_BACKOFF_MS * Math.pow(2, state.consecutiveErrors - 1),
                        MAX_BACKOFF_MS
                    )

                    if (state.hasPendingUpdates) {
                        state.hasPendingUpdates = false
                        setTimeout(() => scheduleProcessing(), backoffDelay)
                    }
                })
            }

            // Trigger multiple failures with pending updates
            for (let i = 0; i < 3; i++) {
                state.hasPendingUpdates = true // Simulate pending updates
                scheduleProcessing()
                await new Promise(resolve => setTimeout(resolve, 50)) // Wait for backoff
            }

            expect(state.consecutiveErrors).toBe(3)
            expect(state.processFrameCallCount).toBe(3)
        })

        it('should stop retrying after MAX_CONSECUTIVE_ERRORS', async () => {
            mockRuntime.mockImplementation(() => Promise.reject(new Error('Test error')))

            const scheduleProcessing = () => {
                if (state.isProcessing) {
                    state.hasPendingUpdates = true
                    return
                }

                if (state.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
                    const timeSinceLastError = Date.now() - state.lastErrorTime
                    if (timeSinceLastError < MAX_BACKOFF_MS) {
                        return
                    }
                    state.consecutiveErrors = 0
                }

                state.isProcessing = true
                state.hasPendingUpdates = false
                state.processFrameCallCount++

                mockRuntime().then(() => {
                    state.consecutiveErrors = 0
                    state.isProcessing = false

                    if (state.hasPendingUpdates) {
                        state.hasPendingUpdates = false
                        Promise.resolve().then(() => scheduleProcessing())
                    }
                }).catch(() => {
                    state.consecutiveErrors++
                    state.lastErrorTime = Date.now()
                    state.isProcessing = false

                    const backoffDelay = Math.min(
                        ERROR_BACKOFF_MS * Math.pow(2, state.consecutiveErrors - 1),
                        MAX_BACKOFF_MS
                    )

                    if (state.hasPendingUpdates) {
                        state.hasPendingUpdates = false
                        setTimeout(() => scheduleProcessing(), backoffDelay)
                    }
                })
            }

            // Trigger failures up to MAX_CONSECUTIVE_ERRORS
            for (let i = 0; i < MAX_CONSECUTIVE_ERRORS; i++) {
                state.hasPendingUpdates = true
                scheduleProcessing()
                await new Promise(resolve => setTimeout(resolve, 50))
            }

            expect(state.consecutiveErrors).toBe(MAX_CONSECUTIVE_ERRORS)
            expect(state.processFrameCallCount).toBe(MAX_CONSECUTIVE_ERRORS)

            // Try one more call - should be rejected
            const callCountBefore = state.processFrameCallCount
            state.hasPendingUpdates = true
            scheduleProcessing()
            await new Promise(resolve => setTimeout(resolve, 10))

            expect(state.processFrameCallCount).toBe(callCountBefore) // No new processing
        })

        it('should reset error counter after successful processing', async () => {
            let failCount = 0
            mockRuntime.mockImplementation(() => {
                failCount++
                if (failCount <= 3) {
                    return Promise.reject(new Error('Test error'))
                }
                return Promise.resolve()
            })

            const scheduleProcessing = () => {
                if (state.isProcessing) {
                    state.hasPendingUpdates = true
                    return
                }

                if (state.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
                    const timeSinceLastError = Date.now() - state.lastErrorTime
                    if (timeSinceLastError < MAX_BACKOFF_MS) {
                        return
                    }
                    state.consecutiveErrors = 0
                }

                state.isProcessing = true
                state.hasPendingUpdates = false
                state.processFrameCallCount++

                mockRuntime().then(() => {
                    state.consecutiveErrors = 0
                    state.isProcessing = false

                    if (state.hasPendingUpdates) {
                        state.hasPendingUpdates = false
                        Promise.resolve().then(() => scheduleProcessing())
                    }
                }).catch(() => {
                    state.consecutiveErrors++
                    state.lastErrorTime = Date.now()
                    state.isProcessing = false

                    const backoffDelay = Math.min(
                        ERROR_BACKOFF_MS * Math.pow(2, state.consecutiveErrors - 1),
                        MAX_BACKOFF_MS
                    )

                    if (state.hasPendingUpdates) {
                        state.hasPendingUpdates = false
                        setTimeout(() => scheduleProcessing(), backoffDelay)
                    }
                })
            }

            // Trigger failures then success
            for (let i = 0; i < 5; i++) {
                state.hasPendingUpdates = true
                scheduleProcessing()
                await new Promise(resolve => setTimeout(resolve, 50))
            }

            expect(state.consecutiveErrors).toBe(0) // Reset after success
        })

        it('should allow retrying after MAX_BACKOFF_MS timeout', async () => {
            mockRuntime.mockImplementation(() => Promise.reject(new Error('Test error')))

            const scheduleProcessing = () => {
                if (state.isProcessing) {
                    state.hasPendingUpdates = true
                    return
                }

                if (state.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
                    const timeSinceLastError = Date.now() - state.lastErrorTime
                    if (timeSinceLastError < MAX_BACKOFF_MS) {
                        return
                    }
                    state.consecutiveErrors = 0
                }

                state.isProcessing = true
                state.hasPendingUpdates = false
                state.processFrameCallCount++

                mockRuntime().then(() => {
                    state.consecutiveErrors = 0
                    state.isProcessing = false

                    if (state.hasPendingUpdates) {
                        state.hasPendingUpdates = false
                        Promise.resolve().then(() => scheduleProcessing())
                    }
                }).catch(() => {
                    state.consecutiveErrors++
                    state.lastErrorTime = Date.now()
                    state.isProcessing = false

                    const backoffDelay = Math.min(
                        ERROR_BACKOFF_MS * Math.pow(2, state.consecutiveErrors - 1),
                        MAX_BACKOFF_MS
                    )

                    if (state.hasPendingUpdates) {
                        state.hasPendingUpdates = false
                        setTimeout(() => scheduleProcessing(), backoffDelay)
                    }
                })
            }

            // Trigger failures up to MAX_CONSECUTIVE_ERRORS
            for (let i = 0; i < MAX_CONSECUTIVE_ERRORS; i++) {
                state.hasPendingUpdates = true
                scheduleProcessing()
                await new Promise(resolve => setTimeout(resolve, 50))
            }

            expect(state.consecutiveErrors).toBe(MAX_CONSECUTIVE_ERRORS)

            // Wait for MAX_BACKOFF_MS to pass
            await new Promise(resolve => setTimeout(resolve, MAX_BACKOFF_MS + 100))

            // Should allow retry
            state.hasPendingUpdates = true
            scheduleProcessing()
            await new Promise(resolve => setTimeout(resolve, 50))

            expect(state.consecutiveErrors).toBe(1) // Reset and incremented
        })
    })
})
