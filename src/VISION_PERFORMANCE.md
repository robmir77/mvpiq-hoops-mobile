# MVPIQ Hoops - Vision Performance Analysis

## Performance Targets

| Componente | Target FPS | Attuale FPS | Note |
|------------|-----------|-------------|------|
| Camera | 30 FPS | 27-30 FPS | Default 30 FPS, raggiunge target |
| YOLO | 10 FPS | 4-5 FPS | FPS naturale basato su tempo inferenza async |
| Tracking | Realtime | Realtime | Ogni frame con Kalman prediction |
| MoveNet | 3 FPS | 3-4 FPS | FPS naturale basato su tempo inferenza async |
| UI Telemetry | 1 FPS | 1 FPS | TelemetryOverlay aggiornato ogni 500ms |
| Backend Telemetry | 2 FPS | 2 FPS | Sampling |
| Bridge Calls | 15 FPS | 15 FPS | Throttling 66ms |

## Model Configurations

### YOLO Models

| Model ID | Input Size | Precision | Epochs | Expected FPS | Actual FPS | Note |
|----------|------------|-----------|--------|--------------|------------|------|
| best_320_float16 | 320x320 | FP16 | 50 | 10-37 | 2-7 | Measured at 640x360 resolution |
| best_384_float16 | 384x384 | FP16 | 100 | 20-21 | 3-6 | Updated to 100 epochs, actual FPS lower due to device bottleneck |
| best_448_float16 | 448x448 | FP16 | 5 | 12-21 | TBD | Early training |
| best_512_float16 | 512x512 | FP16 | 40 | 8-10 | TBD | Balanced performance |
| best_640_float16 | 640x640 | FP16 | 30 | 5-7 | TBD | High resolution |

**Nota importante:** Il sistema usa FPS naturale (no throttling temporale). Camera FPS è indipendente da YOLO/MoveNet FPS. Questa architettura evita regressioni causate da accoppiamenti inappropriati.

**Scheduler Architecture (Async):**
- YOLO esegue async tramite scheduleOnRN (FPS naturale ~4-5)
- MoveNet esegue async tramite scheduleOnRN (FPS naturale ~3-4)
- useShotTracker chiama processFrame() ogni frame per entrambi i worker
- Ogni worker decide internamente se eseguire in base a `isProcessing` flag
- Nessuno scheduler duplicato in useShotTracker
- FPS metrics sincronizzati da shared values a state per evitare warning Reanimated
- **Misurazione schedule wait:** Entrambi i worker misurano il tempo di attesa del runtime RN (scheduleWaitMs)

## Bottleneck Analysis

### Primary Bottleneck: RN Runtime Scheduling Contention

**Sintomo:** Schedule wait time variabile 45-134 ms per MoveNet, alto throughput gap

**Causa:**
- YOLO e MoveNet eseguono async sullo stesso runtime RN/JS
- scheduleOnRN() entra in una coda e attende disponibilità runtime
- Contesa tra YOLO runSync() (~30-40ms) e MoveNet inference (~80-130ms)
- Il callback async non parte immediatamente dopo scheduleOnRN()

**Breakdown tipico MoveNet:**
- Worklet prep: ~5 ms (crop geometry + resize + buffer extraction)
- Schedule wait: 45-134 ms (attesa runtime RN)
- CPU crop: ~15 ms (su JS thread)
- Resize: ~4 ms
- MoveNet run: 80-130 ms
- Parse: ~0.4 ms
- Total: ~200-230 ms

**Breakdown tipico YOLO:**
- Schedule wait: variabile (attesa runtime RN)
- Resize: ~5 ms
- Run: 30-40 ms
- Parse: ~3 ms
- Total: ~40-50 ms

**Mitigazione (Attuale):**
- YOLO convertito ad async con scheduleOnRN
- MoveNet convertito ad async con scheduleOnRN
- Misurazione scheduleWaitMs per entrambi i worker
- Worklet prep separato da schedule wait per MoveNet
- CPU crop spostato fuori dal worklet (non più collo di bottiglia)

**Mitigazione (Futuro):**
- Ridurre contesa RN eliminando trasferimento buffer 640×360×3 (~2.64 MB)
- Investigare crop/resize native prima di scheduleOnRN
- Considerare worker thread separati per YOLO/MoveNet
- Ottimizzare delegate/runtime del modello MoveNet

### Secondary Bottleneck: MoveNet Inference Latency

**Sintomo:** MoveNet run time 80-130 ms (variabile)

**Causa:**
- Modello movenet_lightning_192_int8
- Delegate runtime overhead
- Variabilità dovuta a contesa runtime RN

**Mitigazione (Attuale):**
- Misurazione separata di runMs vs scheduleWaitMs
- Crop CPU ridotto a ~15 ms (accettabile)
- Resize intermedio 640×360 ottimizzato

**Mitigazione (Futuro):**
- Ottimizzare delegate (GPU/NPU se disponibile)
- Considerare modello più leggero
- Ridurre input size se accettabile per accuracy

### Tertiary Bottleneck: Frame Processor (Risolto)

**Sintomo:** Frame latency 17-32 ms (risolto da 75-100 ms)

**Causa (Precedente):**
- CPU crop nel worklet bloccava per ~50 ms
- runSync() sincrono nel worklet

**Mitigazione (Implementata):**
- CPU crop spostato su JS thread async
- scheduleOnRN per inference async
- Camera ora 27-30 FPS (target raggiunto)
- Frame processor non più collo di bottiglia

### Quaternary Bottleneck: Bridge Calls

**Sintomo:** scheduleOnRN chiamato troppo frequentemente

**Causa:**
- Ogni detection attraversa il bridge
- Serializzazione overhead
- JS thread congestion

**Mitigazione:**
- Throttling da 16ms a 66ms (15 FPS)
- SharedValues per rendering UI (60 FPS)
- Solo dati critici attraversano il bridge
- YOLO telemetry throttled a 15 FPS (66ms)

### Quinary Bottleneck: Transfer Buffer Size

**Sintomo:** Trasferimento buffer 640×360×3 (~2.64 MB) per MoveNet

**Causa:**
- Resize intermedio 640×360 prima di crop CPU
- getPixelBuffer() + Float32Array conversion
- scheduleOnRN trasferisce buffer intero

**Mitigazione (Attuale):**
- Resize intermedio riduce lavoro crop CPU
- Buffer riutilizzato quando possibile

**Mitigazione (Futuro):**
- Eliminare buffer intermedio se possibile
- Crop/resize native prima di scheduleOnRN
- Passare solo crop 192×192 al runtime RN

## Performance Metrics

### YOLO Scheduler Metrics

**Metriche attuali:**
- FPS naturale: ~4-5 (basato su tempo inferenza async ~40-50ms)
- Esecuzione async tramite scheduleOnRN
- Esegue ogni frame se `!isProcessing`
- Indipendente dal FPS della camera
- useShotTracker chiama processFrame() ogni frame, il worker decide se eseguire
- **scheduleWaitMs:** Tempo di attesa runtime RN (misurato)

**Protezioni attive (in useYoloWorker):**
1. `isProcessing` - previene concorrenza YOLO
2. `enabled` - flag di abilitazione

### MoveNet Scheduler Metrics

**Metriche attuali:**
- FPS naturale: ~3-4 (basato su tempo inferenza async ~200-230ms total)
- Esecuzione async tramite scheduleOnRN
- Esegue ogni frame se `!isProcessing` e bbox player valido
- Indipendente dal FPS della camera
- Condizione: player bbox disponibile + confidence >= 5%
- useShotTracker chiama processFrame() ogni frame, il worker decide se eseguire
- **workletPrepMs:** Tempo preparazione worklet (crop geometry + resize + buffer)
- **scheduleWaitMs:** Tempo di attesa runtime RN (misurato)
- **cropMs:** Tempo crop CPU su JS thread
- **resizeMs:** Tempo resize intermedio
- **runMs:** Tempo inferenza MoveNet
- **parseMs:** Tempo parsing output

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

### Riduzione Contesa RN Runtime

**Architettura target:**
```
WORKLET
  │
  ├─ prep ~5ms
  ├─ resize ~4ms
  ├─ native crop/resize 192×192
  │
  └─ scheduleOnRN(...)
          │
          │  ← ridotto (meno contesa)
          ↓
RN / JS
  │
  ├─ crop ~0ms (già fatto native)
  ├─ conversione ~0ms
  └─ MoveNet run ~80-130ms
```

**Benefici:**
- Eliminazione trasferimento buffer 640×360×3 (~2.64 MB)
- Crop/resize native riducono lavoro JS thread
- Meno contesa tra YOLO e MoveNet
- Schedule wait ridotto

### Ottimizzazione MoveNet Delegate

**Stato:** Da investigare

**Opzioni:**
- GPU delegate se disponibile sul device
- NPU delegate per hardware acceleration
- Modello più leggero se accuracy accettabile
- Riduzione input size (192 → 160 o 128)

### Adaptive Performance

**Stato:** RIMOSSO - Sistema deterministico con VISION_CONFIG

**Motivazione rimozione:**
- L'architettura async attuale (scheduleOnRN) non richiede throttling temporale
- FPS naturale basato su tempo inferenza async
- L'accoppiamento camera FPS / YOLO FPS causava regressioni di performance

**Architettura attuale:**
- Camera FPS: 30 (indipendente, via CAMERA_CONFIG.DEFAULT_FPS)
- YOLO FPS: naturale ~4-5 (basato su tempo inferenza async)
- MoveNet FPS: naturale ~3-4 (basato su tempo inferenza async)
- Tracking: realtime (ogni frame con Kalman prediction)
- FPS metrics sincronizzati da shared values a state per UI
- Session usage time: minuti:secondi con ref globale per persistenza
- Configurazione semplice e chiara in VISION_CONFIG

## Performance Monitoring

### Metrics attuali

**Vision pipeline:**
- YOLO throughput FPS (actual inferences per second)
- YOLO schedule wait time (ms) - attesa runtime RN
- YOLO inference time (min/max/avg)
- MoveNet throughput FPS (actual inferences per second)
- MoveNet worklet prep time (ms) - preparazione nel worklet
- MoveNet schedule wait time (ms) - attesa runtime RN
- MoveNet crop time (ms) - crop CPU su JS thread
- MoveNet resize time (ms) - resize intermedio
- MoveNet run time (ms) - inferenza
- MoveNet parse time (ms) - parsing output
- MoveNet requested/executed/droppedBusy/skipped counters
- Camera FPS (sincronizzato da shared value a state)
- Frame drops (busy, processing)
- Log formato: `YOLO fps=4.9 exec=5 attempt=11 skip=6 avg=46.7ms max=58.3ms`
- Log formato: `YOLO DETAIL schedule=Xms resize=Yms run=Zms parse=Ams`
- Log formato: `MOVE fps=3.8 exec=4 attempt=4 skip=0 avg=213.4ms max=303.7ms`
- Log formato: `MOVE DETAIL prep=Xms schedule=Yms crop=Zms resize=Ams run=Bms parse=Cms`
- Log formato: `CAM fps=29.6 recv=30 proc=28 drop=2 avg=17.0ms max=32.1ms`

**NOTA IMPORTANTE sulle metriche FPS:**
- `throughputFps` (actual): inferences reali per secondo - indica il throughput effettivo
- `theoreticalFps` (latencyCapacity): 1000 / avgInferenceTime - indica quanto velocemente potrebbe girare se eseguita continuamente
- Esempio: se YOLO impiega 50ms, theoreticalFps = 20, ma throughputFps naturale = ~4-5
- I log ora mostrano chiaramente throughput vs capacità di latenza
- Log formato: `[PERF 1s] CAM fps=29.6 recv=30 proc=28 drop=2 avg=17.0ms max=32.1ms`
- **Reanimated Shared Values:** I shared values non vengono letti direttamente durante il render, ma sincronizzati a state tramite useEffect per evitare warning
- **Schedule wait measurement:** Entrambi i worker misurano il tempo tra scheduleOnRN() e l'esecuzione effettiva del callback, permettendo di identificare la contesa del runtime RN

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
- Session usage time (minuti:secondi) con persistenza tra unmount/mount

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
- **Realtime:** 27-30 FPS per camera, realtime per tracking
- **Efficienza:** Zero allocation nel hot path, ring buffers
- **Scalabilità:** Queue async, sampling, throttling
- **Affidabilità:** PersistentOutbox per eventi critici, retry
- **Durabilità:** Global recovery, retry persistente, shutdown sicuro
- **Testability:** Suite test completa per queue/outbox/sampler
- **Misurabilità:** Schedule wait time separato da inference time

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
- **Frame processor latency risolto** (conversione ad async)
- **CPU crop nel worklet risolto** (spostato su JS thread async)
- **Misurazione schedule wait implementata** (per identificare contesa RN)

Le ottimizzazioni future (riduzione contesa RN runtime) richiedono:
- Stabilizzazione pipeline async attuale
- Misurazione precisa schedule wait YOLO vs MoveNet
- Valutazione crop/resize native
- Ottimizzazione delegate MoveNet
- Testing approfondito

Le ottimizzazioni architetturali future (WorkoutSessionRuntime, state machine) richiedono:
- Decoupling screen da runtime
- Implementazione macchina stati
- Separazione responsabilità
