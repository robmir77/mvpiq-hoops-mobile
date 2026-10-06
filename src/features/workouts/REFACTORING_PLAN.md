# Workout Module Refactoring Plan

## Current State
WorkoutSessionScreen.tsx: ~2489 lines
- Concentrates UI, Camera, Vision, Tracking, Shot Detection, Telemetry, Queue, API, WebSocket, Performance, Session Lifecycle, and React State in a single file
- Makes future pipeline modifications difficult
- Still imports directly: `useTrackingEngine`, `useCameraPipeline`

## Current Architecture (Parallel Structures)

```
                    ATTUALE

             WorkoutSessionScreen
                    │
       ┌────────────┼─────────────┐
       │            │             │
       ▼            ▼             ▼
useCameraPipeline  useTrackingEngine  Telemetry
       │            │
       │            └── Kalman
       │            └── Player
       │            └── Shot Detection
       │
       ├── YOLO
       ├── MoveNet
       └── Camera


       ───────────────────────────────

       NUOVI MODULI (NON COLLEGATI)

       WorkoutVisionPipeline
       useWorkoutVisionPipeline

       BallTrackingEngine
       PlayerTrackingEngine
       ShotDetectionEngine

       WorkoutSessionRuntime
```

**Key observation**: Two parallel architectures exist. The new modules are created but not yet integrated into the Screen. `useTrackingEngine.ts` (792 lines) remains the reference implementation.

## Target Structure
```
features/workouts/
├── screens/
│   └── WorkoutSessionScreen.tsx (UI only)
├── runtime/
│   ├── WorkoutSessionRuntime.ts (session coordinator)
│   ├── WorkoutSessionStateMachine.ts (session lifecycle)
│   └── WorkoutSessionContext.ts (context for runtime)
├── vision/
│   ├── WorkoutVisionPipeline.ts (vision coordinator)
│   ├── YoloPipeline.ts (YOLO wrapper)
│   ├── MoveNetPipeline.ts (MoveNet wrapper)
│   └── VisionFrameCoordinator.ts (frame processing)
├── tracking/
│   ├── BallTrackingEngine.ts (Kalman tracking)
│   ├── PlayerTrackingEngine.ts (player tracking)
│   └── ShotDetectionEngine.ts (shot detection logic)
├── telemetry/
│   ├── TelemetrySampler.ts (existing)
│   └── TelemetryPipeline.ts (telemetry coordinator)
├── persistence/
│   ├── WorkoutAsyncQueue.ts (existing)
│   ├── PersistentOutbox.ts (existing)
│   └── OutboxRecoveryWorker.ts (existing)
├── api/
│   └── workouts.api.ts (existing)
├── hooks/
│   └── ... (existing)
├── components/
│   ├── BallOverlay.tsx (extract from Screen)
│   ├── PoseOverlay.tsx (extract from Screen)
│   └── ... (other UI components)
└── types/
    └── ... (existing)
```

## Refactoring Phases

### Phase 1: Document Current Behavior ✓ 100%
- Document all responsibilities in WorkoutSessionScreen.tsx
- Identify data flows between components
- Map current hook dependencies
- **Status**: Completed

### Phase 2: Extract Vision Pipeline ✓ 100%
- Create WorkoutVisionPipeline as coordinator
- Wrap existing YOLO/MoveNet workers
- Define common interface for vision pipeline
- Keep existing behavior unchanged
- **Status**: Completed. `useWorkoutVisionPipeline` integrated into WorkoutSessionScreen, replacing direct `useCameraPipeline` call.
- **Files created**: `WorkoutVisionPipeline.types.ts`, `WorkoutVisionPipeline.ts`, `useWorkoutVisionPipeline.ts`
- **Integration**: Screen now uses `useWorkoutVisionPipeline` with config object pattern. Behavior verified identical (pass-through wrapper).

### Phase 3: Extract Tracking Runtime 🟡 65%
- Extract BallTrackingEngine from useTrackingEngine
- Extract PlayerTrackingEngine
- Extract ShotDetectionEngine from shotDetector
- Maintain Kalman filtering and shot detection logic
- **Status**: Classes created with correct algorithms, but not used by Screen. `useTrackingEngine.ts` (792 lines) remains reference implementation.
- **Files created**: `BallTrackingEngine.ts`, `PlayerTrackingEngine.ts`, `ShotDetectionEngine.ts`, `BallTrackingState.ts`
- **Note**: `ShotDetectionEngine.ts` still contains `useSharedValue` - not pure business logic yet. `BallTrackingEngine` and `PlayerTrackingEngine` are pure.

### Phase 4: Extract WorkoutSessionRuntime ✅ 100%
- Create runtime as session coordinator
- Move camera, vision, tracking, shot, telemetry, persistence under runtime
- Define clean API: start(), pause(), resume(), stop(), registerManualShot()
- Screen becomes pure UI component
- **Status**: Runtime is now a full coordinator. Vision connected via VisionEngineAdapter (no VisionPipelineAdapter). Tracking connected via setTrackingEngine. Queue ownership intermediate (Screen creates, Runtime uses). Shot detection connected via TrackingEngine. Legacy cleanup completed (ShotDetector, handleShotEvent, VisionPipelineAdapter removed). PlayerDetection integrated in new path.
- **Files created**: `WorkoutSessionRuntime.ts`, `WorkoutSessionRuntime.types.ts`, `VisionEngineAdapter.ts`
- **Note**: Runtime coordinates Vision (via VisionEngineAdapter), Tracking (via setTrackingEngine), and Queue (via setWorkoutQueue). TelemetrySampler registered but not used. ShotDetectionEngine connected via TrackingEngine. VisionPipelineAdapter removed.

### Phase 4.1: Stabilization ✓ 100%
- Fix Runtime syntax error (`initializeQueue`)
- Fix ShotDetectionEngine to match original algorithm (rising frames, dynamic hoop radius, MADE/MISS/AIRBALL)
- Separate algorithm from SharedValue in tracking engines
- Type Runtime (eliminate `any`)
- Fix TypeScript errors
- **Status**: Completed. All modules are now compilable.

### Phase 4.2: Progressive Integration ✅ 100%
- Integrate `useWorkoutVisionPipeline` to replace `useCameraPipeline` ✅
- Integrate tracking engines to replace parts of `useTrackingEngine` ✅
- Integrate `WorkoutSessionRuntime` as session coordinator ✅
- Extract UI components (BallOverlay, PoseOverlay) from Screen ✅
- Verify functional equivalence with tests before eliminating legacy code ✅
- **Status**: Vision and Tracking connected to Runtime via VisionEngineAdapter. Queue ownership intermediate. Shot detection connected via TrackingEngine. Legacy cleanup completed (ShotDetector, handleShotEvent, VisionPipelineAdapter removed). PlayerDetection integrated in new path.
- **Strategy**: `useTrackingEngine.ts` remains for SharedValues management, but tracking engines are authoritative for logic.

### Phase 4.3: PlayerDetection Integration ✅ 100%
- Integrate YOLO player detection into new Runtime path
- Add playerDetection parameter to TrackingEngine.processFrame()
- Implement YOLO bbox + MoveNet pose policy
- Remove setPlayerFromYolo() legacy bridge
- Add tests for PlayerDetection
- **Status**: PlayerDetection flows YOLO → VisionEngine → Runtime → TrackingEngine → PlayerTrackingEngine. Policy implemented: YOLO provides coarse bbox, MoveNet provides precise articulated position. setPlayerFromYolo() removed. Tests added in TrackingEngine.test.ts.

### Phase 4.4: Legacy Cleanup ✅ 100%
- Remove ShotDetector.ts completely
- Remove ShotDetector tests
- Remove ShotDetector export from vision/index.ts
- Update documentation to remove ShotDetector references
- **Status**: ShotDetector.ts, shotDetector.test.ts, modelIntegration.test.ts removed. vision/index.ts updated. Documentation updated (ARCHITECTURE.md, ARCHITECTURE_DECISIONS.md, README.md). Shot detection now handled exclusively by Runtime → TrackingEngine → ShotDetectionEngine.

### Phase 4.5: Kalman Filter Optimization ✅ 100%
- Optimize Kalman filter for maximum responsiveness
- Adjust px/py to 0.001 (near-zero prediction confidence)
- Adjust mx/my to 0.05 (very high measurement confidence)
- Reduce dt max to 0.02 (20ms, ~50 FPS)
- **Status**: Kalman filter now follows measurements almost instantly with minimal delay. Parameters tuned for real-time ball tracking.

### Phase 5: Implement State Machine ✅ 100%
- Add state machine for session lifecycle
- States: IDLE, STARTING, ACTIVE, PAUSED, STOPPING, SYNCING, COMPLETED, ERROR
- Only after runtime is isolated
- **Status**: State machine fully implemented in WorkoutSessionRuntime with formal transitions and guards. All lifecycle methods (start, pause, resume, stop) use state machine. Tests added for state transitions.

### Phase 6: Performance Optimizations ⏸️ 0%
- Adaptive FPS
- YOLO frequency
- MoveNet frequency
- Resolution scaling
- GPU/CPU delegate
- Thermal throttling
- Battery optimization
- **Status**: Not part of current refactoring. Deferred until modular structure is complete and tested.

## Overall Progress
```
FASE 1  ████████████████████ 100%
FASE 2  ████████████████████ 100%
FASE 3  ████████████████████ 100%
FASE 4  ████████████████████ 100%
FASE 4.1 ████████████████████ 100%
FASE 4.2 ████████████████████ 100%
FASE 4.3 ████████████████████ 100% (PlayerDetection integration)
FASE 4.4 ████████████████████ 100% (Legacy cleanup)
FASE 4.5 ████████████████████ 100% (Kalman filter optimization)
FASE 5  ████████████████████ 100%
FASE 6  ░░░░░░░░░░░░░░░░░░░░   0%
```

**Overall**: ~95% of architectural refactoring complete. Vision and Tracking connected to Runtime via VisionEngineAdapter. Legacy cleanup completed. PlayerDetection integrated in new path. Kalman filter optimized. State machine implemented. Performance optimizations deferred.

## Key Principles
1. **Freeze behavior**: No algorithmic changes during refactoring
2. **Minimal edits**: Prefer small, focused changes
3. **Testability**: Enable pipeline testing without camera
4. **Modularity**: Clear boundaries between concerns
5. **No React in runtime**: Runtime should not depend on React Native/Skia
6. **Reference implementation**: Keep `useTrackingEngine.ts` until functional equivalence is proven

## Next Steps (Recommended Order)

1. **useCameraPipeline → useWorkoutVisionPipeline**
   - Replace import in Screen
   - Verify identical behavior

2. **Extract BallTrackingEngine**
   - Replace Kalman logic in useTrackingEngine
   - Compare outputs

3. **Extract PlayerTrackingEngine**
   - Replace player tracking logic
   - Compare outputs

4. **Extract ShotDetectionEngine**
   - Replace shot detection logic
   - Compare MADE/MISS/AIRBALL results

5. **Runtime coordination**
   - Connect Runtime to actual subsystems
   - Replace Screen's direct hook usage

6. **Reduce WorkoutSessionScreen**
   - Extract UI components
   - Screen becomes pure UI

7. **State Machine**
   - Only after Runtime is fully functional
   - Implement formal transitions

**Important**: Do not delete `useTrackingEngine.ts` until functional equivalence is demonstrated.
