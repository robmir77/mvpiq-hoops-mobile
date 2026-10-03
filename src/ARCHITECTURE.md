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
- YOLO scheduler con tre protezioni (frame guard, YOLO guard, scheduled count)
- YOLO detection (ball, player, rim)
- Ball/Player/Rim detection parsing e filtering
- Player crop management (TTL 750ms, EMA smoothing, jump threshold)
- MoveNet pose estimation (throttled a 3 FPS)
- Kalman prediction base per ball tracking
- Frame scheduler coordination (YOLO + MoveNet throttling)
- Telemetry e performance monitoring

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
                 FRAME SCHEDULER
                       │
          ┌────────────┼────────────┐
          ▼            ▼            ▼
        YOLO        MoveNet       Tracking
      priority 1   priority 2    every frame
          │            │
      20-21 FPS       5 FPS
```

**YOLO Scheduler (implementato in useShotTracker.ts):**
- Basato su `yoloIntervalMs` (1000 / targetFps)
- Tre protezioni attive:
  1. `isProcessingFrame` - previene concorrenza frame (reentrancy guard)
  2. `yoloWorker.isProcessing` - previene concorrenza YOLO
  3. `yoloScheduledCount` - previene doppio scheduling nello stesso intervallo
- req/exec = 1:1 confermato nei test
- `timeSinceLast` varia correttamente indicando scheduler funzionante

**MoveNet Scheduler:**
- Time-based throttling a 3 FPS (ogni ~333ms)
- Eseguito solo se player bbox disponibile
- Bottleneck JS thread riduce actual FPS a ~5 FPS

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

export const COURT_CONFIG = {
  WIDTH_M: 15.24,      // 50 feet
  HEIGHT_M: 28.65,     // 94 feet
  HOOP_Y_M: 1.575,     // 10 feet
} as const
```

## Stato Implementazione

| Componente | Stato | Note |
|------|------|------|
| Separazione YOLO/tracking/MoveNet | ✅ | Completata |
| Reentrancy guard | ✅ | Implementato con isProcessingFrame |
| YOLO scheduler | ✅ | Implementato con 3 protezioni |
| Player tracking worklet-safe | ✅ | Implementato |
| TTL player 750 ms | ✅ | Implementato |
| TTL ball 500 ms / Kalman | ✅ | Implementato |
| Jump threshold + safety net | ✅ | Implementato correttamente |
| MoveNet throttling 3 FPS | ✅ | Implementato |
| Crop geometrico player | ✅ | Implementato |
| Crop effettivo immagine per MoveNet | ✅ | CPU ottimizzato (640x360 → 192x192) |
| Adaptive performance | ❌ | Completamente disabilitato per debugging |

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

**Shutdown:**
- Se tutti eventi consegnati: `clearSession()` (memoria + storage)
- Se eventi pendenti: `clear()` (solo memoria, storage per recovery)
- Log warning se shutdown con eventi pendenti
- `flushCriticalOnly(maxAttempts)` - default 50, previene loop infinito offline

### Critical Events

**Tipi:**
- `SHOT` - eventi tiro con API `addShotEvent()`
- `SESSION_START` - confermato (gestito da creazione sessione)
- `SESSION_END` - API `endWorkoutSession()`
- `CALIBRATION` - API `saveCourtCalibration()`

**Retry Strategy:**
- Max 5 retry con backoff esponenziale (1s, 2s, 4s, 8s, 16s)
- Retry count persistito prima di ogni tentativo
- Eventi rimangono in outbox dopo esaurimento retry
- Recupero automatico al riavvio

### Telemetry

**Sampling:**
- `TelemetrySampler` con intervallo configurabile (default 500ms = 2 Hz)
- Solo 1 frame su 10 inviato al backend
- Batch di 20 frame per richiesta HTTP

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

**TelemetrySampler:**
- shouldSample con vari intervalli
- reset
- setSampleInterval dinamico
- edge cases (timestamp 0, negativi, non-monotonici)
- scenari real-world (variable frame rates)
