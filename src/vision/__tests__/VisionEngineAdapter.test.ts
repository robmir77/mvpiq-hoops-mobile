import { VisionEngineAdapter } from '../VisionEngineAdapter'

jest.mock('@/config/appConfig', () => ({
  YOLO_CONFIG: {
    BALL_CONF_THRESHOLD: 0.001,
    RIM_CONF_THRESHOLD: 0.30,
    PLAYER_CONF_THRESHOLD: 0.03,
    PLAYER_CROP_MIN_CONFIDENCE: 0.05,
    NMS_IOU_THRESHOLD: 0.4,
    PLAYER_MIN_WIDTH: 0.05,
    PLAYER_MIN_HEIGHT: 0.1,
    BALL_MAX_BBOX_SIZE: 0.15,
    ADAPTIVE_CONF: {
      ENABLED: true,
      WINDOW_SIZE: 15,
      MIN_THRESHOLD: 0.0005,
      MAX_THRESHOLD: 0.50,
      ADJUSTMENT_FACTOR: 0.2,
      HIGH_CONF_THRESHOLD: 0.7,
      LOW_CONF_THRESHOLD: 0.2,
    },
  },
}))

describe('VisionEngineAdapter temporal synchronization', () => {
  const frame = (timestamp: number) => ({ width: 1280, height: 720, timestamp })

  it('forwards the original observation timestamp to tracking', () => {
    const adapter = new VisionEngineAdapter()
    const observedAt = Date.now() - 20
    adapter.updateParsedResults(
      { x: 0.4, y: 0.5, width: 0.03, height: 0.03, confidence: 0.9 },
      undefined,
      undefined,
      undefined,
      observedAt,
    )

    const result = adapter.processFrame(frame(Date.now()))
    expect(result.ball).not.toBeNull()
    expect(result.observationTimestamps?.ball).toBe(observedAt)
  })

  it('does not forward a cached observation as a new measurement twice', () => {
    const adapter = new VisionEngineAdapter()
    const observedAt = Date.now()
    adapter.updateParsedResults(
      { x: 0.4, y: 0.5, width: 0.03, height: 0.03, confidence: 0.9 },
      undefined,
      undefined,
      undefined,
      observedAt,
    )

    const first = adapter.processFrame(frame(observedAt))
    const second = adapter.processFrame(frame(observedAt + 20))

    expect(first.ball).not.toBeNull()
    expect(first.observationTimestamps?.ball).toBe(observedAt)
    expect(second.ball).toBeNull()
    expect(second.observationTimestamps?.ball).toBeNull()
  })

  it('forwards each channel only when that channel has a new observation', () => {
    const adapter = new VisionEngineAdapter()
    const firstTimestamp = Date.now()
    adapter.updateParsedResults(
      { x: 0.4, y: 0.5, width: 0.03, height: 0.03, confidence: 0.9 },
      undefined,
      undefined,
      undefined,
      firstTimestamp,
    )
    adapter.processFrame(frame(firstTimestamp))

    const playerTimestamp = firstTimestamp + 10
    adapter.updateParsedResults(
      undefined,
      { x: 0.2, y: 0.2, width: 0.2, height: 0.5, confidence: 0.8 },
      undefined,
      undefined,
      playerTimestamp,
    )

    const result = adapter.processFrame(frame(playerTimestamp))
    expect(result.ball).toBeNull()
    expect(result.observationTimestamps?.ball).toBeNull()
    expect(result.player).not.toBeNull()
    expect(result.observationTimestamps?.player).toBe(playerTimestamp)
  })
})
