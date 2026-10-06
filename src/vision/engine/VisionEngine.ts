// VisionEngine
// Pure class for vision processing orchestration (YOLO + MoveNet)
// Worklet-safe, no React dependencies
// Implements IVisionEngine interface

import type { IVisionEngine, VisionEngineResult, BallDetection, PlayerDetection, RimDetection, PoseResult } from '../VisionEngine.types'
import { YoloDetector, type YoloResult } from './YoloDetector'
import { MoveNetPoseEstimator, type PoseResult as MoveNetPoseResult } from './MoveNetPoseEstimator'
import { BallDetectionProcessor } from './BallDetectionProcessor'

export class VisionEngine implements IVisionEngine {
  private yoloDetector: YoloDetector
  private moveNetEstimator: MoveNetPoseEstimator
  private ballProcessor: BallDetectionProcessor

  private ballDetectionEnabled: boolean = true
  private playerDetectionEnabled: boolean = true
  private rimDetectionEnabled: boolean = true
  private poseDetectionEnabled: boolean = true

  private ready: boolean = false

  constructor(
    ballConfThreshold?: number,
    rimConfThreshold?: number,
    poseScoreThreshold?: number
  ) {
    this.yoloDetector = new YoloDetector(ballConfThreshold, rimConfThreshold)
    this.moveNetEstimator = new MoveNetPoseEstimator(poseScoreThreshold)
    this.ballProcessor = new BallDetectionProcessor()
    this.ready = true
  }

  // Process a frame and return detection results
  // Worklet-safe - marked with 'worklet' directive for Reanimated
  // Accepts either raw model outputs OR already-parsed results from workers
  // Workers do inference + parsing (due to React Native dependencies)
  // VisionEngine forwards parsed results to maintain single responsibility
  processFrame(frame: {
    width: number
    height: number
    timestamp: number
    data?: Uint8Array
    yoloOutput?: Float32Array
    moveNetOutput?: Float32Array
    // Parsed results from workers (alternative to raw outputs)
    ball?: BallDetection | null
    player?: PlayerDetection | null
    rim?: RimDetection | null
    pose?: PoseResult | null
  }): VisionEngineResult {
    'worklet'

    const result: VisionEngineResult = {
      ball: null,
      player: null,
      rim: null,
      pose: null,
      timestamp: frame.timestamp,
    }

    // Priority 1: Use already-parsed results from workers (current path)
    // Workers do inference + parsing using YoloDetector/MoveNetPoseEstimator
    // VisionEngine forwards these results without re-parsing
    if (frame.ball !== undefined || frame.player !== undefined || frame.rim !== undefined) {
      if (this.ballDetectionEnabled && frame.ball) {
        result.ball = frame.ball
      }
      if (this.playerDetectionEnabled && frame.player) {
        result.player = frame.player
      }
      if (this.rimDetectionEnabled && frame.rim) {
        result.rim = frame.rim
      }
    }
    // Priority 2: Parse raw outputs (fallback for future pure implementation)
    else if (frame.yoloOutput) {
      const yoloResult: YoloResult = this.yoloDetector.parseOutput(
        frame.yoloOutput,
        frame.width,
        frame.height
      )

      if (this.ballDetectionEnabled && yoloResult.ball) {
        const ballProcessed = this.ballProcessor.processDetection(
          yoloResult.ball
        )
        result.ball = ballProcessed.detection
      }

      if (this.playerDetectionEnabled && yoloResult.player) {
        result.player = yoloResult.player
      }

      if (this.rimDetectionEnabled && yoloResult.rim) {
        result.rim = yoloResult.rim
      }
    }

    // Pose: use parsed result from worker or parse raw output
    if (this.poseDetectionEnabled) {
      if (frame.pose) {
        result.pose = frame.pose
      } else if (frame.moveNetOutput) {
        const poseResult: MoveNetPoseResult = this.moveNetEstimator.parseOutput(
          frame.moveNetOutput
        )

        // Convert MoveNetPoseResult to PoseResult interface
        const keypointsArray = Object.values(poseResult.keypoints).map(kp => ({
          x: kp.x,
          y: kp.y,
          confidence: kp.confidence,
        }))

        result.pose = {
          keypoints: keypointsArray,
          confidence: poseResult.confidence,
        }
      }
    }

    return result
  }

  // Enable/disable specific detection modules
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

  // Get current state
  isReady(): boolean {
    return this.ready
  }

  // Lifecycle
  start(): void {
    this.ready = true
  }

  stop(): void {
    this.ready = false
  }

  // Configuration methods
  setBallConfThreshold(threshold: number): void {
    this.yoloDetector.setBallConfThreshold(threshold)
  }

  setRimConfThreshold(threshold: number): void {
    this.yoloDetector.setRimConfThreshold(threshold)
  }

  setPoseScoreThreshold(threshold: number): void {
    this.moveNetEstimator.setScoreThreshold(threshold)
  }
}
