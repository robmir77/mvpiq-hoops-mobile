// Structured telemetry system for model comparison and performance tracking

export interface ModelMetadata {
  name: string
  inputSize: number
  delegate: string
}

export interface DiagnosticWindowSnapshot {
  windowMs: number
  cameraFps: number
  received: number
  processed: number
  droppedBusy: number
  onFrameAvgMs: number
  onFrameMaxMs: number
  yoloRequested: number
  yoloExecuted: number
  yoloSkipped: number
  yoloThroughputFps: number
  yoloAvgMs: number
  yoloMinMs: number
  yoloMaxMs: number
  yoloScheduleWaitMs: number
  yoloScheduleWaitP50: number
  yoloScheduleWaitP95: number
  yoloScheduleWaitP99: number
  yoloWorkletPrepAvgMs: number
  yoloJsPreprocessAvgMs: number
  yoloInferenceAvgMs: number
  yoloPostprocessAvgMs: number
  yoloResizeAvgMs: number
  yoloRunAvgMs: number
  yoloParseAvgMs: number
  moveNetRequested: number
  moveNetExecuted: number
  moveNetSkipped: number
  moveNetThroughputFps: number
  moveNetAvgMs: number
  moveNetMinMs: number
  moveNetMaxMs: number
  moveNetWorkletPrepMs: number
  moveNetScheduleWaitMs: number
  moveNetScheduleWaitP50: number
  moveNetScheduleWaitP95: number
  moveNetScheduleWaitP99: number
  moveNetCropAvgMs: number
  // moveNetResizeAvgMs removed - resize is now included in jsPreprocessMs
  moveNetQuantizationAvgMs: number
  moveNetRunAvgMs: number
  moveNetParseAvgMs: number
}

export interface YoloPerfMetrics {
  throughputFps: number  // Actual inferences per second
  theoreticalFps: number  // 1000 / avgInferenceTime (latency capacity)
  avgMs: number
  minMs: number
  maxMs: number
  samples: number
  requested: number
  executed: number
  skipped: number
  scheduleWaitMs: number
  scheduleWaitP50: number
  scheduleWaitP95: number
  scheduleWaitP99: number
  resizeMs: number
  runMs: number
  parseMs: number
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
  modelInput: number
  inferenceTimes: number[]
  throughputFps: number  // Actual inferences per second
  theoreticalFps: number  // 1000 / avgInferenceTime (latency capacity)
  avgMs: number
  minMs: number
  maxMs: number
  validKeypoints: number
  avgConfidence: number
  keypointStability: number
  requested: number
  executed: number
  skipped: number
  workletPrepMs: number  // Time from worklet start to scheduleOnRN
  cropMs: number
  resizeMs: number
  quantizationMs: number  // Float32 to uint8/int8 conversion time
  runMs: number
  parseMs: number
  scheduleWaitMs: number  // Time from scheduleOnRN to actual execution
  scheduleWaitP50: number
  scheduleWaitP95: number
  scheduleWaitP99: number
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
  cameraFPS: number
  received: number
  processed: number
  droppedBusy: number
  dropped: number
  dropRate: number
  yoloExecuted: number  // Total YOLO executions
  framesWithBall: number  // Unique frames where ball was detected
  framesWithPlayer: number  // Unique frames where player was detected
  trackingAccepted: number
  poseUpdates: number
  overlayRendered: number // Deprecated: Skia renders at camera FPS, not tracked separately
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
  private ballDetections: Array<{ confidence: number; timestamp: number }> = []
  private playerDetections: Array<{ confidence: number; bbox: { x: number; y: number; w: number; h: number }; timestamp: number }> = []
  private moveNetInferenceTimes: number[] = []
  private moveNetModelInput: number = 192
  private moveNetKeypoints: Array<{ confidence: number; timestamp: number }> = []
  private falsePositives: Map<string, number> = new Map()
  private bboxHistory: Array<{ x: number; y: number; w: number; h: number; timestamp: number }> = []
  
  // Helper function to calculate percentiles
  private calculatePercentile(values: number[], percentile: number): number {
    if (values.length === 0) return 0
    const sorted = [...values].sort((a, b) => a - b)
    const index = Math.ceil((percentile / 100) * sorted.length) - 1
    return sorted[Math.max(0, index)]
  }
  private pipelineMetrics: PipelineMetrics = {
    cameraFPS: 0,
    received: 0,
    processed: 0,
    droppedBusy: 0,
    dropped: 0,
    dropRate: 0,
    yoloExecuted: 0,
    framesWithBall: 0,
    framesWithPlayer: 0,
    trackingAccepted: 0,
    poseUpdates: 0,
    overlayRendered: 0,
  }
  private yoloProcessedFramesCount: number = 0
  private batteryMetrics: BatteryMetrics | null = null
  private deviceMetrics: DeviceMetrics | null = null
  private testStartTime: number | null = null
  private testEndTime: number | null = null
  
  // Granular YOLO metrics
  private yoloRequested: number = 0
  private yoloExecuted: number = 0
  private yoloStartTime: number | null = null
  private yoloScheduleWaitTimes: number[] = []
  private yoloResizeTimes: number[] = []
  private yoloRunTimes: number[] = []
  private yoloParseTimes: number[] = []
  
  // Detailed YOLO pipeline A→F timestamps (for schedule wait analysis)
  // Pipeline: WORKLET(A→B) → rnScheduleWait(B→C) → JS/RN(C→D→E→F)
  private yoloWorkletPrepTimes: number[] = []  // A→B: worklet preprocessing (resize + buffer extraction)
  private yoloJsPreprocessTimes: number[] = []   // C→D: JS preprocessing (if any)
  private yoloInferenceTimes: number[] = []     // D→E: TFLite inference (runSync)
  private yoloPostprocessTimes: number[] = []    // E→F: postprocess/callback (parsing + SharedValue updates)
  
  // Granular MoveNet metrics
  private moveNetRequested: number = 0
  private moveNetExecuted: number = 0
  private moveNetSkipped: number = 0
  private moveNetDroppedBusy: number = 0
  private moveNetStartTime: number | null = null
  private moveNetWorkletPrepTimes: number[] = []
  private moveNetCropTimes: number[] = []
  private moveNetResizeTimes: number[] = []
  private moveNetQuantizationTimes: number[] = []
  private moveNetRunTimes: number[] = []
  private moveNetParseTimes: number[] = []
  private moveNetScheduleWaitTimes: number[] = []
  
  // Player tracking metrics
  private playerDetected: number = 0
  private playerLost: number = 0
  private playerUsingLastBbox: number = 0
  private playerBboxExpired: number = 0
  private playerBboxAgeMs: number[] = []
  
  // Granular player flow metrics
  private playerTrackingCurrent: number = 0
  private playerTrackingLastBbox: number = 0
  private playerMoveNetExecutions: number = 0
  private lastPlayerDetectionId: number = 0 // Track last YOLO detection ID
  private currentDetectionUpdateCount: number = 0 // Count updates for current detection
  private trackingUpdatesPerDetection: number[] = [] // Track updates per detection
  private playerBboxAgeBuckets: {
    age0: number
    age1to100: number
    age100to250: number
    age250to500: number
    age500to750: number
    expired: number
  } = {
    age0: 0,
    age1to100: 0,
    age100to250: 0,
    age250to500: 0,
    age500to750: 0,
    expired: 0,
  }
  
  // Ball tracking metrics
  private ballDetected: number = 0
  private ballPrediction: number = 0
  private ballTrackingExpired: number = 0
  private ballPredictionAgeMs: number[] = []

  // RN work tracking - measures queue depth and callback execution
  private rnYoloScheduled: number = 0
  private rnYoloCallbackStarted: number = 0
  private rnYoloCallbackExecutionMs: number[] = []
  private rnMoveNetScheduled: number = 0
  private rnMoveNetCallbackStarted: number = 0
  private rnMoveNetCallbackExecutionMs: number[] = []
  private rnTelemetryUpdates: number = 0
  private rnUiUpdates: number = 0

  private diagnosticWindows: DiagnosticWindowSnapshot[] = []

  getYoloScheduleWaitPercentiles(): { p50: number; p95: number; p99: number } {
    return {
      p50: this.calculatePercentile(this.yoloScheduleWaitTimes, 50),
      p95: this.calculatePercentile(this.yoloScheduleWaitTimes, 95),
      p99: this.calculatePercentile(this.yoloScheduleWaitTimes, 99),
    }
  }

  getMoveNetScheduleWaitPercentiles(): { p50: number; p95: number; p99: number } {
    return {
      p50: this.calculatePercentile(this.moveNetScheduleWaitTimes, 50),
      p95: this.calculatePercentile(this.moveNetScheduleWaitTimes, 95),
      p99: this.calculatePercentile(this.moveNetScheduleWaitTimes, 99),
    }
  }

  recordDiagnosticWindow(snapshot: DiagnosticWindowSnapshot): void {
    this.diagnosticWindows.push(snapshot)
    if (this.diagnosticWindows.length > 120) {
      this.diagnosticWindows.shift()
    }

    console.log('[PERF 1s]')
    console.log(`CAM  fps=${snapshot.cameraFps.toFixed(1)} recv=${snapshot.received} proc=${snapshot.processed} drop=${snapshot.droppedBusy} avg=${snapshot.onFrameAvgMs.toFixed(1)}ms max=${snapshot.onFrameMaxMs.toFixed(1)}ms`)
    console.log(`YOLO fps=${snapshot.yoloThroughputFps.toFixed(1)} exec=${snapshot.yoloExecuted} attempt=${snapshot.yoloRequested} skip=${snapshot.yoloSkipped} avg=${snapshot.yoloAvgMs.toFixed(1)}ms max=${snapshot.yoloMaxMs?.toFixed(1) ?? '0.0'}ms`)
    console.log(`YOLO DETAIL workletPrep=${snapshot.yoloWorkletPrepAvgMs.toFixed(1)}ms schedule=${snapshot.yoloScheduleWaitMs.toFixed(1)}ms (P50=${snapshot.yoloScheduleWaitP50.toFixed(1)} P95=${snapshot.yoloScheduleWaitP95.toFixed(1)} P99=${snapshot.yoloScheduleWaitP99.toFixed(1)}) jsPreprocess=${snapshot.yoloJsPreprocessAvgMs.toFixed(1)}ms inference=${snapshot.yoloInferenceAvgMs.toFixed(1)}ms postprocess=${snapshot.yoloPostprocessAvgMs.toFixed(1)}ms resize=${snapshot.yoloResizeAvgMs.toFixed(1)}ms run=${snapshot.yoloRunAvgMs.toFixed(1)}ms parse=${snapshot.yoloParseAvgMs.toFixed(1)}ms`)
    console.log(`MOVE fps=${snapshot.moveNetThroughputFps.toFixed(1)} exec=${snapshot.moveNetExecuted} attempt=${snapshot.moveNetRequested} skip=${snapshot.moveNetSkipped} avg=${snapshot.moveNetAvgMs.toFixed(1)}ms max=${snapshot.moveNetMaxMs?.toFixed(1) ?? '0.0'}ms`)
    console.log(`MOVE DETAIL prep=${snapshot.moveNetWorkletPrepMs.toFixed(1)}ms schedule=${snapshot.moveNetScheduleWaitMs.toFixed(1)}ms (P50=${snapshot.moveNetScheduleWaitP50.toFixed(1)} P95=${snapshot.moveNetScheduleWaitP95.toFixed(1)} P99=${snapshot.moveNetScheduleWaitP99.toFixed(1)}) crop=${snapshot.moveNetCropAvgMs.toFixed(1)}ms quant=${snapshot.moveNetQuantizationAvgMs.toFixed(1)}ms run=${snapshot.moveNetRunAvgMs.toFixed(1)}ms parse=${snapshot.moveNetParseAvgMs.toFixed(1)}ms`)
    this.logRnWorkMetrics()
  }

  // RN work tracking methods
  recordRnYoloScheduled(): void {
    this.rnYoloScheduled++
  }

  recordRnYoloCallbackStart(): void {
    this.rnYoloCallbackStarted++
  }

  recordRnYoloCallbackExecution(executionMs: number): void {
    this.rnYoloCallbackExecutionMs.push(executionMs)
    if (this.rnYoloCallbackExecutionMs.length > 300) {
      this.rnYoloCallbackExecutionMs.shift()
    }
  }

  recordRnMoveNetScheduled(): void {
    this.rnMoveNetScheduled++
  }

  recordRnMoveNetCallbackStart(): void {
    this.rnMoveNetCallbackStarted++
  }

  recordRnMoveNetCallbackExecution(executionMs: number): void {
    this.rnMoveNetCallbackExecutionMs.push(executionMs)
    if (this.rnMoveNetCallbackExecutionMs.length > 300) {
      this.rnMoveNetCallbackExecutionMs.shift()
    }
  }

  recordRnTelemetryUpdate(): void {
    this.rnTelemetryUpdates++
  }

  recordRnUiUpdate(): void {
    this.rnUiUpdates++
  }

  logRnWorkMetrics(): void {
    const yoloPending = this.rnYoloScheduled - this.rnYoloCallbackStarted
    const moveNetPending = this.rnMoveNetScheduled - this.rnMoveNetCallbackStarted
    const yoloAvgCallbackMs = this.rnYoloCallbackExecutionMs.length > 0
      ? this.rnYoloCallbackExecutionMs.reduce((a, b) => a + b, 0) / this.rnYoloCallbackExecutionMs.length
      : 0
    const moveNetAvgCallbackMs = this.rnMoveNetCallbackExecutionMs.length > 0
      ? this.rnMoveNetCallbackExecutionMs.reduce((a, b) => a + b, 0) / this.rnMoveNetCallbackExecutionMs.length
      : 0

    console.log('[RN WORK]')
    console.log(`  yoloScheduled=${this.rnYoloScheduled} yoloCallback=${this.rnYoloCallbackStarted} yoloPending=${yoloPending} yoloCallbackAvg=${yoloAvgCallbackMs.toFixed(1)}ms`)
    console.log(`  moveNetScheduled=${this.rnMoveNetScheduled} moveNetCallback=${this.rnMoveNetCallbackStarted} moveNetPending=${moveNetPending} moveNetCallbackAvg=${moveNetAvgCallbackMs.toFixed(1)}ms`)
    console.log(`  telemetryUpdates=${this.rnTelemetryUpdates} uiUpdates=${this.rnUiUpdates}`)
  }

  getDiagnosticWindows(): DiagnosticWindowSnapshot[] {
    return [...this.diagnosticWindows]
  }

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

  recordYoloInferenceLegacy(inferenceTimeMs: number): void {
    // Legacy method for backward compatibility - now records to yoloInferenceTimes
    this.yoloInferenceTimes.push(inferenceTimeMs)
    if (this.yoloInferenceTimes.length > 300) {
      this.yoloInferenceTimes.shift()
    }
  }

  recordYoloRequested(): void {
    this.yoloRequested++
  }

  recordYoloExecuted(): void {
    this.yoloExecuted++
    if (this.yoloStartTime === null) {
      this.yoloStartTime = Date.now()
    }
  }

  recordYoloProcessedFrame(): void {
    this.yoloProcessedFramesCount++
  }

  recordYoloResize(resizeMs: number): void {
    this.yoloResizeTimes.push(resizeMs)
    if (this.yoloResizeTimes.length > 300) {
      this.yoloResizeTimes.shift()
    }
  }

  recordYoloRun(runMs: number): void {
    this.yoloRunTimes.push(runMs)
    if (this.yoloRunTimes.length > 300) {
      this.yoloRunTimes.shift()
    }
  }

  recordYoloParse(parseMs: number): void {
    this.yoloParseTimes.push(parseMs)
    if (this.yoloParseTimes.length > 300) {
      this.yoloParseTimes.shift()
    }
  }

  recordYoloScheduleWait(scheduleWaitMs: number): void {
    this.yoloScheduleWaitTimes.push(scheduleWaitMs)
    if (this.yoloScheduleWaitTimes.length > 300) {
      this.yoloScheduleWaitTimes.shift()
    }
  }

  recordYoloWorkletPrep(workletPrepMs: number): void {
    this.yoloWorkletPrepTimes.push(workletPrepMs)
    if (this.yoloWorkletPrepTimes.length > 300) {
      this.yoloWorkletPrepTimes.shift()
    }
  }

  recordYoloJsPreprocess(jsPreprocessMs: number): void {
    this.yoloJsPreprocessTimes.push(jsPreprocessMs)
    if (this.yoloJsPreprocessTimes.length > 300) {
      this.yoloJsPreprocessTimes.shift()
    }
  }

  recordYoloInference(inferenceMs: number): void {
    this.yoloInferenceTimes.push(inferenceMs)
    if (this.yoloInferenceTimes.length > 300) {
      this.yoloInferenceTimes.shift()
    }
  }

  recordYoloPostprocess(postprocessMs: number): void {
    this.yoloPostprocessTimes.push(postprocessMs)
    if (this.yoloPostprocessTimes.length > 300) {
      this.yoloPostprocessTimes.shift()
    }
  }

  getYoloPerfMetrics(): YoloPerfMetrics {
    if (this.yoloInferenceTimes.length === 0) {
      return { throughputFps: 0, theoreticalFps: 0, avgMs: 0, minMs: 0, maxMs: 0, samples: 0, requested: this.yoloRequested, executed: this.yoloExecuted, skipped: this.yoloRequested - this.yoloExecuted, scheduleWaitMs: 0, scheduleWaitP50: 0, scheduleWaitP95: 0, scheduleWaitP99: 0, resizeMs: 0, runMs: 0, parseMs: 0 }
    }

    const avgMs = this.yoloInferenceTimes.reduce((a, b) => a + b, 0) / this.yoloInferenceTimes.length
    const minMs = Math.min(...this.yoloInferenceTimes)
    const maxMs = Math.max(...this.yoloInferenceTimes)
    const theoreticalFps = 1000 / avgMs
    const skipped = this.yoloRequested - this.yoloExecuted

    // Calculate throughput FPS based on executed count and elapsed time
    let throughputFps = 0
    if (this.yoloStartTime !== null && this.yoloExecuted > 0) {
      const elapsedMs = Date.now() - this.yoloStartTime
      if (elapsedMs > 0) {
        throughputFps = (this.yoloExecuted / elapsedMs) * 1000
      }
    }

    const avgScheduleWaitMs = this.yoloScheduleWaitTimes.length > 0 ? this.yoloScheduleWaitTimes.reduce((a, b) => a + b, 0) / this.yoloScheduleWaitTimes.length : 0
    const yoloScheduleWaitP50 = this.calculatePercentile(this.yoloScheduleWaitTimes, 50)
    const yoloScheduleWaitP95 = this.calculatePercentile(this.yoloScheduleWaitTimes, 95)
    const yoloScheduleWaitP99 = this.calculatePercentile(this.yoloScheduleWaitTimes, 99)
    const avgResizeMs = this.yoloResizeTimes.length > 0 ? this.yoloResizeTimes.reduce((a, b) => a + b, 0) / this.yoloResizeTimes.length : 0
    const avgRunMs = this.yoloRunTimes.length > 0 ? this.yoloRunTimes.reduce((a, b) => a + b, 0) / this.yoloRunTimes.length : 0
    const avgParseMs = this.yoloParseTimes.length > 0 ? this.yoloParseTimes.reduce((a, b) => a + b, 0) / this.yoloParseTimes.length : 0

    return {
      throughputFps,
      theoreticalFps,
      avgMs,
      minMs,
      maxMs,
      samples: this.yoloInferenceTimes.length,
      requested: this.yoloRequested,
      executed: this.yoloExecuted,
      skipped,
      scheduleWaitMs: avgScheduleWaitMs,
      scheduleWaitP50: yoloScheduleWaitP50,
      scheduleWaitP95: yoloScheduleWaitP95,
      scheduleWaitP99: yoloScheduleWaitP99,
      resizeMs: avgResizeMs,
      runMs: avgRunMs,
      parseMs: avgParseMs,
    }
  }

  logYoloPerf(): void {
    // Removed duplicate log - YOLO DETAIL already contains detailed timing
    // const metrics = this.getYoloPerfMetrics()
    // console.log('[YOLO]', `latency=${metrics.avgMs.toFixed(1)}ms resize=${metrics.resizeMs.toFixed(1)}ms run=${metrics.runMs.toFixed(1)}ms parse=${metrics.parseMs.toFixed(1)}ms`)
  }

  recordBallDetection(confidence: number): void {
    this.ballDetections.push({ confidence, timestamp: Date.now() })
    if (this.ballDetections.length > 600) {
      this.ballDetections.shift()
    }
  }

  recordYoloFrameWithBall(): void {
    this.pipelineMetrics.framesWithBall++
  }

  recordPlayerDetection(confidence: number, bbox: { x: number; y: number; w: number; h: number }): void {
    this.playerDetections.push({ confidence, bbox, timestamp: Date.now() })
    if (this.playerDetections.length > 600) {
      this.playerDetections.shift()
    }
  }

  recordYoloFrameWithPlayer(): void {
    this.pipelineMetrics.framesWithPlayer++
  }

  recordMoveNetInference(inferenceTimeMs: number): void {
    this.moveNetInferenceTimes.push(inferenceTimeMs)
    if (this.moveNetInferenceTimes.length > 300) {
      this.moveNetInferenceTimes.shift()
    }
  }

  recordMoveNetRequested(): void {
    this.moveNetRequested++
    if (this.moveNetStartTime === null) {
      this.moveNetStartTime = Date.now()
    }
  }

  recordMoveNetExecuted(): void {
    this.moveNetExecuted++
  }

  recordMoveNetSkipped(): void {
    this.moveNetSkipped++
  }

  recordMoveNetDroppedBusy(): void {
    this.moveNetDroppedBusy++
  }

  recordMoveNetWorkletPrep(workletPrepMs: number): void {
    this.moveNetWorkletPrepTimes.push(workletPrepMs)
    if (this.moveNetWorkletPrepTimes.length > 300) {
      this.moveNetWorkletPrepTimes.shift()
    }
  }

  recordMoveNetCrop(cropMs: number): void {
    this.moveNetCropTimes.push(cropMs)
    if (this.moveNetCropTimes.length > 300) {
      this.moveNetCropTimes.shift()
    }
  }

  recordMoveNetResize(resizeMs: number): void {
    this.moveNetResizeTimes.push(resizeMs)
    if (this.moveNetResizeTimes.length > 300) {
      this.moveNetResizeTimes.shift()
    }
  }

  recordMoveNetQuantization(quantizationMs: number): void {
    this.moveNetQuantizationTimes.push(quantizationMs)
    if (this.moveNetQuantizationTimes.length > 300) {
      this.moveNetQuantizationTimes.shift()
    }
  }

  recordMoveNetRun(runMs: number): void {
    this.moveNetRunTimes.push(runMs)
    if (this.moveNetRunTimes.length > 300) {
      this.moveNetRunTimes.shift()
    }
  }

  recordMoveNetParse(parseMs: number): void {
    this.moveNetParseTimes.push(parseMs)
    if (this.moveNetParseTimes.length > 300) {
      this.moveNetParseTimes.shift()
    }
  }

  recordMoveNetScheduleWait(scheduleWaitMs: number): void {
    this.moveNetScheduleWaitTimes.push(scheduleWaitMs)
    if (this.moveNetScheduleWaitTimes.length > 300) {
      this.moveNetScheduleWaitTimes.shift()
    }
  }

  recordMoveNetKeypoints(confidence: number): void {
    this.moveNetKeypoints.push({ confidence, timestamp: Date.now() })
    if (this.moveNetKeypoints.length > 300) {
      this.moveNetKeypoints.shift()
    }
  }

  recordFalsePositive(reason: string, confidence: number): void {
    const count = this.falsePositives.get(reason) || 0
    this.falsePositives.set(reason, count + 1)
  }

  recordBbox(x: number, y: number, w: number, h: number): void {
    this.bboxHistory.push({ x, y, w, h, timestamp: Date.now() })
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
      
      // Coordinates are already normalized (0-1), so calculate jumps directly in normalized space
      const dx = curr.x - prev.x
      const dy = curr.y - prev.y
      const jump = Math.sqrt(dx * dx + dy * dy)
      jumps.push(jump)
      totalSize += curr.w + curr.h
    }

    const avgSize = totalSize / (2 * this.bboxHistory.length)
    const avgJump = jumps.reduce((a, b) => a + b, 0) / jumps.length
    const maxJump = Math.max(...jumps)
    const variance = jumps.reduce((sum, jump) => sum + Math.pow(jump - avgJump, 2), 0) / jumps.length
    const jitter = Math.sqrt(variance)
    // Threshold for stable jumps in normalized space (0.02 = 2% of frame width/height)
    const stableJumps = jumps.filter(j => j < 0.02).length
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
    console.log('[BBOX][STABILITY]', `avgJump=${metrics.avgJump.toFixed(4)} maxJump=${metrics.maxJump.toFixed(4)} jitter=${metrics.jitter.toFixed(4)} stability=${metrics.stability.toFixed(0)}%`)
  }

  recordPlayerDetected(): void {
    this.playerDetected++
  }

  recordPlayerLost(): void {
    this.playerLost++
  }

  recordPlayerUsingLastBbox(ageMs: number): void {
    this.playerUsingLastBbox++
    this.playerBboxAgeMs.push(ageMs)
    if (this.playerBboxAgeMs.length > 300) {
      this.playerBboxAgeMs.shift()
    }
  }

  recordPlayerBboxExpired(): void {
    this.playerBboxExpired++
  }

  recordPlayerTrackingCurrent(detectionId: number): void {
    // Track as current only if detectionId is greater than last seen
    if (detectionId > this.lastPlayerDetectionId) {
      // New detection - record updates for previous detection
      if (this.currentDetectionUpdateCount > 0) {
        this.trackingUpdatesPerDetection.push(this.currentDetectionUpdateCount)
        if (this.trackingUpdatesPerDetection.length > 300) {
          this.trackingUpdatesPerDetection.shift()
        }
      }
      // Reset counter for new detection
      this.currentDetectionUpdateCount = 1
      this.playerTrackingCurrent++
      this.lastPlayerDetectionId = detectionId
    } else {
      // Same detection ID = persisted bbox
      this.currentDetectionUpdateCount++
      this.playerTrackingLastBbox++
    }
  }

  recordPlayerTrackingLastBbox(ageMs: number): void {
    this.playerTrackingLastBbox++
    // Bucket age for distribution analysis
    if (ageMs === 0) {
      this.playerBboxAgeBuckets.age0++
    } else if (ageMs < 100) {
      this.playerBboxAgeBuckets.age1to100++
    } else if (ageMs < 250) {
      this.playerBboxAgeBuckets.age100to250++
    } else if (ageMs < 500) {
      this.playerBboxAgeBuckets.age250to500++
    } else if (ageMs < 750) {
      this.playerBboxAgeBuckets.age500to750++
    } else {
      this.playerBboxAgeBuckets.expired++
    }
  }

  recordPlayerMoveNetExecution(): void {
    this.playerMoveNetExecutions++
  }

  logPlayerTrackingMetrics(): void {
    const avgAgeMs = this.playerBboxAgeMs.length > 0 
      ? this.playerBboxAgeMs.reduce((a, b) => a + b, 0) / this.playerBboxAgeMs.length 
      : 0
    console.log('[PLAYER][TRACKING]', `detected=${this.playerDetected} lost=${this.playerLost} usingLastBbox=${this.playerUsingLastBbox} expired=${this.playerBboxExpired} avgAge=${avgAgeMs.toFixed(0)}ms`)
  }

  logPlayerFlowMetrics(): void {
    const yoloDetections = this.playerDetected
    const trackingCurrent = this.playerTrackingCurrent
    const trackingLast = this.playerTrackingLastBbox
    const moveNetExec = this.playerMoveNetExecutions

    // Calculate age percentiles
    const ageP50 = this.playerBboxAgeMs.length > 0
      ? this.calculatePercentile(this.playerBboxAgeMs, 50)
      : 0
    const ageP95 = this.playerBboxAgeMs.length > 0
      ? this.calculatePercentile(this.playerBboxAgeMs, 95)
      : 0
    const ageMax = this.playerBboxAgeMs.length > 0
      ? Math.max(...this.playerBboxAgeMs)
      : 0

    // Calculate tracking updates per detection percentiles
    const updatesP50 = this.trackingUpdatesPerDetection.length > 0
      ? this.calculatePercentile(this.trackingUpdatesPerDetection, 50)
      : 0
    const updatesP95 = this.trackingUpdatesPerDetection.length > 0
      ? this.calculatePercentile(this.trackingUpdatesPerDetection, 95)
      : 0
    const updatesMax = this.trackingUpdatesPerDetection.length > 0
      ? Math.max(...this.trackingUpdatesPerDetection)
      : 0

    console.log('[PLAYER][FLOW]',
      `yolo=${yoloDetections} ` +
      `current=${trackingCurrent} ` +
      `last=${trackingLast} ` +
      `ageP50=${ageP50.toFixed(0)}ms ` +
      `ageP95=${ageP95.toFixed(0)}ms ` +
      `ageMax=${ageMax.toFixed(0)}ms ` +
      `trackingCurrent=${trackingCurrent} ` +
      `trackingLast=${trackingLast} ` +
      `moveNet=${moveNetExec}`
    )

    console.log('[PLAYER][AGE_BUCKETS]',
      `age0=${this.playerBboxAgeBuckets.age0} ` +
      `age1to100=${this.playerBboxAgeBuckets.age1to100} ` +
      `age100to250=${this.playerBboxAgeBuckets.age100to250} ` +
      `age250to500=${this.playerBboxAgeBuckets.age250to500} ` +
      `age500to750=${this.playerBboxAgeBuckets.age500to750} ` +
      `expired=${this.playerBboxAgeBuckets.expired}`
    )

    console.log('[PLAYER][UPDATES_PER_DETECTION]',
      `detections=${this.trackingUpdatesPerDetection.length} ` +
      `P50=${updatesP50.toFixed(0)} ` +
      `P95=${updatesP95.toFixed(0)} ` +
      `MAX=${updatesMax.toFixed(0)}`
    )
  }

  recordBallDetected(): void {
    this.ballDetected++
  }

  recordBallPrediction(ageMs: number): void {
    this.ballPrediction++
    this.ballPredictionAgeMs.push(ageMs)
    if (this.ballPredictionAgeMs.length > 300) {
      this.ballPredictionAgeMs.shift()
    }
  }

  recordBallTrackingExpired(): void {
    this.ballTrackingExpired++
  }

  logBallTrackingMetrics(): void {
    const avgAgeMs = this.ballPredictionAgeMs.length > 0 
      ? this.ballPredictionAgeMs.reduce((a, b) => a + b, 0) / this.ballPredictionAgeMs.length 
      : 0
    console.log('[BALL][TRACKING]', `detected=${this.ballDetected} prediction=${this.ballPrediction} expired=${this.ballTrackingExpired} avgAge=${avgAgeMs.toFixed(0)}ms`)
  }

  updatePipelineMetrics(cameraFPS: number, received: number, processed: number, droppedBusy: number, trackingAccepted: number, overlayRendered: number): void {
    // overlayRendered parameter kept for API compatibility but deprecated (Skia renders at camera FPS)
    this.pipelineMetrics = {
      cameraFPS,
      received,
      processed,
      droppedBusy,
      dropped: droppedBusy,
      dropRate: received > 0 ? (droppedBusy / received) * 100 : 0,
      yoloExecuted: this.yoloExecuted,
      framesWithBall: this.pipelineMetrics.framesWithBall,
      framesWithPlayer: this.pipelineMetrics.framesWithPlayer,
      trackingAccepted,
      poseUpdates: this.pipelineMetrics.poseUpdates,
      overlayRendered,
    }
  }

  incrementYoloExecuted(): void {
    this.yoloExecuted++
  }

  incrementTrackingAccepted(): void {
    this.pipelineMetrics.trackingAccepted++
  }

  incrementPoseUpdates(): void {
    this.pipelineMetrics.poseUpdates++
  }

  logPipelineMetrics(): void {
    const m = this.pipelineMetrics
    console.log('[PIPELINE]', `camFPS=${m.cameraFPS.toFixed(1)} recv=${m.received} proc=${m.processed} drop=${m.droppedBusy} yoloExec=${m.yoloExecuted} ballFrames=${m.framesWithBall} playerFrames=${m.framesWithPlayer} track=${m.trackingAccepted} pose=${m.poseUpdates}`)
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
      this.batteryMetrics.duration = (Date.now() - this.testStartTime) / 1000
      
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
    const framesWithDetection = this.pipelineMetrics.framesWithBall
    // Use yoloExecuted as denominator to measure: "In what percentage of YOLO inferences did I find a ball?"
    const yoloExecuted = this.yoloExecuted
    const detectionRate = yoloExecuted > 0 ? (framesWithDetection / yoloExecuted) * 100 : 0

    return {
      framesProcessed,
      framesDetected: framesWithDetection,
      detectionRate,
      avgConfidence,
      minConfidence,
      maxConfidence,
    }
  }

  logBallDetectionMetrics(framesProcessed: number): void {
    const metrics = this.getBallDetectionMetrics(framesProcessed)
    // Use yoloExecuted in log for consistency with detectionRate calculation (both are cumulative)
    console.log('[YOLO][BALL]', `yoloExec=${this.yoloExecuted} detected=${metrics.framesDetected} detectionRate=${metrics.detectionRate.toFixed(1)}%`)
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
    const framesWithDetection = this.pipelineMetrics.framesWithPlayer
    // Use yoloExecuted as denominator to measure: "In what percentage of YOLO inferences did I find a player?"
    const yoloExecuted = this.yoloExecuted
    const detectionRate = yoloExecuted > 0 ? (framesWithDetection / yoloExecuted) * 100 : 0
    const bboxSizes = this.playerDetections.map(d => d.bbox.w * d.bbox.h)
    const avgBboxSize = bboxSizes.reduce((a, b) => a + b, 0) / bboxSizes.length
    if (this.playerDetections.length < 2) {
      return {
        framesProcessed,
        framesDetected: framesWithDetection,
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
    const stableJumps = jumps.filter(j => j < 0.02).length
    const bboxStability = (stableJumps / jumps.length) * 100

    return {
      framesProcessed,
      framesDetected: framesWithDetection,
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
    // Use yoloExecuted in log for consistency with detectionRate calculation (both are cumulative)
    console.log('[YOLO][PLAYER]', `yoloExec=${this.yoloExecuted} detected=${metrics.framesDetected} detectionRate=${metrics.detectionRate.toFixed(1)}%`)
  }

  getMoveNetMetrics(): MoveNetMetrics {
    if (this.moveNetInferenceTimes.length === 0) {
      return {
        modelInput: this.moveNetModelInput,
        inferenceTimes: [],
        throughputFps: 0,
        theoreticalFps: 0,
        avgMs: 0,
        minMs: 0,
        maxMs: 0,
        validKeypoints: 0,
        avgConfidence: 0,
        keypointStability: 0,
        requested: this.moveNetRequested,
        executed: this.moveNetExecuted,
        skipped: this.moveNetSkipped,
        workletPrepMs: 0,
        cropMs: 0,
        resizeMs: 0,
        quantizationMs: 0,
        runMs: 0,
        parseMs: 0,
        scheduleWaitMs: 0,
        scheduleWaitP50: 0,
        scheduleWaitP95: 0,
        scheduleWaitP99: 0,
      }
    }

    const avgMs = this.moveNetInferenceTimes.reduce((a, b) => a + b, 0) / this.moveNetInferenceTimes.length
    const minMs = Math.min(...this.moveNetInferenceTimes)
    const maxMs = Math.max(...this.moveNetInferenceTimes)
    const theoreticalFps = 1000 / avgMs

    // Calculate real throughput based on elapsed time
    let throughputFps = 0
    if (this.moveNetStartTime && this.moveNetExecuted > 0) {
      const elapsedSeconds = (Date.now() - this.moveNetStartTime) / 1000
      if (elapsedSeconds > 0) {
        throughputFps = this.moveNetExecuted / elapsedSeconds
      }
    }

    const validKeypoints = this.moveNetKeypoints.length
    const avgConfidence = validKeypoints > 0 
      ? this.moveNetKeypoints.map(k => k.confidence).reduce((a, b) => a + b, 0) / validKeypoints 
      : 0
    let keypointStability = 100
    if (this.moveNetKeypoints.length > 1) {
      const confidences = this.moveNetKeypoints.map(k => k.confidence)
      const variance = confidences.reduce((sum, conf) => sum + Math.pow(conf - avgConfidence, 2), 0) / confidences.length
      const stdDev = Math.sqrt(variance)
      keypointStability = Math.max(0, 100 - (stdDev * 100))
    }
    
    const avgWorkletPrepMs = this.moveNetWorkletPrepTimes.length > 0 ? this.moveNetWorkletPrepTimes.reduce((a, b) => a + b, 0) / this.moveNetWorkletPrepTimes.length : 0
    const avgCropMs = this.moveNetCropTimes.length > 0 ? this.moveNetCropTimes.reduce((a, b) => a + b, 0) / this.moveNetCropTimes.length : 0
    const avgResizeMs = this.moveNetResizeTimes.length > 0 ? this.moveNetResizeTimes.reduce((a, b) => a + b, 0) / this.moveNetResizeTimes.length : 0
    const avgQuantizationMs = this.moveNetQuantizationTimes.length > 0 ? this.moveNetQuantizationTimes.reduce((a, b) => a + b, 0) / this.moveNetQuantizationTimes.length : 0
    const avgRunMs = this.moveNetRunTimes.length > 0 ? this.moveNetRunTimes.reduce((a, b) => a + b, 0) / this.moveNetRunTimes.length : 0
    const avgParseMs = this.moveNetParseTimes.length > 0 ? this.moveNetParseTimes.reduce((a, b) => a + b, 0) / this.moveNetParseTimes.length : 0
    const avgScheduleWaitMs = this.moveNetScheduleWaitTimes.length > 0 ? this.moveNetScheduleWaitTimes.reduce((a, b) => a + b, 0) / this.moveNetScheduleWaitTimes.length : 0
    const moveNetScheduleWaitP50 = this.calculatePercentile(this.moveNetScheduleWaitTimes, 50)
    const moveNetScheduleWaitP95 = this.calculatePercentile(this.moveNetScheduleWaitTimes, 95)
    const moveNetScheduleWaitP99 = this.calculatePercentile(this.moveNetScheduleWaitTimes, 99)

    return {
      modelInput: this.moveNetModelInput,
      inferenceTimes: this.moveNetInferenceTimes,
      throughputFps,
      theoreticalFps,
      avgMs,
      minMs,
      maxMs,
      validKeypoints,
      avgConfidence,
      keypointStability,
      requested: this.moveNetRequested,
      executed: this.moveNetExecuted,
      skipped: this.moveNetSkipped,
      workletPrepMs: avgWorkletPrepMs,
      cropMs: avgCropMs,
      resizeMs: avgResizeMs,
      quantizationMs: avgQuantizationMs,
      runMs: avgRunMs,
      parseMs: avgParseMs,
      scheduleWaitMs: avgScheduleWaitMs,
      scheduleWaitP50: moveNetScheduleWaitP50,
      scheduleWaitP95: moveNetScheduleWaitP95,
      scheduleWaitP99: moveNetScheduleWaitP99,
    }
  }

  logMoveNetMetrics(): void {
    // Removed duplicate log - MOVE DETAIL already contains detailed timing
    // const metrics = this.getMoveNetMetrics()
    // console.log('[MOVENET]', `prep=${metrics.workletPrepMs.toFixed(1)}ms schedule=${metrics.scheduleWaitMs.toFixed(1)}ms crop=${metrics.cropMs.toFixed(1)}ms resize=${metrics.resizeMs.toFixed(1)}ms quant=${metrics.quantizationMs.toFixed(1)}ms inference=${metrics.runMs.toFixed(1)}ms parse=${metrics.parseMs.toFixed(1)}ms total=${metrics.avgMs.toFixed(1)}ms`)
  }

  generateTestSummary(cameraFPS: number, moveNetFPS: number): TestSummary | null {
    if (!this.modelMetadata || !this.batteryMetrics) {
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
        yoloFPS: yoloPerf.throughputFps,
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
    console.log(`FPS=${summary.moveNet.throughputFps.toFixed(1)}`)
    console.log(`AVG=${summary.moveNet.avgMs.toFixed(1)}ms`)
    console.log('')
    console.log('[PIPELINE]')
    console.log(`Received=${summary.pipeline.received}`)
    console.log(`Processed=${summary.pipeline.processed}`)
    console.log(`DroppedBusy=${summary.pipeline.droppedBusy}`)
    console.log(`YOLO Executed=${summary.pipeline.yoloExecuted}`)
    console.log(`Frames with Ball=${summary.pipeline.framesWithBall}`)
    console.log(`Frames with Player=${summary.pipeline.framesWithPlayer}`)
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
    if (!summary) return 'Error: Cannot generate summary'

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
FPS=${summary.moveNet.throughputFps.toFixed(1)}
AVG=${summary.moveNet.avgMs.toFixed(1)}ms

[PIPELINE]
Received=${summary.pipeline.received}
Processed=${summary.pipeline.processed}
DroppedBusy=${summary.pipeline.droppedBusy}
YOLO Executed=${summary.pipeline.yoloExecuted}
Frames with Ball=${summary.pipeline.framesWithBall}
Frames with Player=${summary.pipeline.framesWithPlayer}
Tracking=${summary.pipeline.trackingAccepted}
Pose=${summary.pipeline.poseUpdates}

[BATTERY]
Start=${summary.battery.startLevel}%
Current=${summary.battery.endLevel}%

==========================================`
  }

  reset(): void {
    this.modelMetadata = null
    this.diagnosticWindows = []
    this.yoloInferenceTimes = []
    this.ballDetections = []
    this.playerDetections = []
    this.moveNetInferenceTimes = []
    this.moveNetKeypoints = []
    this.falsePositives.clear()
    this.bboxHistory = []
    this.yoloProcessedFramesCount = 0
    this.pipelineMetrics = {
      cameraFPS: 0,
      received: 0,
      processed: 0,
      droppedBusy: 0,
      dropped: 0,
      dropRate: 0,
      yoloExecuted: 0,
      framesWithBall: 0,
      framesWithPlayer: 0,
      trackingAccepted: 0,
      poseUpdates: 0,
      overlayRendered: 0,
    }
    this.batteryMetrics = null
    this.deviceMetrics = null
    this.testStartTime = null
    this.testEndTime = null
    
    // Reset granular YOLO metrics
    this.yoloRequested = 0
    this.yoloExecuted = 0
    this.yoloResizeTimes = []
    this.yoloRunTimes = []
    this.yoloParseTimes = []
    
    // Reset granular MoveNet metrics
    this.moveNetRequested = 0
    this.moveNetExecuted = 0
    
    // Reset granular player flow metrics
    this.playerTrackingCurrent = 0
    this.playerTrackingLastBbox = 0
    this.playerMoveNetExecutions = 0
    this.lastPlayerDetectionId = 0
    this.currentDetectionUpdateCount = 0
    this.trackingUpdatesPerDetection = []
    this.playerBboxAgeBuckets = {
      age0: 0,
      age1to100: 0,
      age100to250: 0,
      age250to500: 0,
      age500to750: 0,
      expired: 0,
    }
    this.moveNetSkipped = 0
    this.moveNetDroppedBusy = 0
    this.moveNetStartTime = null
    this.moveNetCropTimes = []
    this.moveNetResizeTimes = []
    this.moveNetRunTimes = []
    this.moveNetParseTimes = []
    this.moveNetScheduleWaitTimes = []
    
    // Reset player tracking metrics
    this.playerDetected = 0
    this.playerLost = 0
    this.playerUsingLastBbox = 0
    this.playerBboxExpired = 0
    this.playerBboxAgeMs = []
    
    // Reset ball tracking metrics
    this.ballDetected = 0
    this.ballPrediction = 0
    this.ballTrackingExpired = 0
    this.ballPredictionAgeMs = []
  }
}

export const telemetryLogger = new TelemetryLogger()
