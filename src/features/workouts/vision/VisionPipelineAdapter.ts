// VisionPipelineAdapter
// Phase 4.5: Adapts useWorkoutVisionPipeline hook to IVisionPipeline interface
// This allows the Runtime to control the vision pipeline without depending on React

import type { IVisionPipeline } from '../runtime/WorkoutSessionRuntime.types'

export class VisionPipelineAdapter implements IVisionPipeline {
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
}
