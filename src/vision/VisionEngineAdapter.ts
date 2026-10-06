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
// Current implementation: accepts parsed results from workers (no duplicate parsing)
// Workers (useYoloWorker, useMoveNetWorker) handle inference (runSync, resize) and parsing
// because they depend on react-native-fast-tflite and react-native-vision-camera-resizer
// VisionEngineAdapter simply forwards parsed results to IVisionEngine interface

import type { IVisionEngine, VisionEngineResult, BallDetection, PlayerDetection, RimDetection, PoseResult } from './VisionEngine.types'

export class VisionEngineAdapter implements IVisionEngine {
  private lastBall: BallDetection | null = null
  private lastPlayer: PlayerDetection | null = null
  private lastRim: RimDetection | null = null
  private lastPose: PoseResult | null = null
  private lastTimestamp: number = 0
  private isRunning = false

  private ballDetectionEnabled: boolean = true
  private playerDetectionEnabled: boolean = true
  private rimDetectionEnabled: boolean = true
  private poseDetectionEnabled: boolean = true

  constructor() {
    // No pure VisionEngine needed - workers handle parsing
  }

  // Update parsed results from workers
  // Called by useShotTracker when workers produce new inference results
  updateParsedResults(
    ball: BallDetection | null,
    player: PlayerDetection | null,
    rim: RimDetection | null,
    pose: PoseResult | null,
    timestamp: number
  ): void {
    this.lastBall = ball
    this.lastPlayer = player
    this.lastRim = rim
    this.lastPose = pose
    this.lastTimestamp = timestamp
  }

  processFrame(frame: {
    width: number
    height: number
    timestamp: number
    data?: Uint8Array
  }): VisionEngineResult {
    // Return parsed results from workers
    return {
      ball: this.ballDetectionEnabled ? this.lastBall : null,
      player: this.playerDetectionEnabled ? this.lastPlayer : null,
      rim: this.rimDetectionEnabled ? this.lastRim : null,
      pose: this.poseDetectionEnabled ? this.lastPose : null,
      timestamp: this.lastTimestamp,
    }
  }

  setBallDetectionEnabled(enabled: boolean): void {
    this.ballDetectionEnabled = enabled
  }

  setPlayerDetectionEnabled(enabled: boolean): void {
    this.playerDetectionEnabled = enabled
  }

  setRimDetectionEnabled(enabled: boolean): void {
    this.rimDetectionEnabled = enabled
  }

  setPoseDetectionEnabled(enabled: boolean): void {
    this.poseDetectionEnabled = enabled
  }

  isReady(): boolean {
    return this.isRunning
  }

  start(): void {
    this.isRunning = true
  }

  stop(): void {
    this.isRunning = false
  }
}
