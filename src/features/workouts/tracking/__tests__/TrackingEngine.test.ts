// TrackingEngine Tests
// Tests for PlayerDetection integration

import { TrackingEngine } from '../TrackingEngine'

describe('TrackingEngine - PlayerDetection', () => {
  it('should update PlayerTrackingEngine from YOLO player detection', () => {
    const trackingEngine = new TrackingEngine()

    const playerDetection = {
      x: 0.3,
      y: 0.4,
      width: 0.2,
      height: 0.5,
      confidence: 0.85,
    }

    const ballDetection = {
      x: 0.5,
      y: 0.5,
      width: 0.05,
      height: 0.05,
      confidence: 0.9,
    }

    const frameTs = Date.now()

    // Process frame with player detection
    trackingEngine.processFrame(
      ballDetection,
      null,
      frameTs,
      undefined, // pose
      undefined, // sizeCategory
      undefined, // adaptThreshold
      undefined, // rejectedBall
      playerDetection
    )

    const state = trackingEngine.getState()
    const playerState = trackingEngine.getComparisonStats().player

    // Verify player state was updated
    expect(playerState).toBeDefined()
    expect(playerState.x).toBe(playerDetection.x)
    expect(playerState.y).toBe(playerDetection.y)
    expect(playerState.width).toBe(playerDetection.width)
    expect(playerState.height).toBe(playerDetection.height)
    expect(playerState.confidence).toBe(playerDetection.confidence)
  })

  it('should use YOLO bbox center when pose is not available', () => {
    const trackingEngine = new TrackingEngine()

    const playerDetection = {
      x: 0.3,
      y: 0.4,
      width: 0.2,
      height: 0.5,
      confidence: 0.85,
    }

    const ballDetection = {
      x: 0.5,
      y: 0.5,
      width: 0.05,
      height: 0.05,
      confidence: 0.9,
    }

    const frameTs = Date.now()

    // Process frame with player detection but no pose
    trackingEngine.processFrame(
      ballDetection,
      null,
      frameTs,
      undefined, // pose
      undefined, // sizeCategory
      undefined, // adaptThreshold
      undefined, // rejectedBall
      playerDetection
    )

    const state = trackingEngine.getState()

    // Ball should be processed (spatial constraints use player center)
    expect(state.ballPosition).toBeDefined()
  })

  it('should prioritize pose over YOLO bbox for player center', () => {
    const trackingEngine = new TrackingEngine()

    const playerDetection = {
      x: 0.3,
      y: 0.4,
      width: 0.2,
      height: 0.5,
      confidence: 0.85,
    }

    const poseKeypoints = {
      leftHip: { x: 0.35, y: 0.45 },
      rightHip: { x: 0.45, y: 0.45 },
    }

    const ballDetection = {
      x: 0.5,
      y: 0.5,
      width: 0.05,
      height: 0.05,
      confidence: 0.9,
    }

    const frameTs = Date.now()

    // Process frame with both player detection and pose
    trackingEngine.processFrame(
      ballDetection,
      null,
      frameTs,
      poseKeypoints,
      undefined, // sizeCategory
      undefined, // adaptThreshold
      undefined, // rejectedBall
      playerDetection
    )

    const state = trackingEngine.getState()
    const playerState = trackingEngine.getComparisonStats().player

    // Player state should be updated from YOLO bbox
    expect(playerState.x).toBe(playerDetection.x)
    expect(playerState.y).toBe(playerDetection.y)

    // Ball should be processed (pose center used for spatial constraints)
    expect(state.ballPosition).toBeDefined()
  })

  it('should handle null player detection gracefully', () => {
    const trackingEngine = new TrackingEngine()

    const ballDetection = {
      x: 0.5,
      y: 0.5,
      width: 0.05,
      height: 0.05,
      confidence: 0.9,
    }

    const frameTs = Date.now()

    // Process frame without player detection
    trackingEngine.processFrame(
      ballDetection,
      null,
      frameTs,
      undefined, // pose
      undefined, // sizeCategory
      undefined, // adaptThreshold
      undefined, // rejectedBall
      undefined // playerDetection
    )

    const state = trackingEngine.getState()

    // Ball should still be processed
    expect(state.ballPosition).toBeDefined()
  })
})
