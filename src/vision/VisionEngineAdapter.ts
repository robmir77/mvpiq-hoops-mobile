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
import { ENABLE_VISION_DIAGNOSTICS } from '../config/debugConfig'

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
  // YOLO: ~4-5 FPS natural → ~200-250ms between inferences → threshold 2000ms (8-10x) for hoop verification
  // MoveNet: ~3-4 FPS natural → ~250-330ms between inferences → threshold 750ms (2-3x)
  private readonly BALL_FRESHNESS_MS = 2000 // Increased from 500ms to allow older detections for hoop verification
  private readonly PLAYER_FRESHNESS_MS = 500
  private readonly RIM_FRESHNESS_MS = 500
  private readonly POSE_FRESHNESS_MS = 750

  // Phase 1 Temporal Sync: Track which channels have new observations since last processFrame
  private ballUpdated = false
  private playerUpdated = false
  private rimUpdated = false
  private poseUpdated = false

  // Version counters to distinguish updates acquired during processFrame from updates that arrived after
  private ballVersion = 0
  private playerVersion = 0
  private rimVersion = 0
  private poseVersion = 0

  private lastDiagnosticsLogAt = 0
  private processFrameCount = 0

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
      this.ballVersion += 1
    }
    if (player !== undefined) {
      this.lastPlayer = player
      this.lastPlayerTimestamp = timestamp
      this.playerUpdated = true
      this.playerVersion += 1
    }
    if (rim !== undefined) {
      this.lastRim = rim
      this.lastRimTimestamp = timestamp
      this.rimUpdated = true
      this.rimVersion += 1
    }
    if (pose !== undefined) {
      this.lastPose = pose
      this.lastPoseTimestamp = timestamp
      this.poseUpdated = true
      this.poseVersion += 1
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

    // Diagnostics are opt-in and sampled; never emit a log per frame/channel.
    this.processFrameCount += 1
    const diagnosticsNow = Date.now()
    if (ENABLE_VISION_DIAGNOSTICS && diagnosticsNow - this.lastDiagnosticsLogAt >= 2000) {
      this.lastDiagnosticsLogAt = diagnosticsNow
      const channel = (
        value: unknown,
        timestamp: number,
        age: number,
        fresh: boolean,
        updated: boolean,
        threshold: number
      ) => ({
        present: value !== null,
        timestamp: timestamp || null,
        ageMs: Number.isFinite(age) ? Math.round(age) : null,
        fresh,
        stale: value !== null && !fresh,
        updatedSinceLastProcess: updated,
        reusedCachedObservation: value !== null && !updated,
        thresholdMs: threshold,
      })
      console.log('[VISION_SYNC_DIAG]', {
        frameTimestamp: frame.timestamp,
        referenceTimestamp,
        clockDeltaMs: Math.round(diagnosticsNow - referenceTimestamp),
        processFrameCount: this.processFrameCount,
        channels: {
          ball: channel(this.lastBall, this.lastBallTimestamp, ballAge, ballFresh, this.ballUpdated, this.BALL_FRESHNESS_MS),
          player: channel(this.lastPlayer, this.lastPlayerTimestamp, playerAge, playerFresh, this.playerUpdated, this.PLAYER_FRESHNESS_MS),
          rim: channel(this.lastRim, this.lastRimTimestamp, rimAge, rimFresh, this.rimUpdated, this.RIM_FRESHNESS_MS),
          pose: channel(this.lastPose, this.lastPoseTimestamp, poseAge, poseFresh, this.poseUpdated, this.POSE_FRESHNESS_MS),
        },
      })
    }

    // Snapshot update flags and versions for this orchestration pass. Cached detections may remain
    // fresh for diagnostics, but must not be fed to tracking repeatedly as new measurements.
    // Otherwise the same timestamp/position can be consumed on multiple runtime frames
    // and distort velocity estimates (especially when another channel triggers processFrame).
    // Version counters allow us to distinguish updates that arrived during processing from
    // updates that were already present when we started.
    const ballUpdated = this.ballUpdated
    const playerUpdated = this.playerUpdated
    const rimUpdated = this.rimUpdated
    const poseUpdated = this.poseUpdated

    const ballVersionSnapshot = this.ballVersion
    const playerVersionSnapshot = this.playerVersion
    const rimVersionSnapshot = this.rimVersion
    const poseVersionSnapshot = this.poseVersion

    // Pass fresh cached detections even if not updated this frame
    // This is needed for hoop verification when YOLO is slow (~6-7 FPS)
    // and the ball passes through the hoop between YOLO inferences
    const ballForFrame = ballFresh ? this.lastBall : null
    const playerForFrame = playerFresh && playerUpdated ? this.lastPlayer : null
    const rimForFrame = rimFresh && rimUpdated ? this.lastRim : null
    const poseForFrame = poseFresh && poseUpdated ? this.lastPose : null

    const result = this.visionEngine.processFrame({
      width: frame.width,
      height: frame.height,
      timestamp: referenceTimestamp,
      data: frame.data,
      ball: ballForFrame,
      player: playerForFrame,
      rim: rimForFrame,
      pose: poseForFrame,
    })

    // Preserve acquisition timestamps only for observations actually forwarded on this pass.
    // The reference timestamp is for orchestration/freshness; it must never replace a
    // measurement timestamp used by tracking to calculate deltas.
    const resultWithObservationTimestamps = {
      ...result,
      observationTimestamps: {
        ball: ballForFrame ? this.lastBallTimestamp : null,
        player: playerForFrame ? this.lastPlayerTimestamp : null,
        rim: rimForFrame ? this.lastRimTimestamp : null,
        pose: poseForFrame ? this.lastPoseTimestamp : null,
      },
    }

    // Reset update flags only if no new updates arrived during processing
    // If the version changed, a new update arrived and we must preserve the flag
    this.ballUpdated = ballUpdated && this.ballVersion === ballVersionSnapshot ? false : this.ballUpdated
    this.playerUpdated = playerUpdated && this.playerVersion === playerVersionSnapshot ? false : this.playerUpdated
    this.rimUpdated = rimUpdated && this.rimVersion === rimVersionSnapshot ? false : this.rimUpdated
    this.poseUpdated = poseUpdated && this.poseVersion === poseVersionSnapshot ? false : this.poseUpdated

    return resultWithObservationTimestamps
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
