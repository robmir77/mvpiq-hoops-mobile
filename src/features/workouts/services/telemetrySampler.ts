interface TelemetrySamplerOptions {
  sampleIntervalMs: number // Default 500ms for 2 Hz
}

class TelemetrySampler {
  private sampleIntervalMs: number
  private lastSampleTime: number = 0
  private pendingSample: any = null

  constructor(options: TelemetrySamplerOptions = { sampleIntervalMs: 500 }) {
    this.sampleIntervalMs = options.sampleIntervalMs
  }

  /**
   * Check if a new sample should be taken based on time interval
   * @returns true if should sample, false otherwise
   */
  shouldSample(timestamp: number): boolean {
    if (timestamp - this.lastSampleTime >= this.sampleIntervalMs) {
      this.lastSampleTime = timestamp
      return true
    }
    return false
  }

  /**
   * Reset the sampler (e.g., when session starts)
   */
  reset(): void {
    this.lastSampleTime = 0
    this.pendingSample = null
  }

  /**
   * Get the last sample time
   */
  getLastSampleTime(): number {
    return this.lastSampleTime
  }

  /**
   * Set sample interval dynamically
   */
  setSampleInterval(intervalMs: number): void {
    this.sampleIntervalMs = intervalMs
  }
}

export { TelemetrySampler }
