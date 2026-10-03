# MVPIQ Hoops - Architecture Overview

## Overview

La pipeline di vision dell'applicazione MVPIQ Hoops elabora frame dalla camera per rilevare e tracciare tre oggetti chiave: la palla, il canestro e il giocatore. La pipeline è costruita su React Native Vision Camera V5 con un'architettura worklet-safe per garantire performance real-time.

## Principio Fondamentale

**Il frame processor non aspetta mai il backend, React state, persistenza o telemetria JS.**

Tutto ciò che può essere asincrono deve essere separato dal percorso realtime. L'obiettivo non è trasformare `runSync()` di YOLO/MoveNet in una Promise semplicemente per "renderlo async" - con react-native-fast-tflite, l'uso documentato dentro VisionCamera è proprio `runSync()` nel worklet. Il vero obiettivo è rendere asincroni i flussi che non devono bloccare il realtime, e separare il più possibile le pipeline.

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

### Vision Pipeline Layer (useShotTracker)

**Responsabilità:**
- Camera frame acquisition tramite `useFrameOutput`
- Reentrancy guard per prevenire elaborazioni concorrenti
- YOLO detection (ball, player, rim)
- Ball/Player/Rim detection parsing e filtering
- Player crop management (TTL 750ms, EMA smoothing, jump threshold)
- Kalman prediction base per ball tracking
- Telemetry e performance monitoring
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

**Architettura implementata:**
```
                 CAMERA (30 FPS)
                       │
                       ▼
              useShotTracker.onFrame
                       │
          ┌────────────┼────────────┐
          ▼            ▼            ▼
    YOLO Worker   MoveNet Worker  Tracking
  (no throttle) (no throttle)   every frame
       │              │
   sincrono      sincrono
```

**YOLO Scheduler:**
- Implementato internamente in `useYoloWorker.ts`
- Nessun throttling temporale - esegue ogni frame se `!isProcessing`
- FPS naturale dipende dal tempo di inferenza sincrono (~35-45ms)
- Indipendente dal FPS della camera
- useShotTracker chiama `yoloWorker.processFrame()` ogni frame

**MoveNet Scheduler:**
- Implementato internamente in `useMoveNetWorker.ts`
- Nessun throttling temporale - esegue ogni frame se `!isProcessing` e bbox player valido
- FPS naturale dipende dal tempo di inferenza sincrono (~150-160ms)
- Indipendente dal FPS della camera
- useShotTracker chiama `moveNetWorker.processFrame()` ogni frame
- Esegue solo se YOLO ha rilevato un bbox player valido (confidence >= threshold)

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
  MIN_RESOLUTION: { width: 1280, height: 720 },
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
- YOLO: FPS naturale (~7-10 FPS) basato su tempo inferenza sincrono (~35-45ms)
- MoveNet: FPS naturale (~0-6 FPS) basato su tempo inferenza sincrono (~150-160ms) e disponibilità bbox player
- Tracking: realtime (ogni frame)
- Bridge calls: 15 FPS (throttled a 66ms)

Questa architettura evita limiti artificiali che riducono la detection rate, lasciando che i modelli girino al massimo FPS possibile dato il tempo di inferenza sincrono.

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
| YOLO no throttling | ✅ | Esegue ogni frame se !isProcessing, FPS naturale ~7-10 |
| MoveNet no throttling | ✅ | Esegue ogni frame se !isProcessing e bbox valido, FPS naturale ~0-6 |
| Scheduler duplicati rimossi | ✅ | useShotTracker non fa più scheduling esterno |
| Camera FPS migliorata | 🟡 | Da ~4 FPS a 10-14 FPS (senza throttling), ma ancora sotto target 30 FPS |
| Frame latency | 🟡 | 76-96 ms tipici (vs budget 33.3ms per 30 FPS) |
| MoveNet CPU crop | 🔴 | Costa ~30 ms, investigare riduzione/eliminazione |
| Player tracking worklet-safe | ✅ | Implementato |
| TTL player 750 ms | ✅ | Implementato |
| TTL ball 500 ms / Kalman | ✅ | Implementato |
| Jump threshold + safety net | ✅ | Implementato correttamente |
| Crop geometrico player | ✅ | Implementato |
| Crop effettivo immagine per MoveNet | ✅ | CPU ottimizzato (640x360 → 192x192) |
| Adaptive performance | ✅ | RIMOSSO - senza throttling temporale |
| Residui adaptive performance | ✅ | Rimossi (TARGET_DETECTION_RATE, ADAPTATION_WINDOW_MS, etc.) |
| Throttling YOLO telemetry 15 FPS | ✅ | Implementato (66ms) |
| Decoupling camera/YOLO FPS | ✅ | Camera 30 FPS, YOLO FPS naturale basato su inferenza time |
| Rerender/Remount investigation | 🔴 | Possibili rerender frequenti da investigare |
| Propagazione courtType (FULL/HALF) | 🔴 | NON propagato tra Setup → Calibration → Workout |
| Homography HALF/FULL court | 🔴 | Sempre calcolata come FULL court (15.24 x 28.65) |
| CALIBRATION in critical queue | 🔴 | UI chiama API direttamente, bypassa outbox |
| SESSION_END in critical queue | 🔴 | UI chiama API direttamente, bypassa outbox |
| shutdown() bounded offline | 🔴 | Può loopare infinitamente con critical events pendenti |
| OutboxRecoveryWorker chiavi | 🔴 | Usa chiavi sbagliate (id invece di workout_outbox_<id>) |
| Duplicazione loadAllPendingAndMerge | 🔴 | loadAllPendingAndMerge + loadPending duplicano item |
| Telemetry batching garantito | 🟡 | Non garantito, tende a batch da 1 invece di 20 |
| Inizializzazione queue prima camera | 🟡 | Queue inizializzata DOPO attivazione camera |
| Gestione enqueueCritical false | 🟡 | UI non verifica return boolean per fallimento persistenza |
| Shot detection single source | 🟡 | Due sistemi sovrapposti (useTrackingEngine + useShotTracker) |
| Test coverage lifecycle UI | 🟡 | Buoni sui servizi, mancano test end-to-end UI |

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
- ✅ Verifica propagazione courtType attraverso navigation - IMPLEMENTATO
- ✅ Verifica homography corretta per HALF vs FULL court - IMPLEMENTATO
- ✅ Test shutdown() con backend offline (bounded behavior) - IMPLEMENTATO
- ✅ Test duplicazione loadAllPendingAndMerge + loadPending - IMPLEMENTATO (deduplica per ID)
- ✅ Test batching telemetry reale (accumulation window) - IMPLEMENTATO
