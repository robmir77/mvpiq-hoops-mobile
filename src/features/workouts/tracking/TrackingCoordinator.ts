// TrackingCoordinator
// Phase 4.2: Coordinates ball, player, hoop, and shot detection
// Pure business logic without React dependencies
// Extracted from useTrackingEngine.ts lines 345-354 and related coordination logic

interface BallPosition {
  x: number
  y: number
}

interface PlayerCenter {
  x: number
  y: number
}

interface TrackingCoordinatorConfig {
  maxPlayerBallDistance?: number  // Default: 0.35
}

export class TrackingCoordinator {
  private config: Required<TrackingCoordinatorConfig>

  constructor(config?: TrackingCoordinatorConfig) {
    this.config = {
      maxPlayerBallDistance: config?.maxPlayerBallDistance ?? 0.35,
    }
  }

  // Spatial constraint: ball should be near player when not shooting
  // Returns true if ball detection should be accepted, false if rejected
  shouldAcceptBallDetection(
    ballDetection: { x: number; y: number } | null,
    playerCenter: PlayerCenter | null,
    inFlight: boolean
  ): boolean {
    if (!ballDetection || !playerCenter || inFlight) {
      return true  // No constraint when no player or already in flight
    }

    const dx = ballDetection.x - playerCenter.x
    const dy = ballDetection.y - playerCenter.y
    const distance = Math.sqrt(dx * dx + dy * dy)

    if (distance > this.config.maxPlayerBallDistance) {
      return false  // Too far from player when not shooting
    }

    return true
  }

  // Get rejection reason for debugging
  getRejectionReason(
    ballDetection: { x: number; y: number } | null,
    playerCenter: PlayerCenter | null,
    inFlight: boolean
  ): string {
    if (!ballDetection) return 'No ball detection'
    if (!playerCenter) return 'No player center'
    if (inFlight) return ''  // No rejection when in flight

    const dx = ballDetection.x - playerCenter.x
    const dy = ballDetection.y - playerCenter.y
    const distance = Math.sqrt(dx * dx + dy * dy)

    if (distance > this.config.maxPlayerBallDistance) {
      return `Ball too far from player: ${distance.toFixed(3)} > ${this.config.maxPlayerBallDistance}`
    }

    return ''
  }

  // Calculate distance between ball and player
  calculateBallPlayerDistance(
    ballPosition: BallPosition | null,
    playerCenter: PlayerCenter | null
  ): number | null {
    if (!ballPosition || !playerCenter) return null

    const dx = ballPosition.x - playerCenter.x
    const dy = ballPosition.y - playerCenter.y
    return Math.sqrt(dx * dx + dy * dy)
  }
}
