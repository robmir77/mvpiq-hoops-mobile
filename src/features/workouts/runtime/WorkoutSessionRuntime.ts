// WorkoutSessionRuntime
// Phase 4.1: Session coordinator
// Coordinates Vision, Tracking, Shot Detection, Telemetry, and Persistence
// This class should NOT depend on React Native/Skia - it's pure business logic

import type {
  SessionCallbacks,
  SessionConfig,
  SessionMetrics,
  SessionState,
  WorkoutSessionRuntime as IWorkoutSessionRuntime,
  IVisionPipeline,
  ITrackingEngine,
  IShotDetectionEngine,
  ITelemetrySampler,
  IWorkoutQueue,
} from './WorkoutSessionRuntime.types'

export class WorkoutSessionRuntime implements IWorkoutSessionRuntime {
  private config: SessionConfig
  private state: SessionState = 'IDLE'
  private callbacks?: SessionCallbacks
  private metrics: SessionMetrics = {
    totalShots: 0,
    madeShots: 0,
    sessionDuration: 0,
    yoloFps: 0,
    moveNetFps: 0,
    cameraFps: 0,
  }
  private sessionStartTime: number | null = null
  private sessionDurationInterval: ReturnType<typeof setInterval> | null = null

  // Subsystem references (to be initialized)
  private visionPipeline: IVisionPipeline | null = null
  private trackingEngine: ITrackingEngine | null = null
  private shotDetectionEngine: IShotDetectionEngine | null = null
  private telemetrySampler: ITelemetrySampler | null = null
  private workoutQueue: IWorkoutQueue | null = null

  // State machine guards
  private stateTransitions: Record<SessionState, SessionState[]> = {
    'IDLE': ['STARTING'],
    'STARTING': ['ACTIVE', 'ERROR'],
    'ACTIVE': ['PAUSED', 'STOPPING', 'ERROR'],
    'PAUSED': ['ACTIVE', 'STOPPING', 'ERROR'],
    'STOPPING': ['SYNCING', 'COMPLETED', 'ERROR'],
    'SYNCING': ['COMPLETED', 'ERROR'],
    'COMPLETED': ['IDLE'],
    'ERROR': ['IDLE'],
  }

  constructor(config: SessionConfig, callbacks?: SessionCallbacks) {
    this.config = config
    this.callbacks = callbacks
  }

  // State machine transition with guard validation
  private canTransition(from: SessionState, to: SessionState): boolean {
    const allowed = this.stateTransitions[from]
    return allowed.includes(to)
  }

  async start(): Promise<void> {
    if (!this.canTransition(this.state, 'STARTING')) {
      throw new Error(`Cannot start session from state: ${this.state}`)
    }

    this.setState('STARTING')

    try {
      // Initialize subsystems
      await this.initializeVisionPipeline()
      await this.initializeTrackingEngine()
      await this.initializeShotDetection()
      await this.initializeTelemetry()
      await this.initializeQueue()

      this.sessionStartTime = Date.now()
      this.startDurationTracking()
      
      this.setState('ACTIVE')
      console.log('[WorkoutSessionRuntime] Session started')
    } catch (error) {
      this.setState('ERROR')
      this.callbacks?.onError?.(error as Error)
      throw error
    }
  }

  async pause(): Promise<void> {
    if (!this.canTransition(this.state, 'PAUSED')) {
      throw new Error(`Cannot pause session from state: ${this.state}`)
    }

    this.setState('PAUSED')
    
    // Pause vision pipeline
    if (this.visionPipeline?.stop) {
      this.visionPipeline.stop()
    }

    console.log('[WorkoutSessionRuntime] Session paused')
  }

  async resume(): Promise<void> {
    if (!this.canTransition(this.state, 'ACTIVE')) {
      throw new Error(`Cannot resume session from state: ${this.state}`)
    }

    this.setState('ACTIVE')
    
    // Resume vision pipeline
    if (this.visionPipeline?.start) {
      this.visionPipeline.start()
    }

    console.log('[WorkoutSessionRuntime] Session resumed')
  }

  async stop(): Promise<void> {
    if (!this.canTransition(this.state, 'STOPPING')) {
      throw new Error(`Cannot stop session from state: ${this.state}`)
    }

    this.setState('STOPPING')

    try {
      // Stop vision pipeline
      if (this.visionPipeline?.stop) {
        this.visionPipeline.stop()
      }

      // Transition to SYNCING state for data persistence
      this.setState('SYNCING')

      // Shutdown queue (this will flush pending data)
      if (this.workoutQueue?.shutdown) {
        await this.workoutQueue.shutdown()
      }

      // Stop duration tracking
      this.stopDurationTracking()

      this.setState('COMPLETED')
      console.log('[WorkoutSessionRuntime] Session stopped')
    } catch (error) {
      this.setState('ERROR')
      this.callbacks?.onError?.(error as Error)
      throw error
    }
  }

  async registerManualShot(result: 'MADE' | 'MISS'): Promise<void> {
    if (this.state !== 'ACTIVE') {
      throw new Error(`Cannot register shot from state: ${this.state}`)
    }

    // Enqueue to critical queue
    if (this.workoutQueue) {
      await this.workoutQueue.enqueueCritical({
        type: 'SHOT',
        sessionId: this.config.sessionId,
        userId: this.config.userId,
        payload: {
          timestampMs: Date.now(),
          shotResult: result,
          detectionConfidence: 1.0,
          trackingData: JSON.stringify({ manualEntry: true }),
        },
      })
    }

    // Update metrics
    this.metrics.totalShots++
    if (result === 'MADE') {
      this.metrics.madeShots++
    }

    // Notify callback
    this.callbacks?.onShotDetected?.(result)
    this.notifyTelemetryUpdate()
  }

  getState(): SessionState {
    return this.state
  }

  getMetrics(): SessionMetrics {
    return { ...this.metrics }
  }

  getVisionPipeline(): IVisionPipeline | null {
    return this.visionPipeline
  }

  getTrackingEngine(): ITrackingEngine | null {
    return this.trackingEngine
  }

  // Private initialization methods
  private async initializeVisionPipeline(): Promise<void> {
    // Vision pipeline will be initialized with the React hook
    // This is a placeholder for future non-React implementation
    if (this.visionPipeline) {
      console.log('[WorkoutSessionRuntime] Vision pipeline initialized')
    } else {
      console.warn('[WorkoutSessionRuntime] Vision pipeline not set - will be provided by React hook')
    }
  }

  private async initializeTrackingEngine(): Promise<void> {
    // Tracking engine is now provided via setTrackingEngine()
    // The Runtime coordinates the tracking engines but doesn't own them
    // They are owned by the React hook (useTrackingEngine) for now
    if (this.trackingEngine) {
      console.log('[WorkoutSessionRuntime] Tracking engine initialized')
    } else {
      console.warn('[WorkoutSessionRuntime] Tracking engine not set - will be provided by React hook')
    }
  }

  private async initializeShotDetection(): Promise<void> {
    // Shot detection engine is now provided via setShotDetectionEngine()
    // The Runtime coordinates shot detection but doesn't own the engine
    if (this.shotDetectionEngine) {
      console.log('[WorkoutSessionRuntime] Shot detection initialized')
    } else {
      console.warn('[WorkoutSessionRuntime] Shot detection engine not set - will be provided by React hook')
    }
  }

  private async initializeTelemetry(): Promise<void> {
    // Telemetry sampler already exists in services
    if (this.telemetrySampler) {
      console.log('[WorkoutSessionRuntime] Telemetry initialized')
    } else {
      console.warn('[WorkoutSessionRuntime] Telemetry sampler not set - will be provided by React hook')
    }
  }

  private async initializeQueue(): Promise<void> {
    // Queue already exists in services
    if (this.workoutQueue) {
      console.log('[WorkoutSessionRuntime] Queue initialized')
    } else {
      console.warn('[WorkoutSessionRuntime] Queue not set - will be provided by React hook')
    }
  }

  // State management
  private setState(newState: SessionState): void {
    const oldState = this.state
    this.state = newState
    console.log(`[WorkoutSessionRuntime] State: ${oldState} -> ${newState}`)
    this.callbacks?.onSessionStateChanged?.(newState)
  }

  // Duration tracking
  private startDurationTracking(): void {
    this.sessionDurationInterval = setInterval(() => {
      if (this.sessionStartTime) {
        this.metrics.sessionDuration = Date.now() - this.sessionStartTime
        this.notifyTelemetryUpdate()
      }
    }, 1000)
  }

  private stopDurationTracking(): void {
    if (this.sessionDurationInterval) {
      clearInterval(this.sessionDurationInterval)
      this.sessionDurationInterval = null
    }
  }

  private notifyTelemetryUpdate(): void {
    this.callbacks?.onTelemetryUpdate?.(this.getMetrics())
  }

  // Set subsystem references (called by the Screen during initialization)
  setVisionPipeline(pipeline: IVisionPipeline): void {
    this.visionPipeline = pipeline
  }

  setTrackingEngine(engine: ITrackingEngine): void {
    this.trackingEngine = engine
  }

  setShotDetectionEngine(engine: IShotDetectionEngine): void {
    this.shotDetectionEngine = engine
  }

  setTelemetrySampler(sampler: ITelemetrySampler): void {
    this.telemetrySampler = sampler
  }

  setWorkoutQueue(queue: IWorkoutQueue): void {
    this.workoutQueue = queue
  }
}
