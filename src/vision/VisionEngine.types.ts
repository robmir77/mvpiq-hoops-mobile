// Vision Engine Types
// Pure business logic interface for vision processing (YOLO + MoveNet)
// This should NOT depend on React Native/Skia

export interface BallDetection {
  x: number
  y: number
  width: number
  height: number
  confidence: number
}

export interface PlayerDetection {
  x: number
  y: number
  width: number
  height: number
  confidence: number
}

export interface RimDetection {
  x: number
  y: number
  width: number
  height: number
  confidence: number
}

export interface PoseResult {
  keypoints: Array<{ x: number; y: number; confidence: number }>
  confidence: number
}

export interface VisionObservationTimestamps {
  /** Original wall-clock timestamp captured when the worker submitted the observation. */
  ball: number | null
  player: number | null
  rim: number | null
  pose: number | null
}

export interface VisionEngineResult {
  ball: BallDetection | null
  player: PlayerDetection | null
  rim: RimDetection | null
  pose: PoseResult | null
  /** Reference timestamp for this orchestration pass, not a substitute for observation timestamps. */
  timestamp: number
  /** Original timestamp per channel; null means there is no fresh observation for that channel. */
  observationTimestamps?: VisionObservationTimestamps
}

export interface IVisionEngine {
  // Process a frame and return detection results
  processFrame(frame: {
    width: number
    height: number
    timestamp: number
    // Frame data (will be adapted from React Native Vision Camera Frame)
    data?: Uint8Array
  }): VisionEngineResult

  // Get current raw results (for diagnostics, includes all detections not just updated ones)
  getCurrentResults(): {
    ball: BallDetection | null
    player: PlayerDetection | null
    rim: RimDetection | null
    pose: PoseResult | null
    ballTimestamp: number
    playerTimestamp: number
    rimTimestamp: number
    poseTimestamp: number
  }

  // Enable/disable specific detection modules
  setBallDetectionEnabled(enabled: boolean): void
  setPlayerDetectionEnabled(enabled: boolean): void
  setRimDetectionEnabled(enabled: boolean): void
  setPoseDetectionEnabled(enabled: boolean): void

  // Get current state
  isReady(): boolean

  // Lifecycle
  start(): void
  stop(): void
}
