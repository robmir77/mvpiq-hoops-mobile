// WorkoutVisionPipeline
// Coordinates YOLO, MoveNet, and frame processing for workout sessions
// This is a class-based wrapper around the existing useShotTracker hook
// Phase 2: Extract vision pipeline while maintaining existing behavior

import type {
  DetectionCallback,
  PoseCallback,
  ShotEventCallback,
  RimDetectionCallback,
  VisionPipelineConfig,
  VisionSharedValues,
  WorkoutVisionPipeline as IWorkoutVisionPipeline,
} from './WorkoutVisionPipeline.types'
import type { BallDetection, PoseResult, ShotEvent } from '@/vision'

export class WorkoutVisionPipeline implements IWorkoutVisionPipeline {
  private config: VisionPipelineConfig
  private ballDetectionCallbacks: Set<DetectionCallback> = new Set()
  private poseCallbacks: Set<PoseCallback> = new Set()
  private shotEventCallbacks: Set<ShotEventCallback> = new Set()
  private rimDetectionCallbacks: Set<RimDetectionCallback> = new Set()
  private sharedValues: VisionSharedValues | null = null
  private isReady: any = null
  private fpsMetrics: {
    yoloFps: any
    moveNetFps: any
    actualCameraFps: any
  } = {
    yoloFps: null,
    moveNetFps: null,
    actualCameraFps: null,
  }

  constructor(config: VisionPipelineConfig) {
    this.config = config
  }

  // Initialize the pipeline with shared values from the hook
  // This is called after the React hook initializes
  initialize(sharedValues: VisionSharedValues, isReady: any, fpsMetrics: any): void {
    this.sharedValues = sharedValues
    this.isReady = isReady
    this.fpsMetrics = fpsMetrics
  }

  start(): void {
    // Pipeline is controlled by the React hook's isActive state
    // This method is for future state machine integration
    console.log('[WorkoutVisionPipeline] Start called (delegated to hook)')
  }

  stop(): void {
    // Pipeline is controlled by the React hook's isActive state
    // This method is for future state machine integration
    console.log('[WorkoutVisionPipeline] Stop called (delegated to hook)')
  }

  getSharedValues(): VisionSharedValues {
    if (!this.sharedValues) {
      throw new Error('WorkoutVisionPipeline not initialized. Call initialize() first.')
    }
    return this.sharedValues
  }

  onBallDetection(callback: DetectionCallback): () => void {
    this.ballDetectionCallbacks.add(callback)
    return () => this.ballDetectionCallbacks.delete(callback)
  }

  onPoseResult(callback: PoseCallback): () => void {
    this.poseCallbacks.add(callback)
    return () => this.poseCallbacks.delete(callback)
  }

  onShotEvent(callback: ShotEventCallback): () => void {
    this.shotEventCallbacks.add(callback)
    return () => this.shotEventCallbacks.delete(callback)
  }

  onRimDetection(callback: RimDetectionCallback): () => void {
    this.rimDetectionCallbacks.add(callback)
    return () => this.rimDetectionCallbacks.delete(callback)
  }

  // Internal method to notify callbacks (called by the hook wrapper)
  notifyBallDetection(detection: BallDetection): void {
    this.ballDetectionCallbacks.forEach(cb => cb(detection))
  }

  notifyPoseResult(result: PoseResult): void {
    this.poseCallbacks.forEach(cb => cb(result))
  }

  notifyShotEvent(event: ShotEvent): void {
    this.shotEventCallbacks.forEach(cb => cb(event))
  }

  notifyRimDetection(rim: { x: number; y: number; width: number; height: number; confidence: number }): void {
    this.rimDetectionCallbacks.forEach(cb => cb(rim))
  }

  resetShotTracking(): void {
    // Delegated to the hook's resetShotTracking method
    console.log('[WorkoutVisionPipeline] Reset shot tracking (delegated to hook)')
  }

  isModelReady(): any {
    return this.isReady
  }

  getFpsMetrics(): {
    yoloFps: any
    moveNetFps: any
    actualCameraFps: any
  } {
    return this.fpsMetrics
  }

  updateConfig(newConfig: Partial<VisionPipelineConfig>): void {
    this.config = { ...this.config, ...newConfig }
  }
}
