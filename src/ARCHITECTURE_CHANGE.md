# Vision Pipeline Architecture

## Overview

La pipeline di vision dell'applicazione MVPIQ Hoops elabora frame dalla camera per rilevare e tracciare tre oggetti chiave: la palla, il canestro e il giocatore. La pipeline è costruita su React Native Vision Camera V5 con un'architettura worklet-safe per garantire performance real-time.

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

### Pipeline Principale

```
Camera Frame (1280×720 @ 30 FPS)
    ↓
YOLO Detection (512×512 INT8) - OGNI FRAME
    ↓
YOLO Parser
    ↓
    ├── Ball → BallTracker (TTL 500ms) → Kalman Prediction
    ├── Hoop → RimTracker (TTL 500ms)
    └── Player → PlayerTracker (TTL 750ms) → MoveNet (192×192) SOLO SE BBOX DISPONIBILE
```

### Componenti Principali

#### 1. YOLO Detection
- **Modello**: `best_512_int8.tflite`
- **Risoluzione**: 512×512 INT8
- **Output**: Bounding boxes per ball, hoop, player
- **Performance**: Eseguito su ogni frame (YOLO_FRAME_SKIP = 1)
- **Throttling**: Disabilitato per massima precisione
- **Adaptive**: Sistema adaptive performance gestisce scaling modello se performance degradano

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

**Stato implementazione:** ⚠️ Parzialmente implementato

- ✅ Sistema adaptive performance esistente (`useAdaptivePerformance.ts`)
- ✅ Collegamento adaptive model al worker YOLO (ricreazione worker quando modello cambia)
- ❌ Adaptive FPS NON collegato alla camera
  - **Limitazione:** VisionCamera V5 non supporta FPS dinamico tramite `useFrameOutput`
  - Il FPS è configurato a livello di `Camera` session, non del frame output
  - Per implementare FPS dinamico, sarebbe necessario ricreare l'intera sessione camera quando FPS cambia
  - Questo è un cambiamento architetturale significativo che richiede valutazione

### Stato Implementazione

| Componente | Stato | Note |
|------------|-------|------|
| Separazione YOLO/tracking/MoveNet | ✅ | Completata |
| Player tracking worklet-safe | ✅ | Implementato |
| TTL player 750 ms | ✅ | Implementato |
| TTL ball 500 ms / Kalman | ✅ | Implementato |
| Jump threshold + safety net | ✅ | Implementato correttamente |
| MoveNet throttling 3 FPS | ✅ | Implementato |
| Fix doppio clock MoveNet | ✅ | Implementato |
| Pose parser [y,x,score] | ✅ | Corretto |
| Stati DETECTED/PREDICTED/LOST | ✅ | Implementati |
| Telemetria | ✅ | Ampiamente implementata |
| YOLO ogni frame | ✅ | Throttling rimosso, esegue ogni frame |
| Adaptive performance (model) | ✅ | Collegato al worker YOLO |
| Adaptive performance (FPS) | ⚠️ | Incoerenza stato interno vs carico reale |
| Crop geometrico player | ✅ | Implementato |
| Crop effettivo immagine per MoveNet | ✅ | CPU ottimizzato (640x360 → 192x192) |
| MoveNet riceve crop 192×192 | ✅ | Riceve crop player reale |
| Risoluzione camera | ✅ | Allineata a 1280×720 |
| Log debug dimensioni buffer | ✅ | Aggiunto per verifica runtime |

**Percentuale completamento architettura:** ~90%

**Rimanenti:**
- Test effettivo pose detection con crop corretto (richiede esecuzione app)
- Valutazione se modificare adaptive performance per saltare scaling FPS non collegato

### Configurazione Globale

Tutti i threshold e valori di default sono centralizzati in `appConfig.ts`:

```typescript
export const YOLO_CONFIG = {
  BALL_CONF_THRESHOLD: 0.005,           // 0.5%
  PLAYER_CONF_THRESHOLD: 0.005,         // 0.5%
  PLAYER_CROP_MIN_CONFIDENCE: 0.005,   // 0.5%
  RIM_CONF_THRESHOLD: 0.005,            // 0.5%
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

### Bottleneck Principale: MoveNet CPU Crop

Il collo di bottiglia principale della pipeline è il crop CPU di MoveNet:

**Approccio crop da full-frame 1280×720:**
| Operazione | Tempo | % totale MoveNet |
|------------|-------|------------------|
| rgbResizer.resize() | ~2.8 ms | 1.4% |
| CPU crop/resample | ~92 ms | 46% |
| MoveNet inference | ~67 ms | 33% |
| Parsing | ~0.3 ms | 0.1% |
| **Totale** | **~200 ms** | **100%** |

**Approccio crop da 640×360 intermedio:**
| Operazione | Tempo | % totale MoveNet |
|------------|-------|------------------|
| intermediateResizer.resize() | ~5 ms | 4.5% |
| CPU crop/resample | ~5-10 ms | 9-18% |
| MoveNet inference | ~67 ms | 60% |
| Parsing | ~0.3 ms | 0.3% |
| **Totale** | **~110-120 ms** | **100%** |

**Miglioramento:** -40% tempo MoveNet (da ~200ms a ~110ms)

Il crop CPU ottimizzato (`cropAndResizeFloat32`) lavora su buffer 640×360 invece di 1280×720, riducendo drasticamente il lavoro CPU.

### Camera FPS Impact

| Configurazione | Camera FPS | YOLO FPS | MoveNet FPS |
|----------------|------------|----------|-------------|
| YOLO + MoveNet | ~15-18 FPS | ~30 FPS (ogni frame) | ~3 FPS (solo con bbox) |
| YOLO solo | ~17 FPS | ~30 FPS | N/A |
| MoveNet disabilitato | ~29 FPS | N/A | N/A |

MoveNet riduce la camera FPS di ~25-35% quando attivo.

### Ottimizzazioni Implementate

1. **YOLO su ogni frame**: `YOLO_FRAME_SKIP = 1` per massima precisione
   - YOLO eseguito a ~30 FPS
   - Trade-off: Maggiore carico CPU ma tracking più preciso

2. **MoveNet condizionale**: Esecuzione solo se player bbox disponibile
   - MoveNet non esegue quando player perso, riducendo spreco risorse
   - MoveNet riprende automaticamente quando player rilevato di nuovo

3. **Crop CPU ottimizzato**: Resize intermedio 640×360 + crop CPU su Float32
   - Riduzione tempo crop da ~92ms a ~5-10ms
   - `usingPlayerCrop = true` quando bbox disponibile

4. **Fix throttling**: Spostamento aggiornamento `lastInferenceAt` all'inizio del dispatch
   - MoveNet FPS reali da 1.4 a ~3 FPS

## Bug Risolti

### Bug Tracking: Feedback Loop nel Jump Threshold

Il jump threshold in `usePlayerCropManager.ts` confrontava la nuova detection contro `smoothedX.value` invece di `bboxX.value`, creando un feedback loop che poteva bloccare il tracking durante movimenti rapidi.

**Soluzione**: Confrontare contro l'ultima posizione raw accettata (`bboxX.value`) e aggiungere un contatore di rifiuti consecutivi che forza l'accettazione dopo 3 rifiuti.

### Bug Throttling: Doppio Clock

Due orologi diversi per lo stesso rate-limit causavano esecuzione a ~1.4 FPS reali invece di 3 FPS.

**Soluzione**: Spostare aggiornamento `lastInferenceAt` all'inizio del dispatch per allineare i due orologi.

### Render Warnings: useDerivedValue Chains

Letture `.value` da derived values durante render causavano warning.

**Soluzione**: Inlinare logica per leggere direttamente da SharedValues originali invece di da derived values intermedi.

### ShotTracker UNMOUNT: effectiveResolution Instability

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
- Rim perso ma calibration disponibile → `rimTrackState = 'PREDICTED'`
- Nessuna detection né calibration → `rimTrackState = 'LOST'`

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
- Resize GPU intermedio a 640×640
- Funzione `cropAndResizeFloat32()` per crop CPU su Float32
- `usingPlayerCrop = true` quando bbox disponibile
- Riduzione tempo crop da ~92ms a ~5-10ms

**Nota**: react-native-vision-camera-resizer V5 NON supporta crop arbitrario nativo (GitHub issue #3746). La soluzione ottimizzata usa resize intermedio + crop CPU su buffer ridotto.

## Adaptive Performance Management

### Sistema di Gestione Adattiva (Parzialmente Implementato)

**Hook**: `useAdaptivePerformance` (worklet-safe con SharedValues)

**Obiettivo**: Gestire automaticamente le performance del modello YOLO durante le sessioni di workout per prevenire il degrado delle FPS.

**Problema risolto**: Il vecchio sistema basato su `isReady` causava un degrado progressivo delle FPS (da 16 FPS a 8 FPS) indipendentemente dallo stato di MoveNet.

**Stato implementazione:**
- ✅ Sistema adaptive performance esistente
- ✅ Collegamento adaptive model al worker YOLO (ricreazione worker quando modello cambia)
- ❌ Adaptive FPS NON collegato alla camera (limitazione API VisionCamera V5)

**Approccio attuale**:
- YOLO viene eseguito su ogni frame (senza throttling basato su `isReady`)
- Sistema adattivo monitora le performance YOLO e scala il modello dinamicamente
- Modello YOLO scalato automaticamente: 640 → 512 → 320 (se performance scarse)
- Sistema completamente bidirezionale: scala down quando performance scarse, scala up quando performance buone

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

**Thresholds**:
- `TARGET_YOLO_FPS`: 10 FPS (minimo accettabile)
- `TARGET_YOLO_SUCCESS_RATE`: 60% (minimo tasso di successo)
- `ADAPTATION_WINDOW_MS`: 3000ms (finestra di valutazione)
- `MIN_ADAPTATION_INTERVAL_MS`: 5000ms (minimo tempo tra adattamenti)

**Shared Values**:
- `currentModelIndex`: Indice del modello YOLO corrente
- `perfWindowStart`, `perfYoloFpsSum`, `perfYoloFpsCount`: Metriche performance
- `perfFramesProcessed`, `perfFramesFailed`, `perfInferenceTimeSum`: Statistiche esecuzione

**Limitazione Adaptive FPS:**
VisionCamera V5 non supporta FPS dinamico tramite `useFrameOutput`. Il FPS è configurato a livello di `Camera` session, non del frame output. Per implementare FPS dinamico sarebbe necessario ricreare l'intera sessione camera quando FPS cambia, che è un cambiamento architetturale significativo.

**Warning: Adaptive Performance Incoerenza**
Il sistema adaptive performance prova prima a scalare l'FPS (30→24→20→15) prima di scalare il modello. Poiché l'FPS non è collegato alla camera, lo stato interno cambia ma l'hardware continua a 30 FPS. Solo quando arriva al minimo FPS, il sistema scala il modello. Questo crea un'incoerenza tra stato interno e carico reale.

**Warning: YOLO Actual FPS vs Requested FPS**
YOLO viene richiesto su ogni frame (30 FPS), ma l'actual FPS dipende dal tempo di inferenza. Con `isProcessing` che previene esecuzione concorrente, se YOLO impiega ~70ms, l'actual FPS sarà ~14 FPS, non 30 FPS. Molte richieste vengono ignorate perché `isProcessing=true`. La documentazione dovrebbe distinguere tra YOLO invocation (every frame) e YOLO actual inference FPS (measured).

**Note importanti**:
- Il sistema usa solo SharedValues per comunicazione worklet-JS (no `scheduleOnRN` nei worklet)
- L'adattamento del modello è completamente automatico e trasparente per l'utente
- Il sistema garantisce che YOLO venga sempre eseguito su ogni frame
- Il modello viene scalato automaticamente in base alle performance YOLO

## Future Improvements

### 1. Native Crop+Resize per MoveNet (Non Applicabile)

**Stato**: Crop CPU ottimizzato implementato come soluzione pragmatica.

**Analisi**: react-native-vision-camera-resizer V5 NON supporta crop arbitrario nativo (GitHub issue #3746 confermato dal team). `vision-camera-cropper` esiste ma restituisce base64/path, non buffer GPU worklet-safe.

**Soluzione implementata**: Resize GPU intermedio 640×640 + crop CPU su Float32
- Riduzione tempo crop da ~92ms a ~5-10ms
- `usingPlayerCrop = true` quando bbox disponibile
- MoveNet riceve crop player reale

**Opzioni future** (richiedono redesign architetturale):
- Implementare compute shader personalizzato per crop nativo
- Valutare alternative ML framework con crop nativo supportato

### 2. Riduzione Frequenza MoveNet

**Alternativa**: Ridurre da 3 FPS a 1-2 FPS se performance ancora insufficienti.

**Trade-off**: Pose meno fluida ma miglioramento camera FPS.

### 3. Modello YOLO Migliorato per Player Detection

**Problema attuale**: Il modello `best_512_int8.tflite` produce confidence player estremamente basse (0.0001-0.0003).

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

### Telemetria

**SharedValues worklet-safe**:
- `telemetryInferenceTime`, `telemetryCropMs`, `telemetryResizeMs`
- `telemetryRunMs`, `telemetryParseMs`, `telemetryKeypointsConfidence`
- `telemetryHasNewData` (flag per triggerare lettura)

**Contatori tracking**:
- Player: `playerDetected`, `playerLost`, `playerUsingLastBbox`, `playerBboxExpired`
- Ball: `ballDetected`, `ballPrediction`, `ballTrackingExpired`

## Conclusioni

La pipeline di vision attuale è funzionalmente completa con:
- ✅ Separazione chiara detection/tracking
- ✅ TTL temporale per player (750ms) e ball (500ms)
- ✅ Kalman prediction durante gap YOLO
- ✅ Configurazione centralizzata
- ✅ Telemetria completa
- ✅ Debug overlay dettagliato
- ✅ Stati visuali espliciti per debug sul campo
- ✅ YOLO eseguito su ogni frame per massima precisione
- ✅ MoveNet eseguito solo quando player bbox disponibile
- ✅ Crop CPU ottimizzato per MoveNet (640×640 → 192×192)
- ✅ Adaptive model collegato al worker YOLO
- ✅ Risoluzione allineata a 1280×720

**Stato completamento architettura:** ~85%

Il collo di bottiglia principale (crop CPU ~92ms) è stato ottimizzato a ~5-10ms tramite resize intermedio 640×640. MoveNet ora riceve il crop player reale invece del full-frame, migliorando significativamente la qualità della pose detection.

**Rimanenti:**
- Test effettivo pose detection con crop reale (richiede esecuzione app)
- Valutazione se implementare FPS dinamico camera (richiede redesign architetturale significativo)
