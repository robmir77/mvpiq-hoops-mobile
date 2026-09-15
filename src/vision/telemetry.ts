// src/vision/telemetry.ts
//
// Structured telemetry system for model comparison
// Tracks model performance, detection quality, and system metrics

export interface ModelMetadata {
  name: string
  inputSize: number
  delegate: string
}

export interface YoloPerfMetrics {
  fps: number
  avgMs: number
  minMs: number
  maxMs: number
  samples: number
}

export interface BallDetectionMetrics {
  framesProcessed: number
  framesDetected: number
  detectionRate: number
  avgConfidence: number
  minConfidence: number
  maxConfidence: number
}

export interface FalsePositiveMetrics {
  suspicious: number
  fpRate: number
  reasons: Map<string, number>
}

export interface BboxStabilityMetrics {
  avgSize: number
  avgJump: number
  maxJump: number
  jitter: number
  stability: number
}

export interface PipelineMetrics {
  received: number
  processed: number
  dropped: number
  dropRate: number
  trackingAccepted: number
  overlayRendered: number
}

export interface BatteryMetrics {
  startLevel: number
  endLevel: number
  drain: number
  temperatureStart: number
  temperatureEnd: number
  duration: number
}

export interface DeviceMetrics {
  temperature: number
}

export interface TestSummary {
  model: ModelMetadata
  perf: {
    duration: number
    cameraFPS: number
    yoloFPS: number
    yoloAvgMs: number
    moveNetFPS: number
  }
  ball: BallDetectionMetrics
  falsePositive: FalsePositiveMetrics
  bbox: BboxStabilityMetrics
  pipeline: PipelineMetrics
  battery: BatteryMetrics
  device: DeviceMetrics
}

class TelemetryLogger {
  private modelMetadata: ModelMetadata | null = null
  private yoloInferenceTimes: number[] = []
  private ballDetections: Array<{ confidence: number; timestamp: number }> = []
  private falsePositives: Map<string, number> = new Map()
  private bboxHistory: Array<{ x: number; y: number; w: number; h: number; timestamp: number }> = []
  private pipelineMetrics: PipelineMetrics = {
    received: 0,
    processed: 0,
    dropped: 0,
    dropRate: 0,
    trackingAccepted: 0,
    overlayRendered: 0,
  }
  private batteryMetrics: BatteryMetrics | null = null
  private deviceMetrics: DeviceMetrics | null = null
  private testStartTime: number | null = null
  private testEndTime: number | null = null

  logModelMetadata(metadata: ModelMetadata): void {
    this.modelMetadata = metadata
    console.log('[MODEL]', `name=${metadata.name}`)
    console.log('[MODEL]', `input=${metadata.inputSize}x${metadata.inputSize}`)
    console.log('[MODEL]', `delegate=${metadata.delegate}`)
  }

  recordYoloInference(inferenceTimeMs: number): void {
    this.yoloInferenceTimes.push(inferenceTimeMs)
    // Keep only last 300 samples (10 seconds at 30fps)
    if (this.yoloInferenceTimes.length > 300) {
      this.yoloInferenceTimes.shift()
    }
  }

  getYoloPerfMetrics(): YoloPerfMetrics {
    if (this.yoloInferenceTimes.length === 0) {
      return { fps: 0, avgMs: 0, minMs: 0, maxMs: 0, samples: 0 }
    }

    const avgMs = this.yoloInferenceTimes.reduce((a, b) => a + b, 0) / this.yoloInferenceTimes.length
    const minMs = Math.min(...this.yoloInferenceTimes)
    const maxMs = Math.max(...this.yoloInferenceTimes)
    const fps = 1000 / avgMs

    return {
      fps,
      avgMs,
      minMs,
      maxMs,
      samples: this.yoloInferenceTimes.length,
    }
  }

  logYoloPerf(): void {
    const metrics = this.getYoloPerfMetrics()
    console.log('[PERF][YOLO]', `fps=${metrics.fps.toFixed(1)} avgMs=${metrics.avgMs.toFixed(1)} minMs=${metrics.minMs.toFixed(1)} maxMs=${metrics.maxMs.toFixed(1)}`)
  }

  recordBallDetection(confidence: number): void {
    this.ballDetections.push({ confidence, timestamp: Date.now() })
    // Keep only last 600 samples (20 seconds at 30fps)
    if (this.ballDetections.length > 600) {
      this.ballDetections.shift()
    }
  }

  recordFalsePositive(reason: string, confidence: number): void {
    const count = this.falsePositives.get(reason) || 0
    this.falsePositives.set(reason, count + 1)
    console.log('[YOLO][FP]', `reason=${reason} conf=${confidence.toFixed(2)}`)
  }

  recordBbox(x: number, y: number, w: number, h: number): void {
    this.bboxHistory.push({ x, y, w, h, timestamp: Date.now() })
    // Keep only last 300 samples (10 seconds at 30fps)
    if (this.bboxHistory.length > 300) {
      this.bboxHistory.shift()
    }
  }

  getBboxStabilityMetrics(): BboxStabilityMetrics {
    if (this.bboxHistory.length < 2) {
      return { avgSize: 0, avgJump: 0, maxJump: 0, jitter: 0, stability: 0 }
    }

    const jumps: number[] = []
    let totalSize = 0

    for (let i = 1; i < this.bboxHistory.length; i++) {
      const prev = this.bboxHistory[i - 1]
      const curr = this.bboxHistory[i]
      
      const dx = curr.x - prev.x
      const dy = curr.y - prev.y
      const jump = Math.sqrt(dx * dx + dy * dy)
      jumps.push(jump)
      
      totalSize += curr.w + curr.h
    }

    const avgSize = totalSize / (2 * this.bboxHistory.length)
    const avgJump = jumps.reduce((a, b) => a + b, 0) / jumps.length
    const maxJump = Math.max(...jumps)
    
    // Jitter = standard deviation of jumps
    const variance = jumps.reduce((sum, jump) => sum + Math.pow(jump - avgJump, 2), 0) / jumps.length
    const jitter = Math.sqrt(variance)
    
    // Stability = percentage of jumps under threshold (20px)
    const stableJumps = jumps.filter(j => j < 20).length
    const stability = (stableJumps / jumps.length) * 100

    return {
      avgSize,
      avgJump,
      maxJump,
      jitter,
      stability,
    }
  }

  logBboxStability(): void {
    const metrics = this.getBboxStabilityMetrics()
    console.log('[BBOX][STABILITY]', `avgJump=${metrics.avgJump.toFixed(1)}px maxJump=${metrics.maxJump.toFixed(1)}px jitter=${metrics.jitter.toFixed(1)}px stability=${metrics.stability.toFixed(0)}%`)
  }

  updatePipelineMetrics(received: number, processed: number, dropped: number, trackingAccepted: number, overlayRendered: number): void {
    this.pipelineMetrics = {
      received,
      processed,
      dropped,
      dropRate: processed > 0 ? (dropped / received) * 100 : 0,
      trackingAccepted,
      overlayRendered,
    }
  }

  logPipelineMetrics(): void {
    const m = this.pipelineMetrics
    console.log('[PIPELINE]', `received=${m.received} processed=${m.processed} dropped=${m.dropped} dropRate=${m.dropRate.toFixed(1)}%`)
  }

  getPipelineMetrics(): PipelineMetrics {
    return this.pipelineMetrics
  }

  startBatteryMonitoring(startLevel: number, temperature: number): void {
    this.batteryMetrics = {
      startLevel,
      endLevel: startLevel,
      drain: 0,
      temperatureStart: temperature,
      temperatureEnd: temperature,
      duration: 0,
    }
    this.deviceMetrics = { temperature }
    this.testStartTime = Date.now()
    console.log('[BATTERY]', `level=${startLevel}% temp=${temperature.toFixed(1)}C`)
  }

  endBatteryMonitoring(endLevel: number, temperature: number): void {
    if (this.batteryMetrics && this.testStartTime) {
      this.batteryMetrics.endLevel = endLevel
      this.batteryMetrics.drain = this.batteryMetrics.startLevel - endLevel
      this.batteryMetrics.temperatureEnd = temperature
      this.batteryMetrics.duration = (Date.now() - this.testStartTime) / 1000 // seconds
      
      if (this.deviceMetrics) {
        this.deviceMetrics.temperature = temperature
      }
      
      const elapsedMin = (this.batteryMetrics.duration / 60).toFixed(1)
      console.log('[BATTERY]', `level=${endLevel}% elapsed=${elapsedMin}m`)
    }
  }

  getBallDetectionMetrics(framesProcessed: number): BallDetectionMetrics {
    if (this.ballDetections.length === 0) {
      return {
        framesProcessed,
        framesDetected: 0,
        detectionRate: 0,
        avgConfidence: 0,
        minConfidence: 0,
        maxConfidence: 0,
      }
    }

    const confidences = this.ballDetections.map(d => d.confidence)
    const avgConfidence = confidences.reduce((a, b) => a + b, 0) / confidences.length
    const minConfidence = Math.min(...confidences)
    const maxConfidence = Math.max(...confidences)
    const detectionRate = (this.ballDetections.length / framesProcessed) * 100

    return {
      framesProcessed,
      framesDetected: this.ballDetections.length,
      detectionRate,
      avgConfidence,
      minConfidence,
      maxConfidence,
    }
  }

  logBallDetectionMetrics(framesProcessed: number): void {
    const metrics = this.getBallDetectionMetrics(framesProcessed)
    console.log('[YOLO][BALL]', `frames=${metrics.framesProcessed} detected=${metrics.framesDetected} detectionRate=${metrics.detectionRate.toFixed(1)}%`)
  }

  getFalsePositiveMetrics(): FalsePositiveMetrics {
    const suspicious = Array.from(this.falsePositives.values()).reduce((a, b) => a + b, 0)
    const fpRate = this.ballDetections.length > 0 ? (suspicious / this.ballDetections.length) * 100 : 0
    
    return {
      suspicious,
      fpRate,
      reasons: this.falsePositives,
    }
  }

  logFalsePositiveSummary(): void {
    const metrics = this.getFalsePositiveMetrics()
    console.log('[YOLO][SUMMARY]', `detections=${this.ballDetections.length} suspicious=${metrics.suspicious} fpRate=${metrics.fpRate.toFixed(1)}%`)
  }

  generateTestSummary(cameraFPS: number, moveNetFPS: number): TestSummary | null {
    if (!this.modelMetadata || !this.batteryMetrics) {
      console.warn('[TELEMETRY] Cannot generate summary: missing model or battery data')
      return null
    }

    const yoloPerf = this.getYoloPerfMetrics()
    const ballMetrics = this.getBallDetectionMetrics(this.pipelineMetrics.processed)
    const fpMetrics = this.getFalsePositiveMetrics()
    const bboxMetrics = this.getBboxStabilityMetrics()

    return {
      model: this.modelMetadata,
      perf: {
        duration: this.batteryMetrics.duration,
        cameraFPS,
        yoloFPS: yoloPerf.fps,
        yoloAvgMs: yoloPerf.avgMs,
        moveNetFPS,
      },
      ball: ballMetrics,
      falsePositive: fpMetrics,
      bbox: bboxMetrics,
      pipeline: this.pipelineMetrics,
      battery: this.batteryMetrics,
      device: this.deviceMetrics || { temperature: 0 },
    }
  }

  logTestSummary(cameraFPS: number, moveNetFPS: number): void {
    const summary = this.generateTestSummary(cameraFPS, moveNetFPS)
    if (!summary) return

    console.log('========== MVPiQ MODEL TEST ==========')
    console.log('')
    console.log('[MODEL]')
    console.log(`name=${summary.model.name}`)
    console.log(`input=${summary.model.inputSize}x${summary.model.inputSize}`)
    console.log(`delegate=${summary.model.delegate}`)
    console.log('')
    console.log('[PERF]')
    console.log(`duration=${summary.perf.duration.toFixed(0)}s`)
    console.log(`cameraFPS=${summary.perf.cameraFPS}`)
    console.log(`yoloFPS=${summary.perf.yoloFPS.toFixed(1)}`)
    console.log(`yoloAvgMs=${summary.perf.yoloAvgMs.toFixed(1)}`)
    console.log(`movenetFPS=${summary.perf.moveNetFPS.toFixed(1)}`)
    console.log('')
    console.log('[BALL]')
    console.log(`frames=${summary.ball.framesProcessed}`)
    console.log(`detected=${summary.ball.framesDetected}`)
    console.log(`detectionRate=${summary.ball.detectionRate.toFixed(1)}%`)
    console.log(`avgConfidence=${summary.ball.avgConfidence.toFixed(2)}`)
    console.log(`minConfidence=${summary.ball.minConfidence.toFixed(2)}`)
    console.log('')
    console.log('[FALSE_POSITIVE]')
    console.log(`suspicious=${summary.falsePositive.suspicious}`)
    console.log(`fpRate=${summary.falsePositive.fpRate.toFixed(1)}%`)
    console.log('')
    console.log('[BBOX]')
    console.log(`avgSize=${summary.bbox.avgSize.toFixed(1)}px`)
    console.log(`avgJump=${summary.bbox.avgJump.toFixed(1)}px`)
    console.log(`maxJump=${summary.bbox.maxJump.toFixed(1)}px`)
    console.log(`jitter=${summary.bbox.jitter.toFixed(1)}px`)
    console.log(`stability=${summary.bbox.stability.toFixed(0)}%`)
    console.log('')
    console.log('[PIPELINE]')
    console.log(`received=${summary.pipeline.received}`)
    console.log(`processed=${summary.pipeline.processed}`)
    console.log(`dropped=${summary.pipeline.dropped}`)
    console.log(`dropRate=${summary.pipeline.dropRate.toFixed(1)}%`)
    console.log(`trackingAccepted=${summary.pipeline.trackingAccepted}`)
    console.log('')
    console.log('[BATTERY]')
    console.log(`start=${summary.battery.startLevel}%`)
    console.log(`end=${summary.battery.endLevel}%`)
    console.log(`drain=${summary.battery.drain}%`)
    console.log(`temperatureStart=${summary.battery.temperatureStart.toFixed(1)}C`)
    console.log(`temperatureEnd=${summary.battery.temperatureEnd.toFixed(1)}C`)
    console.log('')
    console.log('[DEVICE]')
    console.log(`temp=${summary.device.temperature.toFixed(1)}C`)
    console.log('')
    console.log('=======================================')
  }

  exportTestSummary(cameraFPS: number, moveNetFPS: number): string {
    const summary = this.generateTestSummary(cameraFPS, moveNetFPS)
    if (!summary) return 'Error: Cannot generate summary - missing model or battery data'

    return `========== MVPiQ MODEL TEST ==========

[MODEL]
name=${summary.model.name}
input=${summary.model.inputSize}x${summary.model.inputSize}
delegate=${summary.model.delegate}

[PERF]
duration=${summary.perf.duration.toFixed(0)}s
cameraFPS=${summary.perf.cameraFPS}
yoloFPS=${summary.perf.yoloFPS.toFixed(1)}
yoloAvgMs=${summary.perf.yoloAvgMs.toFixed(1)}
movenetFPS=${summary.perf.moveNetFPS.toFixed(1)}

[BALL]
frames=${summary.ball.framesProcessed}
detected=${summary.ball.framesDetected}
detectionRate=${summary.ball.detectionRate.toFixed(1)}%
avgConfidence=${summary.ball.avgConfidence.toFixed(2)}
minConfidence=${summary.ball.minConfidence.toFixed(2)}

[FALSE_POSITIVE]
suspicious=${summary.falsePositive.suspicious}
fpRate=${summary.falsePositive.fpRate.toFixed(1)}%

[BBOX]
avgSize=${summary.bbox.avgSize.toFixed(1)}px
avgJump=${summary.bbox.avgJump.toFixed(1)}px
maxJump=${summary.bbox.maxJump.toFixed(1)}px
jitter=${summary.bbox.jitter.toFixed(1)}px
stability=${summary.bbox.stability.toFixed(0)}%

[PIPELINE]
received=${summary.pipeline.received}
processed=${summary.pipeline.processed}
dropped=${summary.pipeline.dropped}
dropRate=${summary.pipeline.dropRate.toFixed(1)}%
trackingAccepted=${summary.pipeline.trackingAccepted}

[BATTERY]
start=${summary.battery.startLevel}%
end=${summary.battery.endLevel}%
drain=${summary.battery.drain}%
temperatureStart=${summary.battery.temperatureStart.toFixed(1)}C
temperatureEnd=${summary.battery.temperatureEnd.toFixed(1)}C

[DEVICE]
temp=${summary.device.temperature.toFixed(1)}C

=======================================`
  }

  reset(): void {
    this.modelMetadata = null
    this.yoloInferenceTimes = []
    this.ballDetections = []
    this.falsePositives.clear()
    this.bboxHistory = []
    this.pipelineMetrics = {
      received: 0,
      processed: 0,
      dropped: 0,
      dropRate: 0,
      trackingAccepted: 0,
      overlayRendered: 0,
    }
    this.batteryMetrics = null
    this.deviceMetrics = null
    this.testStartTime = null
    this.testEndTime = null
  }
}

// Singleton instance
export const telemetryLogger = new TelemetryLogger()
