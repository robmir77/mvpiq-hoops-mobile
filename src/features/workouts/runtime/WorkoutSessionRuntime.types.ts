// WorkoutSessionRuntime Types
// Defines the contract for the workout session runtime

import type { FrameDataPayload } from '../services/workoutAsyncQueue'

export type SessionState = 'IDLE' | 'STARTING' | 'ACTIVE' | 'PAUSED' | 'STOPPING' | 'SYNCING' | 'COMPLETED' | 'ERROR'

export interface SessionConfig {
  sessionId: string
  userId: string
  cameraResolution?: { width: number; height: number }
  cameraFps?: number
  yoloModelId?: string
  moveNetModelId?: string
  poseResolution?: number
  yoloDelegate?: unknown
  poseDelegate?: unknown
}

export interface SessionMetrics {
  totalShots: number
  madeShots: number
  sessionDuration: number
  yoloFps: number
  moveNetFps: number
  cameraFps: number
}

export interface SessionCallbacks {
  onShotDetected?: (result: 'MADE' | 'MISS') => void
  onSessionStateChanged?: (state: SessionState) => void
  onError?: (error: Error) => void
  onTelemetryUpdate?: (metrics: SessionMetrics) => void
  onTrackingStateUpdate?: (trackingState: any) => void // Phase 4: Callback for Runtime.processFrame() tracking results
}

// Minimal subsystem interfaces (will be refined as subsystems are integrated)
export interface IVisionPipeline {
  start(): void
  stop(): void
}

export interface IVisionEngine {
  processFrame(frame: {
    width: number
    height: number
    timestamp: number
    data?: Uint8Array
  }): {
    ball: { x: number; y: number; width: number; height: number; confidence: number } | null
    player: { x: number; y: number; width: number; height: number; confidence: number } | null
    rim: { x: number; y: number; width: number; height: number; confidence: number } | null
    pose: any | null
    timestamp: number
  }
  setBallDetectionEnabled(enabled: boolean): void
  setPlayerDetectionEnabled(enabled: boolean): void
  setRimDetectionEnabled(enabled: boolean): void
  setPoseDetectionEnabled(enabled: boolean): void
  isReady(): boolean
  start(): void
  stop(): void
}

export interface ITrackingEngine {
  processFrame(
    ballDetection: { x: number; y: number; width?: number; height?: number; confidence: number } | null,
    hoopDetection: { x: number; y: number; width?: number; height?: number; confidence: number } | null,
    frameTs: number,
    poseKeypoints?: any,
    sizeCategory?: 'small' | 'medium' | 'large' | null,
    adaptThreshold?: number,
    rejectedBall?: { x: number; y: number; width?: number; height?: number; confidence: number } | null
  ): any
  resetShot(): void
  resetAll(): void
  getState(): any
  getComparisonStats(): any
}

export interface IShotDetectionEngine {
  processFrame(
    ballPosition: { x: number; y: number } | null,
    ballVelocity: { vx: number; vy: number } | null,
    hoopPosition: { x: number; y: number; width?: number; height?: number; confidence: number } | null,
    frameTs: number
  ): {
    shotDetected: boolean
    shotResult: 'MADE' | 'MISS' | 'AIRBALL' | null
    inFlight: boolean
    releasePoint: { x: number; y: number } | null
    apexPoint: { x: number; y: number } | null
  }
  resetShot(): void
  resetAll(): void
}

export interface ITelemetrySampler {
  shouldSample(timestamp: number): boolean
  reset(): void
  getLastSampleTime(): number
  setSampleInterval(intervalMs: number): void
}

export interface IWorkoutQueue {
  enqueueCritical(event: {
    type: 'SHOT' | 'SESSION_START' | 'SESSION_END' | 'CALIBRATION'
    sessionId: string
    userId: string
    payload?: any
  }): Promise<boolean>
  enqueueTelemetry(payload: Omit<FrameDataPayload, 'sessionId' | 'userId'>): void
  shutdown(): Promise<void>
}

export interface WorkoutSessionRuntime {
  // Lifecycle
  start(): Promise<void>
  pause(): Promise<void>
  resume(): Promise<void>
  stop(): Promise<void>

  // Frame processing (orchestrates Vision → Tracking → Shot)
  processFrame(frame: {
    width: number
    height: number
    timestamp: number
    data?: Uint8Array
  }): void

  // Actions
  registerManualShot(result: 'MADE' | 'MISS'): Promise<void>
  enqueueCritical(event: {
    type: 'SHOT' | 'SESSION_START' | 'SESSION_END' | 'CALIBRATION'
    sessionId: string
    userId: string
    payload?: any
  }): Promise<boolean>
  enqueueTelemetry(payload: Omit<FrameDataPayload, 'sessionId' | 'userId'>): void

  // State
  getState(): SessionState
  getMetrics(): SessionMetrics

  // Subsystems
  getVisionPipeline(): IVisionPipeline | null
  getTrackingEngine(): ITrackingEngine | null
}
