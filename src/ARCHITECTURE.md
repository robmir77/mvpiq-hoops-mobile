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
  (throttle 10) (throttle 3)   every frame
       │              │
   deterministico  deterministico
```

**YOLO Scheduler:**
- Implementato internamente in `useYoloWorker.ts`
- Throttling deterministico a 10 FPS via `VISION_CONFIG.YOLO.TARGET_FPS`
- Time-based: esegue inferenza solo se `timeSinceLast >= YOLO_INTERVAL_MS` (100ms)
- Indipendente dal FPS della camera
- useShotTracker chiama `yoloWorker.processFrame()` ogni frame, il worker decide se eseguire

**MoveNet Scheduler:**
- Implementato internamente in `useMoveNetWorker.ts`
- Throttling deterministico a 3 FPS via `VISION_CONFIG.MOVENET.TARGET_FPS`
- Time-based: esegue inferenza solo se `timeSinceLast >= MOVENET_INTERVAL_MS` (333ms)
- Indipendente dal FPS della camera
- useShotTracker chiama `moveNetWorker.processFrame()` ogni frame, il worker decide se eseguire
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

// Vision Pipeline Configuration - Deterministic FPS targets
// Camera FPS is independent from vision model FPS
export const VISION_CONFIG = {
  CAMERA_FPS: 30, // Camera frame rate (hardware/configured)

  YOLO: {
    ENABLED: true,
    TARGET_FPS: 10, // YOLO inference target (10-15 FPS)
  },

  MOVENET: {
    ENABLED: true,
    TARGET_FPS: 3, // MoveNet pose estimation target (~3 FPS)
  },
} as const

export const COURT_CONFIG = {
  WIDTH_M: 15.24,      // 50 feet
  HEIGHT_M: 28.65,     // 94 feet (FULL court)
  HOOP_Y_M: 1.575,     // 10 feet
} as const
```

**Nota importante:** Il sistema NON usa adaptive performance. La frequenza della camera è indipendente dalla frequenza di inferenza YOLO/MoveNet:
- Camera: 30 FPS (configurabile via CAMERA_CONFIG)
- YOLO: 10 FPS (deterministico, via VISION_CONFIG.YOLO.TARGET_FPS)
- MoveNet: 3 FPS (deterministico, via VISION_CONFIG.MOVENET.TARGET_FPS)
- Tracking: realtime (ogni frame)
- Bridge calls: 15 FPS (throttled a 66ms)

Questa architettura deterministica evita regressioni di performance causate da accoppiamenti tra FPS della camera e FPS dei modelli di visione.

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
| YOLO scheduler a 10 FPS | ✅ | Deterministico, interno a useYoloWorker, throttle confermato dai log |
| MoveNet scheduler a 3 FPS | ✅ | Deterministico, interno a useMoveNetWorker, throttle confermato dai log |
| Scheduler duplicati rimossi | ✅ | useShotTracker non fa più scheduling esterno |
| Camera FPS migliorata | 🟡 | Da ~4 FPS a 8-12 FPS, ma ancora sotto target 30 FPS |
| Frame latency | 🟡 | 75-100 ms tipici (vs budget 33.3ms per 30 FPS) |
| MoveNet CPU crop | 🔴 | Costa ~30 ms, investigare riduzione/eliminazione |
| Player tracking worklet-safe | ✅ | Implementato |
| TTL player 750 ms | ✅ | Implementato |
| TTL ball 500 ms / Kalman | ✅ | Implementato |
| Jump threshold + safety net | ✅ | Implementato correttamente |
| Crop geometrico player | ✅ | Implementato |
| Crop effettivo immagine per MoveNet | ✅ | CPU ottimizzato (640x360 → 192x192) |
| Adaptive performance | ✅ | RIMOSSO - sistema deterministico con VISION_CONFIG |
| Residui adaptive performance | ✅ | Rimossi (TARGET_DETECTION_RATE, ADAPTATION_WINDOW_MS, etc.) |
| Throttling YOLO telemetry 15 FPS | ✅ | Implementato (66ms) |
| Decoupling camera/YOLO FPS | ✅ | VISION_CONFIG separa i target FPS |
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
while (this.criticalOutbox.size > 0 || this.telemetry.size > 0) {
  await this.flush(...)
}
```
Se il backend è offline con critical events pendenti, questo loop può continuare indefinitamente. Nonostante `flushCriticalOnly(maxAttempts)` esista, `shutdown()` non lo usa direttamente. In pratica, l'utente che preme "Fine" con backend offline può rimanere bloccato in `await workoutQueue.shutdown()` senza mai arrivare alla navigation.

### Critical Events

**Tipi:**
- `SHOT` - eventi tiro con API `addShotEvent()` - ✅ Usa critical queue
- `SESSION_START` - confermato (gestito da creazione sessione) - ✅ Non richiede queue
- `SESSION_END` - API `endWorkoutSession()` - 🔴 UI chiama direttamente, bypassa critical queue
- `CALIBRATION` - API `saveCourtCalibration()` - 🔴 UI chiama direttamente, bypassa critical queue

**NOTA CRITICA:** Nonostante l'architettura documentata preveda CALIBRATION e SESSION_END come eventi critici passanti attraverso la PersistentOutbox, l'implementazione attuale in `CalibrationScreen.tsx` e `WorkoutSessionScreen.tsx` chiama direttamente le API. Questo significa che:
- Se il device perde connessione durante salvataggio calibrazione, la calibrazione può essere persa
- Se il backend è offline durante fine sessione, SESSION_END può fallire senza retry
- La funzione per gestirli nella queue esiste (`case 'SESSION_END'`, `case 'CALIBRATION'`) ma il normale flow UI non la utilizza

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
- Documentato: Batch di 20 frame per richiesta HTTP
- Reale: Il worker chiama `flush()` immediatamente su ogni `enqueueTelemetry()`
- `telemetry.drain(20)` tende a restituire 1 elemento
- Comportamento reale: sample → HTTP batch da 1 → 500ms → sample → HTTP batch da 1
- Il batching da 20 frame non è garantito dall'implementazione

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
- Avvio/arresto manuale
- 🔴 BUG: Chiavi AsyncStorage sbagliate (vedi sezione Recovery)

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
- Verifica propagazione courtType attraverso navigation
- Verifica homography corretta per HALF vs FULL court
- Test shutdown() con backend offline (bounded behavior)
- Test duplicazione loadAllPendingAndMerge + loadPending
- Test batching telemetry reale (20 frame vs 1 frame)
