# MVPIQ Hoops - Vision Performance Analysis

## Performance Targets

| Componente | Target FPS | Observed FPS | Note |
|------------|-----------|-------------|------|
| Camera | 30 FPS | ~25 FPS (best ~29-30) | Default 30 FPS, observed ~25 FPS |
| YOLO | 10 FPS | 5-6 FPS | Deterministic rate limiting, latest-frame-wins |
| Tracking | Realtime | Realtime | Ogni frame con Kalman prediction |
| MoveNet | 3 FPS | 2-4 FPS | Deterministic rate limiting (hard cap 3 FPS) |
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

**Nota importante:** Il sistema usa deterministic rate limiting (YOLO max 10 FPS, MoveNet max 3 FPS), non adaptive throttling. Camera FPS è indipendente da YOLO/MoveNet FPS. Questa architettura evita regressioni causate da accoppiamenti inappropriati.

**Scheduler Architecture (Async):**
- YOLO esegue async tramite scheduleOnRN con deterministic rate limiting max 10 FPS
- MoveNet esegue async tramite scheduleOnRN con deterministic rate limiting max 3 FPS (throttle 333ms)
- useShotTracker chiama processFrame() ogni frame per entrambi i worker
- Ogni worker decide internamente se eseguire in base a `isProcessing` flag
- YOLO: true latest-frame-wins flag-based (worklet-safe). True buffer-based richiede architettura native queue
- MoveNet: throttle temporale + single-flight
- Nessuno scheduler duplicato in useShotTracker
- FPS metrics sincronizzati da shared values a state per evitare warning Reanimated
- **Misurazione schedule wait:** Entrambi i worker misurano il tempo di attesa del runtime RN (scheduleWaitMs)
- **Cancellation guard su unmount:** Entrambi i worker hanno `isMountedRef` per prevenire nuove inferenze dopo unmount (non interrompe inferenze già in esecuzione)

## Bottleneck Analysis

### Primary Bottleneck: RN Runtime Scheduling Contention

**Sintomo:** Schedule wait time è il principale collo di bottiglia della latenza della pipeline

**Metriche misurate (A→F Pipeline Breakdown con P50/P95/P99):**

**YOLO Pipeline:**
- Worklet prep: 0ms (resize avviene nel worklet ma non tracciato separatamente)
- Schedule wait: P50=44.4ms, P95=93.3ms, P99=119.7ms
- JS preprocessing: 0ms (YOLO non ha preprocessing JS)
- Inference: 89.9ms avg
- Postprocess: 0ms (parsing è veloce)
- **Schedule wait è ~40-50% della latenza totale**

**MoveNet Pipeline:**
- Worklet prep: 6-12ms avg
- Schedule wait: P50=75.5ms, P95=161.0ms, P99=185.3ms
- Crop: 8-9ms avg
- Quantization: 12ms avg
- Inference: 105-155ms avg
- Postprocess: 0.1ms avg
- **Schedule wait è ~40-60% della latenza totale**

**Causa:**
- YOLO e MoveNet eseguono async sullo stesso runtime RN/JS
- scheduleOnRN() entra in una coda e attende disponibilità runtime
- Contesa tra YOLO runSync() (~30-40ms) e MoveNet inference (~80-130ms)
- Il callback async non parte immediatamente dopo scheduleOnRN()
- La telemetria misura quanto tempo passa prima dell'esecuzione della callback RN, ma non identifica ancora quale attività stia occupando il thread durante quel periodo

**Mitigazione (Attuale):**
- YOLO convertito ad async con scheduleOnRN
- MoveNet convertito ad async con scheduleOnRN
- **Telemetry A→F con P50/P95/P99** per monitorare schedule wait nel tempo
- Worklet prep separato da schedule wait per MoveNet
- CPU crop spostato fuori dal worklet (non più collo di bottiglia)
- **Throttling tracking.processFrame() a 100ms** per ridurre lavoro RN del 60-70%
- **Telemetry RN work metrics** per identificare fonti di congestione (scheduled, callback execution, UI updates)
- **useShotTracker disabilitato quando Runtime è attivo** (Decision 29) per eliminare lavoro duplicato YOLO/MoveNet

**Mitigazione (Futuro):**
- Indagare causa specifica del schedule wait (chi occupa il thread RN per 75-185ms MoveNet e 44-120ms YOLO)
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
- **sharedValueReads broken down per categoria** (camera, yolo, moveNet, playerCrop, tracking, writes)
- **playerCrop identificato come SharedValue read più costoso**

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
- FPS deterministic rate limiting: ≤10 (max 10 FPS con throttle 100ms)
- Esecuzione async tramite scheduleOnRN
- Esegue ogni frame se `!isProcessing` e throttle passato
- Indipendente dal FPS della camera
- useShotTracker chiama processFrame() ogni frame, il worker decide se eseguire
- **scheduleWaitMs:** Tempo di attesa runtime RN (misurato)
- **Latest-frame-wins:** Buffer frame pendente per processare frame più recente

**Protezioni attive (in useYoloWorker):**
1. `isProcessing` - previene concorrenza YOLO
2. `enabled` - flag di abilitazione

### MoveNet Scheduler Metrics

**Metriche attuali:**
- FPS deterministic rate limiting: ≤3 (hard cap 3 FPS con throttle 333ms)
- Esecuzione async tramite scheduleOnRN
- Esegue ogni frame se `!isProcessing` e bbox player valido e throttle passato
- Indipendente dal FPS della camera
- Condizione: player bbox disponibile + confidence >= 5%
- useShotTracker chiama processFrame() ogni frame, il worker decide se eseguire
- **workletPrepMs:** Tempo preparazione worklet (crop geometry + resize + buffer)
- **scheduleWaitMs:** Tempo di attesa runtime RN (misurato)
- **cropMs:** Tempo crop CPU su JS thread
- **resizeMs:** Tempo resize intermedio
- **runMs:** Tempo inferenza MoveNet
- **parseMs:** Tempo parsing output
- **Cancellation guard su unmount:** `isMountedRef` previene nuove inferenze dopo unmount (non interrompe inferenze già in esecuzione)

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
// ballDetectionFramesCount e playerDetectionFramesCount rimossi (duplicati non usati)
// framesWithBall e framesWithPlayer usati direttamente da pipelineMetrics
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

**Stato:** RIMOSSO - Sostituito con deterministic rate limiting

**Motivazione rimozione adaptive:**
- L'architettura async attuale (scheduleOnRN) non richiede adaptive throttling dinamico
- Adaptive throttling (10 → 7 → 5 in base al carico) causava regressioni di performance
- L'accoppiamento camera FPS / YOLO FPS era problematico

**Architettura attuale (deterministic rate limiting):**
- Camera FPS: 30 (indipendente, via CAMERA_CONFIG.DEFAULT_FPS)
- YOLO FPS: max 10 FPS con deterministic rate limiting (throttle 100ms)
- MoveNet FPS: max 3 FPS con deterministic rate limiting (throttle 333ms)
- Tracking: realtime (ogni frame con Kalman prediction)
- FPS metrics sincronizzati da shared values a state per UI
- Session usage time: minuti:secondi con ref globale per persistenza
- Configurazione semplice e chiara in VISION_CONFIG

## Performance Monitoring

### Metrics attuali

**Vision pipeline (A→F Breakdown con P50/P95/P99):**
- YOLO throughput FPS (actual inferences per second)
- YOLO worklet prep time (ms) - preparazione nel worklet
- YOLO schedule wait time (ms) - attesa runtime RN con P50/P95/P99
- YOLO JS preprocessing time (ms) - preprocessing su JS thread
- YOLO inference time (ms) - inferenza
- YOLO postprocess time (ms) - postprocessing
- MoveNet throughput FPS (actual inferences per second)
- MoveNet worklet prep time (ms) - preparazione nel worklet
- MoveNet schedule wait time (ms) - attesa runtime RN con P50/P95/P99
- MoveNet crop time (ms) - crop CPU su JS thread
- MoveNet quantization time (ms) - Float32 → uint8/int8 conversion
- MoveNet resize time (ms) - resize intermedio
- MoveNet run time (ms) - inferenza
- MoveNet parse time (ms) - parsing output
- MoveNet requested/executed/droppedBusy/skipped counters
- Camera FPS (sincronizzato da shared value a state)
- Frame drops (busy, processing)
- Log formato: `YOLO DETAIL workletPrep=Xms schedule=Yms (P50=A P95=B P99=C) jsPreprocess=Dms inference=Ems postprocess=Fms`
- Log formato: `MOVE DETAIL prep=Xms schedule=Yms (P50=A P95=B P99=C) crop=Zms quant=Ams run=Bms parse=Cms`

**NOTA IMPORTANTE sulle metriche FPS:**
- `throughputFps` (actual): inferences reali per secondo - indica il throughput effettivo
- `theoreticalFps` (latencyCapacity): 1000 / avgInferenceTime - indica quanto velocemente potrebbe girare se eseguita continuamente
- Esempio: se YOLO impiega 50ms, theoreticalFps = 20, ma throughputFps naturale = ~4-5
- I log ora mostrano chiaramente throughput vs capacità di latenza
- Log formato: `[PERF 1s] CAM fps=29.6 recv=30 proc=28 drop=2 avg=17.0ms max=32.1ms`
- **Reanimated Shared Values:** I shared values non vengono letti direttamente durante il render, ma sincronizzati a state tramite useEffect per evitare warning
- **Schedule wait measurement:** Entrambi i worker misurano il tempo tra scheduleOnRN() e l'esecuzione effettiva del callback, permettendo di identificare la contesa del runtime RN. La telemetria misura quanto tempo passa prima dell'esecuzione della callback RN, ma non identifica ancora quale attività stia occupando il thread durante quel periodo.

**Tracking:**
- Ball state (DETECTED/PREDICTED/LOST)
- Player state (DETECTED/PREDICTED/LOST)
- Rim state (DETECTED/PREDICTED/LOST)
- Trajectory length
- **Kalman prediction count:** 0 (spiegato da detection YOLO 100% - il ramo prediction non viene esercitato)

**Telemetry:**
- Frames processed
- Frames with ball (da pipelineMetrics.framesWithBall)
- Frames with player (da pipelineMetrics.framesWithPlayer)
- YOLO executed frames (yoloExecuted)
- **Detection rate calcolato correttamente:** framesWithBall/yoloExecuted e framesWithPlayer/yoloExecuted
- **Sorgente FPS unica:** telemetryLogger.getYoloPerfMetrics() (no duplicazioni)
- Session usage time (minuti:secondi) con persistenza tra unmount/mount
- **RN work sources identification** (BALL CALLBACK, POSE CALLBACK, TELEMETRY OVERLAY UPDATE)

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
- **Realtime:** Camera target 30 FPS, observed ~25 FPS, realtime per tracking
- **Efficienza:** Zero allocation nel hot path, ring buffers
- **Scalabilità:** Queue async, sampling, deterministic rate limiting
- **Affidabilità:** PersistentOutbox per eventi critici, retry
- **Durabilità:** Global recovery, retry persistente, shutdown sicuro
- **Testability:** Suite test completa per queue/outbox/sampler
- **Misurabilità:** Schedule wait time separato da inference time con P50/P95/P99
- **Telemetry corretta:** Detection rate calcolato correttamente, sorgente FPS unica
- **Telemetry A→F:** Breakdown dettagliato della pipeline con percentili per identificare collo di bottiglia

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
- **Misurazione schedule wait implementata** (per identificare contesa RN con P50/P95/P99)
- **Telemetry bugs strutturali risolti** (Decision 24):
  - Contatori duplicati rimossi
  - Detection rate calcolato correttamente
  - Sorgente FPS unica (telemetryLogger)
  - Deterministic rate limiting implementato (YOLO ≤10 FPS, MoveNet ≤3 FPS)
  - Latest-frame-wins flag-based implementato (worklet-safe). True buffer-based richiede architettura native queue a causa di limitazioni scheduleOnRN
  - Cancellation guard su unmount implementato (non interrompe inferenze già in esecuzione)
- **Audit performance completato** (Decision 28):
  - Telemetry A→F con P50/P95/P99 implementata per YOLO e MoveNet
  - Kalman filter analizzato: prediction=0 spiegato da detection YOLO 100%
  - Kalman filter comportamento corretto come fallback (non richiede tuning parametri)
  - Schedule wait identificato come principale collo di bottiglia (40-60% latenza totale)
  - YOLO schedule wait: P50=44.4ms, P95=93.3ms, P99=119.7ms
  - MoveNet schedule wait: P50=75.5ms, P95=161.0ms, P99=185.3ms
  - Nessun tuning aggressivo richiesto al momento
- **useShotTracker disabilitato quando Runtime attivo** (Decision 29):
  - Flag runtimeActive aggiunto per eliminare lavoro duplicato YOLO/MoveNet
  - Quando Runtime è ACTIVE: solo VisionEngineAdapter esegue YOLO/MoveNet
  - Quando Runtime non è ACTIVE: useShotTracker mantiene comportamento legacy
  - Potenziale riduzione schedule wait (da verificare con test)

**Problemi aperti (non risolti da Decision 24):**
- Qualità player bbox (PLAYER_CONFIDENCE_THRESH = 0.005 estremamente permissivo)
- False-positive/suspicious rate
- Float32 normalizzato vs modello uint8
- Schedule wait YOLO/MoveNet (contesa RN runtime) - **MITIGATO con throttling tracking.processFrame()**
- ~2.64 MB di buffer intermedio
- CPU crop su JS thread
- Delegate MoveNet
- Camera che resta intorno a ~25 FPS
- Vera cancellazione di un'inferenza già partita (richiederebbe worklet-safe SharedValue)
- **Semantic metrics da correggere:** detected vs framesWithBall, ballFrameRate vs detectionCount

**Problemi risolti da Audit Performance (Decision 28):**
- ✅ Kalman prediction=0 spiegato (YOLO detection 100% - ramo prediction non esercitato)
- ✅ Kalman filter comportamento corretto come fallback (non richiede tuning px/py/mx/my)
- ✅ Telemetry A→F con P50/P95/P99 sufficiente per monitorare schedule wait nel tempo
- ✅ Schedule wait identificato come principale area performance (non nascosto in latenza generica)

Le ottimizzazioni future (riduzione contesa RN runtime) richiedono:
- Stabilizzazione pipeline async attuale
- Indagare causa specifica del schedule wait (chi occupa il thread RN)
- Valutazione crop/resize native
- Ottimizzazione delegate MoveNet
- Testing approfondito

**Future optimization targets (solo se necessario):**
- Indagare causa specifica del schedule wait (chi occupa il thread RN per 75-185ms MoveNet e 44-120ms YOLO)
- Camera avg onFrame < ~10 ms (attualmente ~27-30 ms)
- Eliminazione buffer intermedio 640×360×3 (~2.64 MB)
- Crop/resize native prima di scheduleOnRN

**Stato Audit Performance (Decision 28):**
- ✅ COMPLETATO - Nessun tuning aggressivo richiesto al momento
- Sistema stabile e misurato
- Schedule wait monitorato con P50/P95/P99
- Kalman filter funzionante come fallback
- Ottimizzazioni future solo se necessario
