# Vision Pipeline Architecture - Async Queue Refactor

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

## Priorità di Modifica

### 🔴 P0 - Critico (Immediato)

1. **WorkoutSessionScreen.tsx** - Eliminare frameBatch + flush seriale
2. **WorkoutSessionScreen.tsx** - Introdurre queue async bounded
3. **WorkoutSessionScreen.tsx** - Sampling backend 2 Hz
4. **workouts.api.ts** - Aggiungere `saveFrameDataBatch()`
5. **Backend workout API** - Endpoint `/frames/batch`
6. **telemetry.ts** - Set → contatori

### 🟠 P1 - Importante (Dopo P0)

7. **useShotTracker.ts** - detectionHistory → ring buffer
8. **useShotTracker.ts** - Eliminare/rate-limitare log
9. **useMoveNetWorker.ts** - Eliminare log per-frame

### 🟢 P2 - Non Toccare (Già Corretto)

10. **useYoloWorker.ts** - Mantenere runSync() per ora
11. **useTrackingEngine.ts** - Mantenere ring buffer già presente
12. **TelemetryOverlay.tsx** - Max ~1 Hz
13. **usePerformanceMonitor.ts** - Mantenere 1 Hz

### 🔵 P3 - Futuro (Dopo Stabilizzazione)

14. **useShotTracker.ts** - Separare YOLO/MoveNet pipeline

---

## Dettaglio Modifiche P0

### 1. WorkoutSessionScreen.tsx - Eliminare frameBatch

**Problema attuale:**
```typescript
const frameBatch = useRef<any[]>([])
const batchTimer = useRef<ReturnType<typeof setInterval> | null>(null)

// Ad ogni detection:
frameBatch.current.push({
    frameTimestamp: detection.timestamp,
    ballX: ball?.x,
    ballY: ball?.y,
    // ...
})

// Flush seriale:
const batch = [...frameBatch.current]
frameBatch.current = []

for (const frame of batch) {
    try {
        await saveFrameData(sid, uid, frame)
    } catch (_) {}
}
```

**Perché è un problema:**
- Coda seriale: 40 frame × 100ms = 4 secondi
- `setInterval(flushFrameBatch, 2000)` può avviare un altro flush mentre il precedente è ancora in esecuzione
- Se hai 20 FPS e salvi quasi ogni frame, il backlog cresce progressivamente

**Soluzione:** Eliminare completamente questo meccanismo.

### 2. Creare workoutAsyncQueue.ts

**Nuovo file:** `src/features/workouts/services/workoutAsyncQueue.ts`

```typescript
interface AsyncQueueItem<T> {
    payload: T
    timestamp: number
}

class BoundedQueue<T> {
    private queue: T[] = []

    constructor(
        private readonly maxSize: number
    ) {}

    push(item: T): boolean {
        if (this.queue.length >= this.maxSize) {
            this.queue.shift()  // Drop oldest
        }

        this.queue.push(item)
        return true
    }

    drain(maxItems: number): T[] {
        return this.queue.splice(0, maxItems)
    }

    get size() {
        return this.queue.length
    }

    clear() {
        this.queue.length = 0
    }
}

class WorkoutAsyncQueue {
    private telemetry = new BoundedQueue<FrameDataPayload>(100)
    private critical = new BoundedQueue<any>(50)

    private running = false
    private workerPromise: Promise<void> | null = null

    enqueueTelemetry(payload: FrameDataPayload) {
        this.telemetry.push({
            payload,
            timestamp: Date.now(),
        })

        this.ensureWorker()
    }

    enqueueCritical(payload: any) {
        this.critical.push({
            payload,
            timestamp: Date.now(),
        })

        this.ensureWorker()
    }

    private ensureWorker() {
        if (this.running) return

        this.running = true
        this.workerPromise = this.run()
    }

    private async run() {
        try {
            while (
                this.critical.size > 0 ||
                this.telemetry.size > 0
            ) {
                await this.flush()
            }
        } finally {
            this.running = false
            this.workerPromise = null

            if (
                this.critical.size > 0 ||
                this.telemetry.size > 0
            ) {
                this.ensureWorker()
            }
        }
    }

    private async flush() {
        // Process critical first, then telemetry
        // Use batch API
    }

    async flushCritical() {
        while (this.critical.size > 0) {
            await this.flush()
        }
    }

    async flushTelemetry() {
        while (this.telemetry.size > 0) {
            await this.flush()
        }
    }
}
```

**Politica delle queue:**

**Critical Queue (MAX=50):**
- Non perde dati
- SHOT
- SESSION_START
- SESSION_END
- CALIBRATION

**Telemetry Queue (MAX=100):**
- Può perdere dati (drop oldest)
- frame
- FPS
- bbox
- pose telemetry
- performance

### 3. workouts.api.ts - Aggiungere API batch

**Nuova funzione:**
```typescript
export const saveFrameDataBatch = async (
    sessionId: string,
    userId: string,
    frames: FrameDataPayload[]
): Promise<void> => {
    if (frames.length === 0) return

    await apiClient.post(
        `/workouts/sessions/${sessionId}/frames/batch?userId=${userId}`,
        {
            frames,
        }
    )
}
```

**Backend endpoint richiesto:**
```
POST /workouts/sessions/{id}/frames/batch
{
  "frames": [
    {...},
    {...},
    {...}
  ]
}
```

**Beneficio:**
- 40 frame → 1 POST invece di 40 POST
- Riduzione drastica del carico HTTP

### 4. Non mandare ogni frame al backend

**Filosofia cambiata:**
Il backend non ha bisogno di ricevere ogni frame YOLO.

**Target:**
- Camera: 20 FPS
- YOLO: ~10-15 FPS
- Tracking: realtime
- Backend telemetry: 2 FPS
- Shot events: 100%

**Implementazione in WorkoutSessionScreen.tsx:**
```typescript
const lastBackendFrameTimestamp = useRef<number>(0)

if (ball || rimForTracking) {
    const now = detection.timestamp

    if (now - lastBackendFrameTimestamp.current >= 500) {  // 2 Hz
        lastBackendFrameTimestamp.current = now

        workoutQueue.enqueueTelemetry({
            frameTimestamp: now,
            ballX: ball?.x,
            ballY: ball?.y,
            ballWidth: ball?.width,
            ballHeight: ball?.height,
            ballConfidence: ball?.confidence,
            hoopX: rimForTracking?.x,
            hoopY: rimForTracking?.y,
            hoopConfidence: rimForTracking?.confidence,
            ballVelocityX: newState.ballVelocity?.vx,
            ballVelocityY: newState.ballVelocity?.vy,
            shotDetected: newState.shotDetected,
            trajectoryData: {
                points: newState.trajectory.slice(-10),
            },
        })
    }
}
```

**Risultato:** Massimo 2 POST-worthy samples/sec invece di 15-20.

### 5. handleAutoShotDetected() - Asincronia controllata

**Problema attuale:**
```typescript
await addShotEvent(...)  // Blocca il realtime
```

**Soluzione:**
```typescript
// Shot detection nel realtime
workoutQueue.enqueueCritical({
    type: 'SHOT',
    payload
})
// Ritorna immediatamente
```

**Pipeline separata:**
```
YOLO
 ↓
tracking
 ↓
shot detected
 ↓
enqueueCritical()
 ↓
FINE realtime

queue
 ↓
POST /shots
```

### 6. handleManualShot() - Stesso principio

**Da:**
```typescript
await addShotEvent(...)
```

**A:**
```typescript
workoutQueue.enqueueCritical({
    type: 'SHOT',
    payload
})

// Aggiorna UI subito
setShotCount(...)
setLastShotResult(...)
// Backend aggiornato in background
```

### 7. handleEndSession() - Drain queue

**Da:**
```typescript
await flushFrameBatch()
```

**A:**
```typescript
await workoutQueue.flushCritical()
await workoutQueue.flushTelemetry()
```

**Questa è l'unica situazione in cui accetto di aspettare la queue:**
```
UTENTE PREME FINE
        ↓
stop camera
        ↓
drain queue
        ↓
end session
```

Durante il workout: **NON ASPETTARE MAI**.

---

## Dettaglio Modifiche P1

### 8. telemetry.ts - Set → Contatori

**Problema attuale:**
```typescript
private ballDetectionFrames: Set<number> = new Set()
private playerDetectionFrames: Set<number> = new Set()
private yoloProcessedFrames: Set<number> = new Set()
```

**Perché è un problema:**
- 20 FPS × 60 minuti = 72.000 frame
- I frame counter continuano a crescere
- Set cresce potenzialmente all'infinito

**Soluzione:**
```typescript
private yoloProcessedFramesCount = 0
private ballDetectionFramesCount = 0
private playerDetectionFramesCount = 0

recordYoloProcessedFrame() {
    this.yoloProcessedFramesCount++
}

recordBallDetection() {
    this.ballDetectionFramesCount++
}

recordPlayerDetection() {
    this.playerDetectionFramesCount++
}
```

**Output:**
```typescript
framesWithBall: this.ballDetectionFramesCount
```

### 9. useShotTracker.ts - detectionHistory → Ring Buffer

**Problema attuale:**
```typescript
const detectionHistory = ...
detectionHistory.current.push(...)
detectionHistory.current = detectionHistory.current.filter(...)
```

**Crea continuamente nuovi array.**

**Soluzione:**
```typescript
const DETECTION_HISTORY_SIZE = 60

const detectionHistory = useRef(
    new Array(DETECTION_HISTORY_SIZE).fill(null)
)

const detectionHistoryIndex = useRef(0)
const detectionHistoryCount = useRef(0)

const addDetectionSample = (sample: DetectionSample) => {
    detectionHistory.current[
        detectionHistoryIndex.current
    ] = sample

    detectionHistoryIndex.current =
        (detectionHistoryIndex.current + 1) %
        DETECTION_HISTORY_SIZE

    detectionHistoryCount.current = Math.min(
        detectionHistoryCount.current + 1,
        DETECTION_HISTORY_SIZE
    )
}
```

### 10. Eliminare/rate-limitare log

**Log da eliminare o rate-limitare:**
```typescript
console.log('[MoveNet Throttle] Skip...')
console.log('[YOLO SCHEDULER] Executing YOLO...')
console.log('[BBOX FILTER] ...')
console.log('[ShotTracker] Rejected rim detection...')
console.log('[ShotTracker] Shot started')
```

**Soluzione:**
```typescript
const DEBUG_VISION = false

if (DEBUG_VISION && ...) {
    console.log(...)
}
```

**Rate-limiting per log diagnostici:**
```typescript
let lastLogTime = 0
const LOG_INTERVAL_MS = 5000

if (Date.now() - lastLogTime >= LOG_INTERVAL_MS) {
    console.log(...)
    lastLogTime = Date.now()
}
```

### 11. useMoveNetWorker.ts - Eliminare log per-frame

**Log da rimuovere:**
```typescript
console.log('[MoveNet] Skip...')
console.log('[MoveNet Throttle] Skip...')
```

**Con 20-30 FPS questi possono diventare migliaia di messaggi.**

---

## Dettaglio Modifiche P2 (Non Toccare)

### 12. useYoloWorker.ts - Mantenere runSync()

**NON trasformare in Promise:**
```typescript
// NON FARE:
await yoloModelInstance.run(...)

// MANTENERE:
const outputs = yoloModelInstance!.runSync([inputBuffer])
```

**Motivo:**
- react-native-fast-tflite documentazione per VisionCamera mostra `runSync()` nel worklet
- Il problema vero è YOLO + MoveNet sequenziali sullo stesso thread
- Non inventare pseudo-asincronità che sposta il carico sul JS thread

### 13. useTrackingEngine.ts - Già corretto

**Già implementato:**
```typescript
const MAX_POINTS = 90
// trajectoryBuffer come ring buffer
```

**Mantenere così.**

### 14. TelemetryOverlay.tsx - Max 1 Hz

**Già corretto:**
```typescript
setInterval(..., ...)
```

**Mantenere a 1 Hz. Non fare telemetry UI ad ogni frame.**

**Filosofia:**
- Vision: 20 FPS
- UI telemetry: 1 FPS
- Backend telemetry: 1-2 FPS

### 15. usePerformanceMonitor.ts - Mantenere 1 Hz

**Già corretto:**
```typescript
setInterval(..., 1000)
```

**Mantenere solo per:**
- YOLO FPS
- tracking FPS
- overlay FPS

---

## Dettaglio Modifiche P3 (Futuro)

### 16. Separare YOLO e MoveNet

**Architettura attuale:**
```
useShotTracker
      │
      └── onFrame
            │
            ├── YOLO
            │
            └── MoveNet
```

**Target:**
```
                  CAMERA
                     │
          ┌──────────┴──────────┐
          │                     │
          ▼                     ▼
     YOLO pipeline         Pose pipeline
          │                     │
          ▼                     ▼
    latestPlayerBBox       latestPose
          │                     │
          └──────────┬──────────┘
                     ▼
               Tracking Engine
```

**YOLO deve produrre:**
- latestResultPlayer
- latestResultBall
- latestResultRim

**MoveNet legge:**
- playerBbox (già fatto via SharedValue)

**Nota:** Questa parte del codice è già predisposta:
```typescript
moveNetWorker.playerBbox.value = {
    x: trackedBbox.bbox.x,
    y: trackedBbox.bbox.y,
    ...
}
```

### 17. Non forzare due thread subito

**Prudenza:**
- Con react-native-fast-tflite, il modello viene utilizzato direttamente dal worklet
- L'inferenza documentata nel frame processor è sincrona
- Non inventare pseudo-asincronità del tipo:
  ```typescript
  scheduleOnRN(() => {
     model.run(...)
  })
  ```
- Rischio: spostare il carico sul JS thread, creare backlog, perdere controllo del frame

**La vera parallelizzazione richiede una scelta più profonda di runtime/threading.**

### 18. runOnJS vs scheduleOnRN per React State da Worklets

**runOnJS (react-native-reanimated):**
- Usare con `useAnimatedReaction`, `useAnimatedStyle`, e altre API Reanimated
- Sintassi: `runOnJS(callback)(arg1, arg2, ...)`
- Esempio:
```typescript
import { runOnJS } from 'react-native-reanimated'

useAnimatedReaction(
    () => ({ ballX: sharedValues?.ballX.value }),
    (current) => {
        'worklet'
        runOnJS(updateAutoStatus)(current.ballX)
    }
)
```

**scheduleOnRN (react-native-worklets):**
- Usare in worklet generici o frame processor worklet
- Sintassi: `scheduleOnRN(callback, arg1, arg2, ...)`
- Esempio:
```typescript
import { scheduleOnRN } from 'react-native-worklets'

const onFrame = useCallback((frame: Frame) => {
    'worklet'
    // ... processing ...
    scheduleOnRN(updateTelemetry, metrics)
}, [])
```

**Nota:** `runOnJS` è deprecato in TypeScript ma è ancora l'API corretta per useAnimatedReaction. `scheduleOnRN` è per altri casi d'uso worklet.

---

## Piano di Esecuzione

### Fase 1: P0 - Senza toccare ML

**Obiettivo:** Verificare se il degrado dopo 5/10/20 minuti sparisce senza toccare YOLO/MoveNet.

**Modifiche:**
1. WorkoutSessionScreen - remove frameBatch
2. WorkoutSessionScreen - AsyncQueue
3. WorkoutSessionScreen - sampling backend 2 Hz
4. workouts.api.ts - saveFrameDataBatch()
5. Backend - endpoint /frames/batch
6. telemetry.ts - Set → counters

### Fase 2: P1 - Pulizia codice

**Modifiche:**
7. useShotTracker - detectionHistory → ring buffer
8. useShotTracker - eliminare/rate-limitare log
9. useMoveNetWorker - eliminare log per-frame

### Fase 3: P3 - Separazione pipeline vision

**Dopo aver stabilizzato YOLO/MoveNet/Tracking.**

---

## Architettura Corrente (Pre-Refactor)

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

---

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

---

## Stato Implementazione Pre-Refactor

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

---

## Conclusione

La modifica più importante è questa:

**PRIMA:**
```
YOLO → tracking → React → frameBatch → 40 POST
                           ↓
                     backlog crescente
```

**DOPO:**
```
YOLO → tracking → SharedValues → UI

             └──────→ bounded queue
                          ↓
                       batch
                          ↓
                        HTTP
```

Questa modifica agisce esattamente sul tipo di accumulo che può spiegare il fatto che il Workout sia veloce all'inizio e degradi progressivamente.

**Nota importante su run() vs runSync():**
L'attuale react-native-fast-tflite supporta `run()` asincrono a livello API, ma la documentazione per VisionCamera continua a mostrare `runSync()` nel worklet. Non userei `run()` come scorciatoia per "parallelizzare" il frame processor.

### Visione Architetturale Target

```
                    MVPIQ VISION ARCHITECTURE
                              │
             ┌────────────────┴────────────────┐
             │                                 │
       DETECTION LAYER                    TRACKING LAYER
             │                                 │
        YOLO 320/512/640                    Ball
             │                              Player
             │                               Rim
             ▼                                 │
        detections                             ▼
                                      tracked objects
             │
             └──────────────┬──────────────────┘
                            │
                            ▼
                     POSE ESTIMATION
                            │
                     Player crop
                            │
                       MoveNet 192
                            │
                            ▼
                         Pose
                            │
                            ▼
                  BASKETBALL ENGINE
                            │
                 ┌──────────┼──────────┐
                 ▼          ▼          ▼
             trajectory   shot       biomechanics
                          detect
                            │
                       MADE/MISS
```

### P0 - Priorità Critica (Risolto)

#### P0-1: ✅ Reentrancy Guard Implementato
**Risolto:** Implementato guard reentrancy in `useShotTracker.ts` per prevenire elaborazioni concorrenti.

**Implementazione:**
```typescript
if (isProcessingFrame.value) {
  perfFramesDroppedBusy.value += 1
  frame.dispose()
  return
}

isProcessingFrame.value = true
// ... processing ...
finally {
  isProcessingFrame.value = false
  frame.dispose()
}
```

**Risultato:** Due onFrame contemporanei non possono più entrare nel processing. Il dispose() è gestito in un unico punto nel finally block.

#### P0-2: ✅ YOLO Model Registry Aggiornato
**Risolto:** Registry aggiornato con modelli Float16 corretti.

**YOLO model ladder attuale:**
```
best_640_float16
best_512_float16
best_448_float16
best_384_float16
best_320_float16  ← default (più compatibile cross-device)
```

**Modelli rimossi:**
- best_416_float16 (risoluzione incompatibile, rimosso completamente)
- best_480_float16 (risoluzione incompatibile, rimosso completamente)

**Codice:** `DEFAULT_YOLO_MODEL_ID: 'best_384_float16'` in `appConfig.ts` (384 offre miglior equilibrio stabilità/performance)

**Nota:** Adaptive Performance YOLO_MODEL_TIERS include solo: 640 → 512 → 320 (manca 448 e 384)

#### P0-3: ✅ Dimensione Resize MoveNet Corretta
**Risolto:** Documento aggiornato con dimensioni corrette.

**Pipeline corretta:**
```
1280 × 720
       ↓
640 × 360  (INTERMEDIATE_RESIZE_SIZE / max(frameWidth, frameHeight))
```
Tutte le occorrenze di "640×640" sono state corrette in "640×360".

#### P0-4: ✅ YOLO Scheduler Implementato
**Risolto:** Implementato scheduler YOLO basato su intervallo e guard.

**Implementazione:**
```typescript
const yoloIntervalMs = targetFps > 0 ? 1000 / targetFps : 67
const timeSinceLastYolo = lastYoloInferenceAt.value > 0
  ? nowForMoveNet - lastYoloInferenceAt.value
  : yoloIntervalMs

const yoloDue =
  ballEnabledShared.value &&
  !yoloWorker.isProcessing.value &&
  timeSinceLastYolo >= yoloIntervalMs &&
  yoloScheduledCount.value === 0
```

**Tre protezioni attive:**
1. `isProcessingFrame` - previene concorrenza frame
2. `yoloWorker.isProcessing` - previene concorrenza YOLO
3. `yoloScheduledCount` - previene doppio scheduling nello stesso intervallo

**Risultato test:** req/exec = 1:1 confermato (nessun doppio scheduling)

#### P0-5: ✅ Metriche FPS Clarificate
**Risolto:** Documentazione aggiornata con distinzione chiara tra requested e actual FPS.

**Metriche misurate:**
```
Camera FPS: 30 FPS (configurato)
YOLO requested FPS: 30 FPS (ogni frame schedulato)
YOLO actual inference FPS: ~20-21 FPS (best_384, ~47ms inferenza)
MoveNet actual FPS: ~5 FPS (throttled a 3, ma bottleneck JS thread)
```

**Nota:** La distinzione tra "requested FPS" e "actual inference FPS" è fondamentale. YOLO viene schedulato su ogni frame, ma l'actual FPS è limitato dal tempo di inferenza hardware.

### P1 - Architettura (Formalizzata)

#### P1-1: ✅ Vision Pipeline Layer Formalizzato
**Risolto:** `useShotTracker` definito come "Vision Pipeline Layer".

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

**Nota:** Adaptive performance temporaneamente disabilitato per debugging.

#### P1-2: ✅ Basketball Intelligence Layer Formalizzato
**Risolto:** `useTrackingEngine` definito come "Basketball Intelligence Layer".

**Responsabilità:**
- Advanced Kalman tracking per ball position prediction
- Ball trajectory analysis (release point, apex, descending)
- Shot detection logic (MADE/MISS/AIRBALL classification)
- Release point detection
- Apex detection
- Shot quality metrics
- Ball state management (DETECTED/PREDICTED/LOST)

**Separazione architetturale:**
```
Vision Layer (useShotTracker)
  ↓
Detection + Basic Tracking
  ↓
Basketball Intelligence Layer (useTrackingEngine)
  ↓
Shot Analysis + Basketball Logic
```

#### P1-3: ✅ Frame Scheduler Implementato
**Risolto:** Scheduler centralizzato implementato in `useShotTracker.ts`.

**Architettura scheduler:**
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

**YOLO Scheduler:**
- Basato su `yoloIntervalMs` (1000 / targetFps)
- Tre protezioni: `isProcessingFrame`, `yoloWorker.isProcessing`, `yoloScheduledCount`
- req/exec = 1:1 confermato nei test

**MoveNet Scheduler:**
- Time-based throttling a 3 FPS (ogni ~333ms)
- Eseguito solo se player bbox disponibile
- Bottleneck JS thread riduce actual FPS a ~5 FPS

#### P1-4: ✅ Tracking Policies Definite
**Risolto:** Politiche di tracking documentate e implementate.

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
Confidence threshold: 5% (YOLO_CONFIG.PLAYER_CROP_MIN_CONFIDENCE)
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
Confidence threshold: 10% (YOLO_CONFIG.RIM_CONF_THRESHOLD)
Note: Non è vero "tracking", è "best-confidence locking" per camera stabile
```

### P2 - Validazione (Test Eseguiti)

#### P2-1: ✅ Test Reentrancy e Scheduler
**Eseguito:** Test su Samsung Galaxy S21 Ultra 5G (SM-G998B) con best_384_float16.

**Risultati:**
- req/exec = 1:1 confermato (nessun doppio scheduling)
- `yoloScheduledCount` previene correttamente doppie esecuzioni
- `timeSinceLast` varia correttamente (33ms, 58ms, 38ms, 52ms, 75ms...)
- `droppedBusy` basso (0-6 frame persi per concorrenza)

**Metriche YOLO:**
- YOLO actual FPS: 20-21 FPS (media, non throughput istantaneo - vedi nota sotto)
- Tempo inferenza: ~47-48ms (run=38-39ms + resize/parse)
- req/exec: 321/321, 302/302, 316/316 (perfetto 1:1)

**⚠️ NOTA IMPORTANTE: Metrica YOLO FPS Fuorviante**
La metrica "YOLO 20-21 FPS stabile" calcolata da `telemetry.ts` è fuorviante:
```typescript
const avgMs = this.yoloInferenceTimes.reduce...] / this.yoloInferenceTimes.length
const fps = 1000 / avgMs
```
Questo calcola FPS come `1000 / media dei tempi di inferenza`, non il throughput istantaneo. Inoltre conserva fino a 300 campioni, quindi se i tempi degradano progressivamente (47ms → 100ms → 150ms), la console può ancora mostrare 20.5 FPS perché sta mediando anche i campioni precedenti. Questa metrica non è sufficiente per dimostrare che YOLO sia stabile durante il degrado della camera.

**Problema identificato:** Camera FPS degradation
- Inizio: camFPS=17.0 recv=17 proc=8
- Mezzo: camFPS=30.0 recv=30 proc=6 drop=6
- Fine: camFPS=5.0 recv=5 proc=5
- Ultimo: camFPS=6.0 recv=6 proc=5 drop=1

**🔴 DIAGNOSI CORRETTA:**
La metrica camera viene calcolata come `perfFramesReceived.value / 1.0`, dove `perfFramesReceived` viene incrementato all'ingresso di `onFrame`. Quando vediamo `cameraFPS = 5-6`, significa realmente che solo 5-6 callback `onFrame` stanno arrivando in quel secondo. Non è semplicemente un problema dell'overlay o del contatore FPS della UI - è un segnale molto serio che il frame processor è bloccato.

**Problema architetturale: runSync() dentro onFrame**
La pipeline attuale:
```
useFrameOutput.onFrame()
        │
        ├── YOLO scheduler
        │
        ├── yoloWorker.processFrame()
        │       │
        │       ├── resize
        │       ├── getPixelBuffer
        │       ├── Float32Array
        │       ├── runSync()   ← BLOCCANTE
        │       └── parsing
        │
        ├── MoveNet
        │
        └── frame.dispose()
```
`runSync()` viene eseguito direttamente nel frame-processing worklet. Con il benchmark attuale:
- YOLO run: ~38-39 ms
- resize + parse: ~8-10 ms
- **Totale: ~47-48 ms**

A 30 FPS la finestra disponibile è 33.3 ms. Abbiamo quindi:
- YOLO pipeline: ~48 ms
- Camera budget: ~33 ms

Prima ancora di considerare MoveNet, tracking, bridge e rendering, il sistema è già sotto pressione.

**Sospetti principali (in ordine di priorità):**
1. **🔴 YOLO runSync() dentro onFrame** - Problema architetturale concreto
2. **🔴 YOLO GPU + MoveNet GPU contention** - Due modelli competono per le stesse risorse hardware
3. **🔴 console.log DEV nel percorso caldo** - Troppi log nel percorso critico in development build
4. **🟠 MoveNet CPU crop** - Contribuisce, ma non sembra sufficiente da solo
5. **🟠 scheduleOnRN/JS congestion** - Da misurare

**⚠️ Float32Array NON è la causa primaria**
Nel codice attuale YOLO fa:
```typescript
const pixelBuffer = resized.getPixelBuffer()
const source = new Float32Array(pixelBuffer as unknown as ArrayBufferLike)
const inputBuffer = source.buffer as ArrayBuffer
const outputs = yoloModelInstance!.runSync([inputBuffer])
```
Non c'è più `slice()`. La conversione Float32Array rimane un'operazione da misurare, ma non è la prima cosa che correggerei.

**⚠️ Scheduler YOLO: Complessità inutile**
Lo scheduler esiste ed è implementato correttamente, ma ha due meccanismi di clock:
```
useShotTracker
    ↓
lastYoloInferenceAt
yoloScheduledCount

+

useYoloWorker
    ↓
lastInferenceAt
yoloScheduledCount
```
Non è necessariamente un bug, ma è complessità inutile. Il scheduler dovrebbe avere un solo proprietario.

**Piano di test per isolare il problema:**
Non modificare ancora l'algoritmo. Fare 4 test identici da 30-60 secondi, con la stessa risoluzione 1280×720 e stesso modello best_384_float16.

**TEST A (Baseline) - ✅ COMPLETATO**
- YOLO OFF
- MoveNet OFF
- Overlay OFF
- Serve per stabilire il baseline camera

**Risultati TEST A:**
```
Camera:        ~30–31 FPS (stabile per tutta la sessione)
recv:          ~30–31/s
processed:     0
droppedBusy:   0–1
YOLO:          0 (fps=0, req/exec=0/0, run=0)
MoveNet:       0 (fps=0, req/exec=0/0, run=0)
Tracking:      29 (stabile)
```

**Conclusione TEST A:**
La camera/frame pipeline di base NON degrada da sola. Il modello viene caricato ma non eseguito. Il baseline è sano. Questo elimina l'ipotesi che il problema sia nella camera/VisionCamera stessa. Il degrado viene introdotto quando attiviamo YOLO e/o MoveNet.

**TEST B (YOLO isolato) - ✅ COMPLETATO**
- YOLO ON
- MoveNet OFF
- Overlay OFF
- Serve per isolare l'impatto di YOLO sulla camera FPS

**Risultati TEST B:**
```
Camera:        7–20 FPS (molto instabile, range: 7-20)
recv:          7–20/s
processed:     5–8 per intervallo
droppedBusy:   0–5 (aumento rispetto al baseline)
YOLO:          10–20 FPS (avg ~48-49ms inference time)
YOLO req/exec: 368/368 (100% eseguite)
MoveNet:       0 (fps=0, req/exec=0/0, run=0)
Tracking:      6–21 (variabile)
```

**Conclusione TEST B:**
YOLO CAUSA IL DAGRADO DELLA CAMERA. Con YOLO attivo, la camera FPS scende da 30-31 (baseline) a 7-20 FPS, con forte instabilità. L'inference time di YOLO è stabile (~ms), ma l'esecuzione sincrona di YOLO nel frame processor blocca la pipeline, causando droppedBusy e degrado della camera. Questo conferma che il problema è nel percorso YOLO/frame processor, specificamente nell'interazione tra runSync() e onFrame().

**FIX ARCHITETTURALE IMPLEMENTATO (v2 - YOLO Frequency Reduction):**
L'approccio `scheduleOnRN` è fallito a causa delle limitazioni dei worklet di React Native (le funzioni `useCallback` sono "bound" e non accettate da `scheduleOnRN`).

Ho implementato una fix alternativa pragmatica: ridurre la frequenza YOLO a 15 FPS mentre la camera rimane a 30 FPS.

**Risultati TEST B-v2 (YOLO 15 FPS target):**
```
Camera:        16-20 FPS (degradata vs baseline 30-31 FPS)
YOLO:          ~22 FPS (BUG SCHEDULER: esegue sopra il target 15 FPS)
YOLO avg:      45-46 ms (stabile)
droppedBusy:   1-4 (aumento rispetto al baseline)
```

**Conclusione v2:** FAILED. La riduzione della frequenza non risolve il problema perché ogni `runSync()` continua a bloccare il percorso camera per ~45-46 ms.

**FIX ARCHITETTURALE IMPLEMENTATO (v3 - YOLO 10 FPS target):**
Ridotto ulteriormente il target YOLO a 10 FPS per verificare se frequenza più bassa permette alla camera di mantenere ~30 FPS.

**Risultati TEST B-v3 (YOLO 10 FPS target):**
```
Camera:        15-34 FPS (variabile, picchi a 34 FPS ma instabile)
YOLO:          ~21 FPS (BUG SCHEDULER: esegue sopra il target 10 FPS)
YOLO avg:      47-48 ms (stabile)
droppedBusy:   1-5 (aumento rispetto al baseline)
```

**Conclusione v3:** FAILED. Anche con target 10 FPS:
1. **Bug scheduler persiste:** YOLO esegue a ~21 FPS con target 10 FPS (stesso problema v2)
2. **Camera degrada:** Anche con frequenza ridotta, `runSync()` blocca il thread per ~47-48 ms
3. **Problema architetturale confermato:** Ridurre la frequenza non è una soluzione efficace

**CONCLUSIONE FINALE:**
Il problema è puramente architetturale: `runSync()` blocca il frame processor per ~47-48 ms, superando il budget di 33.3 ms/frame a 30 FPS. Nessuna riduzione di frequenza (15 FPS, 10 FPS, o anche 5 FPS) risolverà il problema perché ogni inferenza monopolizza la pipeline.

**Soluzione richiesta:** Isolare veramente il consumer YOLO dalla pipeline camera in modo che `runSync()` non blocchi `onFrame()`. Questo richiede un'architettura di worker thread o queue system separato dal frame processor worklet.

**TEST C (MoveNet isolato)**
- YOLO OFF
- MoveNet ON
- Overlay OFF
- Particolarmente importante per verificare il nuovo crop MoveNet

**TEST D (Combinazione)**
- YOLO ON
- MoveNet ON
- Overlay OFF
- Se A/B/C sono relativamente stabili e D degrada → combinazione YOLO GPU + MoveNet GPU è il principale sospetto

**TEST E (Release build)**
- Stesso TEST B, ma in release build, non development
- Perché adesso abbiamo troppi `if (__DEV__) { console.log(...) }` nel percorso critico
- Se DEV: 30→18→10→5 e RELEASE: 30→29→28→27 → abbiamo trovato immediatamente una grossa parte del problema

### Note Aggiuntive

#### Rim Tracking: Best-Confidence Locking
**Strategia attuale:**
```
nuovo rim
confidence > lastRimConfidence
        ↓
accetta
```

**Rischio:** Funziona se camera è completamente stabile, ma può creare problemi:
```
Rim confidence:
0.40
0.60
0.80
0.75 ← posizione migliore ma confidence inferiore
```
Il sistema mantiene il vecchio rim. Non è vero "tracking", è "best-confidence locking".

**Futuro:** Considerare `confidence + positional stability` invece di solo confidence.

## Implementazione Crop Player per MoveNet

### Geometria Crop
Il sistema calcola la regione crop quadrata del player usando:
- `makeSquareCrop()` in `useMoveNetWorker.ts`
- Tracking player con TTL 750ms in `usePlayerCropManager.ts`
- Smoothing bbox con EMA
- Jump threshold 0.15 con safety net (3 rifiuti consecutivi)
- Trasformazione keypoint da crop space a frame space

### Crop CPU Ottimizzato
`react-native-vision-camera-resizer` V5 NON supporta crop arbitrario nativo (GitHub issue #3746). La soluzione implementata:

**Pipeline:**
```
Camera Frame 1280×720
    ↓
Player BBox (normalizzato)
    ↓
Padding 15% + Clamp
    ↓
makeSquareCrop() (geometria)
    ↓
intermediateResizer.resize(frame) → 640×360 Float32 (16:9 aspect ratio)
    ↓
cropAndResizeFloat32() → 192×192 Float32 (CPU crop ottimizzato)
    ↓
Conversione dataType (uint8/int8/float32)
    ↓
MoveNet inference (async su JS thread)
    ↓
Pose parser
    ↓
Keypoints trasformati (crop → frame space)
```

**Configurazione:**
- Resize GPU intermedio: 640×360 (match aspect ratio 16:9)
- `scaleMode: 'contain'` (no letterboxing perché aspect ratio match)
- Crop CPU su Float32 con nearest neighbor
- `usingPlayerCrop = true` quando bbox disponibile

**Performance:**
- CPU crop da 1280×720: ~92ms
- CPU crop da 640×360: ~5-10ms
- Miglioramento: -40% tempo MoveNet (da ~200ms a ~110ms)

## Architettura Corrente

### Vision Pipeline Layer (useShotTracker)

**Responsabilità:**
- Camera frame acquisition tramite `useFrameOutput`
- YOLO detection (ball, player, rim) su ogni frame
- Ball/Player/Rim detection parsing e filtering
- Player crop management (TTL 750ms, EMA smoothing, jump threshold)
- MoveNet pose estimation (throttled a 3 FPS)
- Adaptive performance management (scaling modello YOLO)
- Kalman prediction base per ball tracking
- Frame scheduler coordination (YOLO + MoveNet throttling)

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

**Nota:** useShotTracker gestisce la pipeline di vision "grezza" (YOLO → detection → tracking base → pose), mentre useTrackingEngine gestisce l'intelligenza basketball (trajectory analysis, shot detection, MADE/MISS/AIRBALL).

### Basketball Intelligence Layer (useTrackingEngine)

**Responsabilità:**
- Advanced Kalman tracking per ball position prediction
- Ball trajectory analysis (release point, apex, descending)
- Shot detection logic (MADE/MISS/AIRBALL classification)
- Release point detection
- Apex detection
- Shot quality metrics
- Ball state management (DETECTED/PREDICTED/LOST)

**Separazione architetturale:**
```
Vision Layer (useShotTracker)
  ↓
Detection + Basic Tracking
  ↓
Basketball Intelligence Layer (useTrackingEngine)
  ↓
Shot Analysis + Basketball Logic
```

**Nota:** useTrackingEngine riceve le detection grezze da useShotTracker e applica logica basketball-specifica per analizzare trajectory, detect shot events e classificare MADE/MISS/AIRBALL.

### Frame Scheduler

**Stato implementazione:** ✅ Completato

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

**Comportamento attuale:**
- **YOLO**: Schedulato su ogni frame ricevuto dalla camera (30 FPS richiesti, ~20-21 FPS actual)
- **MoveNet**: Throttled a 3 FPS tramite time-based scheduling (ogni ~333ms)
- **Tracking**: Eseguito ogni frame per Kalman prediction

**Metriche FPS misurate:**
```
Camera FPS: 30 FPS (configurato)
YOLO requested FPS: 30 FPS (ogni frame schedulato)
YOLO actual inference FPS: ~20-21 FPS (best_384, ~47ms inferenza)
MoveNet actual FPS: ~5 FPS (throttled a 3, ma bottleneck JS thread)
```

**Nota:** La distinzione tra "requested FPS" e "actual inference FPS" è fondamentale. YOLO viene schedulato su ogni frame, ma l'actual FPS è limitato dal tempo di inferenza hardware.

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
Confidence threshold: 5% (YOLO_CONFIG.PLAYER_CROP_MIN_CONFIDENCE)
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
Confidence threshold: 10% (YOLO_CONFIG.RIM_CONF_THRESHOLD)
Note: Non è vero "tracking", è "best-confidence locking" per camera stabile
```

### Pipeline Principale

```
Camera Frame (1280×720 @ 30 FPS)
    ↓
Reentrancy Guard (isProcessingFrame)
    ↓
YOLO Scheduler (yoloIntervalMs + 3 protezioni)
    ↓
YOLO Detection (best_384_float16 FP16) - SCHEDULATO
    ↓
YOLO Parser
    ↓
    ├── Ball → BallTracker (TTL 500ms) → Kalman Prediction
    ├── Hoop → RimTracker (TTL 500ms)
    └── Player → PlayerTracker (TTL 750ms) → MoveNet (192×192) SOLO SE BBOX DISPONIBILE
```

### Componenti Principali

#### 1. YOLO Detection
- **Modello**: `best_384_float16.tflite` (default - miglior equilibrio stabilità/performance)
- **Risoluzione**: 384×384 FP16
- **Model ladder in yoloModels.ts**: best_640_float16 → best_512_float16 → best_448_float16 → best_384_float16 → best_320_float16
- **Model ladder in useAdaptivePerformance.ts**: best_640_float16 → best_512_float16 → best_320_float16 (MANCA 448 e 384)
- **Output**: Bounding boxes per ball, hoop, player
- **Scheduling**: Basato su `yoloIntervalMs` con 3 protezioni (reentrancy guard, YOLO guard, scheduled count)
- **Throttling**: Disabilitato (YOLO_FRAME_SKIP rimosso)
- **Adaptive**: Sistema adaptive performance completamente disabilitato per debugging (TEMPORARILY DISABLED in useShotTracker.ts)

**MODEL PERFORMANCE BENCHMARK (Samsung SM-G998B, Android 15, GPU delegate)**

| Model        | Input | Output Detections | FPS Range       | Notes |
|--------------|-------|-------------------|-----------------|-------|
| best_320     | 320   | 2100              | 10-37 (variable)| Highly unstable, starts high then drops to 10-12, 50 epoche |
| best_384     | 384   | 3024              | 20-21 (stable)  | Test recente: req/exec=1:1, ~47ms inferenza, 50 epoche |
| best_448     | 448   | 4116              | 12-21 (variable)| Starts high then drops to 9-11, 5 epoche |
| best_512     | 512   | 5376              | 8-10 (variable) | Starts high then drops to 6-8, 40 epoche |
| best_640     | 640   | 8400              | 5-7 (stable)    | Stable but low FPS, 30 epoche |

**Modelli rimossi:**
- best_416_float16 (risoluzione incompatibile, rimosso)
- best_480_float16 (risoluzione incompatibile, rimosso)

**Recommendations:**
- best_384 mostra performance stabili a 20-21 FPS nel test recente
- best_640 è l'unico modello con performance stabili ma a FPS basso (5-7)
- Per il test corrente: best_384 è stato confermato stabile con req/exec=1:1

#### 2. Ball Tracking
- **TTL**: 500ms (time-based)
- **Kalman Prediction**: Eseguita anche durante gap YOLO (ogni frame viene inviato anche senza detection)
- **Stati Visuali**: DETECTED (🟠), PREDICTED (🔴), LOST (🔴)
- **Telemetria**: `ballDetected`, `ballPrediction`, `ballTrackingExpired`
- **Parser**: x/y sono già centro della palla (ShotDetector usa direttamente ball.x/ball.y)
- **Confidence**: Threshold gestito dal parser (nessun secondo filtro fisso nel worker)

#### 3. Player Tracking
- **TTL**: 750ms (time-based)
- **Smoothing**: EMA su coordinate bbox
- **Jump Threshold**: 0.15 per filtrare detection spurie
- **Safety Net**: Force accept dopo 3 rifiuti consecutivi
- **Stati Visuali**: DETECTED (🟠), PREDICTED (🔴), LOST (🔴)

#### 4. MoveNet Pose Estimation
- **Modello**: `movenet_lightning_192_int8.tflite`
- **Risoluzione**: 192×192
- **Frequenza**: 3 FPS (throttled)
- **Condizione esecuzione**: Solo se player bbox disponibile (trackedBbox !== null)
- **Preprocessing**: GPU resize intermedio (640×360) → CPU crop player ottimizzato → Resize 192×192
- **Inferenza**: Asincrona su JS thread (~70ms)
- **Crop**: CPU crop ottimizzato su Float32
  - Nota: react-native-vision-camera-resizer V5 NON supporta crop arbitrario nativo
  - Soluzione: resize GPU intermedio 640×360 + crop CPU su Float32

#### 5. Rim Tracking
- **TTL**: 500ms (time-based)
- **Stati Visuali**: DETECTED (🟠), PREDICTED (🔴), LOST (🔴)
- **Fallback**: Usa calibration point quando YOLO non rileva

### Configurazione Globale

Tutti i threshold e valori di default sono centralizzati in `appConfig.ts`:

### Adaptive Performance

**Stato implementazione:** ❌ Completamente disabilitato per debugging

- ❌ Sistema adaptive performance esistente (`useAdaptivePerformance.ts`) ma TEMPORARILY DISABLED in `useShotTracker.ts`
- ❌ Collegamento adaptive model al worker YOLO disabilitato (commentato)
- ❌ Adaptive FPS NON collegato alla camera
  - **Limitazione:** VisionCamera V5 non supporta FPS dinamico tramite `useFrameOutput`
  - Il FPS è configurato a livello di `Camera` session, non del frame output
  - Per implementare FPS dinamico, sarebbe necessario ricreare l'intera sessione camera quando FPS cambia
  - Questo è un cambiamento architetturale significativo che richiede valutazione

**Codice:** Tutti i riferimenti a `useAdaptivePerformance` sono commentati con `TEMPORARILY DISABLED` in `useShotTracker.ts` (righe 186-208, 927-943, 1240)

### Stato Implementazione

| Componente | Stato | Note |
|------------|-------|------|
| Separazione YOLO/tracking/MoveNet | ✅ | Completata |
| Reentrancy guard | ✅ | Implementato con isProcessingFrame |
| YOLO scheduler | ✅ | Implementato con 3 protezioni |
| Player tracking worklet-safe | ✅ | Implementato |
| TTL player 750 ms | ✅ | Implementato |
| TTL ball 500 ms / Kalman | ✅ | Implementato |
| Jump threshold + safety net | ✅ | Implementato correttamente |
| MoveNet throttling 3 FPS | ✅ | Implementato |
| Fix doppio clock MoveNet | ✅ | Implementato |
| Pose parser [y,x,score] | ✅ | Corretto |
| Stati DETECTED/PREDICTED/LOST | ✅ | Implementati |
| Telemetria | ✅ | Ampiamente implementata |
| TelemetryOverlay FPS range dinamico | ✅ | Calcolato da minMs/maxMs in tempo reale |
| TelemetryOverlay usage minutes | ✅ | Aggiornato con dipendenza useEffect |
| YOLO scheduling basato su intervallo | ✅ | YOLO_FRAME_SKIP rimosso |
| Adaptive performance (model) | ❌ | Completamente disabilitato per debugging |
| Adaptive performance (FPS) | ❌ | Completamente disabilitato per debugging |
| Crop geometrico player | ✅ | Implementato |
| Crop effettivo immagine per MoveNet | ✅ | CPU ottimizzato (640x360 → 192x192) |
| MoveNet riceve crop 192×192 | ✅ | Riceve crop player reale |
| Risoluzione camera | ✅ | Allineata a 1280×720 |
| Log debug dimensioni buffer | ✅ | Aggiunto per verifica runtime |
| Test req/exec=1:1 | ✅ | Confermato con best_384 |
| Camera FPS degradation | ⚠️ | Problema identificato, investigazione in corso |

**Percentuale completamento architettura:** ~85%

**Rimanenti:**
- Investigare causa camera FPS degradation (5-6 FPS sotto carico)
- Test effettivo pose detection con crop corretto (richiede esecuzione app)
- Valutazione se riabilitare adaptive performance dopo debugging
- Correggere YOLO_MODEL_TIERS in useAdaptivePerformance per includere 448 e 384

### Configurazione Globale

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

### Visual Tracking State System

Per debug sul campo, ogni oggetto tracciato ha uno stato visuale esplicito:

**VisionTrackState**: `'DETECTED' | 'PREDICTED' | 'LOST' | 'REJECTED'`

**Ball**:
- DETECTED 🟠: YOLO vede la palla, mostra confidence
- PREDICTED 🔴: YOLO perde la palla, Kalman continua (mostra age in ms)
- LOST 🔴: TTL scaduto (>500ms), tracking invalidato

**Player**:
- DETECTED 🟠: YOLO vede il player, mostra confidence
- PREDICTED 🔴: YOLO perde il player, usa last bbox (mostra age in ms)
- LOST 🔴: TTL scaduto (>750ms), MoveNet non esegue

**Rim**:
- DETECTED 🟠: YOLO vede il canestro
- PREDICTED 🔴: Usa calibration point come fallback
- LOST 🔴: Nessuna detection né calibration

**SharedValues per stati visuali**:
- `ballTrackState`, `ballTrackAge`
- `playerTrackState`, `playerTrackAge`
- `rimTrackState`, `rimTrackAge`

## Performance Analysis

### Bottleneck Principale: Camera FPS Degradation

**Problema identificato nel test recente (best_384_float16):**
- Inizio: camFPS=17.0 recv=17 proc=8
- Mezzo: camFPS=30.0 recv=30 proc=6 drop=6
- Fine: camFPS=5.0 recv=5 proc=5
- Ultimo: camFPS=6.0 recv=6 proc=5 drop=1

**🔴 DIAGNOSI CORRETTA:**
La metrica camera viene calcolata come `perfFramesReceived.value / 1.0`, dove `perfFramesReceived` viene incrementato all'ingresso di `onFrame`. Quando vediamo `cameraFPS = 5-6`, significa realmente che solo 5-6 callback `onFrame` stanno arrivando in quel secondo.

**Causa principale: runSync() bloccante dentro onFrame**
```
                    CAMERA
                      │
                   30 FPS
                      │
                      ▼
                useFrameOutput
                      │
                      ▼
                  onFrame
                      │
             ┌────────┴────────┐
             │                 │
          YOLO             MoveNet
             │                 │
          runSync             async
             │                 │
          ~48 ms             ~70 ms
             │                 │
             └────────┬────────┘
                      │
               tracking/bridge
                      │
                      ▼
                  dispose()
```
Il sistema può iniziare bene perché GPU libera, buffer liberi, JS thread libero. Poi sotto carico abbiamo:
- YOLO GPU
- MoveNet GPU
- GPUFrame mantenuti
- Allocazioni CPU
- scheduleOnRN
- console.log DEV
- Skia/rendering

Progressivamente il sistema entra in una situazione di resource contention. Questo è molto più coerente con:
```
inizio → 20 FPS
        ↓
dopo un po'
        ↓
10 FPS
        ↓
5 FPS
```
che con un semplice "YOLO è troppo lento".

**Sospetti principali (in ordine di priorità):**
1. **🔴 YOLO runSync() dentro onFrame** - 48ms in un budget di 33ms
2. **🔴 YOLO GPU + MoveNet GPU contention** - Due modelli competono per GPU
3. **🔴 console.log DEV nel percorso caldo** - Troppi log in development build
4. **🟠 MoveNet CPU crop** - Contribuisce ma non sufficiente da solo
5. **🟠 scheduleOnRN/JS congestion** - Da misurare

**⚠️ Metrica YOLO FPS Fuorviante**
La metrica "YOLO 20-21 FPS" calcolata da `telemetry.ts` è una media dei tempi di inferenza, non il throughput istantaneo. Non rappresenta il throughput reale durante il degrado della camera.

### Bottleneck Secondario: MoveNet CPU Crop

Il crop CPU di MoveNet è stato ottimizzato ma rimane un fattore:

**Approccio crop da 640×360 intermedio (attuale):**
| Operazione | Tempo | % totale MoveNet |
|------------|-------|------------------|
| intermediateResizer.resize() | ~5 ms | 4.5% |
| CPU crop/resample | ~5-10 ms | 9-18% |
| MoveNet inference | ~67 ms | 60% |
| Parsing | ~0.3 ms | 0.3% |
| **Totale** | **~110-120 ms** | **100%** |

**Miglioramento implementato:** -40% tempo MoveNet (da ~200ms a ~110ms)

Il crop CPU ottimizzato (`cropAndResizeFloat32`) lavora su buffer 640×360 invece di 1280×720, riducendo drasticamente il lavoro CPU.

### Camera FPS Impact

| Configurazione | Camera FPS | YOLO FPS | MoveNet FPS | Note |
|----------------|------------|----------|-------------|------|
| YOLO + MoveNet | 5-6 FPS (degrado) | 20-21 FPS | ~5 FPS | Bottleneck sistema non identificato |
| YOLO solo | TBD | TBD | N/A | Test richiesto |
| MoveNet disabilitato | TBD | N/A | N/A | Test richiesto |

**Nota:** Il test recente ha mostrato un degrado significativo della camera FPS a 5-6 FPS sotto carico, nonostante YOLO sia stabile a 20-21 FPS. Questo indica un bottleneck nel sistema esterno al worker YOLO.

### Ottimizzazioni Implementate

1. **Reentrancy Guard**: Implementato in `useShotTracker.ts`
   - Previene elaborazioni concorrenti di frame
   - `isProcessingFrame` con `finally` block per dispose() sicuro
   - `droppedBusy` metric per tracciare frame persi

2. **YOLO Scheduler**: Basato su intervallo con 3 protezioni
   - `yoloIntervalMs` calcolato da targetFps
   - Protezioni: `isProcessingFrame`, `yoloWorker.isProcessing`, `yoloScheduledCount`
   - req/exec = 1:1 confermato nei test

3. **YOLO su ogni frame**: `YOLO_FRAME_SKIP` rimosso
   - Scheduling basato su intervallo invece di frame skip
   - YOLO eseguito a ~20-21 FPS (best_384)
   - Trade-off: Maggiore carico CPU ma tracking più preciso

4. **MoveNet condizionale**: Esecuzione solo se player bbox disponibile
   - MoveNet non esegue quando player perso, riducendo spreco risorse
   - MoveNet riprende automaticamente quando player rilevato di nuovo

5. **Crop CPU ottimizzato**: Resize intermedio 640×360 + crop CPU su Float32
   - Riduzione tempo crop da ~92ms a ~5-10ms
   - `usingPlayerCrop = true` quando bbox disponibile

6. **Fix throttling**: Spostamento aggiornamento `lastInferenceAt` all'inizio del dispatch
   - MoveNet FPS reali da 1.4 a ~3 FPS (throttled)
   - Actual ~5 FPS a causa di bottleneck JS thread

## Bug Risolti

### Bug TelemetryOverlay: FPS Range Statico

**Problema**: Il TelemetryOverlay mostrava valori FPS range statici da `modelConfig.fpsMin` e `modelConfig.fpsMax` invece di valori dinamici basati sulle metriche in tempo reale. Inoltre, `usageMinutes` non si aggiornava correttamente.

**Soluzione**: 
1. Sostituito FPS range statico con calcolo dinamico da `yoloPerf.minMs` e `yoloPerf.maxMs`:
   - `minFPS = 1000 / maxMs` (tempo più lento = FPS più basso)
   - `maxFPS = 1000 / minMs` (tempo più veloce = FPS più alto)
2. Aggiunto `modelConfig?.usageMinutes` come dipendenza dell'useEffect per forzare re-render quando il timer aggiorna il valore
3. Aggiunto logging dettagliato di `yoloMinMs`, `yoloMaxMs`, `yoloSamples` per debug

**Risultato**: Il TelemetryOverlay ora mostra il range FPS dinamico calcolato dalle metriche in tempo reale del telemetry logger, e usageMinutes si aggiorna correttamente durante la sessione.



### Bug Reentrancy: Elaborazioni Concorrenti

**Problema:** Due onFrame contemporanei potevano entrare nel processing, causando:
- Dispose() non gestito correttamente
- Race conditions su SharedValues
- Frame persi non tracciati

**Soluzione:** Implementato reentrancy guard in `useShotTracker.ts`:
```typescript
if (isProcessingFrame.value) {
  perfFramesDroppedBusy.value += 1
  frame.dispose()
  return
}

isProcessingFrame.value = true
// ... processing ...
finally {
  isProcessingFrame.value = false
  frame.dispose()
}
```

**Risultato:** Due onFrame contemporanei non possono più entrare nel processing. Il dispose() è gestito in un unico punto nel finally block.

### Bug Scheduler: Doppio Scheduling YOLO

**Problema:** YOLO poteva essere schedulato più volte nello stesso intervallo, causando elaborazioni ridondanti.

**Soluzione:** Implementato scheduler con 3 protezioni:
1. `isProcessingFrame` - previene concorrenza frame
2. `yoloWorker.isProcessing` - previene concorrenza YOLO
3. `yoloScheduledCount` - previene doppio scheduling nello stesso intervallo

**Risultato test:** req/exec = 1:1 confermato (nessun doppio scheduling)

### Bug Tracking: Feedback Loop nel Jump Threshold

Il jump threshold in `usePlayerCropManager.ts` confrontava la nuova detection contro `smoothedX.value` invece di `bboxX.value`, creando un feedback loop che poteva bloccare il tracking durante movimenti rapidi.

**Soluzione**: Confrontare contro l'ultima posizione raw accettata (`bboxX.value`) e aggiungere un contatore di rifiuti consecutivi che forza l'accettazione dopo 3 rifiuti.

### Bug Throttling: Doppio Clock

Due orologi diversi per lo stesso rate-limit causavano esecuzione a ~1.4 FPS reali invece di 3 FPS.

**Soluzione**: Spostare aggiornamento `lastInferenceAt` all'inizio del dispatch per allineare i due orologi.

### Render Warnings: useDerivedValue Chains

Letture `.value` da derived values durante render causavano warning.

**Soluzione**: Inlinare logica per leggere direttamente da SharedValues originali invece di da derived values intermedi.

### Bug Codice: YOLO_FRAME_SKIP Obsoleto

**Problema:** Costante `YOLO_FRAME_SKIP` e commenti associati erano presenti in `useShotTracker.ts` ma non più utilizzati, poiché lo scheduling è ora basato su `yoloIntervalMs`.

**Soluzione:** Rimossa la costante e i commenti obsoleti.

**Codice rimosso:**
```typescript
// // AI throttling
//
// const YOLO_FRAME_SKIP = 1 // Run YOLO on every frame (currentFrame % 1 === 0 always true)
// // PERFORMANCE TEST: disabled frame skip adaptability
// // const YOLO_FRAME_SKIP_STABLE = 3 // Throttle YOLO when ball is stable
```

**Risultato:** Codice più pulito, nessuna confusione sul meccanismo di scheduling attuale.

### Bug ShotTracker UNMOUNT: effectiveResolution Instability

Cambio di `effectiveResolution` quando calibration veniva caricato causava remount di ShotTracker.

**Soluzione**: Usare `useRef` invece di `useMemo` per stabilizzare `effectiveResolution`.

### Pose Parser: Trasformazione Coordinate Errata

Trasformazione `x: 1 - yNorm, y: xNorm` causava deformazione della pose.

**Soluzione**: Usare direttamente `x: xNorm, y: yNorm` (MoveNet output è [y, x, score]).

## Architettura Dettagliata

### Player Tracking

**Hook**: `usePlayerCropManager` (worklet-safe con SharedValues)

**Stato**:
- `bboxX`, `bboxY`, `bboxWidth`, `bboxHeight` - BBox raw da detection
- `smoothedX`, `smoothedY`, `smoothedWidth`, `smoothedHeight` - BBox smoothed (EMA)
- `lastSeenAt`, `detectedAt` - Timestamp tracking
- `hasBbox` - Flag validità BBox

**Funzioni worklet**:
- `update(playerBbox)` - Aggiorna stato tracking con filtro confidence minimo
- `getEffectiveBbox(now)` - Restituisce BBox tracciato o null se scaduto
- `calculateCrop(trackedBbox, frameWidth, frameHeight)` - Calcola regione crop
- `transformKeypointsToFrame()` - Trasforma keypoints da crop a frame space
- `reset()` - Reset stato tracking

**Comportamento**:
- Player rilevato con confidence ≥ 0.005 → BBox aggiornato
- Player perso → BBox persiste per 750ms (PREDICTED)
- BBox scaduto (>750ms) → MoveNet non esegue (LOST)
- Jump threshold 0.15 con safety net (3 rifiuti consecutivi)

### Ball Tracking

**Hook**: `useTrackingEngine`

**Stato**:
- `ballLastSeenAt` - Timestamp ultima detection
- `ballTrackingValid` - Flag validità tracking (TTL 500ms)
- Kalman filter per prediction

**Funzioni**:
- `kalmanPredict()` - Prediction standalone con check TTL
- `predictFrame()` - Prediction durante gap YOLO

**Comportamento**:
- Ball rilevato → `ballTrackState = 'DETECTED'`
- Ball perso → Kalman PREDICT esegue, `ballTrackState = 'PREDICTED'` (fino a 500ms)
- TTL scaduto (>500ms) → Tracking invalidato, `ballTrackState = 'LOST'`

### Rim Tracking

**Hook**: `useShotTracker` (inline nel frame processor)

**Comportamento**:
- Rim rilevato da YOLO con confidence > 0.15 → `rimTrackState = 'DETECTED'`
- **Aggiornamento solo se confidence maggiore**: Il rim viene aggiornato solo se la nuova detection ha confidence superiore alla precedente. Questo mantiene il rim stabile poiché la camera è tipicamente ferma.
- Rim perso ma calibration disponibile → `rimTrackState = 'PREDICTED'`
- Nessuna detection né calibration → `rimTrackState = 'LOST'`

**Logica di stabilità**:
- `lastRimConfidence`: Traccia l'ultima confidence accettata
- `lastRimPosition`: Traccia l'ultima posizione accettata
- Una nuova detection rim viene accettata solo se `detection.rim.confidence > lastRimConfidence.value`
- Questo previene fluttuazioni del canestro quando la camera è stabile

### MoveNet Pipeline

**Hook**: `useMoveNetWorker`

**Preprocessing attuale (ottimizzato)**:
```
Camera Frame 1280×720
    ↓
Player BBox (normalizzato)
    ↓
Padding 15% + Clamp
    ↓
makeSquareCrop() (geometria)
    ↓
intermediateResizer.resize(frame) → 640×360 Float32 (16:9 aspect ratio)
    ↓
cropAndResizeFloat32() → 192×192 Float32 (CPU crop ottimizzato)
    ↓
Conversione dataType (uint8/int8/float32)
    ↓
MoveNet inference (async su JS thread)
    ↓
Pose parser
    ↓
Keypoints trasformati (crop → frame space)
```

**Fase 1 (implementata)**: Preparazione del codice per crop nativo
- Aggiunto `makeSquareCrop()` (geometria)
- Aggiunto flag `usingPlayerCrop` (inizialmente false)

**Fase 2 (implementata)**: Crop CPU ottimizzato
- Resize GPU intermedio a 640×360
- Funzione `cropAndResizeFloat32()` per crop CPU su Float32
- `usingPlayerCrop = true` quando bbox disponibile
- Riduzione tempo crop da ~92ms a ~5-10ms

**Nota**: react-native-vision-camera-resizer V5 NON supporta crop arbitrario nativo (GitHub issue #3746). La soluzione ottimizzata usa resize intermedio + crop CPU su buffer ridotto.

## Adaptive Performance Management

### Sistema di Gestione Adattiva (Completamente Disabilitato)

**Hook**: `useAdaptivePerformance` (worklet-safe con SharedValues)

**Obiettivo**: Gestire automaticamente le performance del modello YOLO durante le sessioni di workout per prevenire il degrado delle FPS.

**Problema risolto**: Il vecchio sistema basato su `isReady` causava un degrado progressivo delle FPS (da 16 FPS a 8 FPS) indipendentemente dallo stato di MoveNet.

**Stato implementazione:**
- ❌ Sistema adaptive performance esistente ma TEMPORARILY DISABLED in `useShotTracker.ts`
- ❌ Collegamento adaptive model al worker YOLO disabilitato
- ❌ Adaptive FPS NON collegato alla camera (limitazione API VisionCamera V5)

**Approccio attuale**:
- YOLO viene eseguito su ogni frame (senza throttling basato su `isReady`)
- Sistema adattivo monitora le performance YOLO e scala il modello dinamicamente (DISABILITATO)
- Modello YOLO scalato automaticamente: 640 → 512 → 320 (se performance scarse) - DISABILITATO
- Sistema completamente bidirezionale: scala down quando performance scarse, scala up quando performance buone - DISABILITATO

**YOLO_MODEL_TIERS in useAdaptivePerformance.ts**:
```typescript
const YOLO_MODEL_TIERS: YoloModelConfig[] = [
  YOLO_MODELS.find(m => m.id === 'best_640_float16')!,
  YOLO_MODELS.find(m => m.id === 'best_512_float16')!,
  YOLO_MODELS.find(m => m.id === 'best_320_float16')!, // MANCA 448 e 384
].filter(Boolean)
```

**Nota:** La ladder in useAdaptivePerformance non include best_448_float16 e best_384_float16, mentre yoloModels.ts ha la lista completa.

**Architettura**:
```
YOLO Execution (ogni frame)
    ↓
recordYoloPerformance(fps, success, inferenceTime)
    ↓
Performance Metrics (window 3s)
    ↓
evaluateAndAdapt (ogni 100 frame)
    ↓
Se performance scarse:
    scaleDownModel() → 640→512→320
Se performance buone:
    scaleUpModel() → 320→512→640
```

**Thresholds (percentuali rispetto al target FPS corrente)**:
- `SCALE_DOWN_THRESHOLD`: 80% (scala giù se FPS < 80% del target)
- `SCALE_UP_THRESHOLD`: 95% (scala su se FPS >= 95% del target)
- `TARGET_YOLO_SUCCESS_RATE`: 60% (minimo tasso di successo)
- `ADAPTATION_WINDOW_MS`: 3000ms (finestra di valutazione)
- `MIN_ADAPTATION_INTERVAL_MS`: 5000ms (minimo tempo tra adattamenti)

**Logica adattamento**:
- Il sistema calcola il ratio `yoloFps / currentFps` (target FPS corrente)
- Se ratio < 80% → scala giù (prima FPS, poi modello se FPS già al minimo)
- Se ratio >= 95% → scala su (prima modello, poi FPS se modello già al massimo)
- Esempio con target FPS = 30:
  - Scala giù se YOLO FPS < 24 (30 * 0.8)
  - Scala su se YOLO FPS >= 28.5 (30 * 0.95)

**Shared Values**:
- `currentModelIndex`: Indice del modello YOLO corrente
- `perfWindowStart`, `perfYoloFpsSum`, `perfYoloFpsCount`: Metriche performance
- `perfFramesProcessed`, `perfFramesFailed`, `perfInferenceTimeSum`: Statistiche esecuzione

**Limitazione Adaptive FPS:**
VisionCamera V5 non supporta FPS dinamico tramite `useFrameOutput`. Il FPS è configurato a livello di `Camera` session, non del frame output. Per implementare FPS dinamico sarebbe necessario ricreare l'intera sessione camera quando FPS cambia, che è un cambiamento architetturale significativo.

**Warning: Adaptive Performance Incoerenza**
Il sistema adaptive performance prova prima a scalare l'FPS (30→24→20→15) prima di scalare il modello. Poiché l'FPS non è collegato alla camera, lo stato interno cambia ma l'hardware continua a 30 FPS. Solo quando arriva al minimo FPS, il sistema scala il modello. Questo crea un'incoerenza tra stato interno e carico reale.

**ATTUALMENTE DISABILITATO**: Questo problema non è più presente poiché adaptive performance è completamente disabilitato.

**Warning: YOLO Actual FPS vs Requested FPS**
YOLO viene richiesto su ogni frame (30 FPS), ma l'actual FPS dipende dal tempo di inferenza. Con `isProcessing` che previene esecuzione concorrente, se YOLO impiega ~70ms, l'actual FPS sarà ~14 FPS, non 30 FPS. Molte richieste vengono ignorate perché `isProcessing=true`. La documentazione dovrebbe distinguere tra YOLO invocation (every frame) e YOLO actual inference FPS (measured).

**Note importanti**:
- Il sistema usa solo SharedValues per comunicazione worklet-JS (no `scheduleOnRN` nei worklet)
- L'adattamento del modello è completamente automatico e trasparente per l'utente (QUANDO ATTIVO)
- Il sistema garantisce che YOLO venga sempre eseguito su ogni frame
- Il modello viene scalato automaticamente in base alle performance YOLO (QUANDO ATTIVO)
- **ATTUALMENTE DISABILITATO**: Tutti i riferimenti a adaptive performance sono commentati in useShotTracker.ts

## Future Improvements

### 1. Native Crop+Resize per MoveNet (Non Applicabile)

**Stato**: Crop CPU ottimizzato implementato come soluzione pragmatica.

**Analisi**: react-native-vision-camera-resizer V5 NON supporta crop arbitrario nativo (GitHub issue #3746 confermato dal team). `vision-camera-cropper` esiste ma restituisce base64/path, non buffer GPU worklet-safe.

**Soluzione implementata**: Resize GPU intermedio 640×360 + crop CPU su Float32
- Riduzione tempo crop da ~92ms a ~5-10ms
- `usingPlayerCrop = true` quando bbox disponibile
- MoveNet riceve crop player reale

**Opzioni future** (richiedono redesign architetturale):
- Implementare compute shader personalizzato per crop nativo
- Valutare alternative ML framework con crop nativo supportato

### 2. GPU Capability Test per YOLO Resolutions

**Stato**: Implementato ma limitato - verifica solo registry assets, non inferenza reale.

**Problema**: Alcuni modelli YOLO non funzionano su alcuni dispositivi (es. Galaxy S21 Ultra), mentre 320, 384, 448, 512 e 640 funzionano correttamente. La compatibilità GPU dipende dal modello TFLite + operatori + delegate + GPU/driver, non semplicemente dalla risoluzione.

**Soluzione implementata**: `useGpuCapabilityTest.ts` - Hook che verifica che i modelli siano registrati nel registry e abbiano asset validi.

**Modelli rimossi dal registry:**
- best_416_float16 (risoluzione incompatibile)
- best_480_float16 (risoluzione incompatibile)

**Modelli confermati funzionanti:**
- best_320_float16
- best_384_float16
- best_448_float16
- best_512_float16
- best_640_float16

**Limitazione**: Poiché `useTensorflowModel` è un hook React, non può essere chiamato dentro una funzione async per testare l'inferenza. Il test attuale verifica solo:
- Modello presente nel registry
- Asset reference valido

**Approccio alternativo per test reale**:
Per testare realmente l'inferenza GPU, aggiungere una modalità di test nel worker YOLO che:
1. Cicla attraverso le risoluzioni (320, 384, 448, 512, 640)
2. Per ogni risoluzione:
   - Carica il modello
   - Esegue inferenza su frame reali
   - Logga: MODEL STATE, INPUT DEBUG, BEFORE runSync, AFTER runSync
   - Registra: success/failure, tempo inferenza, errori
3. Genera tabella finale delle risoluzioni supportate

**Log attuali già presenti in useYoloWorker.ts**:
- `[YoloWorker] MODEL STATE` - mostra stato caricamento (loaded/error)
- `[YoloWorker] INPUT DEBUG` - mostra dimensioni input
- `[YoloWorker] BEFORE runSync` / `[YoloWorker] AFTER runSync` - mostra esecuzione inferenza

**Problema Model Switching Dinamico**:
Il test ha rivelato che il problema non è la risoluzione 416 in sé, ma il cambio dinamico del modello TFLite durante il lifecycle del worker/component. Quando AdaptivePerf cambia modello:
1. Componenti vengono smontati
2. Componenti vengono rimontati
3. AdaptivePerf sceglie nuovo modello
4. useTensorflowModel() deve reinizializzare interpreter + GPU delegate
5. Questo processo può fallire su alcune combinazioni dispositivo/modello

**Dispositivo testato**: Samsung Galaxy S21 Ultra 5G (SM-G998B)
- SoC: Exynos 2100 (5nm)
- GPU: ARM Mali-G78 MP14 (version 3.2)
- RAM: 12 GB LPDDR5
- Android: 15 (API 35)

**Nota**: La GPU Mali-G78 può avere compatibilità diversa rispetto ad Adreno (Snapdragon 888), il che spiega perché alcune risoluzioni potrebbero non funzionare su questo dispositivo specifico.

**Soluzione temporanea**: Model switching disabilitato in `useAdaptivePerformance.ts` (solo FPS scaling attivo) per isolare il problema.

**Prossimi passi:**
1. Testare l'app con model switching disabilitato per confermare stabilità
2. Se stabile, implementare test manuale delle risoluzioni cambiando il modello in `yoloModels.ts` e controllando i log
3. Identificare la massima risoluzione stabile supportata dal dispositivo

### 3. Riduzione Frequenza MoveNet

**Alternativa**: Ridurre da 3 FPS a 1-2 FPS se performance ancora insufficienti.

**Trade-off**: Pose meno fluida ma miglioramento camera FPS.

### 3. Modello YOLO Migliorato per Player Detection

**Problema attuale**: Il modello `best_512_float16.tflite` produce confidence player basse (0.05-0.12).

**Soluzioni**:
1. Riaddestrare il modello con più dati umani
2. Utilizzare un modello separato per person detection (es. COCO)
3. Valutare un modello YOLO diverso addestrato specificamente per persone

### 4. Adaptive FPS Camera (Richiede Redesign)

**Limitazione**: VisionCamera V5 non supporta FPS dinamico tramite `useFrameOutput`.

**Soluzione richiesta**: Ricreare l'intera sessione camera quando FPS cambia.

**Impatto**: Cambiamento architetturale significativo che richiede valutazione costi/benefici.

## Debug e Telemetria

### Overlay Debug

**WorkoutSessionScreen** mostra:
- Debug box con confidence e rejection reason per ball, hoop, player
- Colori dinamici: verde (valido), rosso (scartato)
- Overlay labels con confidence percentuale
- Skia drawing con coordinate real-time
- **Stati visuali**: Etichette con emoji e stato (DETECTED/PREDICTED/LOST)
- **Age tracking**: Mostra tempo in ms quando in stato PREDICTED

### TelemetryOverlay

**Componente**: `TelemetryOverlay.tsx`

**Funzionalità**:
- Visualizzazione metriche performance in tempo reale
- Due modalità: DEBUG (dettagliata) e NORMAL (semplificata)
- Aggiornamento ogni 500ms tramite interval

**Metriche visualizzate (YOLO)**:
- **FPS**: FPS attuale calcolato da telemetry logger
- **FPS Range**: Range dinamico calcolato da minMs/maxMs
  - `minFPS = 1000 / maxMs` (tempo più lento = FPS più basso)
  - `maxFPS = 1000 / minMs` (tempo più veloce = FPS più alto)
  - Sostituisce i valori statici da modelConfig con valori in tempo reale
- **Req/Exec**: Ratio richieste/esecuzioni YOLO
- **Avg**: Tempo medio inferenza in ms
- **Min/Max**: Tempo minimo/massimo inferenza in ms
- **Resize**: Tempo resize in ms
- **Run**: Tempo esecuzione modello in ms
- **Parse**: Tempo parsing in ms

**Metriche visualizzate (Pipeline)**:
- Detection rate (ball/player)
- Pipeline processed
- Usage minutes (durata sessione)

**Logging migliorato**:
- Log dettagliato di `yoloMinMs`, `yoloMaxMs`, `yoloSamples` per debug
- Log di `usageMinutes` per verificare aggiornamento timer
- Dipendenza `modelConfig?.usageMinutes` nell'useEffect per forzare re-render

### Telemetria

**SharedValues worklet-safe**:
- `telemetryInferenceTime`, `telemetryCropMs`, `telemetryResizeMs`
- `telemetryRunMs`, `telemetryParseMs`, `telemetryKeypointsConfidence`
- `telemetryHasNewData` (flag per triggerare lettura)

**Contatori tracking**:
- Player: `playerDetected`, `playerLost`, `playerUsingLastBbox`, `playerBboxExpired`
- Ball: `ballDetected`, `ballPrediction`, `ballTrackingExpired`

**TelemetryLogger** (`telemetry.ts`):
- `getYoloPerfMetrics()`: Restituisce fps, avgMs, minMs, maxMs, samples, requested, executed, resizeMs, runMs, parseMs
- `getBallDetectionMetrics()`: Detection rate, confidence metrics
- `getPlayerDetectionMetrics()`: Detection rate, bbox stability
- `getMoveNetMetrics()`: Pose metrics, keypoint stability
- `getPipelineMetrics()`: Camera FPS, received/processed/dropped frames
- `getBboxStabilityMetrics()`: Jump metrics, stability percentage
- `getFalsePositiveMetrics()`: FP rate, reasons map

## Conclusioni

La pipeline di vision attuale è funzionalmente completa con:
- ✅ Separazione chiara detection/tracking
- ✅ Reentrancy guard per prevenire elaborazioni concorrenti
- ✅ YOLO scheduler con 3 protezioni (req/exec=1:1 confermato)
- ✅ TTL temporale per player (750ms) e ball (500ms)
- ✅ Kalman prediction durante gap YOLO
- ✅ Configurazione centralizzata
- ✅ Telemetria completa con TelemetryLogger dettagliato
- ✅ Debug overlay dettagliato
- ✅ Stati visuali espliciti per debug sul campo
- ✅ YOLO schedulato basato su intervallo (YOLO_FRAME_SKIP rimosso)
- ✅ MoveNet eseguito solo quando player bbox disponibile
- ✅ Crop CPU ottimizzato per MoveNet (640×360 → 192×192)
- ✅ Risoluzione allineata a 1280×720
- ✅ Modelli YOLO aggiornati (416 e 480 rimossi)
- ✅ TelemetryOverlay con FPS range dinamico calcolato in tempo reale
- ✅ TelemetryOverlay con usage minutes aggiornato correttamente
- ✅ Logging migliorato per debug FPS range e usage minutes

**Stato completamento architettura:** ~87%

**Problema attuale:** Camera FPS degradation
- Test recente ha mostrato camera FPS degradata a 5-6 FPS sotto carico
- ⚠️ Metrica YOLO 20-21 FPS è fuorviante (media, non throughput istantaneo)
- 🔴 Causa principale: runSync() bloccante dentro onFrame (48ms in budget di 33ms)
- 🔴 Sospetto forte: YOLO GPU + MoveNet GPU contention
- 🔴 Problema: troppi console.log DEV nel percorso caldo
- Prossimi passi: eseguire piano di test A-E per isolare la causa

Il collo di bottiglia principale (crop CPU ~92ms) è stato ottimizzato a ~5-10ms tramite resize intermedio 640×360. MoveNet ora riceve il crop player reale invece del full-frame, migliorando significativamente la qualità della pose detection.

**Rimanenti:**
- Eseguire piano di test A-E per isolare causa camera FPS degradation (priorità alta)
- Implementare telemetria throughput reale per finestra di 1 secondo (vedi proposta sotto)
- Rimuovere/ridurre console.log DEV nel percorso caldo per benchmark seri
- Valutare architettura alternativa per runSync() (es. spostare fuori onFrame)
- Test effettivo pose detection con crop reale (richiede esecuzione app)
- Valutazione se riabilitare adaptive performance dopo debugging
- Correggere YOLO_MODEL_TIERS in useAdaptivePerformance per includere 448 e 384
- Verificare aggiornamento FPS range dinamico in TelemetryOverlay durante esecuzione app

### Proposta: Telemetria Throughput Reale

**Problema attuale:**
La metrica YOLO FPS attuale (`1000 / avgInferenceTime`) non rappresenta il throughput istantaneo.

**Soluzione proposta:**
Registrare throughput reale per finestra di 1 secondo, allineato temporalmente con cameraFPS:
```
sec 1: camera 30 / YOLO 20 / MoveNet 3
sec 2: camera 27 / YOLO 19 / MoveNet 3
sec 3: camera 18 / YOLO 13 / MoveNet 3
sec 4: camera 7  / YOLO 6  / MoveNet 2
```
Solo così potremo diagnosticare il degrado senza ambiguità.

**Implementazione:**
- Contare esecuzioni YOLO effettive per finestra di 1 secondo
- Contare esecuzioni MoveNet effettive per finestra di 1 secondi
- Allineare temporalmente con cameraFPS (già calcolato per finestra di 1 secondo)
- Mostrare in TelemetryOverlay come "Throughput (last 1s)"
