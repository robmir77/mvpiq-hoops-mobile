// ShotDetectionUIAdapter
// Phase 4.2: UI adapter for ShotDetectionEngine
// Bridges pure business logic (ShotDetectionEngine) to React Native Reanimated SharedValues
// This hook should be used in the Screen to sync engine state with UI

import { useSharedValue } from 'react-native-reanimated'
import { ShotDetectionEngine } from './ShotDetectionEngine'

export class ShotDetectionUIAdapter {
  private engine: ShotDetectionEngine

  // Shared values for overlay
  public readonly inFlightShared = useSharedValue(false)
  public readonly shotDetectedShared = useSharedValue(false)
  public readonly showShotTrail = useSharedValue(false)
  public readonly shotResultShared = useSharedValue<string | null>(null)
  public readonly releasePointX = useSharedValue(0)
  public readonly releasePointY = useSharedValue(0)
  public readonly apexPointX = useSharedValue(0)
  public readonly apexPointY = useSharedValue(0)

  // Trajectory shared values (flat array: [x1, y1, x2, y2, ...])
  private readonly MAX_POINTS = 90
  public readonly trajectoryPoints = useSharedValue(new Float32Array(this.MAX_POINTS * 2).fill(0))
  public readonly trajectoryPointCount = useSharedValue(0)

  constructor(engine: ShotDetectionEngine) {
    this.engine = engine
  }

  // Sync SharedValues with engine state (call this every frame or when state changes)
  sync(): void {
    const state = this.engine.getState()
    
    this.inFlightShared.value = state.inFlight
    this.shotDetectedShared.value = state.shotDetected
    this.shotResultShared.value = state.shotResult
    
    if (state.releasePoint) {
      this.releasePointX.value = state.releasePoint.x
      this.releasePointY.value = state.releasePoint.y
    }
    
    if (state.apexPoint) {
      this.apexPointX.value = state.apexPoint.x
      this.apexPointY.value = state.apexPoint.y
    }

    // Update trajectory when inFlight
    if (state.inFlight) {
      this.updateTrajectorySharedValues()
    }
  }

  // Reset SharedValues when shot is reset
  reset(): void {
    this.inFlightShared.value = false
    this.showShotTrail.value = false
    this.shotDetectedShared.value = false
    this.shotResultShared.value = null
    this.releasePointX.value = 0
    this.releasePointY.value = 0
    this.apexPointX.value = 0
    this.apexPointY.value = 0
    this.trajectoryPoints.value = new Float32Array(this.MAX_POINTS * 2).fill(0)
    this.trajectoryPointCount.value = 0
  }

  private updateTrajectorySharedValues(): void {
    const traj = this.engine.getTrajectoryPoints()
    const points = this.trajectoryPoints.value
    for (let i = 0; i < Math.min(traj.length, this.MAX_POINTS); i++) {
      points[i * 2] = traj[i].x
      points[i * 2 + 1] = traj[i].y
    }
    this.trajectoryPoints.value = points
    this.trajectoryPointCount.value = traj.length
  }
}
