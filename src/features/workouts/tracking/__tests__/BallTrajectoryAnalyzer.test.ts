// BallTrajectoryAnalyzer.test.ts
// Test per separazione palleggio / traiettoria di tiro

import { BallTrajectoryAnalyzer, BallMotionState } from '../BallTrajectoryAnalyzer'

describe('BallTrajectoryAnalyzer', () => {
  let analyzer: BallTrajectoryAnalyzer

  beforeEach(() => {
    analyzer = new BallTrajectoryAnalyzer()
  })

  describe('Motion Classification', () => {
    it('should start in IDLE state', () => {
      const result = analyzer.analyze(
        { x: 0.5, y: 0.5 },
        { vx: 0, vy: 0 },
        1000
      )

      expect(result.motionState).toBe(BallMotionState.IDLE)
    })

    it('should detect DRIBBLE from alternating motion', () => {
      const timestamp = 1000

      // Simula palleggio: su-giù-su-giù
      analyzer.analyze({ x: 0.5, y: 0.6 }, { vx: 0, vy: -0.02 }, timestamp)
      analyzer.analyze({ x: 0.5, y: 0.55 }, { vx: 0, vy: 0.02 }, timestamp + 16)
      analyzer.analyze({ x: 0.5, y: 0.6 }, { vx: 0, vy: -0.02 }, timestamp + 32)
      analyzer.analyze({ x: 0.5, y: 0.55 }, { vx: 0, vy: 0.02 }, timestamp + 48)
      analyzer.analyze({ x: 0.5, y: 0.6 }, { vx: 0, vy: -0.02 }, timestamp + 64)

      const result = analyzer.analyze(
        { x: 0.5, y: 0.55 },
        { vx: 0, vy: 0.02 },
        timestamp + 80
      )

      expect(result.motionState).toBe(BallMotionState.DRIBBLE)
    })

    it('should detect SHOT_CANDIDATE from sustained ascent', () => {
      const timestamp = 1000

      // Simula ascesa prolungata
      for (let i = 0; i < 15; i++) {
        const y = 0.6 - (i * 0.01) // Ascesa
        analyzer.analyze(
          { x: 0.5, y },
          { vx: 0, vy: -0.015 },
          timestamp + (i * 16)
        )
      }

      const result = analyzer.analyze(
        { x: 0.5, y: 0.45 },
        { vx: 0, vy: -0.015 },
        timestamp + 240
      )

      // Dopo 240ms di ascesa, dovrebbe essere almeno SHOT_CANDIDATE
      expect(result.motionState).toBe(BallMotionState.SHOT_CANDIDATE)
    })

    it('should transition to SHOT_DESCENDING after apex', () => {
      const timestamp = 1000

      // Ascesa
      for (let i = 0; i < 10; i++) {
        const y = 0.6 - (i * 0.01)
        analyzer.analyze(
          { x: 0.5, y },
          { vx: 0, vy: -0.015 },
          timestamp + (i * 16)
        )
      }

      // Discesa
      for (let i = 0; i < 5; i++) {
        const y = 0.5 + (i * 0.01)
        analyzer.analyze(
          { x: 0.5, y },
          { vx: 0, vy: 0.015 },
          timestamp + 160 + (i * 16)
        )
      }

      const result = analyzer.analyze(
        { x: 0.5, y: 0.55 },
        { vx: 0, vy: 0.015 },
        timestamp + 240
      )

      expect(result.motionState).toBe(BallMotionState.SHOT_DESCENDING)
    })
  })

  describe('Release Detection', () => {
    it('should find release candidate when ascent begins', () => {
      const timestamp = 1000

      // Movimento orizzontale poi ascesa
      analyzer.analyze({ x: 0.5, y: 0.5 }, { vx: 0.01, vy: 0 }, timestamp)
      analyzer.analyze({ x: 0.51, y: 0.5 }, { vx: 0.01, vy: 0 }, timestamp + 16)
      analyzer.analyze({ x: 0.52, y: 0.49 }, { vx: 0.01, vy: -0.01 }, timestamp + 32)
      analyzer.analyze({ x: 0.53, y: 0.48 }, { vx: 0.01, vy: -0.015 }, timestamp + 48)

      const result = analyzer.analyze(
        { x: 0.54, y: 0.47 },
        { vx: 0.01, vy: -0.015 },
        timestamp + 64
      )

      expect(result.releaseCandidate).not.toBeNull()
      expect(result.releaseCandidate?.y).toBeLessThan(0.5)
    })
  })

  describe('Apex Detection', () => {
    it('should find apex as minimum Y point', () => {
      const timestamp = 1000

      // Ascesa
      for (let i = 0; i < 10; i++) {
        const y = 0.6 - (i * 0.01)
        analyzer.analyze({ x: 0.5, y }, { vx: 0, vy: -0.015 }, timestamp + (i * 16))
      }

      // Apex
      analyzer.analyze({ x: 0.5, y: 0.5 }, { vx: 0, vy: 0 }, timestamp + 160)

      // Discesa
      for (let i = 0; i < 5; i++) {
        const y = 0.5 + (i * 0.01)
        analyzer.analyze({ x: 0.5, y }, { vx: 0, vy: 0.015 }, timestamp + 176 + (i * 16))
      }

      const result = analyzer.analyze(
        { x: 0.5, y: 0.55 },
        { vx: 0, vy: 0.015 },
        timestamp + 256
      )

      expect(result.apexCandidate).not.toBeNull()
      expect(result.apexCandidate?.y).toBeCloseTo(0.5, 2)
    })
  })

  describe('Direction Changes', () => {
    it('should count direction changes correctly', () => {
      const timestamp = 1000

      analyzer.analyze({ x: 0.5, y: 0.5 }, { vx: 0, vy: -0.01 }, timestamp)
      analyzer.analyze({ x: 0.5, y: 0.49 }, { vx: 0, vy: 0.01 }, timestamp + 16)
      analyzer.analyze({ x: 0.5, y: 0.5 }, { vx: 0, vy: -0.01 }, timestamp + 32)
      analyzer.analyze({ x: 0.5, y: 0.49 }, { vx: 0, vy: 0.01 }, timestamp + 48)

      const result = analyzer.analyze(
        { x: 0.5, y: 0.5 },
        { vx: 0, vy: -0.01 },
        timestamp + 64
      )

      // 4 cambi di direzione (up→down→up→down→up)
      expect(result.directionChanges).toBe(4)
    })

    it('should classify as DRIBBLE when direction changes exceed threshold', () => {
      const timestamp = 1000

      // Molti cambi direzione
      for (let i = 0; i < 10; i++) {
        const vy = i % 2 === 0 ? -0.01 : 0.01
        analyzer.analyze({ x: 0.5, y: 0.5 }, { vx: 0, vy }, timestamp + (i * 16))
      }

      const result = analyzer.analyze(
        { x: 0.5, y: 0.5 },
        { vx: 0, vy: -0.01 },
        timestamp + 160
      )

      expect(result.motionState).toBe(BallMotionState.DRIBBLE)
    })
  })

  describe('Motion Window', () => {
    it('should trim history to motion window', () => {
      const timestamp = 1000

      // Aggiungi punti vecchi
      for (let i = 0; i < 10; i++) {
        analyzer.analyze(
          { x: 0.5, y: 0.5 },
          { vx: 0, vy: -0.01 },
          timestamp + (i * 16)
        )
      }

      // Punti recenti
      const recentTimestamp = timestamp + 1000
      for (let i = 0; i < 5; i++) {
        analyzer.analyze(
          { x: 0.5, y: 0.5 },
          { vx: 0, vy: -0.01 },
          recentTimestamp + (i * 16)
        )
      }

      const history = analyzer.getHistory()

      // Solo punti recenti dovrebbero rimanere
      expect(history.length).toBeLessThan(15)
      expect(history[history.length - 1].timestamp).toBeGreaterThanOrEqual(recentTimestamp)
    })
  })

  describe('Reset', () => {
    it('should reset state completely', () => {
      const timestamp = 1000

      analyzer.analyze({ x: 0.5, y: 0.5 }, { vx: 0, vy: -0.01 }, timestamp)
      analyzer.analyze({ x: 0.5, y: 0.49 }, { vx: 0, vy: 0.01 }, timestamp + 16)

      analyzer.reset()

      const result = analyzer.analyze(
        { x: 0.5, y: 0.5 },
        { vx: 0, vy: -0.01 },
        timestamp + 32
      )

      expect(result.motionState).toBe(BallMotionState.IDLE)
      expect(result.directionChanges).toBe(0)
      expect(analyzer.getHistory().length).toBeLessThan(3)
    })
  })

  describe('Vertical Speed', () => {
    it('should report vertical speed correctly', () => {
      const result = analyzer.analyze(
        { x: 0.5, y: 0.5 },
        { vx: 0, vy: -0.02 },
        1000
      )

      expect(result.verticalSpeed).toBeCloseTo(0.02, 3)
    })

    it('should stay IDLE for very low speed', () => {
      const timestamp = 1000

      for (let i = 0; i < 10; i++) {
        analyzer.analyze(
          { x: 0.5, y: 0.5 },
          { vx: 0, vy: -0.001 }, // Molto lento
          timestamp + (i * 16)
        )
      }

      const result = analyzer.analyze(
        { x: 0.5, y: 0.5 },
        { vx: 0, vy: -0.001 },
        timestamp + 160
      )

      expect(result.motionState).toBe(BallMotionState.IDLE)
    })
  })

  describe('Ascending Detection', () => {
    it('should detect ascending motion correctly', () => {
      const result = analyzer.analyze(
        { x: 0.5, y: 0.5 },
        { vx: 0, vy: -0.02 },
        1000
      )

      expect(result.isAscending).toBe(true)
    })

    it('should detect descending motion correctly', () => {
      const result = analyzer.analyze(
        { x: 0.5, y: 0.5 },
        { vx: 0, vy: 0.02 },
        1000
      )

      expect(result.isAscending).toBe(false)
    })
  })
})
