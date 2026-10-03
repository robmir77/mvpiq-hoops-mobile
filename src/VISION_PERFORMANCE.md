# MVPIQ Hoops - Vision Performance Analysis

## Performance Targets

| Componente | Target FPS | Attuale FPS | Note |
|------------|-----------|-------------|------|
| Camera | 30 FPS | 30 FPS | Configurazione hardware |
| YOLO | 20 FPS | 20-21 FPS | Scheduler con 3 protezioni |
| Tracking | Realtime | Realtime | Ogni frame |
| MoveNet | 3 FPS | 5 FPS | Bottleneck JS thread |
| UI Telemetry | 1 FPS | 1 FPS | TelemetryOverlay |
| Backend Telemetry | 2 FPS | 2 FPS | Sampling |
| Bridge Calls | 15 FPS | 15 FPS | Throttling 66ms |

## Bottleneck Analysis

### Primary Bottleneck: JS Thread per MoveNet

**Sintomo:** MoveNet throttled a 3 FPS ma actual ~5 FPS

**Causa:**
- Crop CPU (640x360 → 192x192) su JS thread
- Resize e dispose operazioni asincrone
- Bridge overhead per coordinate crop

**Mitigazione:**
- Crop geometrico (coordinate) nel worklet
- Resize CPU ottimizzato con dimensione intermedia
- Throttling a 3 FPS per limitare carico

### Secondary Bottleneck: YOLO + MoveNet Sequenziali

**Sintomo:** YOLO e MoveNet eseguiti sequenzialmente nel frame processor

**Causa:**
- Entrambi i modelli eseguiti nello stesso worklet
- react-native-fast-tflite usa runSync() nel worklet
- Nessuna parallelizzazione a livello thread

**Mitigazione (Futuro):**
- Separare pipeline YOLO e MoveNet
- YOLO produce latestPlayerBbox via SharedValue
- MoveNet legge playerBbox via SharedValue
- Possibile parallelizzazione con thread separati

### Tertiary Bottleneck: Bridge Calls

**Sintomo:** scheduleOnRN chiamato troppo frequentemente

**Causa:**
- Ogni detection attraversa il bridge
- Serializzazione overhead
- JS thread congestion

**Mitigazione:**
- Throttling da 16ms a 66ms (15 FPS)
- SharedValues per rendering UI (60 FPS)
- Solo dati critici attraversano il bridge

## Performance Metrics

### YOLO Scheduler Metrics

**Metriche attuali:**
- req/exec ratio: 1:1 (ottimale)
- timeSinceLast: varia correttamente
- yoloIntervalMs: adattivo in base a target FPS
- yoloScheduledCount: previene doppio scheduling

**Protezioni attive:**
1. `isProcessingFrame` - reentrancy guard
2. `yoloWorker.isProcessing` - YOLO concurrency guard
3. `yoloScheduledCount` - interval scheduling guard

### MoveNet Scheduler Metrics

**Metriche attuali:**
- Target: 3 FPS (ogni 333ms)
- Actual: ~5 FPS (bottleneck JS thread)
- Throttling: time-based
- Condizione: player bbox disponibile + confidence >= 5%

### Tracking Performance

**Ball Tracking:**
- TTL: 500 ms
- Fallback: Kalman prediction durante gap YOLO
- Stati: DETECTED, PREDICTED, LOST
- Performance: Realtime (ogni frame)

**Player Tracking:**
- TTL: 750 ms
- Fallback: Last bbox durante gap YOLO
- Jump threshold: 0.15 con safety net
- Smoothing: EMA (factor 0.3)
- Performance: Realtime (ogni frame)

**Rim Tracking:**
- TTL: 500 ms
- Fallback: Calibration point
- Update rule: Best-confidence locking
- Confidence threshold: 10%
- Performance: Realtime (ogni frame)

## Memory Management

### Ring Buffers

**detectionHistory:**
- Dimensione: 60 elementi
- Implementazione: Ring buffer con index ciclico
- Allocation: Zero allocation durante runtime
- Memory footprint: Costante

**trajectoryBuffer:**
- Dimensione: 90 elementi
- Implementazione: Ring buffer
- Allocation: Zero allocation durante runtime
- Memory footprint: Costante

### Telemetry Counters

**Prima:**
```typescript
private ballDetectionFrames: Set<number> = new Set()
private playerDetectionFrames: Set<number> = new Set()
private yoloProcessedFrames: Set<number> = new Set()
```
- Cresce all'infinito (72.000 frame in 60 minuti)
- Memory footprint: O(n)

**Dopo:**
```typescript
private yoloProcessedFramesCount = 0
private ballDetectionFramesCount = 0
private playerDetectionFramesCount = 0
```
- Memory footprint: O(1)
- Performance: O(1) per update

## Hot Path Optimization

### Log Elimination

**Log rimossi dal hot path:**
- `[MoveNet Throttle] Skip...`
- `[YOLO SCHEDULER] Executing YOLO...`
- `[BBOX FILTER] ...`
- `[ShotTracker] Rejected rim detection...`
- `[ShotTracker] Shot started`

**Sostituzione con flag compile/config:**
```typescript
const HOT_PATH_LOGS = false  // Disabilitato di default
const ENABLE_PLAYER_CROP_LOGS = false
const ENABLE_ADAPTIVE_PERFORMANCE_LOGS = false
const ENABLE_MOVENET_LOGS = false
```

**Beneficio:**
- Elimina overhead di serializzazione
- Elimina allocation di stringhe
- Zero log overhead in produzione

### Object Allocation Reduction

**detectionHistory:**
- Prima: push/filter crea nuovi array
- Dopo: Ring buffer con index ciclico
- Allocation: Zero durante runtime

**Telemetry:**
- Prima: Set cresce all'infinito
- Dopo: Contatori atomici
- Allocation: Zero durante runtime

## Network Performance

### Backend Telemetry

**Prima:**
- 20 FPS = 20 richieste/sec
- Ogni frame singolo
- Carico HTTP eccessivo

**Dopo:**
- 2 Hz sampling = 2 richieste batch/sec
- Batch di 20 frame per richiesta
- Riduzione carico HTTP: 90%

### Critical Events

**Prima:**
- Shot events inviati singolarmente
- Nessun retry su fallimento
- Possibile perdita dati
- MAX_OUTBOX_SIZE = 100 (overflow)

**Dopo:**
- Critical queue con PersistentOutbox
- Retry con backoff esponenziale
- Garanzia di consegna
- Unbounded queue (nessun overflow)
- Global recovery da tutte le sessioni
- Retry count persistente
- Shutdown sicuro con preservazione eventi pendenti

**API Reali:**
- SHOT: `addShotEvent()`
- SESSION_END: `endWorkoutSession()`
- CALIBRATION: `saveCourtCalibration()`
- SESSION_START: confermato (creazione sessione)

### Recovery Performance

**Global Recovery:**
- `loadAllPending()` carica item da tutte le sessioni precedenti
- Merge ordinato per timestamp
- Recovery automatico all'avvio app

**Retry Strategy:**
- Max 5 retry con backoff esponenziale (1s, 2s, 4s, 8s, 16s)
- Retry count persistito su ogni tentativo
- Eventi rimangono in outbox dopo esaurimento retry
- Retry continuo in batch successivi

**Shutdown Safety:**
- Se tutti eventi consegnati: `clearSession()` (memoria + storage)
- Se eventi pendenti: `clear()` (solo memoria, storage per recovery)
- Log warning se shutdown con eventi pendenti

## Degradation Analysis

### Sintomo: Performance degrada dopo 5-10-20 minuti

**Possibili cause:**
1. **Memory leak in telemetry Set** - Risolto con contatori
2. **Backlog frame batch** - Risolto con queue async
3. **Bridge congestion** - Risolto con throttling
4. **Log overhead** - Risolto con flag config
5. **Race condition in loadPending()** - Risolto con inizializzazione async
6. **Data loss su crash** - Risolto con global recovery
7. **Retry state perso** - Risolto con retry count persistente
8. **Shutdown perde dati** - Risolto con shutdown sicuro

### Mitigazioni implementate:

1. **Queue async bounded**
   - Telemetry queue: max 100 elementi (drop oldest)
   - Critical queue: unbounded (mai rifiuta)
   - Worker asincrono per HTTP

2. **Sampling 2 Hz**
   - Solo 1 frame su 10 inviato al backend
   - Batch di 20 frame per richiesta

3. **Throttling bridge**
   - Da 16ms a 66ms (15 FPS)
   - SharedValues per rendering a 60 FPS

4. **Memory management**
   - Ring buffers per detection/trajectory
   - Contatori invece di Set
   - Zero allocation nel hot path

5. **Reliability improvements**
   - Inizializzazione async con global recovery
   - Retry count persistente
   - Shutdown sicuro
   - API reali per SESSION_END/CALIBRATION
   - Eventi rimangono in outbox dopo retry exhaustion

6. **Test coverage**
   - PersistentOutbox: 15+ test cases
   - WorkoutAsyncQueue: 15+ test cases
   - TelemetrySampler: 15+ test cases

## Future Optimizations

### Separazione Pipeline YOLO/MoveNet

**Architettura target:**
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

**Benefici:**
- Parallelizzazione YOLO e MoveNet
- YOLO può girare a target FPS senza bloccare MoveNet
- MoveNet può girare a 3 FPS indipendentemente

### Adaptive Performance

**Stato:** Disabilitato per debugging

**Funzionalità:**
- Scala YOLO FPS in base a performance
- Scala dimensione modello (640 → 512 → 320)
- Scala camera FPS (30 → 24 → 20 → 15)

**Attivazione futura:**
- Dopo stabilizzazione pipeline
- Con metriche reliable
- Con testing approfondito

## Performance Monitoring

### Metrics attuali

**Vision pipeline:**
- YOLO FPS
- YOLO inference time (min/max/avg)
- MoveNet FPS
- MoveNet inference time
- Frame drops (busy, processing)

**Tracking:**
- Ball state (DETECTED/PREDICTED/LOST)
- Player state (DETECTED/PREDICTED/LOST)
- Rim state (DETECTED/PREDICTED/LOST)
- Trajectory length

**Telemetry:**
- Frames processed
- Frames with ball
- Frames with player
- YOLO processed frames

**Async Queue:**
- Telemetry queue size
- Telemetry dropped count
- Critical queue size
- Critical overflow count
- Pending items from previous sessions
- Retry counts per event

### Logging

**Hot path:**
- Disabilitato di default
- Abilitabile per componente
- Rate-limited per diagnostici

**Diagnostics:**
- 1 Hz performance metrics
- Session summary
- Error tracking
- Queue metrics
- Recovery events
- Retry events
- Shutdown warnings

## Conclusioni

La pipeline vision è ottimizzata per:
- **Realtime:** 20+ FPS per YOLO, realtime per tracking
- **Efficienza:** Zero allocation nel hot path, ring buffers
- **Scalabilità:** Queue async, sampling, throttling
- **Affidabilità:** PersistentOutbox per eventi critici, retry
- **Durabilità:** Global recovery, retry persistente, shutdown sicuro
- **Testability:** Suite test completa per queue/outbox/sampler

Le ottimizzazioni implementate risolvono i problemi di degradazione a lungo termine:
- Memory leak risolto (contatori invece di Set)
- Backlog risolto (queue async bounded)
- Bridge congestion risolto (throttling 66ms)
- Log overhead risolto (flag config)
- Race condition risolta (inizializzazione async)
- Data loss risolto (global recovery)
- Retry state perso risolto (retry count persistente)
- Shutdown perde dati risolto (shutdown sicuro)
- API fake risolto (SESSION_END/CALIBRATION reali)

Le ottimizzazioni future (separazione pipeline YOLO/MoveNet) richiedono:
- Stabilizzazione pipeline attuale
- Testing approfondito
- Valutazione costi/benefici

Le ottimizzazioni architetturali future (WorkoutSessionRuntime, state machine) richiedono:
- Decoupling screen da runtime
- Implementazione macchina stati
- Separazione responsabilità
