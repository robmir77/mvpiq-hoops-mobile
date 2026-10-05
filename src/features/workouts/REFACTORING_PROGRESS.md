# Progresso Refactoring Modulo Workout

## Fasi Completate

### Fase 1: Documentare Comportamento Attuale ✓
- Creato REFACTORING_PLAN.md che documenta la struttura attuale
- Identificate tutte le responsabilità in WorkoutSessionScreen.tsx (~2490 righe)
- Mappati i flussi di dati tra i componenti

### Fase 2: Estrazione Vision Pipeline ✓
Creato nuova struttura modulo vision:
- `features/workouts/vision/WorkoutVisionPipeline.types.ts` - Definizioni dei tipi
- `features/workouts/vision/WorkoutVisionPipeline.ts` - Coordinatore basato su classi (futuro)
- `features/workouts/vision/useWorkoutVisionPipeline.ts` - Wrapper hook
- `features/workouts/vision/index.ts` - Export del modulo

**Integrazione completata**: `useWorkoutVisionPipeline` ora è integrato in WorkoutSessionScreen, sostituendo la chiamata diretta a `useCameraPipeline`. L'hook usa un pattern config object per raggruppare i parametri e delega a `useCameraPipeline` mantenendo il comportamento identico.

### Fase 3: Estrazione Tracking Runtime ✓
Creato nuova struttura modulo tracking:
- `features/workouts/tracking/BallTrackingEngine.ts` - Filtro Kalman e stato palla
- `features/workouts/tracking/PlayerTrackingEngine.ts` - Tracking bbox player
- `features/workouts/tracking/ShotDetectionEngine.ts` - Analisi traiettoria tiro
- `features/workouts/tracking/BallTrackingState.ts` - Stato puro senza React
- `features/workouts/tracking/index.ts` - Export del modulo

**Fase 3 Completata**: Tutti e tre i tracking engines sono stati integrati in parallelo con la logica legacy in `useTrackingEngine.ts`:
- BallTrackingEngine: Kalman update/predict, TTL, trajectory
- PlayerTrackingEngine: Player center da pose keypoints (aggiunto metodo `updateFromPose`)
- ShotDetectionEngine: Dribble filter, shot detection (MADE/MISS/AIRBALL), trajectory management
- Sistema di confronto A/B per tutti e tre gli engine con statistiche dettagliate
- Log di warning in DEV per prime 10 discrepanze per ogni engine
- Reset di tutti gli engine in `resetShot()` e `resetAll()`
- TypeScript compila senza errori

### Fase 4: Estrazione WorkoutSessionRuntime ✓
Creato nuova struttura modulo runtime:
- `features/workouts/runtime/WorkoutSessionRuntime.types.ts` - Contratti del runtime
- `features/workouts/runtime/WorkoutSessionRuntime.ts` - Classe coordinatore sessione
- `features/workouts/runtime/index.ts` - Export del modulo

La classe `WorkoutSessionRuntime` fornisce:
- Lifecycle della sessione: start(), pause(), resume(), stop()
- Registrazione tiro manuale
- Gestione stati (IDLE, STARTING, ACTIVE, PAUSED, STOPPING, SYNCING, COMPLETED, ERROR)
- Tracking delle metriche
- Metodi placeholder per coordinamento sottosistemi

### Fase 4.1: Stabilizzazione Estrazioni ✓
Fix critici per rendere i moduli pronti all'integrazione:

**4.1.1: Fix Runtime syntax error**
- Corretto errore `await this initializeQueue()` → `await this.initializeQueue()`
- Il runtime è ora compilabile

**4.1.2: Fix ShotDetectionEngine**
- Riallineato all'algoritmo originale da `useTrackingEngine.ts` (linee 466-556)
- Implementato filtro dribble: `risingFrames`, `MIN_RISING_FRAMES = 3`, `MIN_ARC_HEIGHT = 0.08`
- Implementato `getDynamicHoopRadius()` con calcolo dinamico
- Implementato distinzione completa: MADE, MISS, AIRBALL
- Implementato ring buffer per traiettoria (O(1) insert)
- L'equivalenza funzionale con l'originale deve essere verificata con test prima dell'integrazione definitiva

**4.1.3: Separare algoritmo da SharedValue**
- Creato `BallTrackingState.ts` con stato puro senza dipendenze React
- `BallTrackingEngine` ora usa stato puro invece di `useSharedValue`
- `PlayerTrackingEngine` uniformato per usare `frameTs` invece di `Date.now()`
- Questo rende i tracking engines testabili senza React Native

**4.1.4: Tipizzare Runtime**
- Eliminati tutti i tipi `any` da `WorkoutSessionRuntime`
- Aggiunte interfacce minime: `IVisionPipeline`, `ITrackingEngine`, `IShotDetectionEngine`, `ITelemetrySampler`, `IWorkoutQueue`
- Sostituito `any` con `unknown` in `SessionConfig` per delegate
- Il runtime ora ha contratti espliciti per tutti i sottosistemi

## Struttura Attuale

```
features/workouts/
├── vision/              (NUOVO)
│   ├── WorkoutVisionPipeline.types.ts
│   ├── WorkoutVisionPipeline.ts
│   ├── useWorkoutVisionPipeline.ts
│   └── index.ts
├── tracking/            (NUOVO)
│   ├── BallTrackingEngine.ts
│   ├── PlayerTrackingEngine.ts
│   ├── ShotDetectionEngine.ts
│   └── index.ts
├── runtime/             (NUOVO)
│   ├── WorkoutSessionRuntime.types.ts
│   ├── WorkoutSessionRuntime.ts
│   └── index.ts
├── screens/
│   └── WorkoutSessionScreen.tsx (originale, ~2490 righe)
├── hooks/
│   ├── useTrackingEngine.ts
│   ├── usePerformanceMonitor.ts
│   └── ...
├── services/
│   ├── workoutAsyncQueue.ts
│   ├── telemetrySampler.ts
│   └── ...
└── REFACTORING_PLAN.md
```

## Prossimi Passi

### Fase 4.2: Integrazione Progressiva (IN CORSO)
Integrazione graduale dei nuovi moduli nella Screen:

**4.2.1: All Tracking Engines Integration ✓**
Tutti e tre i tracking engines sono stati integrati in parallelo con la logica legacy in `useTrackingEngine.ts`:

- **BallTrackingEngine**: Kalman update/predict, TTL, trajectory
- **PlayerTrackingEngine**: Player center da pose keypoints (aggiunto metodo `updateFromPose`)
- **ShotDetectionEngine**: Dribble filter, shot detection (MADE/MISS/AIRBALL), trajectory management

Sistema di confronto A/B per tutti gli engine:
- `detectionMatches` / `detectionMismatches` (BallTrackingEngine)
- `predictionMatches` / `predictionMismatches` (BallTrackingEngine)
- `maxPositionDiff` / `maxVelocityDiff` (BallTrackingEngine)
- `playerCenterMatches` / `playerCenterMismatches` (PlayerTrackingEngine)
- `shotDetectionMatches` / `shotDetectionMismatches` (ShotDetectionEngine)
- `getComparisonStats()` esposto per verifica con tutti i match rate
- Log di warning in DEV per prime 10 discrepanze per ogni engine
- Reset di tutti gli engine in `resetShot()` e `resetAll()`
- TypeScript compila senza errori

**4.2.2: All Tracking Engines Validation (PENDING)**
Criteri di verifica prima della sostituzione:
- `detectionMatchRate` = 100%
- `predictionMatchRate` = 100%
- `playerCenterMatchRate` = 100%
- `shotDetectionMatchRate` = 100%
- `maxPositionDiff` = 0 o tolleranza minima documentata (es. < 0.0001 per rumore float)
- `maxVelocityDiff` = 0 o tolleranza minima documentata
- Nessuna differenza sistematica nei frame di perdita/recupero della palla
- Nessuna differenza dopo `resetShot()`
- Nessuna differenza dopo `resetAll()`

Sessioni di test richieste (2-3 sessioni reali):
1. Sessione con tiri regolari
2. Sessione con palla intermittente/occlusioni
3. Sessione con movimenti più difficili

**Nota**: Distinguere tra mismatch logico e rumore numerico float (es. differenze < 0.000001 accettabili)

**4.2.3: Runtime Integration (PENDING)**
- Da integrare dopo verifica tutti tracking engines

**4.2.4: UI Component Extraction (PENDING)**
- Da integrare dopo verifica runtime

### Fase 5: Implementare State Machine ✓
Completata implementazione della State Machine in WorkoutSessionRuntime:
- Definite transizioni di stato con guardie: IDLE → STARTING → ACTIVE → PAUSED → STOPPING → SYNCING → COMPLETED → ERROR
- Implementato metodo `canTransition()` per validare le transizioni
- Aggiornati tutti i metodi lifecycle (start, pause, resume, stop) per usare le guardie
- Implementato stato SYNCING reale per persistenza dati durante shutdown
- Definite interfacce complete per sottosistemi:
  - `ITrackingEngine`: processFrame, resetShot, resetAll, getState, getComparisonStats
  - `IShotDetectionEngine`: processFrame, resetShot, resetAll
- Wiring dei tracking engines nel Runtime con log di warning se non forniti
- TypeScript compila senza errori

### Fase 6: Ottimizzazioni Performance (IN ATTESA)
- FPS adattivo
- Regolazione frequenza YOLO
- Regolazione frequenza MoveNet
- Scaling risoluzione
- Selezione delegate GPU/CPU
- Thermal throttling
- Ottimizzazione batteria

## Note sull'Integrazione

I nuovi moduli sono attualmente **indipendenti** e non ancora integrati in WorkoutSessionScreen.tsx. La Fase 4.1 ha completato la stabilizzazione:
- Il runtime è compilabile
- ShotDetectionEngine replica l'algoritmo originale
- I tracking engines sono separati dalle SharedValue
- Il runtime ha contratti tipizzati

La Fase 4.2 procederà con l'integrazione graduale, mantenendo `useTrackingEngine.ts` come reference implementation fino a dimostrazione di equivalenza funzionale.
