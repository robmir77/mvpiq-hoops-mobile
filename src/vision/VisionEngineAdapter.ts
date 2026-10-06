// VisionEngineAdapter
// Bridges legacy useShotTracker hook to IVisionEngine interface
// This is a temporary adapter during migration from useShotTracker to pure VisionEngine
//
// Migration status:
// - IVisionEngine contract: ✅ defined
// - VisionEngine pure class: ✅ created (vision/engine/VisionEngine.ts)
// - YoloDetector pure class: ✅ created (vision/engine/YoloDetector.ts)
// - MoveNetPoseEstimator pure class: ✅ created (vision/engine/MoveNetPoseEstimator.ts)
// - BallDetectionProcessor pure class: ✅ created (vision/engine/BallDetectionProcessor.ts)
// - YoloDetector integrated in useYoloWorker/useYoloWorkerAsync: ✅
// - MoveNetPoseEstimator integrated in useMoveNetWorker: ✅
//
// Current implementation: accepts parsed results from workers and passes to VisionEngine
// Workers (useYoloWorker, useMoveNetWorker) handle inference (runSync, resize) and parsing
// because they depend on react-native-fast-tflite and react-native-vision-camera-resizer
// VisionEngineAdapter forwards parsed results to VisionEngine for orchestration

import type { IVisionEngine, VisionEngineResult, BallDetection, PlayerDetection, RimDetection, PoseResult } from './VisionEngine.types'
import { VisionEngine } from './engine/VisionEngine'

export class VisionEngineAdapter implements IVisionEngine {
  private visionEngine: VisionEngine
  private lastBall: BallDetection | null = null
  private lastPlayer: PlayerDetection | null = null
  private lastRim: RimDetection | null = null
  private lastPose: PoseResult | null = null
  private lastTimestamp: number = 0
  private isRunning = false

  constructor(ballConfThreshold?: number, rimConfThreshold?: number, poseScoreThreshold?: number) {
    // VisionEngine now handles parsed results from workers
    this.visionEngine = new VisionEngine(ballConfThreshold, rimConfThreshold, poseScoreThreshold)
  }

  // Update parsed results from workers
  // Called by useShotTracker when workers produce new inference results
  // undefined = don't update this channel
  // null = update channel: detection lost
  // object = update channel: detection present
  updateParsedResults(
    ball: BallDetection | null | undefined,
    player: PlayerDetection | null | undefined,
    rim: RimDetection | null | undefined,
    pose: PoseResult | null | undefined,
    timestamp: number
  ): void {
    if (ball !== undefined) this.lastBall = ball
    if (player !== undefined) this.lastPlayer = player
    if (rim !== undefined) this.lastRim = rim
    if (pose !== undefined) this.lastPose = pose
    this.lastTimestamp = timestamp
  }

  // Get current parsed results for Runtime integration
  getCurrentResults(): {
    ball: BallDetection | null
    player: PlayerDetection | null
    rim: RimDetection | null
    pose: PoseResult | null
    timestamp: number
  } {
    return {
      ball: this.lastBall,
      player: this.lastPlayer,
      rim: this.lastRim,
      pose: this.lastPose,
      timestamp: this.lastTimestamp,
    }
  }

  processFrame(frame: {
    width: number
    height: number
    timestamp: number
    data?: Uint8Array
  }): VisionEngineResult {
    // Pass parsed results to VisionEngine for orchestration
    return this.visionEngine.processFrame({
      width: frame.width,
      height: frame.height,
      timestamp: this.lastTimestamp || frame.timestamp,
      data: frame.data,
      ball: this.lastBall,
      player: this.lastPlayer,
      rim: this.lastRim,
      pose: this.lastPose,
    })
  }

  setBallDetectionEnabled(enabled: boolean): void {
    this.visionEngine.setBallDetectionEnabled(enabled)
  }

  setPlayerDetectionEnabled(enabled: boolean): void {
    this.visionEngine.setPlayerDetectionEnabled(enabled)
  }

  setRimDetectionEnabled(enabled: boolean): void {
    this.visionEngine.setRimDetectionEnabled(enabled)
  }

  setPoseDetectionEnabled(enabled: boolean): void {
    this.visionEngine.setPoseDetectionEnabled(enabled)
  }

  isReady(): boolean {
    return this.visionEngine.isReady() && this.isRunning
  }

  start(): void {
    this.isRunning = true
    this.visionEngine.start()
  }

  stop(): void {
    this.isRunning = false
    this.visionEngine.stop()
  }
}
