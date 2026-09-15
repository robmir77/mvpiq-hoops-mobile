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

export interface PlayerDetectionMetrics {
  framesProcessed: number
  framesDetected: number
  detectionRate: number
  avgConfidence: number
  minConfidence: number
  maxConfidence: number
  avgBboxSize: number
  bboxStability: number
}

export interface MoveNetMetrics {
  modelInput: number // 192 or 320
  inferenceTimes: number[]
  fps: number
  avgMs: number
  minMs: number
  maxMs: number
  validKeypoints: number
  avgConfidence: number
  keypointStability: number
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
  droppedBusy: number
  dropped: number
  dropRate: number
  yoloDetections: number
  ballDetections: number
  playerDetections: number
  trackingAccepted: number
  poseUpdates: number
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
  player: PlayerDetectionMetrics
  moveNet: MoveNetMetrics
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
  private playerDetections: Array<{ confidence: number; bbox: { x: number; y: number; w: number; h: number }; timestamp: number }> = []
  private moveNetInferenceTimes: number[] = []
  private moveNetModelInput: number = 320 // Default 320
  private moveNetKeypoints: Array<{ confidence: number; timestamp: number }> = []
  private falsePositives: Map<string, number> = new Map()
  private bboxHistory: Array<{ x: number; y: number; w: number; h: number; timestamp: number }> = []
  private pipelineMetrics: PipelineMetrics = {
    received: 0,
    processed: 0,
    droppedBusy: 0,
    dropped: 0,
    dropRate: 0,
    yoloDetections: 0,
    ballDetections: 0,
    playerDetections: 0,
    trackingAccepted: 0,
    poseUpdates: 0,
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

  setMoveNetModelInput(inputSize: number): void {
    this.moveNetModelInput = inputSize
    console.log('[MOVENET]', `modelInput=${inputSize}x${inputSize}`)
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

  recordPlayerDetection(confidence: number, bbox: { x: number; y: number; w: number; h: number }): void {
    this.playerDetections.push({ confidence, bbox, timestamp: Date.now() })
    // Keep only last 600 samples (20 seconds at 30fps)
    if (this.playerDetections.length > 600) {
      this.playerDetections.shift()
    }
  }

  recordMoveNetInference(inferenceTimeMs: number): void {
    this.moveNetInferenceTimes.push(inferenceTimeMs)
    // Keep only last 300 samples (10 seconds at 30fps)
    if (this.moveNetInferenceTimes.length > 300) {
      this.moveNetInferenceTimes.shift()
    }
  }

  recordMoveNetKeypoints(confidence: number): void {
    this.moveNetKeypoints.push({ confidence, timestamp: Date.now() })
    // Keep only last 300 samples (10 seconds at 30fps)
    if (this.moveNetKeypoints.length > 300) {
      this.moveNetKeypoints.shift()
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

  updatePipelineMetrics(received: number, processed: number, droppedBusy: number, trackingAccepted: number, overlayRendered: number): void {
    this.pipelineMetrics = {
      received,
      processed,
      droppedBusy,
      dropped: droppedBusy,
      dropRate: received > 0 ? (droppedBusy / received) * 100 : 0,
      yoloDetections: this.pipelineMetrics.yoloDetections,
      ballDetections: this.ballDetections.length,
      playerDetections: this.playerDetections.length,
      trackingAccepted,
      poseUpdates: this.pipelineMetrics.poseUpdates,
      overlayRendered,
    }
  }

  incrementYoloDetections(): void {
    this.pipelineMetrics.yoloDetections++
  }

  incrementPoseUpdates(): void {
    this.pipelineMetrics.poseUpdates++
  }

  logPipelineMetrics(): void {
    const m = this.pipelineMetrics
    console.log('[PIPELINE]', `received=${m.received} processed=${m.processed} droppedBusy=${m.droppedBusy} yoloDetections=${m.yoloDetections} ball=${m.ballDetections} player=${m.playerDetections} tracking=${m.trackingAccepted} pose=${m.poseUpdates} overlay=${m.overlayRendered}`)
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

  getPlayerDetectionMetrics(framesProcessed: number): PlayerDetectionMetrics {
    if (this.playerDetections.length === 0) {
      return {
        framesProcessed,
        framesDetected: 0,
        detectionRate: 0,
        avgConfidence: 0,
        minConfidence: 0,
        maxConfidence: 0,
        avgBboxSize: 0,
        bboxStability: 0,
      }
    }

    const confidences = this.playerDetections.map(d => d.confidence)
    const avgConfidence = confidences.reduce((a, b) => a + b, 0) / confidences.length
    const minConfidence = Math.min(...confidences)
    const maxConfidence = Math.max(...confidences)
    const detectionRate = (this.playerDetections.length / framesProcessed) * 100

    // Calculate average bbox size
    const bboxSizes = this.playerDetections.map(d => d.bbox.w * d.bbox.h)
    const avgBboxSize = bboxSizes.reduce((a, b) => a + b, 0) / bboxSizes.length

    // Calculate bbox stability
    if (this.playerDetections.length < 2) {
      return {
        framesProcessed,
        framesDetected: this.playerDetections.length,
        detectionRate,
        avgConfidence,
        minConfidence,
        maxConfidence,
        avgBboxSize,
        bboxStability: 100,
      }
    }

    const jumps: number[] = []
    for (let i = 1; i < this.playerDetections.length; i++) {
      const prev = this.playerDetections[i - 1].bbox
      const curr = this.playerDetections[i].bbox
      const dx = curr.x - prev.x
      const dy = curr.y - prev.y
      const jump = Math.sqrt(dx * dx + dy * dy)
      jumps.push(jump)
    }

    const avgJump = jumps.reduce((a, b) => a + b, 0) / jumps.length
    const stableJumps = jumps.filter(j => j < 30).length // 30px threshold for player
    const bboxStability = (stableJumps / jumps.length) * 100

    return {
      framesProcessed,
      framesDetected: this.playerDetections.length,
      detectionRate,
      avgConfidence,
      minConfidence,
      maxConfidence,
      avgBboxSize,
      bboxStability,
    }
  }

  logPlayerDetectionMetrics(framesProcessed: number): void {
    const metrics = this.getPlayerDetectionMetrics(framesProcessed)
    console.log('[YOLO][PLAYER]', `frames=${metrics.framesProcessed} detected=${metrics.framesDetected} detectionRate=${metrics.detectionRate.toFixed(1)}%`)
  }

  getMoveNetMetrics(): MoveNetMetrics {
    if (this.moveNetInferenceTimes.length === 0) {
      return {
        modelInput: this.moveNetModelInput,
        inferenceTimes: [],
        fps: 0,
        avgMs: 0,
        minMs: 0,
        maxMs: 0,
        validKeypoints: 0,
        avgConfidence: 0,
        keypointStability: 0,
      }
    }

    const avgMs = this.moveNetInferenceTimes.reduce((a, b) => a + b, 0) / this.moveNetInferenceTimes.length
    const minMs = Math.min(...this.moveNetInferenceTimes)
    const maxMs = Math.max(...this.moveNetInferenceTimes)
    const fps = 1000 / avgMs

    // Calculate keypoint metrics
    const validKeypoints = this.moveNetKeypoints.length
    const avgConfidence = validKeypoints > 0 
      ? this.moveNetKeypoints.map(k => k.confidence).reduce((a, b) => a + b, 0) / validKeypoints 
      : 0

    // Calculate keypoint stability
    let keypointStability = 100
    if (this.moveNetKeypoints.length > 1) {
      const confidences = this.moveNetKeypoints.map(k => k.confidence)
      const variance = confidences.reduce((sum, conf) => sum + Math.pow(conf - avgConfidence, 2), 0) / confidences.length
      const stdDev = Math.sqrt(variance)
      keypointStability = Math.max(0, 100 - (stdDev * 100)) // Lower stdDev = higher stability
    }

    return {
      modelInput: this.moveNetModelInput,
      inferenceTimes: this.moveNetInferenceTimes,
      fps,
      avgMs,
      minMs,
      maxMs,
      validKeypoints,
      avgConfidence,
      keypointStability,
    }
  }

  logMoveNetMetrics(): void {
    const metrics = this.getMoveNetMetrics()
    console.log('[MOVENET]', `modelInput=${metrics.modelInput} fps=${metrics.fps.toFixed(1)} avgMs=${metrics.avgMs.toFixed(1)} keypoints=${metrics.validKeypoints} confidence=${metrics.avgConfidence.toFixed(2)}`)
  }

  generateTestSummary(cameraFPS: number, moveNetFPS: number): TestSummary | null {
    if (!this.modelMetadata || !this.batteryMetrics) {
      console.warn('[TELEMETRY] Cannot generate summary: missing model or battery data')
      return null
    }

    const yoloPerf = this.getYoloPerfMetrics()
    const ballMetrics = this.getBallDetectionMetrics(this.pipelineMetrics.processed)
    const playerMetrics = this.getPlayerDetectionMetrics(this.pipelineMetrics.processed)
    const moveNetMetrics = this.getMoveNetMetrics()
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
      player: playerMetrics,
      moveNet: moveNetMetrics,
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

    console.log('========== MVPiQ VISION SUMMARY ==========')
    console.log('')
    console.log('[MODEL]')
    console.log(`YOLO=${summary.model.inputSize}`)
    console.log(`MoveNet=${summary.moveNet.modelInput}`)
    console.log(`delegate=${summary.model.delegate}`)
    console.log('')
    console.log('[YOLO]')
    console.log(`FPS=${summary.perf.yoloFPS.toFixed(1)}`)
    console.log(`AVG=${summary.perf.yoloAvgMs.toFixed(1)}ms`)
    console.log('')
    console.log('[BALL]')
    console.log(`DetectionRate=${summary.ball.detectionRate.toFixed(1)}%`)
    console.log(`Confidence=${summary.ball.avgConfidence.toFixed(2)}`)
    console.log(`Stability=${summary.bbox.stability.toFixed(0)}%`)
    console.log('')
    console.log('[PLAYER]')
    console.log(`DetectionRate=${summary.player.detectionRate.toFixed(1)}%`)
    console.log(`Confidence=${summary.player.avgConfidence.toFixed(2)}`)
    console.log(`Stability=${summary.player.bboxStability.toFixed(0)}%`)
    console.log('')
    console.log('[MOVENET]')
    console.log(`FPS=${summary.moveNet.fps.toFixed(1)}`)
    console.log(`AVG=${summary.moveNet.avgMs.toFixed(1)}ms`)
    console.log('')
    console.log('[PIPELINE]')
    console.log(`Received=${summary.pipeline.received}`)
    console.log(`Processed=${summary.pipeline.processed}`)
    console.log(`DroppedBusy=${summary.pipeline.droppedBusy}`)
    console.log(`YOLO Detections=${summary.pipeline.yoloDetections}`)
    console.log(`Ball=${summary.pipeline.ballDetections}`)
    console.log(`Player=${summary.pipeline.playerDetections}`)
    console.log(`Tracking=${summary.pipeline.trackingAccepted}`)
    console.log(`Pose=${summary.pipeline.poseUpdates}`)
    console.log('')
    console.log('[BATTERY]')
    console.log(`Start=${summary.battery.startLevel}%`)
    console.log(`Current=${summary.battery.endLevel}%`)
    console.log('==========================================')
  }

  exportTestSummary(cameraFPS: number, moveNetFPS: number): string {
    const summary = this.generateTestSummary(cameraFPS, moveNetFPS)
    if (!summary) return 'Error: Cannot generate summary - missing model or battery data'

    return `========== MVPiQ VISION SUMMARY ==========

[MODEL]
YOLO=${summary.model.inputSize}
MoveNet=${summary.moveNet.modelInput}
delegate=${summary.model.delegate}

[YOLO]
FPS=${summary.perf.yoloFPS.toFixed(1)}
AVG=${summary.perf.yoloAvgMs.toFixed(1)}ms

[BALL]
DetectionRate=${summary.ball.detectionRate.toFixed(1)}%
Confidence=${summary.ball.avgConfidence.toFixed(2)}
Stability=${summary.bbox.stability.toFixed(0)}%

[PLAYER]
DetectionRate=${summary.player.detectionRate.toFixed(1)}%
Confidence=${summary.player.avgConfidence.toFixed(2)}
Stability=${summary.player.bboxStability.toFixed(0)}%

[MOVENET]
FPS=${summary.moveNet.fps.toFixed(1)}
AVG=${summary.moveNet.avgMs.toFixed(1)}ms

[PIPELINE]
Received=${summary.pipeline.received}
Processed=${summary.pipeline.processed}
DroppedBusy=${summary.pipeline.droppedBusy}
YOLO Detections=${summary.pipeline.yoloDetections}
Ball=${summary.pipeline.ballDetections}
Player=${summary.pipeline.playerDetections}
Tracking=${summary.pipeline.trackingAccepted}
Pose=${summary.pipeline.poseUpdates}

[BATTERY]
Start=${summary.battery.startLevel}%
Current=${summary.battery.endLevel}%

==========================================`
  }

  reset(): void {
    this.modelMetadata = null
    this.yoloInferenceTimes = []
    this.ballDetections = []
    this.playerDetections = []
    this.moveNetInferenceTimes = []
    this.moveNetKeypoints = []
    this.falsePositives.clear()
    this.bboxHistory = []
    this.pipelineMetrics = {
      received: 0,
      processed: 0,
      droppedBusy: 0,
      dropped: 0,
      dropRate: 0,
      yoloDetections: 0,
      ballDetections: 0,
      playerDetections: 0,
      trackingAccepted: 0,
      poseUpdates: 0,
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
