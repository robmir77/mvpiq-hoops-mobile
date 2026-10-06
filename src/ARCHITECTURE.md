# MVPIQ Hoops - Architecture Overview

## Overview

La pipeline di vision dell'applicazione MVPIQ Hoops elabora frame dalla camera per rilevare e tracciare tre oggetti chiave: la palla, il canestro e il giocatore. La pipeline è costruita su React Native Vision Camera V5 con un'architettura worklet-safe per garantire performance real-time.

## Principio Fondamentale

**Il frame processor non aspetta mai il backend, React state, persistenza o telemetria JS.**

Tutto ciò che può essere asincrono deve essere separato dal percorso realtime. L'obiettivo è misurare e ridurre la contesa del runtime RN/JS, non solo trasformare `runSync()` in async. L'architettura attuale usa `scheduleOnRN()` per eseguire YOLO e MoveNet sul thread JS, permettendo di misurare il tempo di attesa del runtime (scheduleWaitMs) separatamente dal tempo di inferenza.

**Reanimated Shared Values:** I shared values di Reanimated non devono essere letti direttamente durante il render dei componenti React. Per evitare warning di Reanimated, i valori devono essere sincronizzati a variabili di stato regolari tramite useEffect prima di essere passati ai componenti UI.

**Schedule Wait Measurement:** Entrambi i worker (YOLO e MoveNet) misurano il tempo tra `scheduleOnRN()` e l'esecuzione effettiva del callback, permettendo di identificare la contesa del runtime RN come collo di bottiglia primario.

## Architettura Target

```
                         CAMERA
                           │
                           ▼
                  ┌─────────────────┐
                  │ Frame Processor │
                  └────────┬────────┘
                           │
                 SOLO realtime/vision
                           │
             ┌─────────────┴─────────────┐
             ▼                           ▼
        YOLO / Tracking              MoveNet
             │                           │
             └─────────────┬─────────────┘
                           ▼
                    Shot Detection
                           │
                 ┌─────────┴─────────┐
                 ▼                   ▼
             SharedValues        Shot Event
                 │                   │
                 ▼                   ▼
              Overlay          CRITICAL QUEUE
                                    │
                                    ▼
                              Async Worker
                                    │
                              batch HTTP
                                    │
                                    ▼
                                Backend

        Telemetry ───────► TELEMETRY QUEUE
                              │
                         sampling/drop
                              │
                              ▼
                         Async Worker
```

## Architettura Corrente

### WorkoutSessionRuntime (Session Coordinator)

**Responsabilità:**
- Coordinamento lifecycle sessione (IDLE → STARTING → ACTIVE → PAUSED → STOPPING → SYNCING → COMPLETED → ERROR)
- Controllo vision pipeline tramite IVisionPipeline interface
- Coordinamento tracking engine (non ownership, ma coordinamento)
- Gestione critical events (SHOT, SESSION_START, SESSION_END, CALIBRATION)
- Gestione telemetry sampling e enqueue
- Metrics tracking (totalShots, madeShots, sessionDuration, FPS metrics)
- State machine con guardie di transizione

**Architettura Runtime:**
```
WorkoutSessionRuntime
  ├── VisionEngine (IVisionEngine) - ✅ COMPLETATO
  │   ├── YOLO detection
  │   ├── MoveNet pose detection
  │   ├── Player detection
  │   └── Detection filtering
  ├── TrackingEngine (ITrackingEngine)
  │   ├── BallTrackingEngine
  │   ├── PlayerTrackingEngine
  │   ├── ShotDetectionEngine (IShotDetectionEngine) - esposto via getShotDetectionEngine()
  │   └── TrackingCoordinator
  ├── TelemetrySampler (ITelemetrySampler)
  └── WorkoutQueue (IWorkoutQueue)
```

**Nota importante:** ShotDetectionEngine è un'istanza interna di TrackingEngine. Il Runtime ottiene questa istanza tramite `trackingEngine.getShotDetectionEngine()` per evitare double ownership.

**Vision Migration (Decision 27):**
- IVisionEngine interface creato
- VisionEngine class creato
- Runtime.processFrame() implementato per orchestrare Vision → Tracking → Shot
- VisionEngineAdapter creato
- Piano di migrazione documentato in ARCHITECTURE_DECISIONS.md
- Fase 1 completata, Fase 2 COMPLETATA (estrazione YOLO/MoveNet in classi pure worklet-safe)
- YoloDetector.ts creato (parsing YOLO puro worklet-safe)
- MoveNetPoseEstimator.ts creato (parsing MoveNet puro worklet-safe)
- VisionEngine.ts in vision/engine/ (orchestrazione YOLO + MoveNet)
- Integrazione completata in useYoloWorker, useYoloWorkerAsync, useMoveNetWorker
- Codice legacy rimosso (poseParser.ts, yoloParserFloat16.ts)
- Test aggiornati per usare YoloDetector
- VisionEngineAdapter semplificato per forward parsed results
- Fase 3 COMPLETATA (VisionEngine integration - parsed results path, callbacks aggiornati, type conversion)
- Fase 4 COMPLETATA (Runtime.processFrame() attivo, callback onTrackingStateUpdate, SharedValues sync, double call fix)
- VisionEngineAdapter istanziato in WorkoutSessionScreen
- Collegato a Runtime via setVisionEngine()
- Runtime.processFrame() chiamato dai callbacks quando Runtime è ACTIVE
- Flag useRuntimeProcessingRef per toggle tra path Runtime e legacy
- Aggiunto onTrackingStateUpdate callback a SessionCallbacks
- Runtime.processFrame() chiama callback dopo TrackingEngine.processFrame()
- Aggiunto updateSharedValuesFromState() a useTrackingEngine
- SharedValues aggiornati da callback Runtime per Skia overlay
- Path legacy esiste come fallback (skippato quando Runtime è attivo)
- Fix double ShotDetectionEngine call (rimosso da Runtime.processFrame())
- Fix TypeScript type mismatches (BallDetection senza player, PoseResult conversion)
- Fase 4.1 COMPLETATA (VisionEngineAdapter partial update - non cancella altri risultati)
- Fase 4.2 COMPLETATA (Runtime.processFrame() debounce 50ms - evita chiamate duplicate)
- Fase 4.3 COMPLETATA (Legacy Shot Detection disattivata - single source of truth shot events)
- Fase 4.4 COMPLETATA (PlayerDetection integrato nel nuovo percorso - onPlayerDetection callback)
- Fase 5 COMPLETATA (Legacy cleanup - ShotDetector.ts rimosso completamente, handleShotEvent rimosso)
- Fase 6 COMPLETATA (setPlayerFromYolo() rimosso, test PlayerDetection aggiunti, Kalman filter ottimizzato)

**Stato integrazione:**
- ✅ Vision collegata via VisionEngineAdapter
- ✅ Tracking collegato via setTrackingEngine()
- ✅ ShotDetectionEngine collegato (evitando double ownership - Runtime usa istanza interna di TrackingEngine)
- ✅ Queue collegata (ownership intermedio - Screen crea, Runtime usa)
- ✅ TelemetrySampler collegato e utilizzato dal Runtime
- ✅ Tutti i sottosistemi connessi PRIMA di runtime.start()
- ✅ PlayerDetection fluisce nel nuovo percorso Runtime (YOLO → VisionEngine → Runtime → TrackingEngine → PlayerTrackingEngine)
- ✅ Policy YOLO bbox + MoveNet pose implementata (YOLO = coarse bbox, MoveNet = articulated/precise position)
- ✅ setPlayerFromYolo() rimosso (legacy bridge eliminato)
- ✅ Test TrackingEngine.test.ts per PlayerDetection aggiunti
- ✅ Kalman filter ottimizzato per massima reattività (px/py: 0.001, mx/my: 0.05, dt: 0.02)

### Vision Pipeline Layer (useShotTracker)

**Responsabilità:**
- Camera frame acquisition tramite `useFrameOutput`
- Reentrancy guard per prevenire elaborazioni concorrenti
- YOLO detection (ball, player, rim)
- Ball/Player/Rim detection parsing e filtering
- Player crop management (TTL 750ms, EMA smoothing, jump threshold)
- Kalman prediction base per ball tracking
- Telemetry e performance monitoring
- FPS metrics synchronization (shared values → state) per evitare warning Reanimated
- Session usage time tracking (minuti:secondi) con persistenza tra unmount/mount
- **NOTA:** Lo scheduling YOLO/MoveNet è gestito internamente dai rispettivi worker, non da useShotTracker

**Separazione responsabilità:**
```
Vision Pipeline Layer (useShotTracker)
  ↓
Detection + Basic Tracking
  ↓
Basketball Intelligence Layer (useTrackingEngine)
  ↓
Shot Analysis + Basketball Logic
```

### Basketball Intelligence Layer (useTrackingEngine)

**Responsabilità:**
- Advanced Kalman tracking per ball position prediction
- Ball trajectory analysis (release point, apex, descending)
- Shot detection logic (MADE/MISS/AIRBALL classification)
- Release point detection
- Apex detection
- Shot quality metrics
- Ball state management (DETECTED/PREDICTED/LOST)

### Frame Scheduler

**Architettura implementata (Async):**
```
                 CAMERA (30 FPS)
                       │
                       ▼
              useShotTracker.onFrame
                       │
          ┌────────────┼────────────┐
          ▼            ▼            ▼
    YOLO Worker   MoveNet Worker  Tracking
  (async)        (async)         every frame
       │              │
   scheduleOnRN   scheduleOnRN
       │              │
   JS thread      JS thread
       │              │
   runSync()      runSync()
```

**YOLO Scheduler (Async):**
- Implementato internamente in `useYoloWorker.ts`
- Esecuzione async tramite `scheduleOnRN()`
- Worklet prepara frame (resize), poi scheduleOnRN invia al JS thread
- FPS naturale dipende dal tempo inferenza async (~40-50ms)
- Indipendente dal FPS della camera
- useShotTracker chiama `yoloWorker.processFrame()` ogni frame
- **scheduleWaitMs misurato:** tempo di attesa runtime RN

**MoveNet Scheduler (Async):**
- Implementato internamente in `useMoveNetWorker.ts`
- Esecuzione async tramite `scheduleOnRN()`
- Worklet prepara frame (crop geometry + resize + buffer), poi scheduleOnRN invia al JS thread
- FPS naturale dipende dal tempo inferenza async (~200-230ms total)
- Indipendente dal FPS della camera
- useShotTracker chiama `moveNetWorker.processFrame()` ogni frame
- Esegue solo se YOLO ha rilevato un bbox player valido (confidence >= threshold)
- **workletPrepMs misurato:** tempo preparazione worklet
- **scheduleWaitMs misurato:** tempo di attesa runtime RN
- **cropMs misurato:** tempo crop CPU su JS thread

### Tracking Policies

**Ball Tracking Policy:**
```
Target: Ball
Detection: YOLO
Tracking: Kalman prediction
TTL: 500 ms
Fallback: Prediction durante gap YOLO
Stati: DETECTED (🟠), PREDICTED (🔴), LOST (🔴)
```

**Player Tracking Policy:**
```
Target: Player
Detection: YOLO
Tracking: EMA smoothing
TTL: 750 ms
Fallback: Last bbox durante gap YOLO
Jump threshold: 0.15 con safety net (3 rifiuti consecutivi)
Stati: DETECTED (🟠), PREDICTED (🔴), LOST (🔴)
Confidence threshold: 5%
```

**Rim Tracking Policy:**
```
Target: Rim
Detection: YOLO
Tracking: Best-confidence locking
TTL: 500 ms
Fallback: Calibration point
Update rule: Aggiorna solo se confidence > lastRimConfidence
Stati: DETECTED (🟠), PREDICTED (🔴), LOST (🔴)
Confidence threshold: 10%
Note: Non è vero "tracking", è "best-confidence locking" per camera stabile
```

## Configurazione Globale

Tutti i threshold e valori di default sono centralizzati in `appConfig.ts`:

```typescript
export const YOLO_CONFIG = {
  BALL_CONF_THRESHOLD: 0.005,           // 0.5%
  PLAYER_CONF_THRESHOLD: 0.05,         // 5%
  PLAYER_CROP_MIN_CONFIDENCE: 0.05,   // 5%
  RIM_CONF_THRESHOLD: 0.1,            // 10%
  NMS_IOU_THRESHOLD: 0.4,
  PLAYER_MIN_WIDTH: 0.05,              // 5% del frame
  PLAYER_MIN_HEIGHT: 0.1,              // 10% del frame
} as const

export const CAMERA_CONFIG = {
  DEFAULT_RESOLUTION: { width: 1280, height: 720 },
  DEFAULT_FPS: 30,
  DEFAULT_POSE_RESOLUTION: 192,
  DEFAULT_ZOOM: 1,
  MIN_RESOLUTION: { width: 640, height: 360 },
} as const

// Vision Pipeline Configuration
// Camera FPS is independent from vision model FPS
// Vision models execute at natural FPS based on inference time
export const VISION_CONFIG = {
  CAMERA_FPS: 30, // Camera frame rate (hardware/configured)

  YOLO: {
    ENABLED: true,
    // No TARGET_FPS - executes every frame if not processing
  },

  MOVENET: {
    ENABLED: true,
    // No TARGET_FPS - executes every frame if not processing and player bbox valid
  },
} as const

export const COURT_CONFIG = {
  WIDTH_M: 15.24,      // 50 feet
  HEIGHT_M: 28.65,     // 94 feet (FULL court)
  HOOP_Y_M: 1.575,     // 10 feet
} as const
```

## Model Configurations

### YOLO Models

| Model ID | Input Size | Precision | Epochs | Expected FPS | Actual FPS | Note |
|----------|------------|-----------|--------|--------------|------------|------|
| best_320_float16 | 320x320 | FP16 | 50 | 10-37 | 2-7 | Measured at 640x360 resolution |
| best_384_float16 | 384x384 | FP16 | 100 | 20-21 | 3-6 | Updated to 100 epochs, actual FPS lower due to device bottleneck |
| best_448_float16 | 448x448 | FP16 | 5 | 12-21 | TBD | Early training |
| best_512_float16 | 512x512 | FP16 | 40 | 8-10 | TBD | Balanced performance |
| best_640_float16 | 640x640 | FP16 | 30 | 5-7 | TBD | High resolution |

**Nota importante:** Il sistema NON usa throttling temporale. La frequenza della camera è indipendente dalla frequenza di inferenza YOLO/MoveNet:
- Camera: 30 FPS (configurabile via CAMERA_CONFIG)
- YOLO: FPS naturale (~4-5 FPS) basato su tempo inferenza async (~40-50ms)
- MoveNet: FPS naturale (~3-4 FPS) basato su tempo inferenza async (~200-230ms) e disponibilità bbox player
- Tracking: realtime (ogni frame)
- Bridge calls: 15 FPS (throttled a 66ms)

Questa architettura evita limiti artificiali che riducono la detection rate, lasciando che i modelli girino al massimo FPS possibile dato il tempo di inferenza async. La conversione ad async permette di misurare la contesa del runtime RN separatamente dal tempo di inferenza.

**BUG CRITICO:** `COURT_CONFIG.HEIGHT_M` è hardcoded a 28.65m (full court) ma non esiste configurazione separata per half court. `CalibrationScreen.tsx` usa sempre:
```typescript
const dstCorners = getCourtCornersMeters(
  COURT_CONFIG.WIDTH_M,
  COURT_CONFIG.HEIGHT_M  // Sempre 28.65, anche per HALF_COURT
)
```

La documentazione di `homography.ts` dice che per half court dovrebbe essere usata una profondità diversa (~14m), ma questo non è implementato. Questo falsa:
- `courtX`, `courtY`
- `distanceFromHoop`
- `zone`
- Shot chart e analytics basati sulla posizione

**BUG CRITICO:** `courtType` non viene propagato nel navigation flow:
- `WorkoutSetupScreen.tsx` seleziona `courtType` (HALF_COURT o FULL_COURT)
- Viene inviato al backend nel payload di creazione sessione
- `CalibrationScreen.tsx` riceve `undefined` per `courtType` nei params
- Fallback a `HALF_COURT` anche se l'utente ha selezionato FULL_COURT

Conseguenza: il backend conosce FULL_COURT, ma la calibrazione lavora come HALF_COURT.

## Stato Implementazione

| Componente | Stato | Note |
|------|------|------|
| Separazione YOLO/tracking/MoveNet | ✅ | Completata |
| Reentrancy guard | ✅ | Implementato con isProcessingFrame |
| YOLO async con scheduleOnRN | ✅ | Esegue async, FPS naturale ~4-5 |
| MoveNet async con scheduleOnRN | ✅ | Esegue async, FPS naturale ~3-4 |
| Scheduler duplicati rimossi | ✅ | useShotTracker non fa più scheduling esterno |
| Camera FPS migliorata | ✅ | 27-30 FPS (target raggiunto) |
| Frame latency | ✅ | 17-32 ms (risolto da 75-100 ms) |
| MoveNet CPU crop | ✅ | Spostato su JS thread async, ~15 ms (accettabile) |
| Schedule wait measurement | ✅ | Entrambi i worker misurano scheduleWaitMs |
| Player tracking worklet-safe | ✅ | Implementato |
| TTL player 750 ms | ✅ | Implementato |
| TTL ball 500 ms / Kalman | ✅ | Implementato |
| Jump threshold + safety net | ✅ | Implementato correttamente |
| Crop geometrico player | ✅ | Implementato |
| Crop effettivo immagine per MoveNet | ✅ | CPU ottimizzato (640x360 → 192x192) |
| Adaptive performance | ✅ | RIMOSSO - senza throttling temporale |
| Residui adaptive performance | ✅ | Rimossi (TARGET_DETECTION_RATE, ADAPTATION_WINDOW_MS, etc.) |
| Throttling YOLO telemetry 15 FPS | ✅ | Implementato (66ms) |
| Decoupling camera/YOLO FPS | ✅ | Camera 30 FPS, YOLO FPS naturale basato su inferenza async |
| Reanimated shared values handling | ✅ | Sincronizzazione shared values → state per evitare warning |
| TelemetryOverlay unificazione stili | ✅ | Tutte le voci usano formato row/label/value uniforme |
| TelemetryOverlay FPS display | ✅ | Camera/YOLO/MoveNet su righe separate, YOLO sopra MoveNet |
| Session usage time tracking | ✅ | Minuti:secondi con ref globale per persistenza unmount/mount |
| WorkoutSessionRuntime ownership | ✅ | Vision, Tracking, Shot Detection ora posseduti dal Runtime |
| VisionPipelineAdapter | ✅ | Bridge tra useWorkoutVisionPipeline e IVisionPipeline |
| ShotDetectionEngine connection | ✅ | Connesso via TrackingEngine.getShotDetectionEngine() (no double ownership) |
| Subsystem connection timing | ✅ | Tutti i sottosistemi connessi PRIMA di runtime.start() |
| ShotDetectionUIAdapter removal | ✅ | Rimosso anti-pattern (useSharedValue in class) |
| WorkoutSessionRuntime tests | ✅ | Test state machine completi implementati |
| Runtime lifecycle migration | ✅ | handlePauseResume, handleEndSession, handleManualShot migrate al Runtime |
| IVisionEngine interface | ✅ | Creato per definire contratto Vision Engine puro |
| VisionEngine placeholder | ✅ | Creato (placeholder per futura estrazione YOLO/MoveNet) |
| Runtime.processFrame() | ✅ | Implementato per orchestrare Vision → Tracking → Shot |
| VisionEngineAdapter placeholder | ✅ | Creato (bridge temporaneo per migrazione) |
| Vision migration plan | ✅ | Documentato in ARCHITECTURE_DECISIONS.md (Decision 27) |
| RN runtime contention | 🔴 | Schedule wait 45-134 ms, da ridurre |
| Transfer buffer size | 🔴 | 640×360×3 (~2.64 MB), da eliminare |
| Rerender/Remount investigation | 🔴 | Possibili rerender frequenti da investigare |
| Propagazione courtType (FULL/HALF) | 🔴 | NON propagato tra Setup → Calibration → Workout |
| Homography HALF/FULL court | 🔴 | Sempre calcolata come FULL court (15.24 x 28.65) |
| CALIBRATION in critical queue | 🔴 | UI chiama API direttamente, bypassa outbox |
| SESSION_END in critical queue | 🔴 | UI chiama API direttamente, bypassa outbox |
| shutdown() bounded offline | ✅ | Time-bounded con timeout 3 secondi |
| OutboxRecoveryWorker chiavi | ✅ | Chiavi AsyncStorage corrette (workout_outbox_<id>) |
| Duplicazione loadAllPendingAndMerge | ✅ | Deduplica per ID implementata |
| Telemetry batching garantito | ✅ | Accumulation window 250ms implementata |
| Inizializzazione queue prima camera | 🟡 | Queue inizializzata DOPO attivazione camera |
| Gestione enqueueCritical false | 🟡 | UI non verifica return boolean per fallimento persistenza |
| Shot detection single source | ✅ | Sistema unificato via TrackingEngine |
| Test coverage lifecycle UI | 🟡 | Buoni sui servizi, mancano test end-to-end UI |
| Vision extraction YOLO/MoveNet | ✅ | Fase 1 completata, Fase 2 COMPLETATA, Fase 3 COMPLETATA, Fase 4 COMPLETATA (Runtime.processFrame() attivo) |
| useShotTracker.ts legacy removal | ✅ | ShotDetector.ts rimosso completamente, handleShotEvent rimosso (Fase 5 completata) |
| PlayerDetection integration | ✅ | onPlayerDetection callback aggiunto, fluisce nel nuovo percorso Runtime (Fase 4.4 completata) |
| setPlayerFromYolo() removal | ✅ | Legacy bridge eliminato, TrackingEngine.processFrame() usa playerDetection (Fase 6 completata) |
| PlayerDetection tests | ✅ | TrackingEngine.test.ts aggiunti per YOLO + MoveNet integration (Fase 6 completata) |
| Kalman filter optimization | ✅ | Massima reattività: px/py 0.001, mx/my 0.05, dt 0.02 (Fase 6 completata) |

## Async Queue & Critical Events

### WorkoutAsyncQueue

**Responsabilità:**
- Queue session-scoped per eventi critici e telemetria
- Inizializzazione async con global recovery
- Worker asincrono per HTTP backend
- Flush granulare (critical only, telemetry only, all)
- Shutdown sicuro con preservazione eventi pendenti

**Architettura:**
```
WorkoutAsyncQueue (session-scoped)
  ├── Telemetry Queue (bounded, drop-oldest)
  │   └── max 100 items, best-effort
  └── Critical Outbox (unbounded, persistent)
      ├── SHOT events
      ├── SESSION_START events
      ├── SESSION_END events
      └── CALIBRATION events
```

**Inizializzazione:**
```typescript
const queue = await createWorkoutQueue({ sessionId, userId })
```
- Carica item pendenti da TUTTE le sessioni precedenti (global recovery)
- Carica item della sessione corrente
- Flag `initialized` previene enqueue prematuro

**BUG CRITICO:** In `WorkoutSessionScreen.tsx`, la camera viene attivata PRIMA che la queue sia pronta:
```typescript
setSession(s)
setIsActive(true)  // Camera ON
setShotCount(...)
workoutQueueRef.current = await createWorkoutQueue(...)  // Queue pronta DOPO
```
Per un breve periodo:
- Camera ACTIVE
- Vision tracking genera shot/telemetry
- `workoutQueueRef.current === null`
- Eventi possono essere persi (telemetry: return, shot: return)

Questo contraddice Decision 11: l'inizializzazione deve essere completata prima di accettare eventi.

### PersistentOutbox

**Responsabilità:**
- Persistenza eventi critici in AsyncStorage
- Global recovery da tutte le sessioni
- Retry count persistente
- Separazione clear() (memoria) da clearSession() (storage)

**Durabilità:**
- Nessun limite di dimensione (MAX_OUTBOX_SIZE rimosso)
- Eventi critici mai rifiutati
- Retry count persistito su ogni tentativo
- Eventi rimangono in storage dopo esaurimento retry

**Recovery:**
- `loadAllPendingAndMerge()` - carica e merge item da tutte le sessioni
- `loadPending()` - carica item della sessione corrente e merge
- Merge con memory queue esistente
- Sorting per timestamp
- `OutboxRecoveryWorker` - worker background per retry di eventi pendenti da sessioni precedenti
  - Intervallo configurabile (default 30 secondi)
  - Backoff esponenziale per retry
  - Max 5 retry per evento
  - Rimozione solo su successo API

**BUG CRITICO:** `OutboxRecoveryWorker` usa chiavi AsyncStorage sbagliate:
- `PersistentOutbox.add()` salva con chiave: `workout_outbox_<id>`
- `OutboxRecoveryWorker.removeItem()` usa: `await AsyncStorage.removeItem(id)`
- `OutboxRecoveryWorker.incrementRetryCount()` usa: `await AsyncStorage.setItem(item.id, ...)`

Questo causa:
- L'evento viene trovato correttamente
- Viene inviato con successo
- Il worker tenta di rimuoverlo con chiave sbagliata
- L'evento originale rimane nello storage
- Alla prossima recovery può essere reinviato (duplicazione)

**BUG CRITICO:** `WorkoutAsyncQueue.create()` chiama:
1. `await queue.criticalOutbox.loadAllPendingAndMerge()` - include sessione corrente
2. `await queue.criticalOutbox.loadPending()` - ricarica sessione corrente

Senza deduplica per id, questo causa duplicazione degli item nella memory queue.

**Shutdown:**
- Se tutti eventi consegnati: `clearSession()` (memoria + storage)
- Se eventi pendenti: `clear()` (solo memoria, storage per recovery)
- Log warning se shutdown con eventi pendenti
- `flushCriticalOnly(maxAttempts)` - default 50, previene loop infinito offline

**BUG CRITICO:** `shutdown()` chiama `flushAll()` che contiene un loop while:
```typescript
async shutdown() {
  await this.flushCriticalOnly(50, 3000) // max 3 seconds timeout
  await this.flushTelemetryOnly()
}
```
`shutdown()` è ora time-bounded con timeout di 3 secondi. Se il backend è offline, gli eventi critical rimangono in outbox per recovery successivo invece di bloccare l'utente.

### Critical Events

**Tipi:**
- `SHOT` - eventi tiro con API `addShotEvent()` - ✅ Usa critical queue
- `SESSION_START` - confermato (gestito da creazione sessione) - ✅ Non richiede queue
- `SESSION_END` - API `endWorkoutSession()` - ✅ Usa critical queue (enqueueCritical → shutdown)
- `CALIBRATION` - API `saveCourtCalibration()` - ✅ Usa critical queue (enqueueCritical in CalibrationScreen)

**IMPLEMENTATO:**
- `CalibrationScreen.tsx`: ora usa `workoutQueue.enqueueCritical({ type: 'CALIBRATION', ... })`
- `WorkoutSessionScreen.tsx`: ora usa `workoutQueue.enqueueCritical({ type: 'SESSION_END', ... })` prima di shutdown
- Gli eventi vengono persistiti in AsyncStorage e ritentati automaticamente dal recovery worker

**Retry Strategy:**
- Max 5 retry con backoff esponenziale (1s, 2s, 4s, 8s, 16s)
- Retry count persistito prima di ogni tentativo
- Eventi rimangono in outbox dopo esaurimento retry
- Recupero automatico al riavvio

### Telemetry

**Sampling:**
- `TelemetrySampler` con intervallo configurabile (default 500ms = 2 Hz)
- Solo 1 frame su 10 inviato al backend

**Batching:**
- Accumulation window di 250ms per telemetry
- Flush immediato se batch size >= 5
- Flush dopo accumulation window se batch size < 5
- Massimo 20 frame per richiesta HTTP
- Comportamento reale: sample → attesa 250ms → batch accumulato → HTTP

**Queue:**
- Bounded queue (max 100 items)
- Overflow behavior: drop-oldest
- Best-effort (dati persi accettabili)

### Test Suite

**PersistentOutbox:**
- add/remove/peek
- loadPending/loadAllPendingAndMerge
- updateRetryCount
- clear/clearSession
- corrupted storage handling
- timestamp sorting
- merge con memory queue

**WorkoutAsyncQueue:**
- Inizializzazione async
- enqueueTelemetry/enqueueCritical
- flushCriticalOnly(maxAttempts)/flushTelemetryOnly/flushAll
- shutdown sicuro
- retry behavior
- SESSION_END/CALIBRATION API calls
- metrics
- offline shutdown (maxAttempts limit)

**OutboxRecoveryWorker:**
- Singleton worker background
- Carica item da tutte le sessioni precedenti
- Retry con backoff esponenziale
- Rimozione solo su successo
- ✅ Avviato automaticamente in `AppProviders.tsx` (30s interval)
- ✅ Chiavi AsyncStorage corrette (`workout_outbox_${id}`)

**TelemetrySampler:**
- shouldSample con vari intervalli
- reset
- setSampleInterval dinamico
- edge cases (timestamp 0, negativi, non-monotonici)
- scenari real-world (variable frame rates)

**In architettura ma NON implementato:**
- OutboxRecoveryWorker test - non presente nel codebase
- Test end-to-end del lifecycle UI (Setup → Calibration → Workout → Pause → Resume → End)
- Test FULL/HALF court end-to-end

**Implementato recentemente:**
- ✅ Verifica propagazione courtType attraverso navigation - IMPLEMENTATO
- ✅ Verifica homography corretta per HALF vs FULL court - IMPLEMENTATO
- ✅ Test shutdown() con backend offline (bounded behavior) - IMPLEMENTATO
- ✅ Test duplicazione loadAllPendingAndMerge + loadPending - IMPLEMENTATO (deduplica per ID)
- ✅ Test batching telemetry reale (accumulation window) - IMPLEMENTATO
- ✅ WorkoutSessionRuntime state machine tests - IMPLEMENTATO
- ✅ ShotDetectionUIAdapter removal (anti-pattern) - IMPLEMENTATO
- ✅ Subsystem connection timing fix - IMPLEMENTATO
