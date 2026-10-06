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

export interface VisionEngineResult {
  ball: BallDetection | null
  player: PlayerDetection | null
  rim: RimDetection | null
  pose: PoseResult | null
  timestamp: number
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
