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
  // Phase 1 Audit: Separate timestamps per channel to avoid mixing observations of different ages
  private lastBallTimestamp: number = 0
  private lastPlayerTimestamp: number = 0
  private lastRimTimestamp: number = 0
  private lastPoseTimestamp: number = 0
  private isRunning = false

  // Phase 1 Temporal Sync: Freshness thresholds based on natural worker frequencies
  // YOLO: ~4-5 FPS natural → ~200-250ms between inferences → threshold 500ms (2-3x)
  // MoveNet: ~3-4 FPS natural → ~250-330ms between inferences → threshold 750ms (2-3x)
  private readonly BALL_FRESHNESS_MS = 500
  private readonly PLAYER_FRESHNESS_MS = 500
  private readonly RIM_FRESHNESS_MS = 500
  private readonly POSE_FRESHNESS_MS = 750

  // Phase 1 Temporal Sync: Track which channels have new observations since last processFrame
  private ballUpdated = false
  private playerUpdated = false
  private rimUpdated = false
  private poseUpdated = false

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
    if (ball !== undefined) {
      this.lastBall = ball
      this.lastBallTimestamp = timestamp
      this.ballUpdated = true
    }
    if (player !== undefined) {
      this.lastPlayer = player
      this.lastPlayerTimestamp = timestamp
      this.playerUpdated = true
    }
    if (rim !== undefined) {
      this.lastRim = rim
      this.lastRimTimestamp = timestamp
      this.rimUpdated = true
    }
    if (pose !== undefined) {
      this.lastPose = pose
      this.lastPoseTimestamp = timestamp
      this.poseUpdated = true
    }
  }

  // Get current parsed results for Runtime integration
  // Phase 1 Audit: Returns separate timestamps per channel and freshness info
  getCurrentResults(): {
    ball: BallDetection | null
    player: PlayerDetection | null
    rim: RimDetection | null
    pose: PoseResult | null
    ballTimestamp: number
    playerTimestamp: number
    rimTimestamp: number
    poseTimestamp: number
  } {
    return {
      ball: this.lastBall,
      player: this.lastPlayer,
      rim: this.lastRim,
      pose: this.lastPose,
      ballTimestamp: this.lastBallTimestamp,
      playerTimestamp: this.lastPlayerTimestamp,
      rimTimestamp: this.lastRimTimestamp,
      poseTimestamp: this.lastPoseTimestamp,
    }
  }

  processFrame(frame: {
    width: number
    height: number
    timestamp: number
    data?: Uint8Array
  }): VisionEngineResult {
    // Phase 1 Temporal Sync: Check freshness of each channel before passing to VisionEngine
    const referenceTimestamp = Math.max(
      this.lastBallTimestamp,
      this.lastPlayerTimestamp,
      this.lastRimTimestamp,
      this.lastPoseTimestamp,
      frame.timestamp
    )

    // Calculate age of each observation
    const ballAge = this.lastBallTimestamp > 0 ? referenceTimestamp - this.lastBallTimestamp : Infinity
    const playerAge = this.lastPlayerTimestamp > 0 ? referenceTimestamp - this.lastPlayerTimestamp : Infinity
    const rimAge = this.lastRimTimestamp > 0 ? referenceTimestamp - this.lastRimTimestamp : Infinity
    const poseAge = this.lastPoseTimestamp > 0 ? referenceTimestamp - this.lastPoseTimestamp : Infinity

    // Filter stale observations
    const ballFresh = ballAge < this.BALL_FRESHNESS_MS
    const playerFresh = playerAge < this.PLAYER_FRESHNESS_MS
    const rimFresh = rimAge < this.RIM_FRESHNESS_MS
    const poseFresh = poseAge < this.POSE_FRESHNESS_MS

    // Phase 1 Temporal Sync: Log diagnostics for age and freshness (throttled to avoid noise)
    if (this.lastBall && !ballFresh && this.ballUpdated) {
      console.log('[VisionEngineAdapter] Ball observation stale:', {
        age: ballAge.toFixed(0) + 'ms',
        threshold: this.BALL_FRESHNESS_MS + 'ms',
        timestamp: this.lastBallTimestamp,
        reference: referenceTimestamp,
      })
    }
    if (this.lastPlayer && !playerFresh && this.playerUpdated) {
      console.log('[VisionEngineAdapter] Player observation stale:', {
        age: playerAge.toFixed(0) + 'ms',
        threshold: this.PLAYER_FRESHNESS_MS + 'ms',
        timestamp: this.lastPlayerTimestamp,
        reference: referenceTimestamp,
      })
    }
    if (this.lastRim && !rimFresh && this.rimUpdated) {
      console.log('[VisionEngineAdapter] Rim observation stale:', {
        age: rimAge.toFixed(0) + 'ms',
        threshold: this.RIM_FRESHNESS_MS + 'ms',
        timestamp: this.lastRimTimestamp,
        reference: referenceTimestamp,
      })
    }
    if (this.lastPose && !poseFresh && this.poseUpdated) {
      console.log('[VisionEngineAdapter] Pose observation stale:', {
        age: poseAge.toFixed(0) + 'ms',
        threshold: this.POSE_FRESHNESS_MS + 'ms',
        timestamp: this.lastPoseTimestamp,
        reference: referenceTimestamp,
      })
    }

    // Pass only fresh observations to VisionEngine
    // Phase 1 Temporal Sync: Use updated flags to distinguish new observations from cached ones
    const result = this.visionEngine.processFrame({
      width: frame.width,
      height: frame.height,
      timestamp: referenceTimestamp,
      data: frame.data,
      ball: ballFresh ? this.lastBall : null,
      player: playerFresh ? this.lastPlayer : null,
      rim: rimFresh ? this.lastRim : null,
      pose: poseFresh ? this.lastPose : null,
    })

    // Reset update flags after processing
    this.ballUpdated = false
    this.playerUpdated = false
    this.rimUpdated = false
    this.poseUpdated = false

    return result
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
