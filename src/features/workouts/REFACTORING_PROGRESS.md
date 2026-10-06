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
│  Runtime                    ███████░░░  70% │
│  State machine              ████████░░  80% │
│  Screen decomposition       █████████░  90% │
│  Legacy removal              ███████░░░  70% │
│  New architecture tests     ████████░░  80% │
│                                             │
└─────────────────────────────────────────────┘
```

**Legenda:**
- ⚠️ ShotDetectionEngine autorevole ma ShotDetector legacy ancora presente (dual systems)
- Runtime: 70% - FASE B completata (Vision + Tracking ownership):
  - ✅ Runtime API definite (enqueueCritical, enqueueTelemetry)
  - ✅ Screen usa Runtime API per enqueueCritical (4 chiamate migrate)
  - ✅ Screen usa Runtime.stop() per shutdown
  - ✅ runtime.stop() integrato in tutti i percorsi di terminazione (end, unmount)
  - ✅ VisionPipelineAdapter creato per collegare useWorkoutVisionPipeline a IVisionPipeline
  - ✅ Runtime.setVisionPipeline() chiamato da Screen
  - ✅ Runtime può controllare vision pipeline (start/stop) tramite lifecycle
  - ✅ Runtime.setTrackingEngine() chiamato da Screen
  - ⚠️ TelemetrySampler registrato ma non usato dal Runtime (solo log)
  - ⚠️ Screen crea ancora Queue e la passa al Runtime (ownership intermedio)
  - ⚠️ ShotDetectionEngine non ancora collegato al Runtime
- State machine: implementata nel Runtime ma non utilizzata
- Screen decomposition: ridotta a 1043 righe ma ancora possiede tracking/vision hooks (collegati al Runtime)
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

**4.4.2: Collegamento Runtime 🟢**
- WorkoutSessionRuntime è ora **coordinatore operativo parziale**
- Screen possiede ancora:
  - useTrackingEngine() → tracking engines (ma collegato al Runtime)
  - useWorkoutVisionPipeline() → vision pipeline (ma collegato al Runtime)
  - TelemetrySampler
  - WorkoutQueue (creato da Screen, passato al Runtime)
- **Runtime status**: coordinatore parziale (~70%)
  - Implementa lifecycle e state transitions
  - ✅ TrackingEngine collegato via setTrackingEngine()
  - ✅ VisionPipeline collegato via VisionPipelineAdapter + setVisionPipeline()
  - ✅ Runtime può controllare vision pipeline tramite start/pause/resume/stop
  - ⚠️ ShotDetectionEngine non ancora collegato
  - ⚠️ TelemetrySampler registrato ma non usato effettivamente
- **Architettura attuale**:
  ```
  WorkoutSessionScreen
   ├── useTrackingEngine()          ← operativo, collegato al Runtime
   ├── useWorkoutVisionPipeline()   ← operativo, collegato al Runtime via Adapter
   ├── WorkoutSessionRuntime        ← coordinatore Vision + Tracking + Queue
   ├── TelemetrySampler             ← operativo
   └── WorkoutQueue                 ← operativo, ownership intermedio
  ```
- **Target architettura (parzialmente raggiunta)**:
  ```
  WorkoutSessionScreen
          ↓
  WorkoutSessionRuntime (coordinatore Vision/Tracking/Queue)
          ├── Vision ✓ (collegato)
          ├── Tracking ✓ (collegato)
          ├── Shot ✗ (non collegato)
          ├── Queue ✓ (ownership intermedio)
          └── Telemetry ⚠️ (registrato ma non usato)
  ```

### Fase 4.5: Vision Pipeline Integration ✅ COMPLETATA

**4.5.1: VisionPipelineAdapter Creato ✓**
- Creato `VisionPipelineAdapter.ts` che implementa `IVisionPipeline`
- Adapter wrappa le funzioni `setIsActive(true/false)` di useWorkoutVisionPipeline
- Permette al Runtime di controllare la vision pipeline senza dipendenze React
- Pattern: React Hook → Adapter → IVisionPipeline Interface → Runtime

**4.5.2: Runtime Vision Control ✓**
- Screen crea VisionPipelineAdapter e lo passa al Runtime via setVisionPipeline()
- Runtime.start() chiama visionPipeline.start() per attivare la camera
- Runtime.pause() chiama visionPipeline.stop() per mettere in pausa
- Runtime.resume() chiama visionPipeline.start() per riprendere
- Runtime.stop() chiama visionPipeline.stop() per spegnere
- Il Runtime ora coordina effettivamente il lifecycle della vision pipeline

**4.5.3: Tracking Engine Connection ✓**
- useTrackingEngine.getTrackingEngine() restituisce l'istanza TrackingCoordinator
- Screen passa l'istanza al Runtime via setTrackingEngine()
- Runtime può coordinare il tracking engine (anche se non lo possiede)
- TrackingCoordinator è già autorevole per constraint spaziali

### Fase 4.6: Shot Detection Integration (PROSSIMO STEP)
- Collegare ShotDetectionEngine al Runtime
- Evitare doppio ownership (Screen → Shot, Runtime → Shot)
- Deve diventare: Runtime → Shot
- ShotDetectionUIAdapter refactoring (rimuovere useSharedValue da classe)

### Fase 4.7: ShotDetectionUIAdapter Refactoring (DEFERRED)
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

2. **Runtime Subsystem Ownership - IN CORSO** 🟡
   - FASE A completata: Runtime ora possiede WorkoutQueue (ownership intermedio)
   - ✅ Runtime API definite: enqueueCritical(), enqueueTelemetry()
   - ✅ Tutte le chiamate Screen → Queue migrate a Runtime (enqueueCritical ×4, enqueueTelemetry)
   - ✅ Screen chiama runtime.stop() per shutdown (non più workoutQueue.shutdown())
   - ✅ runtime.stop() integrato in tutti i percorsi di terminazione (end, unmount)
   - ✅ FASE B completata: Vision collegata via VisionPipelineAdapter
   - ✅ FASE B completata: Tracking collegato via setTrackingEngine()
   - ⚠️ Screen crea ancora Queue e la passa al Runtime (ownership intermedio, futuro: Runtime crea Queue)
   - ⚠️ ShotDetectionEngine non ancora collegato al Runtime
   - ⚠️ TelemetrySampler registrato ma non usato effettivamente
   - Stato: 70% - pattern coordinatore parzialmente raggiunto (Vision + Tracking + Queue)
3. **Vision Extraction - COMPLETATA** ✅
   - useWorkoutVisionPipeline è adapter su useCameraPipeline
   - VisionPipelineAdapter collega l'hook React all'interfaccia IVisionPipeline
   - Runtime ora controlla vision pipeline tramite adapter
   - Estrazione completa richiede refactor di useCameraPipeline (fase successiva)
4. **useShotTracker Sovraccarico**: continua a fare frame processing, YOLO/MoveNet orchestration, player crop, shot detection legacy, rim filtering, telemetry, tracking callback, performance diagnostics, frame scheduling, error recovery, SharedValues, camera frame output
5. **Vision FPS Remnants - RIMOSSI** ✅
   - MoveNet 3 FPS limit rimosso (MOVENET_TARGET_FPS eliminato)
   - Adaptive FPS code rimosso da useYoloWorker.ts (lastSubmitTime, targetFps, adaptiveFpsEnabled eliminati)
   - Ora nessun throttling temporale per YOLO e MoveNet per ARCHITECTURE.md
6. **Screen Non UI-Only**: 1043 righe, possiede tracking e vision hooks ma collegati al Runtime
