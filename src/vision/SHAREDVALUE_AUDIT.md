# SharedValue Audit - Frame Processor
## PASS 3: Classification of SharedValue Operations

**Generated:** 2026-10-07
**Purpose:** Identify which SharedValue operations are truly required per frame vs telemetry/debug

---

## READS (SharedValue.value)

### REQUIRED FOR DETECTION
- `ballEnabledShared.value` - YOLO enable check
- `poseEnabledShared.value` - MoveNet enable check
- `yoloWorker.latestResultBall.value` - YOLO ball detection result
- `yoloWorker.latestResultPlayer.value` - YOLO player detection result
- `yoloWorker.latestResultRim.value` - YOLO rim detection result
- `yoloWorker.latestResultTimestamp.value` - YOLO result timestamp
- `moveNetWorker.latestResultKeypoints.value` - MoveNet pose result
- `moveNetWorker.latestResultAngles.value` - MoveNet pose result
- `moveNetWorker.latestResultTimestamp.value` - MoveNet result timestamp

### REQUIRED FOR TRACKING
- `playerX.value` - Player crop X coordinate
- `playerY.value` - Player crop Y coordinate
- `playerWidth.value` - Player crop width
- `playerHeight.value` - Player crop height
- `playerConfidence.value` - Player crop confidence

### REQUIRED FOR UI
- `lastRNDispatch.value` - Throttle check for UI updates (66ms window)

### TELEMETRY ONLY (maybeFlushDiagnosticWindow - runs every 1s)
- `perfLastLogAt.value` - Diagnostic window timing
- `perfYoloExecuted.value` - YOLO execution count
- `perfMoveNetExecuted.value` - MoveNet execution count
- `perfFramesReceived.value` - Camera frame count
- `perfFramesProcessed.value` - Processed frame count
- `perfFramesDroppedBusy.value` - Dropped frame count
- `perfFrameDurationTotal.value` - Frame duration total
- `perfFrameDurationMax.value` - Frame duration max
- `perfYoloRequested.value` - YOLO requested count
- `perfYoloSkipped.value` - YOLO skipped count
- `perfYoloInferenceTotal.value` - YOLO inference total time
- `perfYoloInferenceMin.value` - YOLO inference min time
- `perfYoloInferenceMax.value` - YOLO inference max time
- `perfYoloScheduleWaitTotal.value` - YOLO schedule wait total
- `perfYoloWorkletPrepTotal.value` - YOLO worklet prep total
- `perfYoloJsPreprocessTotal.value` - YOLO JS preprocess total
- `perfYoloPostprocessTotal.value` - YOLO postprocess total
- `perfYoloResizeTotal.value` - YOLO resize total
- `perfYoloRunTotal.value` - YOLO run total
- `perfYoloParseTotal.value` - YOLO parse total
- `perfMoveNetRequested.value` - MoveNet requested count
- `perfMoveNetSkipped.value` - MoveNet skipped count
- `perfMoveNetInferenceTotal.value` - MoveNet inference total time
- `perfMoveNetInferenceMin.value` - MoveNet inference min time
- `perfMoveNetInferenceMax.value` - MoveNet inference max time
- `perfMoveNetWorkletPrepTotal.value` - MoveNet worklet prep total
- `perfMoveNetRnScheduleWaitTotal.value` - MoveNet RN schedule wait total
- `perfMoveNetCropTotal.value` - MoveNet crop total
- `perfMoveNetQuantizationTotal.value` - MoveNet quantization total
- `perfMoveNetRunTotal.value` - MoveNet run total
- `perfMoveNetParseTotal.value` - MoveNet parse total
- `perfTrackingAccepted.value` - Tracking accepted count
- `perfPlayerLostCount.value` - Player lost count
- `perfPlayerBboxExpiredCount.value` - Player bbox expired count
- `perfPlayerTrackingFreshCount.value` - Fresh bbox count
- `perfPlayerTrackingPersistedCount.value` - Persisted bbox count
- `perfPlayerTrackingFreshWithMoveNetCount.value` - Fresh bbox with MoveNet count
- `perfPlayerTrackingPersistedWithMoveNetCount.value` - Persisted bbox with MoveNet count
- `perfPlayerMoveNetExecutionCount.value` - MoveNet execution count
- `perfLastPlayerDetectionId.value` - Last player detection ID
- `perfLastPersistedBboxAgeMs.value` - Last persisted bbox age
- `perfMoveNetDecisionFrames.value` - MoveNet decision frames
- `perfMoveNetDecisionHasBbox.value` - MoveNet decision has bbox
- `perfMoveNetDecisionCurrentBbox.value` - MoveNet decision current bbox
- `perfMoveNetDecisionPersistedBbox.value` - MoveNet decision persisted bbox
- `perfMoveNetDecisionConfidenceRejected.value` - MoveNet decision confidence rejected
- `perfMoveNetDecisionSizeRejected.value` - MoveNet decision size rejected
- `perfMoveNetDecisionBoundsRejected.value` - MoveNet decision bounds rejected
- `perfMoveNetDecisionRun.value` - MoveNet decision run

### DEBUG ONLY
- `yoloWorker.latestResultDebug.value` - Debug info (ballRejectionReason, rimRejectionReason)

---

## WRITES (SharedValue.value =)

### REQUIRED FOR DETECTION
- `moveNetWorker.playerBbox.value` - MoveNet input bbox

### REQUIRED FOR TRACKING
- `playerTrackState.value` - Player tracking state (DETECTED/PREDICTED/LOST)
- `playerTrackAge.value` - Player tracking age
- `rimTrackState.value` - Rim tracking state (DETECTED/PREDICTED/LOST)
- `rimTrackAge.value` - Rim tracking age

### REQUIRED FOR UI
- `ballRejectionReason.value` - Ball rejection reason (UI display)
- `rimRejectionReason.value` - Rim rejection reason (UI display)
- `actualCameraFps.value` - Camera FPS for UI
- `actualYoloFps.value` - YOLO FPS for UI
- `actualMoveNetFps.value` - MoveNet FPS for UI
- `lastRNDispatch.value` - Throttle timestamp update

### TELEMETRY ONLY (per-frame counters)
- `perfFramesProcessed.value += 1` - Frame counter
- `perfYoloBallDetected.value += (yoloResult.ball ? 1 : 0)` - Ball detection counter
- `perfMoveNetDecisionFrames.value += 1` - MoveNet decision counter
- `perfMoveNetDecisionHasBbox.value += 1` - Has bbox counter
- `perfMoveNetDecisionCurrentBbox.value += 1` - Current bbox counter
- `perfMoveNetDecisionPersistedBbox.value += 1` - Persisted bbox counter
- `perfMoveNetDecisionConfidenceRejected.value += 1` - Confidence rejected counter
- `perfMoveNetDecisionRun.value += 1` - MoveNet run counter
- `perfPlayerTrackingFreshCount.value += 1` - Fresh bbox counter
- `perfPlayerTrackingFreshWithMoveNetCount.value += 1` - Fresh bbox with MoveNet counter
- `perfLastPlayerDetectionId.value = trackedBbox.detectionId` - Last detection ID
- `perfPlayerMoveNetExecutionCount.value += 1` - MoveNet execution counter
- `perfPlayerTrackingPersistedCount.value += 1` - Persisted bbox counter
- `perfLastPersistedBboxAgeMs.value = trackedBbox.ageMs` - Persisted bbox age

### TELEMETRY ONLY (window reset - every 1s)
- `perfLastLogAt.value = now`
- `perfFramesReceived.value = 0`
- `perfFramesProcessed.value = 0`
- `perfFramesDroppedBusy.value = 0`
- `perfFrameDurationTotal.value = 0`
- `perfFrameDurationMax.value = 0`
- `perfYoloRequested.value = 0`
- `perfYoloExecuted.value = 0`
- `perfYoloSkipped.value = 0`
- `perfYoloInferenceTotal.value = 0`
- `perfYoloInferenceMin.value = 0`
- `perfYoloInferenceMax.value = 0`
- `perfYoloScheduleWaitTotal.value = 0`
- `perfYoloResizeTotal.value = 0`
- `perfYoloRunTotal.value = 0`
- `perfYoloParseTotal.value = 0`
- `perfMoveNetRequested.value = 0`
- `perfMoveNetExecuted.value = 0`
- `perfMoveNetSkipped.value = 0`
- `perfMoveNetInferenceTotal.value = 0`
- `perfMoveNetInferenceMin.value = 0`
- `perfMoveNetInferenceMax.value = 0`
- `perfMoveNetWorkletPrepTotal.value = 0`
- `perfMoveNetRnScheduleWaitTotal.value = 0`
- `perfMoveNetCropTotal.value = 0`
- `perfMoveNetQuantizationTotal.value = 0`
- `perfMoveNetRunTotal.value = 0`
- `perfMoveNetParseTotal.value = 0`
- `perfTrackingAccepted.value = 0`
- `perfPlayerLostCount.value = 0`
- `perfPlayerBboxExpiredCount.value = 0`
- `perfPlayerTrackingFreshCount.value = 0`
- `perfPlayerTrackingPersistedCount.value = 0`
- `perfPlayerTrackingFreshWithMoveNetCount.value = 0`
- `perfPlayerTrackingPersistedWithMoveNetCount.value = 0`
- `perfPlayerMoveNetExecutionCount.value = 0`
- `perfLastPlayerDetectionId.value = 0`
- `perfLastPersistedBboxAgeMs.value = 0`
- `perfMoveNetDecisionFrames.value = 0`
- `perfMoveNetDecisionHasBbox.value = 0`
- `perfMoveNetDecisionCurrentBbox.value = 0`
- `perfMoveNetDecisionPersistedBbox.value = 0`
- `perfMoveNetDecisionConfidenceRejected.value = 0`
- `perfMoveNetDecisionSizeRejected.value = 0`
- `perfMoveNetDecisionBoundsRejected.value = 0`
- `perfMoveNetDecisionRun.value = 0`

### REQUIRED (guards)
- `isProcessingFrame.value = true` - Reentrancy guard
- `isProcessingFrame.value = false` - Reentrancy guard reset

---

## SUMMARY

### Per-Frame Operations (every ~33ms at 30 FPS)
**READS:**
- Detection: 9 reads
- Tracking: 5 reads
- UI: 1 read
- **Total: 15 reads per frame**

**WRITES:**
- Detection: 1 write
- Tracking: 4 writes
- UI: 4 writes
- Telemetry: ~10 writes (counters)
- Guards: 2 writes
- **Total: ~21 writes per frame**

### Per-Second Operations (every 1s)
**READS:**
- Telemetry: ~40 reads (diagnostic window snapshot)

**WRITES:**
- Telemetry: ~40 writes (counter reset)

---

## OPTIMIZATION OPPORTUNITIES

### HIGH IMPACT
1. **Telemetry counter writes per frame** - ~10 counter increments per frame could be batched or reduced
   - `perfYoloBallDetected` - only needed for telemetry
   - `perfMoveNetDecision*` counters - only needed for telemetry
   - `perfPlayerTracking*` counters - only needed for telemetry

2. **YOLO result spread** - `{ ...rawBall }` clones entire object
   - PASS 2 profiling will show if this is significant
   - Could use selective property extraction if object is large

### MEDIUM IMPACT
3. **PlayerCrop reads** - 5 reads every frame
   - Could be cached if player hasn't moved significantly

4. **Telemetry window reads** - ~40 reads every 1s
   - Could be reduced by only reading counters that changed

### LOW IMPACT
5. **Debug reads** - `yoloWorker.latestResultDebug.value`
   - Only read if debug mode is enabled
   - Could be gated behind a debug flag

6. **UI state writes** - `ballRejectionReason`, `rimRejectionReason`
   - Only needed when rejection occurs
   - Could be conditional on actual rejection

---

## RECOMMENDATIONS

### PASS 4: Micro-optimizations
1. **Profile YOLO spread impact** - Use PASS 2 data to decide if spread optimization is needed
2. **Batch telemetry counter writes** - Accumulate counters and write once per frame
3. **Conditional debug reads** - Only read debug SharedValue when debug mode is active
4. **Conditional UI writes** - Only write rejection reasons when rejection occurs
5. **Cache PlayerCrop reads** - Only read if player position changed significantly

### PASS 5: Benchmark
After optimizations, benchmark:
- Camera FPS
- Frame Processor avg/max
- YOLO FPS
- MoveNet FPS
- Drop rates
- SharedValue time (total and breakdown)

Verify no regression in:
- YOLO player detection
- MoveNet execution
- Player tracking
- Shot detection
