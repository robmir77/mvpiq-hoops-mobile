import { TelemetrySampler } from '../services/telemetrySampler'

describe('TelemetrySampler', () => {
  let sampler: TelemetrySampler

  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  describe('constructor', () => {
    it('should initialize with default 500ms interval (2 Hz)', () => {
      sampler = new TelemetrySampler()
      expect(sampler.getLastSampleTime()).toBe(0)
    })

    it('should initialize with custom interval', () => {
      sampler = new TelemetrySampler({ sampleIntervalMs: 1000 })
      expect(sampler.getLastSampleTime()).toBe(0)
    })
  })

  describe('shouldSample', () => {
    it('should return true on first sample', () => {
      sampler = new TelemetrySampler({ sampleIntervalMs: 500 })
      const timestamp = 1000

      const result = sampler.shouldSample(timestamp)

      expect(result).toBe(true)
      expect(sampler.getLastSampleTime()).toBe(timestamp)
    })

    it('should return false if interval has not elapsed', () => {
      sampler = new TelemetrySampler({ sampleIntervalMs: 500 })
      const firstTimestamp = 1000
      sampler.shouldSample(firstTimestamp)

      const secondTimestamp = 1200 // Only 200ms elapsed
      const result = sampler.shouldSample(secondTimestamp)

      expect(result).toBe(false)
      expect(sampler.getLastSampleTime()).toBe(firstTimestamp) // Not updated
    })

    it('should return true if interval has elapsed', () => {
      sampler = new TelemetrySampler({ sampleIntervalMs: 500 })
      const firstTimestamp = 1000
      sampler.shouldSample(firstTimestamp)

      const secondTimestamp = 1600 // 600ms elapsed (more than 500ms)
      const result = sampler.shouldSample(secondTimestamp)

      expect(result).toBe(true)
      expect(sampler.getLastSampleTime()).toBe(secondTimestamp) // Updated
    })

    it('should sample at exactly 2 Hz with 500ms interval', () => {
      sampler = new TelemetrySampler({ sampleIntervalMs: 500 })
      const timestamps = [1000, 1500, 2000, 2500, 3000]

      const results = timestamps.map(t => sampler.shouldSample(t))

      expect(results).toEqual([true, true, true, true, true])
    })

    it('should sample at 1 Hz with 1000ms interval', () => {
      sampler = new TelemetrySampler({ sampleIntervalMs: 1000 })
      const timestamps = [1000, 1200, 1500, 2000, 2500, 3000]

      const results = timestamps.map(t => sampler.shouldSample(t))

      expect(results).toEqual([true, false, false, true, false, true])
    })

    it('should sample at 4 Hz with 250ms interval', () => {
      sampler = new TelemetrySampler({ sampleIntervalMs: 250 })
      const timestamps = [1000, 1250, 1500, 1750, 2000]

      const results = timestamps.map(t => sampler.shouldSample(t))

      expect(results).toEqual([true, true, true, true, true])
    })

    it('should handle timestamp 0 correctly', () => {
      sampler = new TelemetrySampler({ sampleIntervalMs: 500 })

      const result = sampler.shouldSample(0)

      expect(result).toBe(true)
    })

    it('should handle negative timestamps', () => {
      sampler = new TelemetrySampler({ sampleIntervalMs: 500 })

      const result = sampler.shouldSample(-1000)

      expect(result).toBe(true)
    })
  })

  describe('reset', () => {
    it('should reset last sample time to 0', () => {
      sampler = new TelemetrySampler({ sampleIntervalMs: 500 })
      sampler.shouldSample(1000)

      sampler.reset()

      expect(sampler.getLastSampleTime()).toBe(0)
    })

    it('should allow sampling immediately after reset', () => {
      sampler = new TelemetrySampler({ sampleIntervalMs: 500 })
      sampler.shouldSample(1000)

      sampler.reset()

      const result = sampler.shouldSample(1100) // Only 100ms after reset
      expect(result).toBe(true)
    })
  })

  describe('getLastSampleTime', () => {
    it('should return 0 initially', () => {
      sampler = new TelemetrySampler()
      expect(sampler.getLastSampleTime()).toBe(0)
    })

    it('should return last sample timestamp after sampling', () => {
      sampler = new TelemetrySampler({ sampleIntervalMs: 500 })
      sampler.shouldSample(1000)

      expect(sampler.getLastSampleTime()).toBe(1000)
    })

    it('should not update if sampling was rejected', () => {
      sampler = new TelemetrySampler({ sampleIntervalMs: 500 })
      sampler.shouldSample(1000)
      sampler.shouldSample(1200) // Rejected

      expect(sampler.getLastSampleTime()).toBe(1000)
    })
  })

  describe('setSampleInterval', () => {
    it('should change sample interval dynamically', () => {
      sampler = new TelemetrySampler({ sampleIntervalMs: 500 })
      sampler.shouldSample(1000)

      sampler.setSampleInterval(1000)

      const result = sampler.shouldSample(1400) // 400ms elapsed (old interval would reject)
      expect(result).toBe(false) // New interval is 1000ms

      const result2 = sampler.shouldSample(2000) // 1000ms elapsed
      expect(result2).toBe(true)
    })

    it('should allow increasing sampling rate', () => {
      sampler = new TelemetrySampler({ sampleIntervalMs: 1000 })
      sampler.shouldSample(1000)

      sampler.setSampleInterval(250) // 4 Hz

      const result = sampler.shouldSample(1250) // 250ms elapsed
      expect(result).toBe(true)
    })

    it('should allow decreasing sampling rate', () => {
      sampler = new TelemetrySampler({ sampleIntervalMs: 250 })
      sampler.shouldSample(1000)

      sampler.setSampleInterval(1000) // 1 Hz

      const result = sampler.shouldSample(1200) // 200ms elapsed
      expect(result).toBe(false)
    })
  })

  describe('edge cases', () => {
    it('should handle very small intervals', () => {
      sampler = new TelemetrySampler({ sampleIntervalMs: 10 })
      const timestamps = [1000, 1010, 1020, 1030]

      const results = timestamps.map(t => sampler.shouldSample(t))

      expect(results).toEqual([true, true, true, true])
    })

    it('should handle very large intervals', () => {
      sampler = new TelemetrySampler({ sampleIntervalMs: 10000 })
      sampler.shouldSample(1000)

      const result = sampler.shouldSample(5000) // 4000ms elapsed
      expect(result).toBe(false)

      const result2 = sampler.shouldSample(11000) // 10000ms elapsed
      expect(result2).toBe(true)
    })

    it('should handle non-monotonic timestamps', () => {
      sampler = new TelemetrySampler({ sampleIntervalMs: 500 })
      sampler.shouldSample(1000)

      const result = sampler.shouldSample(900) // Timestamp went backwards
      expect(result).toBe(true) // Should still sample
      expect(sampler.getLastSampleTime()).toBe(900)
    })
  })

  describe('real-world scenarios', () => {
    it('should simulate 2 Hz sampling over 5 seconds', () => {
      sampler = new TelemetrySampler({ sampleIntervalMs: 500 })
      const timestamps = []
      
      for (let i = 0; i <= 5000; i += 100) {
        if (sampler.shouldSample(i)) {
          timestamps.push(i)
        }
      }

      expect(timestamps).toEqual([0, 500, 1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000])
      expect(timestamps.length).toBe(11) // 11 samples in 5 seconds at 2 Hz
    })

    it('should handle variable frame rates', () => {
      sampler = new TelemetrySampler({ sampleIntervalMs: 500 })
      
      // Simulate variable frame timing (not perfectly regular)
      const frameTimestamps = [1000, 1033, 1067, 1100, 1133, 1167, 1200, 1233, 1267, 1300, 1500]
      const sampleTimestamps = frameTimestamps.filter(t => sampler.shouldSample(t))

      expect(sampleTimestamps).toEqual([1000, 1500])
    })

    it('should maintain sampling rate after reset', () => {
      sampler = new TelemetrySampler({ sampleIntervalMs: 500 })
      
      sampler.shouldSample(1000)
      sampler.shouldSample(1500)
      
      sampler.reset()
      
      sampler.shouldSample(2000)
      sampler.shouldSample(2500)

      expect(sampler.getLastSampleTime()).toBe(2500)
    })
  })
})
