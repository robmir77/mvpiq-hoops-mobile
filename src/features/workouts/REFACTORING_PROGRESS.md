# Progresso Refactoring Modulo Workout

## Stato Attuale del Refactoring (Ottobre 2026)

### Riepilogo Completo
Il refactoring ha raggiunto un **milestone critico** per il tracking: la nuova architettura tracking è ora **autorevole in produzione** per Ball e Player. Shot detection ha due sistemi sovrapposti (nuovo + legacy). L'architettura di sessione è ancora ibrida: Runtime istanziato ma non operativo come coordinatore.

```
┌─────────────────────────────────────────────┐
│          WORKOUT REFACTORING                │
├─────────────────────────────────────────────┤
│                                             │
│  Documentazione             ██████████ 100% │
│  Vision adapter             ██████████ 100% │
│  Vision extraction          ████░░░░░░  40% │
│                                             │
│  Ball engine (AUTHORITATIVE)███████████ 100% │
│  Player engine (AUTHORITATIVE)███████████ 100% │
│  Shot engine (AUTHORITATIVE)███████████ 100% ⚠️
│                                             │
│  Tracking Coordinator       ██████████ 100% │
│  Runtime                    █████░░░░░  50% │
│  State machine              ████████░░  80% │
│  Screen decomposition       █████████░  90% │
│  Legacy removal              ███████░░░  70% │
│  New architecture tests     ████████░░  80% │
│                                             │
└─────────────────────────────────────────────┘
```

**Legenda:**
- ⚠️ ShotDetectionEngine autorevole ma ShotDetector legacy ancora presente (dual systems)
- Runtime: 50% - FASE A completata (Queue ownership):
  - ✅ Runtime API definite (enqueueCritical, enqueueTelemetry)
  - ✅ Screen usa Runtime API per enqueueCritical (4 chiamate migrate)
  - ✅ Screen usa Runtime.stop() per shutdown
  - ✅ runtime.stop() integrato in tutti i percorsi di terminazione (end, unmount)
  - ⚠️ TelemetrySampler registrato ma non usato dal Runtime (solo log)
  - ⚠️ Screen crea ancora Queue e la passa al Runtime (ownership intermedio)
- State machine: implementata nel Runtime ma non utilizzata
- Screen decomposition: ridotta a 1032 righe ma ancora possiede tracking/vision direttamente
- Legacy removal: ShotDetector e architettura vision legacy ancora presenti

### Fase 4.2 Completata: Production Switch Ball Tracking

**4.2.1: BallTrackingEngine Authoritative ✓**
- BallTrackingEngine è ora **autorevole** nel percorso operativo principale
- Codice legacy Kalman **completamente rimosso** da useTrackingEngine.ts
- Rimossi: `kalmanUpdate()`, `kalmanPredict()`, `predictFrame()`, `kalman` state, `ballLastSeenAt`, `ballTrackingValid`, `lastBallWasDetected`
- Il percorso operativo è ora:
  ```
  FRAME → BallTrackingEngine.update/predict → OUTPUT
  ```
- Confronto legacy mantenuto solo come fallback verification (opzionale)

**4.2.2: ShotDetectionEngine Pure ✓**
- Rimosso `useSharedValue` da ShotDetectionEngine
- Creato `ShotDetectionUIAdapter.ts` per gestire SharedValues come layer separato
- ShotDetectionEngine ora è **puro business logic** senza dipendenze React
- Pattern: Engine (puro) → UI Adapter (React) → SharedValues

**4.2.3: Tracking Coordinator Extracted ✓**
- Creato `TrackingCoordinator.ts` per logica di coordinamento
- Spostata logica `MAX_PLAYER_BALL_DISTANCE` e constraint spaziali da useTrackingEngine
- useTrackingEngine ora delega a TrackingCoordinator per validazioni
- Coordinator è puro, testabile, riutilizzabile

**4.2.4: Test Deterministici Aggiunti ✓**
- Creato `BallTrackingEngine.test.ts` - test equivalenza Kalman
- Creato `PlayerTrackingEngine.test.ts` - test equivalenza player center
- Creato `ShotDetectionEngine.test.ts` - test equivalenza shot detection
- Tutti i test verificano comportamento deterministico
- Test coprono: update, predict, TTL, state management, callbacks

**4.2.5: WorkoutSessionRuntime Connected ✓**
- Runtime ora accetta riferimenti ai tracking engines via `setTrackingEngine()`, `setShotDetectionEngine()`
- Metodi di inizializzazione aggiornati per coordinare (non possedere) i sottosistemi
- Pattern: Screen possiede engines → Runtime coordina → Engines eseguono
- State machine operativa con guardie di transizione

### Fase 4.3 Completata: Player e Shot Production Switch

**4.3.1: PlayerTrackingEngine Authoritative ✓**
- PlayerTrackingEngine è ora **autorevole** per il calcolo del player center
- Rimossa logica legacy player center da useTrackingEngine.ts
- Il calcolo del player center ora usa esclusivamente `playerTrackingEngine.updateFromPose(poseKeypoints)`
- Rimossi: calcolo legacy `(leftHip + rightHip) / 2` e statistiche di confronto
- Il percorso operativo è ora:
  ```
  POSE KEYPOINTS → PlayerTrackingEngine.updateFromPose → PLAYER CENTER
  ```

**4.3.2: ShotDetectionEngine Authoritative ⚠️**
- ShotDetectionEngine è **autorevole** nel percorso tracking (usato da useTrackingEngine)
- Il percorso tracking è:
  ```
  BALL POSITION + VELOCITY + HOOP → ShotDetectionEngine.processFrame → tracking state
  ```
- **MA**: ShotDetector legacy ancora presente in useShotTracker.ts
  - `import { ShotDetector } from './shotDetector'`
  - `shotDetector.current.detectShotStart/release/made/miss(...)` ancora chiamati
  - `onShotEvent(ev)` ancora attivo
- **Dual systems**: ShotDetectionEngine (nuovo) → tracking state, ShotDetector (legacy) → onShotEvent()
- Non ancora single source of truth per shot detection
- ShotDetectionUIAdapter integration deferita (richiede refactoring dell'adapter per rimuovere useSharedValue da classe)

## Struttura Attuale

```
features/workouts/
├── vision/              (NUOVO)
│   ├── WorkoutVisionPipeline.types.ts
│   ├── WorkoutVisionPipeline.ts
│   ├── useWorkoutVisionPipeline.ts
│   └── index.ts
├── tracking/            (NUOVO - COMPLETATO)
│   ├── BallTrackingEngine.ts          (AUTHORITATIVE)
│   ├── PlayerTrackingEngine.ts
│   ├── ShotDetectionEngine.ts         (PURO)
│   ├── ShotDetectionUIAdapter.ts      (NUOVO)
│   ├── TrackingCoordinator.ts         (NUOVO)
│   ├── BallTrackingState.ts
│   ├── index.ts
│   └── __tests__/
│       ├── BallTrackingEngine.test.ts
│       ├── PlayerTrackingEngine.test.ts
│       └── ShotDetectionEngine.test.ts
├── runtime/             (NUOVO)
│   ├── WorkoutSessionRuntime.types.ts
│   ├── WorkoutSessionRuntime.ts
│   └── index.ts
├── screens/
│   └── WorkoutSessionScreen.tsx (originale, ~2490 righe)
├── hooks/
│   ├── useTrackingEngine.ts           (RIDOTTO - legacy Kalman rimosso)
│   ├── usePerformanceMonitor.ts
│   └── ...
├── services/
│   ├── workoutAsyncQueue.ts
│   ├── telemetrySampler.ts
│   └── ...
└── REFACTORING_PLAN.md
```

## Prossimi Passi

### Fase 4.4: Screen Decomposition (COMPLETATA)

**4.4.1: Estrazione Componenti UI ✓**
- Estrarre overlay components da WorkoutSessionScreen
- Estrarre calibration components
- Estrarre shot result display components
- Ridurre Screen da ~2490 righe a < 1000 righe
- **Risultato**: WorkoutSessionScreen ridotto a 977 righe
- **Componenti estratti**:
  - `WorkoutHeader.tsx` - Header con stats e controlli
  - `WorkoutControls.tsx` - Pannello controlli e toggle
  - `ShotFeedback.tsx` - Feedback shot e tracking badge
  - `useScreenshotCapture.ts` - Hook per screenshot
  - `useVideoRecording.ts` - Hook per registrazione video
  - `useTrackingStatus.ts` - Hook per stato tracking
  - `useVisionConfig.ts` - Hook per configurazione vision
- Rimozione duplicato `ReactOverlay` da WorkoutSessionScreen

**4.4.2: Collegamento Runtime 🟡**
- WorkoutSessionRuntime è istanziato ma **NON è coordinatore operativo**
- Screen continua a possedere e orchestrare direttamente:
  - useTrackingEngine() → tracking engines
  - useWorkoutVisionPipeline() → vision pipeline
  - TelemetrySampler
  - WorkoutQueue
- **Runtime status**: skeleton/integration layer (~40%)
  - Implementa lifecycle e state transitions
  - Dispone delle API per collegare sottosistemi (setVisionPipeline, setTrackingEngine, setShotDetectionEngine, setWorkoutQueue)
  - **MA**: nessuna chiamata a runtimeRef.current?.start(), setVisionPipeline(), setTrackingEngine(), ecc.
  - Commenti nel Runtime confermano: "Vision pipeline will be initialized with the React hook", "Tracking engine is now provided via setTrackingEngine() - They are owned by the React hook (useTrackingEngine) for now"
- **Architettura attuale**:
  ```
  WorkoutSessionScreen
   ├── useTrackingEngine()          ← realmente operativo
   ├── useWorkoutVisionPipeline()   ← realmente operativo
   ├── WorkoutSessionRuntime        ← istanziato ma NON coordinatore
   ├── TelemetrySampler             ← operativo
   └── WorkoutQueue                 ← operativo
  ```
- **Target architettura (non ancora raggiunta)**:
  ```
  WorkoutSessionScreen
          ↓
  WorkoutSessionRuntime (coordinatore)
          ↓
  Vision / Tracking / Queue / Telemetry
  ```

### Fase 4.5: ShotDetectionUIAdapter Refactoring (DEFERRED)
- Refactor ShotDetectionUIAdapter per rimuovere useSharedValue da classe
- Convertire a hook React o pattern compatibile
- Integrare nella Screen per completa separazione engine/UI
- **Nota**: ShotDetectionUIAdapter.ts contiene `useSharedValue(false)` dentro la classe - uso non corretto di React Hooks
- Non considerato bug operativo finché la classe non viene effettivamente usata

### Fase 5: Ottimizzazioni Performance (IN ATTESA)
- FPS adattivo
- Regolazione frequenza YOLO
- Regolazione frequenza MoveNet
- Scaling risoluzione
- Selezione delegate GPU/CPU
- Thermal throttling
- Ottimizzazione batteria

## Note sull'Architettura

**Principi Architetturali Raggiunti:**
- ✅ **Pure Business Logic**: Tracking engines senza React/Reanimated
- ✅ **Separation of Concerns**: Engine (algoritmo) → Adapter (UI) → SharedValues
- ✅ **Testability**: Tutti i tracking engines testabili senza React Native
- ✅ **Production Switch**: Ball e Player engines autorevoli, legacy rimosso
- ⚠️ **Shot Detection Dual Systems**: ShotDetectionEngine autorevole ma ShotDetector legacy ancora presente
- ✅ **Coordinator Pattern**: TrackingCoordinator per logica cross-engine
- 🟡 **Session Architecture**: Runtime skeleton presente ma non coordinatore operativo

**Pattern Attuale (Ibrido):**
```
WorkoutSessionScreen (React)
       │
       ├── useTrackingEngine() → Ball/Player/Shot engines (AUTHORITATIVE)
       │
       ├── useWorkoutVisionPipeline() → useCameraPipeline → useShotTracker
       │
       ├── WorkoutSessionRuntime (istanziato ma NON coordinatore)
       │
       ├── TelemetrySampler (Screen-owned)
       │
       └── WorkoutQueue (Screen-owned)
```

**Pattern Target (Non Ancora Raggiunto):**
```
WorkoutSessionScreen (React - UI only)
       ↓
WorkoutSessionRuntime (Coordinator)
       ↓
TrackingCoordinator (Spatial Constraints)
       ↓
BallTrackingEngine (Pure Algorithm - AUTHORITATIVE)
PlayerTrackingEngine (Pure Algorithm - AUTHORITATIVE)
ShotDetectionEngine (Pure Algorithm - AUTHORITATIVE)
       ↓
ShotDetectionUIAdapter (React Bridge - DEFERRED)
       ↓
SharedValues (Reanimated)
```

**Milestone Raggiunto:**
La nuova architettura tracking è **operativa in produzione** per Ball e Player. Shot detection ha due sistemi sovrapposti. L'architettura di sessione è ancora ibrida: la Screen possiede direttamente vision, tracking, queue e telemetry. Il Runtime è un skeleton con API ma non è coordinatore operativo.

**Problemi Aperti:**

1. **Shot Detection Dual Systems — INTENTIONALLY RETAINED** 🟡
   - ShotDetectionEngine e ShotDetector implementano algoritmi differenti e non sono comportamentalmente equivalenti
   - ShotDetectionEngine: authoritative per tracking state (usato da useTrackingEngine)
     - Basato su: SHOT_LAUNCH_THRESHOLD=1.5, DESCENDING_VY_THRESHOLD=0.3, arc height + descending velocity
     - Output: shotDetected, shotResult, inFlight, releasePoint, apexPoint
   - ShotDetector: produce eventi per callback onShotEvent (usato da useShotTracker)
     - Basato su: SHOT_CANDIDATE_THRESHOLD_Y=0.3, MIN_STABLE_FRAMES=5, stability + timeout 2s
     - Output: ShotEvent con shotStarted, shotReleased, shotMade, shotMiss, releasePoint, releaseAngle
   - **Decisione**: rimozione di ShotDetector rimandata a fase successiva
   - **Roadmap futura**: analisi di equivalenza funzionale → decisione sull'algoritmo target → eventuale nuova versione dell'engine
   - **Nota**: non è un semplice problema di "legacy code", ma una duplicazione funzionale con due consumer diversi
   - Domanda futura: "Quale deve essere la source of truth dello shot event?" non "Come eliminiamo ShotDetector?"

2. **Runtime Queue Ownership - RISOLTO** ✅
   - FASE A completata: Runtime ora possiede WorkoutQueue
   - ✅ Runtime API definite: enqueueCritical(), enqueueTelemetry()
   - ✅ Tutte le chiamate Screen → Queue migrate a Runtime (enqueueCritical ×4, enqueueTelemetry)
   - ✅ Screen chiama runtime.stop() per shutdown (non più workoutQueue.shutdown())
   - ✅ runtime.stop() integrato in tutti i percorsi di terminazione (end, unmount)
   - ⚠️ Screen crea ancora Queue e la passa al Runtime (ownership intermedio, futuro: Runtime crea Queue)
   - Stato: 50% - pattern coordinatore parzialmente raggiunto
3. **Vision Extraction Incompleta**: useWorkoutVisionPipeline è solo un adapter su useCameraPipeline
4. **useShotTracker Sovraccarico**: continua a fare frame processing, YOLO/MoveNet orchestration, player crop, shot detection legacy, rim filtering, telemetry, tracking callback, performance diagnostics, frame scheduling, error recovery, SharedValues, camera frame output
5. **Vision FPS Remnants - RIMOSSI** ✅
   - MoveNet 3 FPS limit rimosso (MOVENET_TARGET_FPS eliminato)
   - Adaptive FPS code rimosso da useYoloWorker.ts (lastSubmitTime, targetFps, adaptiveFpsEnabled eliminati)
   - Ora nessun throttling temporale per YOLO e MoveNet per ARCHITECTURE.md
6. **Screen Non UI-Only**: 1032 righe, ancora possiede direttamente tracking e vision hooks
