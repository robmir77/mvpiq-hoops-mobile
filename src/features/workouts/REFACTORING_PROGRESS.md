# Progresso Refactoring Modulo Workout

## Stato Attuale del Refactoring (Ottobre 2026)

### Riepilogo Completo
Il refactoring ha raggiunto un **milestone critico**: la nuova architettura tracking è ora **autorevole in produzione** per Ball Tracking, con completa eliminazione del codice legacy Kalman.

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
│  Player engine              ██████░░░░  60% │
│  Shot engine                █████░░░░░  50% │
│                                             │
│  Tracking Coordinator       ██████████ 100% │
│  Runtime                    ████░░░░░░  40% │
│  State machine              ████░░░░░░  40% │
│  Screen decomposition        █░░░░░░░░░  10% │
│  Legacy removal (Ball)       ██████████ 100% │
│  New architecture tests     ████████░░  70% │
│                                             │
└─────────────────────────────────────────────┘
```

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

### Fase 4.3: Player e Shot Production Switch

**4.3.1: PlayerTrackingEngine Authoritative (PENDING)**
- Rendere PlayerTrackingEngine autorevole nel percorso operativo
- Rimuovere logica legacy player center da useTrackingEngine
- Verificare equivalenza con test deterministici

**4.3.2: ShotDetectionEngine Authoritative (PENDING)**
- Rendere ShotDetectionEngine autorevole nel percorso operativo
- Rimuovere logica legacy shot detection da useTrackingEngine
- Integrare ShotDetectionUIAdapter nella Screen
- Verificare equivalenza con test deterministici

### Fase 4.4: Screen Decomposition

**4.4.1: Estrazione Componenti UI (PENDING)**
- Estrarre overlay components da WorkoutSessionScreen
- Estrarre calibration components
- Estrarre shot result display components
- Ridurre Screen da ~2490 righe a < 1000 righe

**4.4.2: Collegamento Completo Runtime (PENDING)**
- WorkoutSessionScreen usa WorkoutSessionRuntime come coordinatore principale
- Screen diventa puramente UI/orchestration React
- Runtime gestisce lifecycle, tracking, shot detection, telemetry

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
- ✅ **Production Switch**: BallTrackingEngine autorevole, legacy rimosso
- ✅ **Coordinator Pattern**: TrackingCoordinator per logica cross-engine

**Pattern Stabilito:**
```
WorkoutSessionScreen (React)
       ↓
WorkoutSessionRuntime (Coordinator)
       ↓
TrackingCoordinator (Spatial Constraints)
       ↓
BallTrackingEngine (Pure Algorithm)
PlayerTrackingEngine (Pure Algorithm)
ShotDetectionEngine (Pure Algorithm)
       ↓
ShotDetectionUIAdapter (React Bridge)
       ↓
SharedValues (Reanimated)
```

**Milestone Raggiunto:**
La nuova architettura tracking è ora **operativa in produzione** per Ball Tracking. Il prossimo passo è estendere lo stesso pattern a Player e Shot detection, quindi procedere con la decomposizione della Screen.
