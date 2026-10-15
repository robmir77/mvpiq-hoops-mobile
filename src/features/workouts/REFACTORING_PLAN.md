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
- Add tests for PlayerDetection
- **Status**: PlayerDetection flows YOLO → VisionEngine → Runtime → TrackingEngine → PlayerTrackingEngine. Policy implemented: YOLO provides coarse bbox, MoveNet provides precise articulated position. playerDetection parameter added to TrackingEngine.processFrame(). Tests added in TrackingEngine.test.ts.

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

---

## Fase 3 - Completamento del Resoconto del Workout

### Obiettivo

Il resoconto dovrà rappresentare i dati reali di una sessione conclusa, non una simulazione.

**A. Tabellone del campo**
- Metà campo da basket con orientamento e proporzioni coerenti
- Un pallino per ciascun tiro registrato, nella posizione del giocatore al momento del rilascio
- Verde per il canestro, rosso per l'errore
- Voto da 1 a 10 dentro il pallino, se disponibile
- Angolo della parabola in gradi sopra il pallino, se disponibile
- Gestione etichette ravvicinate per evitare sovrapposizioni

**B. Riepilogo statistico**
- Tiri totali (N)
- Canestri (N / %)
- Voto medio (— / 10) - solo tiri con voto disponibile
- Angolo medio (—°) - solo tiri con angolo valido

**C. Dettaglio dei singoli tiri**
- Esito, posizione, voto, angolo, distanza dal canestro
- Confronto rapido tra ciò che è disegnato sul campo e il dato salvato

### Fase 0 - Audit dei Sorgenti (In Corso)

Prima di decidere cosa cambiare, ricostruiamo il percorso completo di un tiro senza modifiche al codice.

**0.1 - Identificare la versione esatta**
- Frontend React Native e schermata del workout
- Backend, API, modelli e schema del database
- Motore di visione, tracking e rilevamento del tiro
- Documentazione architetturale e decisioni già prese

**0.2 - Ricostruire il ciclo di vita del tiro**
Seguiremo il singolo tiro dall'inizio alla fine:
- Rilevamento visione (YOLO/MoveNet)
- Tracking e macchina a stati
- Costruzione evento di tiro
- Accodamento e persistenza
- Salvataggio backend
- Recupero per resoconto

Per ciascun passaggio cercheremo:
- Quale componente è responsabile
- Quali dati riceve e quali produce
- Se conserva il timestamp originale
- Se può perdere, duplicare o ritardare un evento
- Come vengono gestiti gli errori

**0.3 - Verificare la posizione del giocatore**
Dobbiamo distinguere tre cose non intercambiabili:
1. La posizione della palla
2. La posizione del giocatore nell'immagine della videocamera
3. La posizione del giocatore rappresentata sul campo da basket

**Criticità identificata (ShotEventBuilder.ts):**
- Il metodo che calcola la posizione sul campo riceve `trackingState.ballPosition`
- Il commento dichiara che la proiezione tramite omografia è ancora da implementare
- Usa un'approssimazione delle coordinate
- `timestampMs` viene assegnato usando `Date.now()` al momento della costruzione dell'evento

**Criterio di accettazione:** Il punto sul campo deve rappresentare la posizione del giocatore al momento del tiro, non la posizione della palla, il centro del riquadro YOLO o la posizione del giocatore qualche istante dopo.

**0.4 - Verificare voto e angolo**

| Dato | Domanda da risolvere |
|------|---------------------|
| Esito | Come viene stabilito se il tiro è realizzato o sbagliato? |
| Voto | Esiste già? Qual è la scala e come viene calcolato? |
| Angolo | È riferito al rilascio del tiro oppure a un frame successivo? |
| Distanza | È calcolata in coordinate reali o in coordinate dell'immagine? |
| Timestamp | È quello dell'evento originale o quello di elaborazione? |

**Nota:** La visualizzazione durante il workout e il dato storico del resoconto sono due percorsi distinti.

**0.5 - Verificare salvataggio e recupero**
- Struttura dell'evento inviato
- Identificativo della sessione e del singolo tiro
- Coda degli eventi e gestione dei tentativi falliti
- Eventuali duplicazioni durante i retry
- Salvataggio effettivo nel database
- Risposta dell'API utilizzata dal resoconto
- Comportamento quando uno o più campi non sono disponibili

**Criterio di accettazione:** Un tiro confermato come registrato deve poter essere recuperato con gli stessi dati essenziali con cui è stato generato.

**0.6 - Verificare la chiusura del workout**
Ricostruiremo la sequenza eseguita quando premi "Fine workout":
1. Il runtime smette di elaborare nuovi frame
2. Gli ultimi eventi di tiro vengono completati
3. La coda viene gestita secondo le garanzie effettive del sistema
4. Il backend conferma i salvataggi necessari
5. Il resoconto recupera i dati della sessione
6. La schermata mostra il riepilogo completo

### Fasi Successive - Analisi e Implementazione Guidata

| Fase | Attività | Risultato da verificare |
|------|----------|-------------------------|
| 1 | Definizione del contratto dati del tiro | Tutti i componenti concordano sui campi e sul loro significato |
| 2 | Correttezza temporale e posizione del giocatore | Il tiro è associato al frame e alla posizione corretti |
| 3 | Esito, voto e angolo | Regole definite, dati coerenti e valori mancanti gestiti |
| 4 | Persistenza e API | I dati arrivano al backend e vengono recuperati senza perdite |
| 5 | Schermata del resoconto | Campo, pallini, etichette, dettaglio e statistiche sono coerenti |
| 6 | Chiusura e sincronizzazione | Il resoconto include anche gli ultimi tiri |
| 7 | Collaudo end-to-end | I risultati superano una checklist di test ripetibili |

### Metodologia di Lavoro

Ogni passaggio avrà sempre cinque elementi:
1. **Analisi:** Cosa succede nel codice attuale
2. **Problema dimostrato:** Cosa manca o cosa non funziona, con riferimenti ai file e ai punti pertinenti
3. **Istruzioni operative:** Cosa dovrai fare tu, in quale ordine
4. **Verifica:** Quali risultati, log o test dovrai condividere
5. **Decisione:** Passiamo oltre soltanto se i criteri sono soddisfatti

Non considereremo conclusa una fase perché il codice compila soltanto.

### Matrice di Test Finale

Prima di dichiarare conclusa la Fase 3, prepareremo una matrice di test che comprenda almeno questi casi:
- Workout con soli canestri
- Workout con soli errori
- Workout misto
- Tiri ravvicinati sul tabellone
- Tiro senza voto o senza angolo disponibile
- Più tiri in rapida successione
- Interruzione o ritardo di rete
- Chiusura immediata dopo l'ultimo tiro
- Riapertura del resoconto dopo aver concluso la sessione

Per ogni caso confronteremo tre conteggi: tiri effettivamente eseguiti, eventi registrati e tiri visualizzati. Verificheremo anche le singole coordinate, gli esiti e i valori mostrati.

### Stato Fase 3

- 🟡 Fase 0 - Audit dei sorgenti: IN CORSO
- ⏳ Fase 1-7: PENDING (dipendono da completamento Fase 0)

**Important**: Do not delete `useTrackingEngine.ts` until functional equivalence is demonstrated.
