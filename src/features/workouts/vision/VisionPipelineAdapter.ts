// VisionPipelineAdapter
// Phase 4.5: Adapts useWorkoutVisionPipeline hook to IVisionEngine interface
// This allows the Runtime to control the vision pipeline without depending on React
// NOTE: This is a minimal placeholder adapter. Full implementation requires integration with WorkoutVisionPipeline.

import type { IVisionEngine } from '../runtime/WorkoutSessionRuntime.types'

export class VisionPipelineAdapter implements IVisionEngine {
  private startFn: () => void
  private stopFn: () => void

  constructor(startFn: () => void, stopFn: () => void) {
    this.startFn = startFn
    this.stopFn = stopFn
  }

  start(): void {
    console.log('[VisionPipelineAdapter] Starting vision pipeline')
    this.startFn()
  }

  stop(): void {
    console.log('[VisionPipelineAdapter] Stopping vision pipeline')
    this.stopFn()
  }

  // IVisionEngine methods - placeholder implementations
  // These will be implemented when integrating with WorkoutVisionPipeline

  processFrame(_frame: {
    width: number
    height: number
    timestamp: number
    data?: Uint8Array
  }): {
    ball: { x: number; y: number; width: number; height: number; confidence: number } | null
    player: { x: number; y: number; width: number; height: number; confidence: number } | null
    rim: { x: number; y: number; width: number; height: number; confidence: number } | null
    pose: any | null
    observationTimestamps?: { ball: number | null; player: number | null; rim: number | null; pose: number | null }
    timestamp: number
  } {
    console.warn('[VisionPipelineAdapter] processFrame not implemented - returns placeholder')
    return {
      ball: null,
      player: null,
      rim: null,
      pose: null,
      timestamp: _frame.timestamp,
    }
  }

  getCurrentResults(): {
    ball: { x: number; y: number; width: number; height: number; confidence: number } | null
    player: { x: number; y: number; width: number; height: number; confidence: number } | null
    rim: { x: number; y: number; width: number; height: number; confidence: number } | null
    pose: any | null
    ballTimestamp: number
    playerTimestamp: number
    rimTimestamp: number
    poseTimestamp: number
  } {
    console.warn('[VisionPipelineAdapter] getCurrentResults not implemented - returns placeholder')
    return {
      ball: null,
      player: null,
      rim: null,
      pose: null,
      ballTimestamp: 0,
      playerTimestamp: 0,
      rimTimestamp: 0,
      poseTimestamp: 0,
    }
  }

  setBallDetectionEnabled(_enabled: boolean): void {
    console.warn('[VisionPipelineAdapter] setBallDetectionEnabled not implemented')
  }

  setPlayerDetectionEnabled(_enabled: boolean): void {
    console.warn('[VisionPipelineAdapter] setPlayerDetectionEnabled not implemented')
  }

  setRimDetectionEnabled(_enabled: boolean): void {
    console.warn('[VisionPipelineAdapter] setRimDetectionEnabled not implemented')
  }

  setPoseDetectionEnabled(_enabled: boolean): void {
    console.warn('[VisionPipelineAdapter] setPoseDetectionEnabled not implemented')
  }

  isReady(): boolean {
    console.warn('[VisionPipelineAdapter] isReady not implemented - returns false')
    return false
  }
}
