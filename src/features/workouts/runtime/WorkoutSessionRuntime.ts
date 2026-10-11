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
  IVisionEngine,
  ITrackingEngine,
  IShotDetectionEngine,
  ITelemetrySampler,
  IWorkoutQueue,
} from './WorkoutSessionRuntime.types'
import { ShotEventBuilder } from '../tracking/ShotEventBuilder'
import { ENABLE_VISION_DIAGNOSTICS } from '../../../config/debugConfig'

// Generate UUID v4 (compatible React Native)
const generateUUID = (): string => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  const template = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'
  return template.replace(/[xy]/g, (c: string) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

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
  private lastProcessDiagnosticAt = 0
  private processFrameCount = 0
  private previousProcessFrameTimestamp = 0
  private sessionDurationInterval: ReturnType<typeof setInterval> | null = null

  // Subsystem references (to be initialized)
  private visionEngine: IVisionEngine | null = null
  private trackingEngine: ITrackingEngine | null = null
  private shotDetectionEngine: IShotDetectionEngine | null = null
  private telemetrySampler: ITelemetrySampler | null = null
  private workoutQueue: IWorkoutQueue | null = null
  private shotEventBuilder: ShotEventBuilder = new ShotEventBuilder()
  private processedShotIds: Set<string> = new Set() // Track successfully saved shots for idempotency
  private pendingShotIds: Set<string> = new Set() // Track shots being saved (not yet confirmed)
  private isProcessingFrame: boolean = false // Guard against concurrent processFrame() calls
  private currentFramePromise: Promise<void> | null = null // Track current frame processing for stop() coordination

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
    
    // Vision processing paused via VisionEngineAdapter

    console.log('[WorkoutSessionRuntime] Session paused')
  }

  async resume(): Promise<void> {
    if (!this.canTransition(this.state, 'ACTIVE')) {
      throw new Error(`Cannot resume session from state: ${this.state}`)
    }

    this.setState('ACTIVE')
    
    // Vision processing resumed via VisionEngineAdapter

    console.log('[WorkoutSessionRuntime] Session resumed')
  }

  async stop(): Promise<void> {
    if (!this.canTransition(this.state, 'STOPPING')) {
      throw new Error(`Cannot stop session from state: ${this.state}`)
    }

    this.setState('STOPPING')

    try {
      // Vision processing stopped via VisionEngineAdapter

      // Wait for any in-flight frame processing to complete
      if (this.currentFramePromise) {
        console.log('[WorkoutSessionRuntime] Waiting for in-flight frame to complete before stopping')
        await this.currentFramePromise
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

  async processFrame(frame: {
    width: number
    height: number
    timestamp: number
    data?: Uint8Array
  }): Promise<void> {
    // Guard against concurrent processing
    if (this.isProcessingFrame) {
      return
    }

    this.isProcessingFrame = true

    // Schedule the internal work only after registering its Promise.
    // This prevents synchronous callbacks from calling stop() before
    // currentFramePromise is available.
    const framePromise = Promise.resolve().then(
      () => this.processFrameInternal(frame)
    )
    this.currentFramePromise = framePromise

    try {
      await framePromise
    } finally {
      this.isProcessingFrame = false
      this.currentFramePromise = null
    }
  }

  private async processFrameInternal(frame: {
    width: number
    height: number
    timestamp: number
    data?: Uint8Array
  }): Promise<void> {
    // Only process frames if session is ACTIVE
    if (this.state !== 'ACTIVE') {
      return
    }

    // Step 1: Vision detection (YOLO + MoveNet)
    if (!this.visionEngine) {
      console.warn('[WorkoutSessionRuntime] VisionEngine not set, cannot process frame')
      return
    }

    const visionResult = this.visionEngine.processFrame(frame)

    // Step 2: Tracking (Ball + Player + Shot)
    if (!this.trackingEngine) {
      console.warn('[WorkoutSessionRuntime] TrackingEngine not set, cannot process frame')
      return
    }

    // Feed pose data to ShotEventBuilder for rawPoseFrames
    if (visionResult.pose) {
      this.shotEventBuilder.addPoseFrame(
        visionResult.pose,
        visionResult.observationTimestamps?.pose ?? frame.timestamp,
        'IMAGE_NORMALIZED'
      )
    }

    const trackingState = this.trackingEngine.processFrame(
      visionResult.ball,
      visionResult.rim,
      frame.timestamp,
      visionResult.pose,
      undefined, // sizeCategory
      undefined, // adaptThreshold
      undefined, // rejectedBall
      visionResult.player,
      visionResult.observationTimestamps
    )

    // Diagnostic-only telemetry for one-cycle validation; no detection/tracking behavior changes.
    this.processFrameCount += 1
    const diagnosticNow = Date.now()
    const frameDeltaMs = this.previousProcessFrameTimestamp > 0
      ? frame.timestamp - this.previousProcessFrameTimestamp
      : null
    this.previousProcessFrameTimestamp = frame.timestamp
    if (ENABLE_VISION_DIAGNOSTICS && diagnosticNow - this.lastProcessDiagnosticAt >= 2000) {
      this.lastProcessDiagnosticAt = diagnosticNow
      console.log('[RUNTIME_TRACKING_DIAG]', {
        state: this.state,
        processFrameCount: this.processFrameCount,
        frameTimestamp: frame.timestamp,
        frameDeltaMs: frameDeltaMs === null ? null : Math.round(frameDeltaMs),
        input: {
          ball: !!visionResult.ball,
          ballConfidence: visionResult.ball?.confidence ?? null,
          player: !!visionResult.player,
          playerConfidence: visionResult.player?.confidence ?? null,
          rim: !!visionResult.rim,
          pose: !!visionResult.pose,
        },
        observationTimestamps: visionResult.observationTimestamps ?? null,
        tracking: {
          ballPosition: trackingState?.ballPosition ?? null,
          ballPositionRaw: trackingState?.ballPositionRaw ?? null,
          ballVelocity: trackingState?.ballVelocity ?? null,
          hoopPosition: trackingState?.hoopPosition ?? null,
          confidence: trackingState?.confidence ?? null,
          inFlight: trackingState?.inFlight ?? null,
          shotDetected: trackingState?.shotDetected ?? null,
          shotResult: trackingState?.shotResult ?? null,
          trajectoryPoints: trackingState?.trajectory?.length ?? null,
        },
      })
    }

    // Notify callback of tracking state update (Phase 4)
    this.callbacks?.onTrackingStateUpdate?.(trackingState)

    // Step 3: Shot detection (already performed by TrackingEngine internally)
    // TrackingEngine.processFrame() calls ShotDetectionEngine and includes result in trackingState
    if (trackingState?.shotDetected && trackingState?.shotResult) {
      // Check idempotency: skip if this shotId was already processed or is pending
      if (trackingState.shotId) {
        if (this.processedShotIds.has(trackingState.shotId)) {
          console.log(`[WorkoutSessionRuntime] Shot ${trackingState.shotId} already processed, skipping`)
          return
        }
        if (this.pendingShotIds.has(trackingState.shotId)) {
          console.log(`[WorkoutSessionRuntime] Shot ${trackingState.shotId} already pending, skipping`)
          return
        }
      }

      // Use ShotEventBuilder to build complete payload with trajectory, pose, court position
      const payload = this.shotEventBuilder.buildAddShotPayload(
        trackingState,
        this.config.sessionId,
        {
          calibration: undefined, // TODO: Pass calibration data when available
          cameraResolution: this.config.cameraResolution,
        }
      )

      // Normalize shot result for public contract
      const normalizedResult = this.shotEventBuilder.normalizeShotResult(trackingState.shotResult)

      // Mark shot as pending before enqueueing
      if (payload.shotId) {
        this.pendingShotIds.add(payload.shotId)
      }

      // Enqueue shot event to critical queue with complete payload and await result
      const enqueueSuccess = await this.enqueueCritical({
        type: 'SHOT',
        sessionId: this.config.sessionId,
        userId: this.config.userId,
        payload: {
          ...payload,
          shotResult: normalizedResult, // Override with normalized result
        },
      })

      // Only mark as processed and update metrics if enqueue succeeded
      if (enqueueSuccess && payload.shotId) {
        this.pendingShotIds.delete(payload.shotId)
        this.processedShotIds.add(payload.shotId)

        // Clear pose buffer after shot is saved to avoid mixing pose data between shots
        this.shotEventBuilder.clearPoseBuffer()

        // Update metrics (TODO: Make idempotent by deriving from persisted events)
        this.metrics.totalShots++
        if (trackingState.shotResult === 'MADE') {
          this.metrics.madeShots++
        }

        // Notify callback (normalized to MADE/MISS/UNCERTAIN)
        this.callbacks?.onShotDetected?.(normalizedResult)
        this.notifyTelemetryUpdate()

        // Reset tracking state to allow next shot detection
        this.trackingEngine?.resetShot()
      } else if (!enqueueSuccess && payload.shotId) {
        // Enqueue failed - remove from pending and log error
        this.pendingShotIds.delete(payload.shotId)
        console.error(`[WorkoutSessionRuntime] Failed to enqueue shot ${payload.shotId}, not counted in metrics`)
      }
    }
  }

  async registerManualShot(result: 'MADE' | 'MISS'): Promise<void> {
    if (this.state !== 'ACTIVE') {
      throw new Error(`Cannot register shot from state: ${this.state}`)
    }

    console.log('[WorkoutSessionRuntime] registerManualShot called with result:', result)

    // Generate stable shotId for manual shot
    const shotId = generateUUID()

    // Try to get current player position from tracking engine for court position calculation
    let manualBallPosition: { x: number; y: number } | null = null
    if (this.trackingEngine) {
      manualBallPosition = this.trackingEngine.getCurrentPlayerPosition()
      console.log('[WorkoutSessionRuntime] Player position for manual shot:', manualBallPosition)
    } else {
      console.warn('[WorkoutSessionRuntime] TrackingEngine not available for manual shot')
    }

    // Build minimal TrackingState for manual shot
    const manualTrackingState: any = {
      shotId,
      shotResult: result,
      shotDetected: true,
      ballPosition: manualBallPosition, // Use player position if available
      trajectory: [], // Manual shot has no trajectory
      confidence: 1.0,
    }

    // Use ShotEventBuilder to build consistent payload
    const payload = this.shotEventBuilder.buildAddShotPayload(
      manualTrackingState,
      this.config.sessionId,
      {
        calibration: this.config.calibration,
        cameraResolution: this.config.cameraResolution,
      }
    )

    console.log('[WorkoutSessionRuntime] Manual shot payload:', {
      shotId,
      courtX: payload.courtX,
      courtY: payload.courtY,
      shotResult: payload.shotResult,
    })

    // Mark shot as pending before enqueueing
    this.pendingShotIds.add(shotId)

    // Enqueue to critical queue and await result
    const enqueueSuccess = await this.enqueueCritical({
      type: 'SHOT',
      sessionId: this.config.sessionId,
      userId: this.config.userId,
      payload: {
        ...payload,
        shotResult: result, // Manual shots are always MADE or MISS
        trackingData: JSON.stringify({ manualEntry: true }),
      },
    })

    // Only mark as processed and update metrics if enqueue succeeded
    if (enqueueSuccess) {
      this.pendingShotIds.delete(shotId)
      this.processedShotIds.add(shotId)

      // Update metrics
      this.metrics.totalShots++
      if (result === 'MADE') {
        this.metrics.madeShots++
      }

      // Notify callback
      this.callbacks?.onShotDetected?.(result)
      this.notifyTelemetryUpdate()
    } else {
      // Enqueue failed - remove from pending and log error
      this.pendingShotIds.delete(shotId)
      console.error(`[WorkoutSessionRuntime] Failed to enqueue manual shot ${shotId}, not counted in metrics`)
    }
  }

  async enqueueCritical(event: {
    type: 'SHOT' | 'SESSION_START' | 'SESSION_END' | 'CALIBRATION'
    sessionId: string
    userId: string
    payload?: any
  }): Promise<boolean> {
    if (this.workoutQueue) {
      return await this.workoutQueue.enqueueCritical(event)
    } else {
      console.warn('[WorkoutSessionRuntime] Queue not set, cannot enqueue critical event')
      return false
    }
  }

  enqueueTelemetry(payload: Omit<any, 'sessionId' | 'userId'>): void {
    if (this.workoutQueue) {
      this.workoutQueue.enqueueTelemetry(payload)
    } else {
      console.warn('[WorkoutSessionRuntime] Queue not set, cannot enqueue telemetry')
    }
  }

  getState(): SessionState {
    return this.state
  }

  getMetrics(): SessionMetrics {
    return { ...this.metrics }
  }

  getTrackingEngine(): ITrackingEngine | null {
    return this.trackingEngine
  }

  setCalibration(calibration: any): void {
    this.config.calibration = calibration
  }

  // Private initialization methods
  private async initializeVisionPipeline(): Promise<void> {
    // Vision processing handled by VisionEngineAdapter
    console.log('[WorkoutSessionRuntime] Vision processing via VisionEngineAdapter')
  }

  private async initializeTrackingEngine(): Promise<void> {
    // Phase 4.5: Tracking engine is now provided via setTrackingEngine()
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
  setVisionEngine(engine: IVisionEngine): void {
    this.visionEngine = engine
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
