# MVPIQ Hoops - Architecture Overview

## Overview

La pipeline di vision dell'applicazione MVPIQ Hoops elabora frame dalla camera per rilevare e tracciare tre oggetti chiave: la palla, il canestro e il giocatore. La pipeline è costruita su React Native Vision Camera V5 con un'architettura worklet-safe per garantire performance real-time.

**Scenario dell'Applicazione:**
L'app non cerca di riconoscere una scena di basket generica, ma un esercizio ripetitivo con tre elementi principali e un ciclo prevedibile:
1. **Canestro:** Riferimento stabile e fisso nell'inquadratura. Una volta identificato e verificato, dovrebbe diventare un riferimento persistente senza doverlo rideterminare da zero a ogni frame.
2. **Giocatore:** Identità persistente. È sostanzialmente sempre lo stesso giocatore. La posizione e la posa cambiano, ma l'identità non dovrebbe cambiare continuamente né sparire a causa di una singola detection mancata.
3. **Pallone:** Tracciamento continuo. Durante il palleggio si muove vicino al giocatore; durante il tiro si separa dal giocatore e segue una traiettoria verso il canestro.

**Ciclo dell'Esercizio:**
Palleggio → Preparazione → Rilascio → Volo del pallone → Canestro o errore → Nuovo palleggio

Questo significa che l'app può sfruttare contesto, memoria e sequenza temporale, anziché affidarsi soltanto a rilevamenti indipendenti per ogni fotogramma.

## Principio Fondamentale

**Il frame processor non aspetta mai il backend, React state, persistenza o telemetria JS.**

Tutto ciò che può essere asincrono deve essere separato dal percorso realtime. L'obiettivo è misurare e ridurre la contesa del runtime RN/JS, non solo trasformare `runSync()` in async. L'architettura attuale usa `scheduleOnRN()` per eseguire YOLO e MoveNet sul thread JS, permettendo di misurare il tempo di attesa del runtime (scheduleWaitMs) separatamente dal tempo di inferenza.

**Reanimated Shared Values:** I shared values di Reanimated non devono essere letti direttamente durante il render dei componenti React. Per evitare warning di Reanimated, i valori devono essere sincronizzati a variabili di stato regolari tramite useEffect prima di essere passati ai componenti UI.

**Schedule Wait Measurement:** Entrambi i worker (YOLO e MoveNet) misurano il tempo tra `scheduleOnRN()` e l'esecuzione effettiva del callback, permettendo di identificare la contesa del runtime RN come collo di bottiglia primario.

**Principio Fondamentale Aggiunto - Integrità Temporale:**
Il sistema deve usare le informazioni dei frame precedenti per interpretare quello corrente, senza perdere la capacità di riconoscere quando una stima è diventata troppo vecchia. La scena è prevedibile: un canestro fisso, un giocatore e una palla. Il problema principale non è aggiungere altri modelli: è fare in modo che i dati deicomponenti esistenti descrivano correttamente lo stesso evento nel tempo.

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
- Fase 4.1 COMPLETATA (VisionEngineAdapter partial update - undefined/null semantica corretta)
- Fase 4.2 COMPLETATA (Runtime.processFrame() debounce 50ms - evita chiamate duplicate)
- Fase 4.3 COMPLETATA (Legacy Shot Detection disattivata - single source of truth shot events)
- Fase 4.4 COMPLETATA (PlayerDetection integrato nel nuovo percorso - onPlayerDetection callback)
- Fase 5 COMPLETATA (Legacy cleanup - ShotDetector.ts rimosso completamente, handleShotEvent rimosso)
- Fase 6 COMPLETATA (test PlayerDetection aggiunti, Kalman filter ottimizzato)
- Decision 31 COMPLETATA (MoveNet bbox corrente - strict current policy)
- Decision 32 COMPLETATA (Player stability threshold correction + telemetria granulare)
- Fase 1 ShotEvent COMPLETATA (correzioni P0/P1 - idempotenza, persistenza, posa grezza, UNCERTAIN, percorso unico)

**Stato integrazione:**
- ✅ Vision collegata via VisionEngineAdapter
- ✅ Tracking collegato via setTrackingEngine()
- ✅ ShotDetectionEngine collegato (evitando double ownership - Runtime usa istanza interna di TrackingEngine)
- ✅ Queue collegata (ownership intermedio - Screen crea, Runtime usa)
- ✅ TelemetrySampler collegato e utilizzato dal Runtime
- ✅ Tutti i sottosistemi connessi PRIMA di runtime.start()
- ✅ PlayerDetection fluisce nel nuovo percorso Runtime (YOLO → VisionEngine → Runtime → TrackingEngine → PlayerTrackingEngine)
- ✅ Policy YOLO bbox + MoveNet pose implementata (YOLO = coarse bbox, MoveNet = articulated/precise position)
- ✅ PlayerDetection integrato via TrackingEngine.processFrame() (ottavo parametro)
- ✅ Test TrackingEngine.test.ts per PlayerDetection aggiunti
- ✅ Kalman filter v2 implementato con adaptive gain + outlier detection - CONFIGURAZIONE DEFINITIVA
- ✅ ShotEvent idempotenza: shotId generato in TrackingEngine, check processedShotIds/pendingShotIds in Runtime
- ✅ Posa grezza: ShotEventBuilder.addPoseFrame() alimentato da MoveNet in Runtime.processFrame()
- ✅ UNCERTAIN: callback supporta UNCERTAIN, ShotEventBuilder normalizza AIRBALL/BLOCKED
- ✅ Percorso unico: tiri automatici e manuali usano ShotEventBuilder

### Vision Pipeline Layer (useShotTracker)

**Responsabilità:**
- Camera frame acquisition tramite `useFrameOutput`
- Reentrancy guard per prevenire elaborazioni concorrenti
- YOLO detection (ball, player, rim)
- Ball/Player/Rim detection parsing e filtering
- Player crop management (TTL 750ms, EMA smoothing, jump threshold)
- **MoveNet bbox corrente:** MoveNet esegue solo con bbox corrente (non persistente) - Decision 31
- Kalman prediction base per ball tracking
- Telemetry e performance monitoring
- FPS metrics synchronization (shared values → state) per evitare warning Reanimated
- Session usage time tracking (minuti:secondi) con persistenza tra unmount/mount
- **Telemetria granulare player flow:** tracking current, tracking last, MoveNet executions, bucket età bbox - Decision 32
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
- **BallTrajectoryAnalyzer** - Separazione palleggio/tiro con stati IDLE, DRIBBLE, SHOT_CANDIDATE, SHOT_ASCENDING, SHOT_APEX, SHOT_DESCENDING

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
- **quantizationMs misurato:** tempo conversione Float32 → uint8/int8 (~12 ms)

### BallTrajectoryAnalyzer

**Responsabilità:**
- Separazione palleggio/tiro (motion state classification)
- Detection release point (ispirato a TrajectoryService.stabilizeReleaseFrame del backend)
- Detection apex (ispirato a TrajectoryService.findApexIndex del backend)
- Motion window analysis (500ms)
- Direction changes tracking
- Vertical speed analysis

**Stati del movimento:**
- `IDLE` - Nessun tracking attivo
- `DRIBBLE` - Palleggio (movimento breve/alternato, troppi cambi direzione)
- `SHOT_CANDIDATE` - Ascesa coerente e prolungata (>200ms)
- `SHOT_ASCENDING` - Release confermato, ascesa in corso
- `SHOT_APEX` - Apice raggiunto
- `SHOT_DESCENDING` - Discesa verso il ferro

**Algoritmo di classificazione:**
1. Motion window trimming (500ms)
2. Direction changes tracking (max 3 prima di DRIBBLE)
3. Alternating motion detection (su-giù-su-giù)
4. Ascent duration tracking (min 200ms per SHOT_CANDIDATE)
5. Release detection (dy < threshold con ascesa continuata)
6. Apex detection (minimo Y nella finestra)

**Configurazione (TRAJECTORY_CONFIG):**
- motionWindowMs: 500
- ascendingThreshold: -0.005
- descendingThreshold: 0.005
- minSpeed: 0.01
- maxDirectionChanges: 3
- minAscentDuration: 200
- maxPointJump: 0.15
- releaseAscendingThreshold: -0.01

**Architettura:**
```
BallTrackingEngine (Kalman + outlier gate)
  ↓
BallTrajectoryAnalyzer (classificazione movimento)
  ↓
ShotDetectionEngine (shot logic)
```

**Ispirazione Backend:**
- `TrajectoryService.stabilizeReleaseFrame()` → `findReleaseCandidate()`
- `TrajectoryService.findApexIndex()` → `findApexCandidate()`
- `TrajectoryService.extractFlightArc()` → da implementare (flight arc extraction)
- `TrajectoryService.fitTrajectory()` → da implementare (quadratic fit)

### Tracking Policies

**Ball Tracking Policy:**
```
Target: Ball
Detection: YOLO
Tracking: Kalman v2 (adaptive gain + outlier detection)
TTL: 150 ms (configurable via KALMAN_CONFIG.predictionTtlMs)
Trajectory Analysis: BallTrajectoryAnalyzer (motion state classification)
```

**Kalman v2 Architecture:**
Il filtro Kalman v2 è stato completamente ridisegnato per il rilevamento del tiro, sostituendo l'approccio di smoothing tradizionale con un sistema intelligente basato su:
1. **Prediction** - Predizione della posizione basata su velocità
2. **Outlier Gate** - Rilevamento di anomalie basato su distanza e velocità
3. **Adaptive Gain** - Gain adattivo che segue YOLO quando è affidabile

**Algoritmo Kalman v2:**
```
Step 1: Prediction
  predX = x + vx * dt
  predY = y + vy * dt

Step 2: Innovation (distance from prediction)
  distance = sqrt((measX - predX)² + (measY - predY)²)

Step 3: Adaptive Tolerance (velocity-based)
  tolerance = minOutlierDistance + (velocity * velocityTolerance * dt)
  - minOutlierDistance: 0.025 (toleranza minima)
  - velocityTolerance: 0.8 (fattore velocità)
  - Durante tiri veloci, la tolleranza aumenta proporzionalmente alla velocità

Step 4: Outlier Gate + Adaptive Gain
  if isFirstDetection:
    ACCEPT (initialize tracking) → gain = 0.95
  else if distance > tolerance:
    REJECT (outlier) → gain = 0
  else:
    ratio = distance / tolerance
    if ratio < 0.2:   gain = 0.95 (perfect detection)
    if ratio < 0.5:   gain = 0.85 (good detection)
    if ratio < 0.8:   gain = 0.60 (noisy detection)
    else:            gain = 0.30 (near threshold)

Step 5: Update State
  if outlier:
    x = predX (use prediction only)
    velocity unchanged
  else:
    x = predX + gain * (measX - predX)
    velocity = (x - predX) / dt
```

**Comportamento Kalman v2:**
- **Detection perfetta** (distanza < 20% tolleranza): 95% gain → segue YOLO quasi istantaneamente
- **Detection buona** (distanza < 50% tolleranza): 85% gain → segue YOLO con smoothing minimo
- **Detection rumorosa** (distanza < 80% tolleranza): 60% gain → smoothing moderato
- **Outlier** (distanza >= 100% tolleranza): 0% gain → ignora detection, usa predizione

**Vantaggi rispetto a Kalman v1:**
- **Reattività immediata** a detection valide (95% gain vs 2.4% gain v1)
- **Outlier detection** basata su velocità (accetta movimenti rapidi durante tiri)
- **Nessun smoothing progressivo** (px non diminuisce, gain stabile nel tempo)
- **ballPositionRaw** mantenuto separato per debugging
- **ballRejectionReason** dettagliato con distance e tolerance
- **ballLastSeenAt semantica corretta**: aggiornato solo su detection accettate, non su outlier
- **KalmanDebugInfo**: diagnostica temporanea (raw, pred, distance, tolerance, gain, vx/vy, accepted, dt)

**Fallback:** Prediction durante gap YOLO
**Stati:** DETECTED (🟠), PREDICTED (🔴), LOST (🔴)
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

## Audit dell'Architettura

### 1. Analisi del percorso completo

La pipeline di vision deve garantire che ogni livello conservi il significato dei dati ricevuti dal livello precedente. Se una posizione stimata viene scambiata per una rilevazione reale, l'errore può propagarsi fino al risultato e alle statistiche.

**Livelli della pipeline:**

1. **Rilevazione visiva**
   - YOLO: palla, giocatore, canestro
   - MoveNet: posa grezza

2. **Sincronizzazione delle osservazioni**
   - Timestamp, freschezza, coordinate e provenienza dei dati

3. **Tracking e macchina a stati**
   - Palleggio → rilascio → volo → esito → reset

4. **Evento del tiro**
   - Identificativo, timestamp, traiettoria, risultato, posa e posizione

5. **Overlay, persistenza e report**
   - Scia corretta, conteggi coerenti, shot chart affidabile

### 2. Primi difetti confermati nel codice

Questa è la prima passata sui sorgenti; non equivale ancora a una validazione dell'app su dispositivo.

**A. Le osservazioni non sono sincronizzate per oggetto** ✅ RISOLTO (Fase 1 Completata + Correzioni P0)
VisionEngineAdapter conserva separatamente i risultati di palla, giocatore, canestro e posa, ma mantiene un unico lastTimestamp. processFrame() può quindi inoltrare risultati di età diversa senza che l'interfaccia renda esplicita questa differenza.

**Soluzione implementata (Fase 1 iniziale):**
- Timestamp separati per canale in VisionEngineAdapter (ballTimestamp, playerTimestamp, rimTimestamp, poseTimestamp)
- WorkoutSessionScreen ora passa timestamp originali dai worker (detection.timestamp per YOLO, result.timestamp per MoveNet) invece di Date.now()
- Controllo di freschezza in VisionEngineAdapter.processFrame() con soglie basate sulle frequenze naturali dei worker:
  - YOLO: 500ms (2-3x ~200-250ms tra inferenze)
  - MoveNet: 750ms (2-3x ~250-330ms tra inferenze)
- Log diagnostici per età e novità delle rilevazioni
- Osservazioni stale non vengono passate al VisionEngine

**Correzioni P0 aggiuntive (revisione statica):**
- Propagazione timestamp originali per giocatore: useShotTracker.handleYoloAsyncResult ora passa result.timestamp a onPlayerDetectionRef.current
- handlePlayerDetection in WorkoutSessionScreen riceve timestamp come secondo parametro e lo usa invece di Date.now()
- Flag di aggiornamento per canale (ballUpdated, playerUpdated, rimUpdated, poseUpdated) per distinguere nuove rilevazioni da osservazioni già elaborate
- Log diagnostici throttled per evitare rumore (log solo quando canale aggiornato e osservazione stale)

**Impatto:** velocità e associazioni spaziali ora calcolate usando dati temporalmente coerenti. Giocatore ora preserva timestamp originale YOLO.

**B. Possibile errore nel centro del giocatore**
YoloDetector espone coordinate del centro del bounding box; il fallback in TrackingEngine aggiunge nuovamente metà larghezza e altezza.

**Impatto:** se il contratto delle coordinate è quello indicato dal detector, il centro viene calcolato in modo errato. Va verificato e uniformato prima di modificare le soglie YOLO.

**C. Due implementazioni dello stato di tiro**
TrackingEngine e ShotDetectionEngine mantengono entrambi variabili relative alla salita e allo stato di volo.

**Impatto:** rischio di divergenza fra rilevamento, punto di rilascio, traiettoria e overlay. Va individuata una sola fonte di verità.

**D. Il risultato non prova il passaggio nel canestro**
ShotDetectionEngine classifica il tiro soprattutto in base a discesa, distanza dal centro del canestro e velocità.

**Impatto:** una palla che passa vicino al centro potrebbe essere classificata come MADE senza evidenza sufficiente di ingresso. Serve una decisione temporale basata sulla traiettoria.

**E. La traiettoria non distingue tutti i punti osservati da quelli stimati**
Il buffer contiene punti della palla nel tempo, ma la costruzione dell'evento può etichettare i punti come rilevazioni anche quando provengono da predizioni.

**Impatto:** la scia può risultare ingannevole e le metriche del tiro possono includere dati che non sono stati osservati direttamente.

**F. La posizione sul campo è ancora approssimativa**
WorkoutSessionRuntime passa calibration: undefined al costruttore dell'evento. Il calcolo della posizione non applica una trasformazione di omografia effettiva.

**Impatto:** lo shot chart non dovrebbe essere considerato geometricamente affidabile finché calibrazione e coordinate di rilascio non sono collegate correttamente.

### 3. Come procederei nell'audit

Non cambierei contemporaneamente soglie, tracker e classificazione. Prima verificherei i contratti e le transizioni in modo isolato.

| Fase | Verifica | Criterio di completamento |
|------|----------|---------------------------|
| 1 | Rilevazioni e timestamp | Ogni dato ha timestamp e stato di freschezza propri |
| 2 | Coordinate e tracking | Centro giocatore e palla coerenti nello stesso sistema di riferimento |
| 3 | Macchina a stati | Un solo rilascio e un solo evento per ogni tiro |
| 4 | Traiettoria | Punti del tiro isolati, con osservazioni e predizioni distinguibili |
| 5 | Classificazione | MADE/MISS/UNCERTAIN coerenti con la traiettoria disponibile |
| 6 | Evento e report | Timestamp, posa grezza, posizione e conteggi corretti |

La priorità è la fase 1, perché un difetto di sincronizzazione può falsare tutte le fasi successive.

### 4. Che cosa non darei ancora per dimostrato

Non concluderei ancora che il modello YOLO debba essere riaddestrato, che le soglie vadano abbassate o che il Kalman sia da sostituire. Per stabilirlo servono verifiche specifiche sul parser del modello, sulle coordinate prodotte e sulle sequenze reali di rilevazione.

Allo stesso modo, la presenza di test unitari non dimostra da sola che l'intera sequenza palleggio-tiro-canestro sia corretta: bisogna controllare anche i test d'integrazione e i casi in cui le rilevazioni arrivano in ritardo o mancano.

## Configurazione Globale

Tutti i threshold e valori di default sono centralizzati in `appConfig.ts`:

```typescript
export const YOLO_CONFIG = {
  BALL_CONF_THRESHOLD: 0.005,           // 0.5%
  PLAYER_CONF_THRESHOLD: 0.03,         // 3% - lowered for better detection rate
  PLAYER_CROP_MIN_CONFIDENCE: 0.05,   // 5%
  RIM_CONF_THRESHOLD: 0.1,            // 10%
  NMS_IOU_THRESHOLD: 0.4,
  PLAYER_MIN_WIDTH: 0.05,              // 5% del frame
  PLAYER_MIN_HEIGHT: 0.1,              // 10% del frame
} as const

export const CAMERA_CONFIG = {
  DEFAULT_RESOLUTION: { width: 640, height: 360 }, // 360p for better FPS (faster inference)
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
| best_384_float16 | 384x384 | FP16 | 100 | 20-21 | 3-6 | **DEFAULT MODEL** - Updated to 100 epochs, actual FPS lower due to device bottleneck |
| best_448_float16 | 448x448 | FP16 | 5 | 12-21 | TBD | Early training |
| best_512_float16 | 512x512 | FP16 | 40 | 8-10 | TBD | Balanced performance |
| best_640_float16 | 640x640 | FP16 | 30 | 5-7 | TBD | High resolution |

**Nota importante:** Il sistema NON usa throttling temporale. La frequenza della camera è indipendente dalla frequenza di inferenza YOLO/MoveNet:
- Camera: 30 FPS (configurabile via CAMERA_CONFIG)
- YOLO: FPS naturale (~4-5 FPS) basato su tempo inferenza async (~40-50ms)
- MoveNet: FPS naturale (~3-4 FPS) basato su tempo inferenza async (~200-230ms) e disponibilità bbox player
- Tracking: realtime (ogni frame)
- Bridge calls: 15 FPS (throttled a 66ms)
- **Decision 29 REVERTATA:** useShotTracker continua a eseguire YOLO/MoveNet anche quando Runtime è attivo (VisionEngineAdapter non esegue inferenza, solo forward parsed results)
- **Semantica VisionEngineAdapter:** undefined = non aggiornare canale, null = detection persa, object = detection presente

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
| RN runtime contention | 🟡 | Schedule wait identificato come principale collo di bottiglia (40-60% latenza totale), monitorato con P50/P95/P99, Decision 29 revertata (useShotTracker continua a eseguire quando Runtime attivo - VisionEngineAdapter non esegue inferenza) |
| Transfer buffer size | 🔴 | 640×360×3 (~2.64 MB), da eliminare |
| Rerender/Remount investigation | 🔴 | Possibili rerender frequenti da investigare |
| Propagazione courtType (FULL/HALF) | 🔴 | NON propagato tra Setup → Calibration → Workout |
| Homography HALF/FULL court | 🔴 | Sempre calcolata come FULL court (15.24 x 28.65) |
| CALIBRATION in critical queue | 🔴 | UI chiama API direttamente, bypassa outbox |
| SESSION_END in critical queue | 🔴 | UI chiama API direttamente, bypassa outbox |
| **Audit A: Osservazioni non sincronizzate per oggetto** | 🔴 | VisionEngineAdapter ha unico lastTimestamp per tutti gli oggetti |
| **Audit B: Centro giocatore potenzialmente errato** | 🔴 | YoloDetector espone centerX/centerY, TrackingEngine aggiunge nuovamente metà width/height |
| **Audit C: Macchina a stati tiro duplicata** | 🔴 | TrackingEngine e ShotDetectionEngine hanno stati paralleli |
| **Audit D: Classificazione MADE/MISS senza prova passaggio** | 🔴 | Basata su distanza centro, non su sequenza temporale della traiettoria |
| **Audit E: Traietoria non distingue osservati vs stimati** | 🔴 | Punti predizioni etichettati come rilevazioni nel buffer |
| **Audit F: Posizione sul campo approssimativa** | 🔴 | Calibration undefined nel costruttore ShotEvent, omografia non applicata |
| **P2: Canestro non persistente** | 🟡 | Dipende da YOLO per frame invece di calibrazione |
| **P2: Persistenza tiro imprecisa** | 🟡 | Posizione non riferita al rilascio, proiezione non calibrata |
| shutdown() bounded offline | ✅ | Time-bounded con timeout 3 secondi |
| OutboxRecoveryWorker chiavi | ✅ | Chiavi AsyncStorage corrette (workout_outbox_<id>) |
| Duplicazione loadAllPendingAndMerge | ✅ | Deduplica per ID implementata |
| Telemetry batching garantito | ✅ | Accumulation window 250ms implementata |
| Inizializzazione queue prima camera | 🟡 | Queue inizializzata DOPO attivazione camera |
| Gestione enqueueCritical false | ✅ | Runtime attende esito enqueue prima di aggiornare metriche (Fase 1 P0) |
| Shot detection single source | ✅ | Sistema unificato via TrackingEngine + ShotEventBuilder (Fase 1 P0/P1) |
| ShotEvent idempotenza | ✅ | shotId stabile generato in TrackingEngine, deduplicazione in outbox (Fase 1 P0) |
| Posa grezza associata | ✅ | ShotEventBuilder.addPoseFrame() alimenta buffer durante sessione (Fase 1 P1) |
| UNCERTAIN gestito | ✅ | Callback supporta UNCERTAIN, ShotEventBuilder normalizza AIRBALL/BLOCKED (Fase 1 P1) |
| Percorso unico eventi | ✅ | Tiri automatici e manuali usano ShotEventBuilder (Fase 1 P1) |
| Test coverage lifecycle UI | 🟡 | Buoni sui servizi, mancano test end-to-end UI |
| Vision extraction YOLO/MoveNet | ✅ | Fase 1 completata, Fase 2 COMPLETATA, Fase 3 COMPLETATA, Fase 4 COMPLETATA (Runtime.processFrame() attivo) |
| useShotTracker.ts legacy removal | ✅ | ShotDetector.ts rimosso completamente, handleShotEvent rimosso (Fase 5 completata) |
| PlayerDetection integration | ✅ | onPlayerDetection callback aggiunto, fluisce nel nuovo percorso Runtime (Fase 4.4 completata) |
| PlayerDetection parameter | ✅ | TrackingEngine.processFrame() accetta playerDetection come ottavo parametro (Fase 6 completata) |
| PlayerDetection tests | ✅ | TrackingEngine.test.ts aggiunti per YOLO + MoveNet integration (Fase 6 completata) |
| Kalman filter optimization | ✅ | Kalman v2: adaptive gain + outlier detection (prediction → outlier gate → adaptive gain) - CONFIGURAZIONE DEFINITIVA |
| BallTrajectoryAnalyzer | ✅ | Separazione palleggio/tiro con stati IDLE/DRIBBLE/SHOT_CANDIDATE/SHOT_ASCENDING/SHOT_APEX/SHOT_DESCENDING - ispirato a TrajectoryService del backend |
| Performance audit (Decision 28) | ✅ | Telemetry A→F con P50/P95/P99, Kalman analysis completata, schedule wait identificato come principale collo di bottiglia |
| Legacy useShotTracker disable (Decision 29) | ✅ | REVERTATA - Flag runtimeActive rimosso dal frame processor, useShotTracker continua a eseguire quando Runtime è attivo (VisionEngineAdapter non esegue inferenza, solo forward risultati) |
| BallTrajectoryAnalyzer implementation | ✅ | Nuovo componente per separazione palleggio/tiro - stati IDLE/DRIBBLE/SHOT_CANDIDATE/SHOT_ASCENDING/SHOT_APEX/SHOT_DESCENDING - ispirato a TrajectoryService del backend (stabilizeReleaseFrame, findApexIndex) |

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
