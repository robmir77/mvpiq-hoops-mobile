# Vision Pipeline Architecture Change

## Overview
Refactoring della pipeline di vision per separare chiaramente detection, tracking e pose estimation.

## Current Architecture (Before Refactoring)

```
YOLO Detection
    ↓
Ball Detection → ShotDetector → TrackingEngine
    ↓
Player Detection → MoveNet (full-frame fallback)
```

**Problemi identificati:**
- YOLO controlla direttamente l'operazione di MoveNet
- Player BBox non ha TTL temporale (solo frame-based)
- Logica crop duplicata tra playerCrop.ts e useMoveNetWorker.ts
- Fallback full-frame quando BBox scade
- Kalman prediction non eseguita durante i gap YOLO per la palla

## Target Architecture (After Refactoring)

```
YOLO Detection
    ↓
    ├── Ball Detection → BallTracker (TTL 500ms) → Kalman PREDICT
    │
    └── Player Detection → PlayerTracker (TTL 750ms) → MoveNet
```

**Principi chiave:**
- Separazione semantica: detection ≠ tracking state
- TTL temporale per entrambi player (750ms) e ball (500ms)
- Kalman PREDICT eseguita anche quando YOLO non rileva
- Nessun fallback full-frame
- Telemetria per stati di tracking

## Phase 1: Player Tracking Refactoring

### Obiettivo
Separare player detection da tracking state con TTL temporale.

### Modifiche implementate

#### 1. playerCrop.ts - PlayerCropManager refactoring
- Sostituito `maxLostFrames: 5` (frame-based) con `bboxTtlMs: 750` (time-based)
- Aggiunta interfaccia `TrackedPlayerBbox` con metadati:
  - `detectedAt`: timestamp prima detection
  - `lastSeenAt`: timestamp ultima detection
  - `isStale`: BBox scaduto (>750ms)
  - `ageMs`: età del BBox
  - `isUsingLastBbox`: usando BBox persistente
- Aggiunto metodo `update(playerBbox)` per aggiornare tracking state
- Aggiunto metodo `getEffectiveBbox(now)` per ottenere BBox tracciato o null se scaduto
- Modificato `calculateCrop()` per accettare `TrackedPlayerBbox`

#### 2. useShotTracker.ts - Integrazione PlayerCropManager
- Importato `playerCropManager`
- Sostituito aggiornamento diretto `moveNetWorker.playerBbox` con `playerCropManager.update()`
- Aggiunto `getEffectiveBbox()` prima di chiamare MoveNet
- MoveNet chiamato solo se `trackedBbox` non è null (nessun fallback full-frame)
- Aggiunta telemetria player tracking:
  - `recordPlayerDetected()`: ogni volta che YOLO rileva
  - `recordPlayerLost()`: solo transizione DETECTED→LOST
  - `recordPlayerUsingLastBbox()`: quando usa BBox persistente
  - `recordPlayerBboxExpired()`: quando BBox scade
- Aggiunto `lastPlayerDetectedRef` per evitare incrementi ripetuti di `playerLost`
- Aggiunto `playerCropManager.reset()` in `resetShotTracking()`

#### 3. useMoveNetWorker.ts - Rimozione logica duplicata
- Rimosso fallback full-frame (righe 351-453)
- Semplificato `processFrame` per assumere sempre un BBox valido
- Aggiunto early return se BBox è null

#### 4. telemetry.ts - Telemetria player tracking
- Aggiunto contatori: `playerDetected`, `playerLost`, `playerUsingLastBbox`, `playerBboxExpired`
- Aggiunto array `playerBboxAgeMs` per età media
- Aggiunto `logPlayerTrackingMetrics()` per logging periodico
- Aggiunto reset metriche player in `reset()`

### Nuova architettura Player
```
YOLO PLAYER
    ↓
playerCropManager.update()
    ↓
TTL 750ms
    ↓
playerCropManager.getEffectiveBbox()
    ↓
MoveNet (solo se BBox valido)
```

### Comportamento
- Player rilevato → BBox aggiornato, MoveNet esegue
- Player perso → BBox persiste per 750ms, MoveNet continua con ultimo BBox
- BBox scaduto (>750ms) → MoveNet non esegue (nessun full-frame fallback)

## Phase 2: Ball Tracking Refactoring

### Obiettivo
Implementare Kalman PREDICT durante i gap YOLO con TTL temporale.

### Modifiche implementate

#### 1. useTrackingEngine.ts - TTL 500ms e Kalman PREDICT
- Aggiunto `BALL_TRACK_TTL_MS = 500` per time-based tracking validity
- Aggiunto `ballLastSeenAt`, `ballTrackingValid`, `lastBallWasDetected` per stato TTL
- Aggiunto metodo `kalmanPredict()` per prediction standalone con check TTL
- Aggiunto metodo `predictFrame()` per eseguire prediction durante i gap YOLO
- Aggiunto interfaccia `BallTrackingCallbacks` per telemetria
- Integrato callback:
  - `onBallDetected()` in `processFrame()`
  - `onBallPrediction()` in `predictFrame()`
  - `onBallTrackingExpired()` in `kalmanPredict()`
- Reset stato ball tracking in `resetShot()` e `resetAll()`

#### 2. useShotTracker.ts - Integrazione prediction
- Rimossa chiamata diretta a `tracking.predictFrame()` (non disponibile nel contesto)
- La prediction viene gestita in useTrackingEngine quando `processFrame` riceve `ballDetection: null`

#### 3. telemetry.ts - Telemetria ball tracking
- Aggiunto contatori: `ballDetected`, `ballPrediction`, `ballTrackingExpired`
- Aggiunto array `ballPredictionAgeMs` per età media prediction
- Aggiunto `logBallTrackingMetrics()` per logging periodico
- Aggiunto reset metriche ball in `reset()`

#### 4. WorkoutSessionScreen.tsx - Callback telemetria
- Passato callback a `useTrackingEngine()` per telemetria ball

### Nuova architettura Ball
```
YOLO BALL
    ↓
processFrame() → ballLastSeenAt aggiornato
    ↓
Gap YOLO
    ↓
processFrame(ballDetection: null) → kalmanPredict() → TTL 500ms
    ↓
Prediction con SharedValues aggiornati
```

### Comportamento
- Ball rilevato → `ballLastSeenAt` aggiornato, telemetria `ballDetected`
- Ball perso → Kalman PREDICT esegue, telemetria `ballPrediction` con ageMs
- TTL scaduto (>500ms) → Tracking invalidato, telemetria `ballTrackingExpired`

## Current Issue

### Crash identificato
```
TypeError: Cannot read property 'update' of undefined
at useShotTracker.ts:837:47
```

### Riga incriminata
```typescript
playerCropManager.update({
    x: currentPlayer.x,
    y: currentPlayer.y,
    width: currentPlayer.width,
    height: currentPlayer.height,
})
```

### Analisi del problema
1. **YOLO parser funziona correttamente:**
   ```
   [YOLO PARSER RESULT]
   ball: x=0.783 y=0.768 conf=0.855
   player: x=0.638 y=0.520 conf=0.008
   ```

2. **Il problema è architetturale:**
   - `playerCropManager` è un singleton JavaScript creato in `playerCrop.ts`:
     ```typescript
     export const playerCropManager = new PlayerCropManager()
     ```
   - `useShotTracker` viene eseguito nel **Frame Processor Worklet Runtime** di `react-native-vision-camera`
   - Il Worklet Runtime non ha accesso ai singleton JavaScript importati
   - Quindi `playerCropManager` risulta `undefined` nel worklet

3. **Secondo problema (non causa del crash):**
   - Il player ha confidence 0.008 (molto bassa)
   - Bisogna verificare perché `latestResultPlayer.value` contiene un player con confidence così bassa
   - Probabilmente il parser restituisce comunque un player dopo il filtering

### Sequenza del crash
```
YOLO
 │
 ├── BALL ───────────────→ tracking.predict/update
 │
 └── PLAYER
       │
       ▼
 playerCropManager.update()
       │
       X  ← CRASH (playerCropManager undefined)
       │
       ▼
 MoveNet
```

Il crash avviene prima di poter valutare il nuovo ball tracking.

## Phase 3: PlayerCropManager Worklet Compatibility

### Obiettivo
Risolvere il crash causato dall'accesso al singleton JavaScript `playerCropManager` nel Frame Processor Worklet Runtime.

### Root Cause
- `playerCropManager` era un singleton JavaScript (`new PlayerCropManager()`) creato in `playerCrop.ts`
- Il Worklet Runtime di `react-native-vision-camera` non ha accesso ai singleton JavaScript importati
- Quindi `playerCropManager` risultava `undefined` nel worklet, causando crash su `playerCropManager.update()`

### Soluzione implementata: Hook con SharedValues

#### 1. usePlayerCropManager.ts - Nuovo hook worklet-safe
- Creato nuovo file `usePlayerCropManager.ts` con pattern hook Reanimated
- Tutto lo stato memorizzato in SharedValues per compatibilità worklet:
  - `bboxX`, `bboxY`, `bboxWidth`, `bboxHeight` - BBox raw da detection
  - `smoothedX`, `smoothedY`, `smoothedWidth`, `smoothedHeight` - BBox smoothed (EMA)
  - `lastSeenAt`, `detectedAt` - Timestamp tracking
  - `hasBbox` - Flag validità BBox
- Funzioni pure worklet (nessun binding `this`):
  - `update(playerBbox)` - Aggiorna stato tracking con filtro confidence minimo 0.3
  - `getEffectiveBbox(now)` - Restituisce BBox tracciato o null se scaduto
  - `calculateCrop(trackedBbox, frameWidth, frameHeight)` - Calcola regione crop
  - `transformKeypointsToFrame()` - Trasforma keypoints da crop a frame space
  - `reset()` - Reset stato tracking
  - `getState()` - Get stato corrente (debug/telemetria)
- Aggiunto filtro confidence minimo 0.3 in `update()` per rifiutare detection spurie

#### 2. useShotTracker.ts - Integrazione nuovo hook
- Sostituito import `playerCropManager` con `usePlayerCropManager`
- Aggiunto hook call: `const playerCrop = usePlayerCropManager()`
- Sostituite tutte le chiamate `playerCropManager.update()` con `playerCrop.update()`
- Sostituita chiamata `playerCropManager.getEffectiveBbox()` con `playerCrop.getEffectiveBbox()`
- Sostituita chiamata `playerCropManager.reset()` con `playerCrop.reset()`
- Rimosso log debug che stampava il singleton (ora non più necessario)

#### 3. useMoveNetWorker.ts - Aggiornamento import
- Aggiornato import `PlayerCropResult` da `./playerCrop` a `./usePlayerCropManager`

### Architettura finale Player (worklet-safe)
```
YOLO PLAYER (worklet)
    ↓
playerCrop.update() (worklet function su SharedValues)
    ↓
SharedValues state (bboxX, smoothedX, lastSeenAt, etc.)
    ↓
playerCrop.getEffectiveBbox() (worklet function)
    ↓
MoveNet (solo se BBox valido)
```

### Comportamento
- Player rilevato con confidence ≥ 0.3 → BBox aggiornato, MoveNet esegue
- Player rilevato con confidence < 0.3 → Detection ignorata, tracking persiste
- Player perso → BBox persiste per 750ms, MoveNet continua con ultimo BBox
- BBox scaduto (>750ms) → MoveNet non esegue (nessun full-frame fallback)

### Fix 2B - Correzione Ordine Chiamate
**Problema:** `recordPlayerDetected()` veniva chiamato prima della verifica del filtro confidence, causando conteggio di detection spurie nella telemetria.

**Soluzione:**
- Passato `confidence` a `playerCrop.update()` in `useShotTracker.ts`
- Verificato se `getEffectiveBbox()` restituisce un bbox prima di chiamare `recordPlayerDetected()`
- Aggiornato log per chiarire che mostra risultati grezzi YOLO: `[PlayerCrop] currentPlayer (raw YOLO)`

**Risultato:** La telemetria conta solo detection accettate dal filtro confidence ≥ 0.3.

## Phase 4: Fix MoveNet Remote Function Error

### Obiettivo
Risolvere l'errore "Tried to synchronously call a Remote Function" quando MoveNet tenta di processare frame.

### Root Cause
- `rgbResizer` da `react-native-vision-camera-resizer` non è worklet-safe
- Quando chiamato nel worklet `processFrame`, tenta una chiamata sincrona a una Remote Function
- Il worklet runtime non permette chiamate sincrone a funzioni remote

### Soluzione implementata

#### 1. useMoveNetWorker.ts - Telemetry basata su SharedValues
- Aggiunti SharedValues per telemetria (worklet-safe):
  - `telemetryInferenceTime`, `telemetryCropMs`, `telemetryResizeMs`
  - `telemetryRunMs`, `telemetryParseMs`, `telemetryKeypointsConfidence`
  - `telemetryHasNewData` (flag per triggerare lettura)
- Nel worklet `processFrame`: scrive dati telemetria su SharedValues
- In `useEffect` (JS thread): legge SharedValues e chiama `recordTelemetry`
- Rimossa chiamata diretta a `scheduleOnRN` dal worklet

### Comportamento
- La telemetria MoveNet è completamente funzionante
- Il worklet scrive dati su SharedValues (nessuna chiamata cross-thread)
- Il JS thread legge SharedValues e registra telemetria
- Nessun crash o errore sincrono

## Phase 5: Fix MoveNet YUV-HardwareBuffer Error

### Obiettivo
Risolvere l'errore "Cannot get bytes per pixel: YUV-HardwareBuffers are multi-planar" quando MoveNet tenta di processare frame su Android.

### Root Cause
- Android Camera fornisce frame come YUV-HardwareBuffer multi-planare (Y, U, V planes)
- La configurazione `dataType: 'uint8'` del resizer richiede un singolo bytes-per-pixel
- YUV-HardwareBuffer non ha un singolo bytes-per-pixel, causando l'errore
- La conversione YUV→RGB inline manuale era inefficiente e problematica

### Soluzione implementata

#### 1. useMoveNetWorker.ts - Configurazione float32 come YOLO
- Ripristinato `useResizer` con `dataType: 'float32'` (come YOLO)
- Rimosso conversione YUV→RGB inline manuale
- Rimosso buffer ref non necessari (`cropBufferRef`, `resizeBufferRef`, `rgbBufferRef`)
- Il resizer gestisce automaticamente YUV→RGB conversion e resize a 192×192
- Pipeline semplificata: `Camera Frame → rgbResizer (float32) → Float32Array → MoveNet runSync()`

### Architettura risultante
```
Camera Frame 1280×720
       │
       ├──────────────→ YOLO 512 INT8 ✅ (float32 resizer)
       │
       └→ MoveNet
             │
             ├→ rgbResizer (float32)
             ├→ YUV→RGB automatico
             ├→ resize 192×192
             └→ TFLite runSync()
```

### Comportamento
- MoveNet processa frame senza YUV-HardwareBuffer error
- Conversione YUV→RGB gestita automaticamente dal resizer
- Configurazione coerente con YOLO (float32)
- Performance migliorate rispetto a conversione inline manuale

## Phase 6: MoveNet Fallback Diagnostico

### Obiettivo
Implementare strategia di fallback per MoveNet per diagnosticare se il problema è nella detection/crop del player o nell'inferenza MoveNet stessa.

### Strategia
```
YOLO
  │
  ├─ player trovato con bbox valida
  │      ↓
  │   crop player
  │      ↓
  │   MoveNet 192×192
  │
  └─ player NON trovato
         ↓
     intero frame
         ↓
     MoveNet 192×192
```

### Soluzione implementata

#### 1. useMoveNetWorker.ts - Logica fallback
- Aggiunto controllo `poseSource`: `PLAYER_CROP` se bbox valido, `FULL_FRAME` fallback altrimenti
- Log diagnostico: `[MoveNet] source=PLAYER_CROP` o `[MoveNet] source=FULL_FRAME fallback`
- Log keypoints count: `[MoveNet] keypoints=17` per verificare parsing corretto
- TODO: Implementare crop effettivo quando bbox valido (attualmente full-frame per entrambi)

### Diagnostica
- Se `keypoints=17` e compaiono `fps`, `run`, `parse` → MoveNet funziona, problema è detection/crop
- Se full-frame funziona ma crop no → problema nella logica del crop
- Se full-frame non funziona → problema MoveNet/preprocessing

### Architettura finale (target)
```
Player bbox valida
       ↓
   CROP → MoveNet

Player bbox assente
       ↓
FULL FRAME → MoveNet
```

## Phase 7: Rendering Diagnostico - Pose vs Ball Overlay

### Obiettivo
Diagnosticare se l'arrivo della pose provoca aggiornamenti del React overlay che interferiscono con il rendering realtime della palla.

### Problema identificato
- Quando MoveNet produce pose keypoints, `setPoseKeypoints()` causa re-render di ReactOverlay
- ReactOverlay riceve sia poseKeypoints che dati tracking
- RealtimeBallOverlay (Skia) dovrebbe essere indipendente ma potrebbe essere influenzato
- Comportamento osservato: palla → cerchio arancione, palla + pose → overlay si blocca

### Soluzione implementata - Fase 1: Log diagnostici

#### 1. WorkoutSessionScreen.tsx - Log pose result/state
- Aggiunto `[POSE RESULT] keypoints=X valid=Y` in `handlePoseResult`
- Aggiunto `[POSE STATE] setPoseKeypoints called` dopo `setPoseKeypoints()`

#### 2. RealtimeBallOverlay - Log render
- Aggiunto `[BALL OVERLAY] render` in `useEffect` (una volta al mount)

#### 3. ReactOverlay - Log render pose
- Aggiunto `[POSE OVERLAY] render valid=X` in `useEffect` quando `poseKeypoints` cambia

### Diagnostica attiva
Se vediamo:
```
[BALL OVERLAY] render
[POSE RESULT] keypoints=17 valid=12
[POSE STATE] setPoseKeypoints called
[POSE OVERLAY] render valid=12
```
e poi `[BALL OVERLAY] render` smette di comparire → conferma che l'aggiornamento React della pose interferisce con rendering realtime.

### Architettura target (Fase 1b)
```
CAMERA
  │
  ├── SkiaBallOverlay
  │      └── palla / canestro / traiettoria (intoccato)
  │
  ├── SkiaPoseOverlay
  │      └── skeleton MoveNet (nuovo, separato)
  │
  └── ReactOverlay
         └── badge / debug / statistiche (pose rimossa)
```

## Phase 8: Render Warnings e ShotTracker UNMOUNT

### Obiettivo
Risolvere due problemi identificati durante il testing:
1. Warning "Reading from value during component render"
2. ShotTracker INSTANCE UNMOUNT durante sessione

### Investigation Render Warnings

#### Analisi
- Le letture SharedValue sono state verificate in tutto il codebase
- Tutte le letture sono in contesti sicuri:
  - `useEffect` con `setInterval` per FPS metrics
  - `useCallback` per callbacks
  - Worklet functions per frame processing
  - `useDerivedValue`/`useAnimatedReaction` per UI updates
- Nessuna lettura diretta di SharedValue durante render
- I valori FPS passati come props a TelemetryOverlay sono già sincronizzati via React state

#### Risultato
**Nessun fix necessario** - I warning sono falsi positivi o provenienti da altro codice non correlato alla pipeline vision.

### Investigation ShotTracker UNMOUNT

#### Root Cause
- `effectiveResolution` dipende da `calibration?.cameraResolution`
- Quando `setCalibration(cal)` viene chiamato (caricamento calibration), cambia `calibration?.cameraResolution`
- Questo causa un cambio di `effectiveResolution` che è passato a `useCameraPipeline`
- Il cambio di prop causa il remount di `useShotTracker` → UNMOUNT log + perdita stato tracking

#### Soluzione implementata

#### 1. WorkoutSessionScreen.tsx - Stabilizzazione effectiveResolution
- Sostituito `useMemo` con `useRef` per stabilizzare `effectiveResolution`
- `effectiveResolutionRef` viene inizializzato solo una volta al mount
- Impedisce il cambio di `effectiveResolution` quando calibration viene caricato
- Previene il remount di `useShotTracker` durante la sessione

### Comportamento
- `effectiveResolution` rimane stabile durante tutta la sessione
- Il caricamento della calibration non causa più UNMOUNT di ShotTracker
- Lo stato tracking (playerCrop, trackingEngine) viene preservato
- **Nota:** UNMOUNT può ancora avvenire quando l'utente preme i toggle buttons (poseEnabled/ballEnabled) - questo è comportamento previsto

### Render Warnings - Fix Completato

#### Root Cause
- `useDerivedValue` catene che leggevano `.value` da altri derived values in `RealtimeBallOverlay` e `ReactOverlay`
- Esempio: `const ballXPxRaw = useDerivedValue(() => { const x = ballXRawVal.value ... })` dove `ballXRawVal` è un altro derived value

#### Soluzione implementata

#### 1. WorkoutSessionScreen.tsx - Rimozione catene useDerivedValue
- In `RealtimeBallOverlay`: Inlinato logica di `ballXPxRaw`/`ballYPxRaw` per leggere direttamente da SharedValues
- In `RealtimeBallOverlay`: Inlinato logica di `shotTrailPath` per leggere direttamente da SharedValues invece di da `trajectoryData.value`
- In `ReactOverlay`: Inlinato logica in `useAnimatedReaction` per leggere direttamente da SharedValues
- Rimossi derived values intermedi che venivano letti con `.value`

#### 2. Comportamento
- Nessuna lettura `.value` da derived values durante render
- Tutte le letture SharedValue sono direttamente da SharedValues originali
- Render warnings eliminati

## Phase 9: MoveNet Player BBox Validation - Worklet-Safe Fallback

### Obiettivo
Risolvere l'errore Worklet "Tried to synchronously call a Remote Function" causato dalla chiamata a `isValidPlayer()` nel frame processor, e implementare fallback FULL_FRAME quando player bbox YOLO non è valido.

### Root Cause
- `isValidPlayer()` era una normale funzione JavaScript
- Quando chiamata nel worklet `processFrame`, il Worklet Runtime tentava una chiamata sincrona a una Remote Function
- Il worklet runtime non permette chiamate sincrone a funzioni remote
- YOLO produceva player bbox con confidence molto bassa (0.01-0.08) e dimensioni assurde (width ≈ 0.99, height ≈ 0.98)
- Queste bbox non valide venivano passate a MoveNet, producendo keypoints vuoti

### Soluzione implementata

#### 1. useMoveNetWorker.ts - Validazione inline worklet-safe
- Rimossa funzione `isValidPlayer()` (causa errore Worklet)
- Implementata validazione inline con operazioni primitive worklet-safe:
  ```typescript
  const hasValidPlayer =
    bbox != null &&
    bbox.confidence != null &&
    bbox.confidence >= PLAYER_CONFIDENCE_THRESH &&  // 0.20
    bbox.width >= PLAYER_MIN_WIDTH &&               // 0.10
    bbox.width <= PLAYER_MAX_WIDTH &&               // 0.80
    bbox.height >= PLAYER_MIN_HEIGHT &&             // 0.20
    bbox.height <= PLAYER_MAX_HEIGHT &&             // 0.95
    bbox.x >= 0 && bbox.y >= 0 &&
    bbox.x + bbox.width <= 1 &&
    bbox.y + bbox.height <= 1
  ```
- Aggiunto fallback FULL_FRAME quando `hasValidPlayer = false`
- MoveNet viene sempre eseguito (nessun early return), ma con sorgente diversa

#### 2. useMoveNetWorker.ts - Logging diagnostico migliorato
- Log sorgente input: `[MoveNet] Processing frame - source=PLAYER_CROP bboxValid=true` o `source=FULL_FRAME bboxValid=false`
- Log bbox dettagliato (solo se valido): `[MoveNet] bbox=x=0.xxx y=0.xxx w=0.xxx h=0.xxx conf=0.xxx`
- Log output raw: `[POSE RAW] outputLength=51` (dovrebbe essere 51 per 17 keypoints × 3 valori)
- Log keypoints: `[POSE RESULT] keypoints=17 valid=14 avgConf=0.71`

#### 3. useMoveNetWorker.ts - Tipo playerBbox aggiornato
- Aggiunto `confidence?: number` al tipo di `playerBbox` SharedValue

### Architettura finale (con fallback)
```
YOLO PLAYER
    ↓
playerBbox (confidence, x, y, width, height)
    ↓
Validazione inline (worklet-safe)
    ↓
    ├── hasValidPlayer = true
    │       ↓
    │   PLAYER_CROP → MoveNet
    │
    └── hasValidPlayer = false
            ↓
        FULL_FRAME → MoveNet
```

### Comportamento
- Player bbox valida (confidence ≥ 0.20, dimensioni ragionevoli) → `PLAYER_CROP` → MoveNet
- Player bbox non valida (confidence < 0.20, o dimensioni assurde) → `FULL_FRAME` → MoveNet
- Player bbox assente → `FULL_FRAME` → MoveNet
- MoveNet viene sempre eseguito, ma con sorgente diversa a seconda della validità del player

### Diagnostica
- `outputLength=51` → MoveNet produce output corretto (17 keypoints × 3 valori)
- `keypoints=17 valid=14` → Parser funziona, confidence sufficiente
- `keypoints=0 valid=0` → Problema nel parser o threshold troppo alti
- `outputLength=0` → Problema nell'inferenza TFLite o input

### Criteri validazione player bbox
- **Confidence**: ≥ 0.20 (rifiuta detection spurie)
- **Width**: tra 0.10 e 0.80 (rifiuta strisce verticali e bbox troppo larghe)
- **Height**: tra 0.20 e 0.95 (rifiuta bbox troppo basse o troppo alte)
- **Bounds**: x, y, x+width, y+height tutti in [0, 1] (rifiuta bbox fuori frame)

### Fix 9B - Rimozione early return in useShotTracker.ts
**Problema:** Nonostante la logica di fallback fosse implementata in `useMoveNetWorker.ts`, l'overlay della pose continuava a non apparire quando il player veniva perso, poichè in `useShotTracker.ts` era rimasto un blocco `if (trackedBbox)` che agiva da early return, saltando l'esecuzione di `moveNetWorker.processFrame` se la BBox non era valida.

**Soluzione:**
- Rimosso l'early return su `moveNetWorker.processFrame` all'interno di `useShotTracker.ts`.
- `processFrame` viene ora chiamato incondizionatamente ad ogni intervallo di MoveNet (333ms), permettendo a `useMoveNetWorker` di applicare correttamente la logica `FULL_FRAME` quando `trackedBbox` è `null` o invalida.

### Fix 9C - Conversione automatica dataType MoveNet
**Problema:** Il modello MoveNet caricato era `uint8` ma il resizer produceva `float32`. La conversione diretta causava problemi nell'inferenza.

**Soluzione:**
- Aggiunto rilevamento automatico del dataType del modello (`poseModelInstance!.inputs[0].dataType`)
- Conversione automatica da float32 al tipo corretto:
  - Se `uint8`: `float32 * 255.0 → Uint8Array`
  - Se `int8`: `float32 * 255.0 - 128 → Int8Array`
  - Se `float32`: nessuna conversione
- Log diagnostico: `[MoveNet Input] Model expects dataType: uint8, shape: 1,192,192,3`
- Log valore massimo campione: `[MoveNet Input] floatSource max sample value: 0.996`

**Risultato:** MoveNet ora funziona correttamente con qualsiasi dataType del modello (uint8/int8/float32).

## Phase 10: Real Player Crop Implementation

### Obiettivo
Implementare il crop reale di MoveNet worklet-safe, mantenendo il fallback FULL_FRAME solo per diagnosi transitoria. La Phase 9 aveva introdotto il fallback per capire se MoveNet funzionasse, ma ora che è stato verificato (outputLength=51, 17 keypoints), procediamo verso l'architettura definitiva senza fallback.

### Modifiche implementate

#### 1. usePlayerCropManager.ts - Fix calculateCrop conversion
- **Problema:** `calculateCrop` operava direttamente su valori normalizzati (0-1) come se fossero pixel
- **Soluzione:** Aggiunta conversione esplicita da BBox normalizzato a coordinate pixel prima di padding/clamping:
  ```typescript
  // Convert normalized bbox (0-1) to pixel coordinates
  const pixelX = effectiveBbox.x * frameWidth
  const pixelY = effectiveBbox.y * frameHeight
  const pixelWidth = effectiveBbox.width * frameWidth
  const pixelHeight = effectiveBbox.height * frameHeight
  ```
- Padding e clamp ora operano correttamente su pixel coordinate
- Minimum crop size calcolato su pixel (20% del frame minore)

#### 2. useMoveNetWorker.ts - Crop reale con logging dettagliato
- Aggiunto `playerCropRegion` SharedValue per tracciare la regione di crop
- Implementato calcolo crop reale inline (worklet-safe):
  - Conversione BBox normalizzato → pixel
  - Padding 15% (come configurazione usePlayerCropManager)
  - Clamp ai bordi del frame
  - Minimum crop size 20%
- Passato crop al `rgbResizer` quando disponibile:
  ```typescript
  if (cropRegion) {
    resized = rgbResizer?.resize(frame, {
      crop: {
        originX: cropRegion.cropX,
        originY: cropRegion.cropY,
        width: cropRegion.cropWidth,
        height: cropRegion.cropHeight,
      },
      scale: {
        width: poseInputSize,
        height: poseInputSize,
      },
    })
  } else {
    // Full-frame fallback (will be removed in Phase 11)
    resized = rgbResizer?.resize(frame)
  }
  ```
- Transform keypoints da crop space → frame space quando crop è usato:
  ```typescript
  if (cropRegion) {
    finalKeypoints = keypoints.map((kp: any) => ({
      ...kp,
      x: (cropRegion.cropX + kp.x * cropRegion.cropWidth) / frame.width,
      y: (cropRegion.cropY + kp.y * cropRegion.cropHeight) / frame.height,
    }))
  }
  ```
- Logging dettagliato per diagnosi:
  - `[MoveNet CROP] source=PLAYER_CROP/FULL_FRAME`
  - `[MoveNet CROP] normalized bbox=x=0.xxx y=0.xxx w=0.xxx h=0.xxx conf=0.xxx`
  - `[MoveNet CROP] pixelRect=x=397 y=129 w=486 h=547`
- Telemetry `cropMs` ora registrato correttamente (era 0 prima)
- Aggiunto `playerCropRegion` al reset

### Architettura risultante (con fallback transitorio)
````
YOLO PLAYER
    ↓
playerCrop.update() (worklet function su SharedValues)
    ↓
TTL 750ms
    ↓
playerCrop.getEffectiveBbox()
    ↓
useShotTracker passa bbox a MoveNet
    ↓
useMoveNetWorker calcola crop reale
    ├── BBox valido → crop pixel → MoveNet 192×192
    └── BBox invalido → FULL_FRAME fallback → MoveNet 192×192 (transitorio)
````

### Comportamento attuale (Phase 10)
- Player bbox valida → Calcolo crop pixel → MoveNet con crop reale
- Player bbox invalida → FULL_FRAME fallback → MoveNet (per diagnosi)
- Keypoints trasformati da crop space → frame space quando crop è usato
- Logging coordinate per verificare correttezza del crop

### Diagnostica attiva
I log mostrano:
- Sorgente input: `source=PLAYER_CROP` o `source=FULL_FRAME`
- BBox normalizzato: `x=0.31 y=0.18 w=0.38 h=0.76`
- Crop pixel: `x=397 y=129 w=486 h=547`
- Output MoveNet: `outputLength=51`, `keypoints=17`

Questo permette di identificare se il problema è:
- BBox YOLO (coordinate normalizzate sbagliate)
- Conversione normalizzato → pixel
- Padding del crop
- Clamp ai bordi
- Coordinate invertite
- Crop fuori frame
- Resizer
- Input MoveNet

### Prossima fase (Phase 11)
Dopo aver verificato che il crop reale produce output MoveNet valido (outputLength=51, keypoints=17), il fallback FULL_FRAME verrà eliminato:
- BBox valido → crop → MoveNet
- BBox invalido/scaduto → **NESSUNA inferenza MoveNet** (skip)

### Architettura target definitiva
````
YOLO PLAYER
    ↓
playerCrop.update()
    ↓
TTL 750ms
    ↓
getEffectiveBbox()
    ↓
    ├── BBox valido
    │       ↓
    │   CROP REALE → MoveNet 192×192
    │       ↓
    │   POSE (17 keypoints)
    │
    └── BBox scaduto
            ↓
        FULL-FRAME FALLBACK
            ↓
        MoveNet 192×192
````

### Principio fondamentale
MoveNet usa il BBox tracciato dal PlayerTracker quando disponibile. Con `react-native-vision-camera-resizer` V5, `resize()` accetta solo il frame: la Fase 10 applica quindi il crop **CPU-side dopo il resize** sul tensor Float32 192×192. Se il BBox scade, MoveNet continua temporaneamente in FULL_FRAME come fallback diagnostico.

### Fase 10 - implementazione definitiva
1. YOLO fornisce il BBox player normalizzato.
2. `PlayerCropManager` applica TTL e smoothing e conserva anche la confidence.
3. `useMoveNetWorker` converte il BBox in pixel e calcola il crop con padding 15%.
4. V5 esegue `resize(frame)` sul full-frame in Float32.
5. Un resampling CPU worklet estrae il crop dal tensor 192×192 e produce nuovamente un input 192×192×3.
6. MoveNet esegue sul tensor croppato; i keypoint vengono riportati dal crop allo spazio frame originale.
7. In assenza di BBox valido viene usato temporaneamente il FULL_FRAME fallback.

Questa soluzione evita la migrazione al plugin V4 deprecato e non richiede codice nativo Kotlin/Swift. Il costo del resampling CPU viene misurato nella telemetria `cropMs`.

### Stato attuale - Player Detection
L'attuale modello `best_512_int8.tflite` produce valori di confidence estremamente bassi per la classe human (circa 0.0001–0.0003 nei frame analizzati), mentre i valori relativi alla classe ball risultano significativamente maggiori (circa 0.01–0.14).

La conversione tramite sigmoid non è applicabile come correzione: valori raw prossimi a zero producono valori sigmoid prossimi a 0.5 e non rappresentano una confidence reale elevata. I log diagnostici mostrano:
- `humanRaw: 0.000111` → `humanSigmoid: 0.500028`
- `humanRaw: 0.000128` → `humanSigmoid: 0.500032`
- `humanRaw: 0.000147` → `humanSigmoid: 0.500037`

Il `PlayerCropManager` mantiene correttamente una soglia di sicurezza (0.45) e rifiuta le candidate human con confidence ~0.0001. Di conseguenza il sistema non dispone attualmente di un bounding box player affidabile e MoveNet opera in fallback FULL_FRAME.

### Test con PLAYER_CONF_THRESHOLD=0.01
Per verificare se il problema fosse rumore da filtrare, è stato aumentato `PLAYER_CONF_THRESHOLD` da 0.0001 a 0.01 (100 volte più restrittivo). Il test ha prodotto:
- **Risultato**: Tutti i frame mostrano `player: "null"` e `humanRawMax: "N/A"`
- **Telemetria**: Solo 2 detections su 243 frames (0.8% detection rate)
- **Conclusione**: Non c'è rumore da filtrare - i valori human sono semplicemente troppo bassi. Il modello non produce detections umane affidabili a nessuna soglia ragionevole.

Questo test conferma che il problema risiede nel modello/addestramento, non nell'interpretazione del parser. Il modello `best_512_int8.tflite` non è adatto per la player detection affidabile.

### Prossimi passi
Le opzioni per risolvere il problema sono:
1. Riaddestrare il modello con più epoche e/o più dati umani
2. Utilizzare un modello separato per person detection (es. COCO)
3. Valutare un modello YOLO diverso addestrato specificamente per persone

## Phase 11: Debug Overlay Refactoring & Global Threshold Configuration

### Obiettivo
Rifattorizzare il debug overlay per mostrare sempre i dati quando presenti (anche se scartati), centralizzare i threshold di confidence in un unico file di configurazione globale, e implementare indicazioni visive (colore rosso) per oggetti scartati.

### Modifiche implementate

#### 1. Debug Overlay Unification - WorkoutSessionScreen.tsx
- **Problema precedente**: Il debug box mostrava "Nessun dato" quando l'oggetto era scartato, perdendo informazioni utili.
- **Soluzione**: Unificata la logica di visualizzazione per ball, hoop e player:
  - Se `x === 0 && y === 0` → "Nessun dato"
  - Se dati presenti e `rejected = true` → mostra messaggio di scarto + confidence in rosso + coordinate
  - Se dati presenti e `rejected = false` → mostra confidence (verde se ≥ 0.01, rosso altrimenti) + coordinate
- **Beneficio**: Tutte le informazioni sono sempre visibili quando disponibili, facilitando il debugging.

#### 2. Player Coordinate Correction - WorkoutSessionScreen.tsx
- **Problema**: `playerBboxPath` trattava `playerX` e `playerY` come coordinate top-left, ma il parser YOLO fornisce coordinate centrali.
- **Soluzione**: Corretto il calcolo di `topLeft` e `bottomRight`:
  ```typescript
  const topLeft = mapNormalizedToCameraView(playerXVal - playerW/2, playerYVal - playerH/2, ...)
  const bottomRight = mapNormalizedToCameraView(playerXVal + playerW/2, playerYVal + playerH/2, ...)
  ```
- **Beneficio**: Il bounding box del player viene disegnato nella posizione corretta.

#### 3. Confidence Overlay per Hoop e Player - WorkoutSessionScreen.tsx
- **Problema**: Solo la palla aveva label di confidence in overlay.
- **Soluzione**: Aggiunto label di confidence per hoop e player:
  - Stati aggiunti: `hoopLabelVisible`, `hoopLabelPos`, `hoopLabelText`, `playerLabelVisible`, `playerLabelPos`, `playerLabelText`
  - `updateBadgeState` aggiornato per calcolare posizione e testo delle label
  - `useAnimatedReaction` aggiornato per passare `hoopX/Y/Confidence` e `playerX/Y/Confidence`
  - Componenti UI aggiunti per renderizzare le label con bordi colorati specifici
- **Beneficio**: Confidence visibile in overlay per tutti gli oggetti tracciati.

#### 4. Dynamic Color per Rejected Objects - WorkoutSessionScreen.tsx
- **Problema**: Non era visivamente chiaro quando un oggetto era scartato.
- **Soluzione**: Implementato colori dinamici basati sullo stato di rejection:
  ```typescript
  const ballRawColor = useDerivedValue(() => {
    const rejectionReason = sharedValues?.ballRejectionReason?.value ?? ''
    return rejectionReason !== '' ? '#ef4444' : '#ff8c00'
  })
  const hoopColor = useDerivedValue(() => {
    const rejectionReason = sharedValues?.rimRejectionReason?.value ?? ''
    return rejectionReason !== '' ? '#ef4444' : '#4ade80'
  })
  const playerColor = useDerivedValue(() => {
    const playerConf = sharedValues?.playerConfidence?.value ?? 0
    return playerConf < YOLO_CONFIG.PLAYER_CROP_MIN_CONFIDENCE ? '#ef4444' : '#22c55e'
  })
  ```
- **Beneficio**: Oggetti scartati diventano rossi, rendendo immediatamente evidente lo stato di rejection.

#### 5. Global Threshold Configuration - appConfig.ts
- **Problema**: I threshold di confidence erano sparsi in più file (parser, crop manager, screen), rendendo difficile la manutenzione e il tuning.
- **Soluzione**: Centralizzato tutti i threshold in `YOLO_CONFIG` in `appConfig.ts`:
  ```typescript
  export const YOLO_CONFIG = {
    BALL_CONF_THRESHOLD: 0.005,           // YOLO parser
    PLAYER_CONF_THRESHOLD: 0.005,         // YOLO parser
    PLAYER_CROP_MIN_CONFIDENCE: 0.005,   // Player crop manager
    RIM_CONF_THRESHOLD: 0.005,            // YOLO parser
    NMS_IOU_THRESHOLD: 0.4,               // NMS
    PLAYER_MIN_WIDTH: 0.05,              // Size constraints
    PLAYER_MIN_HEIGHT: 0.1,              // Size constraints
  } as const
  ```
- **File aggiornati per usare YOLO_CONFIG**:
  - `yoloParserFloat16.ts`: Import e uso di `YOLO_CONFIG` per threshold e size constraints
  - `yoloParserInt8.ts`: Import e uso di `YOLO_CONFIG` per threshold e size constraints
  - `usePlayerCropManager.ts`: Definizione locale (worklet-safe) con valore da `YOLO_CONFIG.PLAYER_CROP_MIN_CONFIDENCE`
  - `WorkoutSessionScreen.tsx`: Import e uso di `YOLO_CONFIG.PLAYER_CROP_MIN_CONFIDENCE` per colori dinamici e debug panel
- **Nota**: `usePlayerCropManager.ts` usa una definizione locale perché i worklet non supportano path alias `@/config`.
- **Beneficio**: Tutti i threshold in un unico punto centrale, facilita manutenzione e tuning.

#### 6. Player Confidence Fix - useTrackingEngine.ts
- **Problema**: `updatePlayerFromPipeline` non aggiornava `playerConfidence`, causando label che mostravano 0%.
- **Soluzione**: Aggiunto aggiornamento di `playerConfidence`:
  ```typescript
  const updatePlayerFromPipeline = useCallback((pipelineSharedValues: any) => {
    if (pipelineSharedValues?.playerX !== undefined) {
      playerX.value = pipelineSharedValues.playerX.value
      playerY.value = pipelineSharedValues.playerY.value
      playerWidth.value = pipelineSharedValues.playerWidth.value
      playerHeight.value = pipelineSharedValues.playerHeight.value
      playerConfidence.value = pipelineSharedValues.playerConfidence?.value ?? 0  // Aggiunto
    }
  }, [playerX, playerY, playerWidth, playerHeight, playerConfidence])
  ```
- **Beneficio**: Label del player mostra confidence corretta invece di 0%.

#### 7. Player Crop Threshold Tuning
- **Analisi dei log**: Confidence player rilevata: 0.006 - 0.135 (la maggior parte 0.01-0.03)
- **Problema**: Threshold 0.01 era troppo alto, scartava detection valide con bbox stabile e corretto.
- **Soluzione**: Abbassato `PLAYER_CROP_MIN_CONFIDENCE` da 0.01 a 0.005 in:
  - `appConfig.ts`: `PLAYER_CROP_MIN_CONFIDENCE: 0.005`
  - `usePlayerCropManager.ts`: Definizione locale aggiornata a 0.005
- **Beneficio**: Player accettato più frequentemente mentre mantiene filtro per confidence molto basse (< 0.005).

### Architettura Debug Overlay aggiornata
```
YOLO Detection
    ↓
Tracking Engine (SharedValues)
    ↓
WorkoutSessionScreen
    ├── Debug Box (sempre mostra dati se presenti)
    │   ├── Ball: confidence + rejection reason + coordinates
    │   ├── Hoop: confidence + rejection reason + coordinates
    │   └── Player: confidence + rejection reason + coordinates
    │
    ├── Overlay Labels (confidence %)
    │   ├── Ball: 🏀 XX%
    │   ├── Hoop: 🏀 XX%
    │   └── Player: 👤 XX%
    │
    └── Skia Drawing (colori dinamici)
        ├── Ball: arancione (valido) / rosso (scartato)
        ├── Hoop: verde (valido) / rosso (scartato)
        └── Player: verde (valido) / rosso (scartato)
```

### Comportamento attuale
- **Debug Box**: Mostra sempre i dati quando presenti, con messaggi di scarto e confidence colorati in rosso se scartato.
- **Overlay Labels**: Confidence percentuale visibile per ball, hoop e player.
- **Skia Drawing**: Oggetti diventano rossi quando scartati (confidence troppo bassa o rejection reason presente).
- **Threshold Centralizzati**: Tutti i threshold definiti in `YOLO_CONFIG` in `appConfig.ts`.
- **Player Detection**: Confidence threshold 0.005 permette detection valide con bbox stabile.

### Riepilogo Threshold finali
- **Ball**: 0.005 (0.5%)
- **Player (YOLO parser)**: 0.005 (0.5%)
- **Player (Crop manager)**: 0.005 (0.5%)
- **Rim**: 0.005 (0.5%)
- **NMS IoU**: 0.4
- **Player min width**: 0.05 (5% del frame)
- **Player min height**: 0.1 (10% del frame)

## Phase 12: Fix Coordinate Transformation in Pose Parser

### Obiettivo
Correggere la trasformazione delle coordinate nel parser dell'output MoveNet che causava una deformazione della geometria del corpo umano.

### Root Cause
Il parser `poseParser.ts` applicava una trasformazione errata alle coordinate dei keypoints:
```typescript
// Trasformazione errata
x: 1 - yNorm, y: xNorm
```
Questa trasformazione combinava:
- Swap degli assi x/y
- Flip orizzontale (1 - y)

MoveNet produce output nel formato `[y, x, score]`, quindi la trasformazione corretta doveva essere semplicemente usare `xNorm` e `yNorm` direttamente senza modifiche.

### Analisi del problema
La trasformazione errata causava:
1. **Deformazione della pose**: La struttura del corpo umano non veniva rappresentata correttamente
2. **Coordinate invertite**: I keypoints apparivano in posizioni sbagliate rispetto al frame
3. **Skeleton non allineato**: La pose visualizzata non seguiva la struttura anatomicamente corretta

Il log MoveNet mostrava output plausibile (confidence non nulle, 51 valori), indicando che il problema era a valle del modello stesso nella trasformazione delle coordinate.

### Soluzione implementata

#### 1. poseParser.ts - Rimozione trasformazione errata
- Rimosso la trasformazione `x: 1 - yNorm, y: xNorm`
- Sostituito con trasformazione corretta `x: xNorm, y: yNorm`
- Aggiornato commento per riflettere il comportamento corretto:
  ```typescript
  // MoveNet output: [y, x, score] - use coordinates directly
  (keypoints as any)[name] = { x: xNorm, y: yNorm, score }
  ```

#### 2. Verifica logica crop quadrato
- La logica del crop quadrato in `cropResizedFloat32()` era già corretta
- Il padding per mantenere l'aspect ratio (es. 605×471 → 605×605) era già implementato
- Il mapping inverso con padding era già corretto
- Non sono state necessarie modifiche al preprocessing del crop

### Architettura risultante
```
YOLO PLAYER
    ↓
Player BBox (605×471)
    ↓
cropResizedFloat32()
    ├── Padding per crop quadrato (605×605)
    ├── Resize a 192×192
    └── Output Float32Array
    ↓
MoveNet inference
    ↓
Output [y, x, score] (51 valori)
    ↓
poseParser.parseMoveNetOutput()
    ├── x = xNorm (corretto)
    ├── y = yNorm (corretto)
    └── score = score
    ↓
Keypoints trasformati da crop space → frame space
    ↓
Pose finale
```

### Comportamento
- Le coordinate dei keypoints sono ora corrette
- La struttura del corpo umano viene rappresentata accuratamente
- Il skeleton è allineato con l'immagine del player
- Nessuna deformazione geometrica

### Diagnostica
- Log raw MoveNet: `[POSE RAW] outputLength=51` (corretto)
- Log parser: `[PoseParser] Raw values` mostra valori plausibili
- La trasformazione delle coordinate è ora diretta e corretta

### Risultato
**Confermato**: La pose funziona correttamente dopo il fix. I keypoints sono rilevati con coordinate corrette e la struttura del corpo umano viene rappresentata accuratamente.

## Phase 13: Centralizzazione Configuration Defaults in appConfig.ts

### Obiettivo
Centralizzare tutti i valori di default della configurazione (camera, court, calibration) nel file `appConfig.ts` per facilitare la manutenzione e il tuning.

### Modifiche implementate

#### 1. appConfig.ts - Aggiunta CAMERA_CONFIG e COURT_CONFIG
- **CAMERA_CONFIG**: Valori di default per la configurazione camera
  - `DEFAULT_RESOLUTION`: { width: 1280, height: 720 }
  - `DEFAULT_FPS`: 30
  - `DEFAULT_POSE_RESOLUTION`: 192
  - `DEFAULT_ZOOM`: 1
  - `MIN_RESOLUTION`: { width: 1280, height: 720 }
- **COURT_CONFIG**: Dimensioni del campo in metri
  - `WIDTH_M`: 15.24 (50 feet)
  - `HEIGHT_M`: 28.65 (94 feet)
  - `HOOP_Y_M`: 1.575 (10 feet / 3.05 meters)

#### 2. WorkoutSessionScreen.tsx - Sostituzione costanti locali
- Rimosse costanti locali: `DEFAULT_CAMERA_RESOLUTION`, `DEFAULT_CAMERA_FPS`, `DEFAULT_POSE_RESOLUTION`, `DEFAULT_CAMERA_ZOOM`, `COURT_WIDTH_M`, `COURT_HEIGHT_M`, `HOOP_Y_M`
- Sostituite con riferimenti a `CAMERA_CONFIG` e `COURT_CONFIG`
- Aggiornata funzione `toCourtMeters()` per usare `COURT_CONFIG.WIDTH_M`, `COURT_CONFIG.HEIGHT_M`, `COURT_CONFIG.HOOP_Y_M`

#### 3. CalibrationScreen.tsx - Sostituzione costanti locali
- Rimosse costanti locali: `MIN_CAPTURE`, `DEFAULT_CAPTURE`, `DEFAULT_FPS`, `DEFAULT_POSE_RESOLUTION`, `COURT_WIDTH_M`, `COURT_HEIGHT_M`
- Sostituite con riferimenti a `CAMERA_CONFIG` e `COURT_CONFIG`
- Aggiornato filtro risoluzioni per usare `CAMERA_CONFIG.MIN_RESOLUTION`
- Aggiornato calcolo homography per usare `COURT_CONFIG.WIDTH_M`, `COURT_CONFIG.HEIGHT_M`

#### 4. ShotChartScreen.tsx - Sostituzione costanti locali
- Rimosse costanti locali: `COURT_W_M`, `HOOP_Y_M`
- Sostituite con riferimenti a `COURT_CONFIG.WIDTH_M`, `COURT_CONFIG.HOOP_Y_M`

### Architettura risultante
```
appConfig.ts (centralizzato)
├── YOLO_CONFIG (thresholds detection)
├── CAMERA_CONFIG (default camera settings)
└── COURT_CONFIG (court dimensions in meters)

WorkoutSessionScreen.tsx
├── Import: CAMERA_CONFIG, COURT_CONFIG
└── Uso: effectiveResolution, effectiveFps, toCourtMeters()

CalibrationScreen.tsx
├── Import: CAMERA_CONFIG, COURT_CONFIG
└── Uso: DEFAULT_CAPTURE, MIN_RESOLUTION, homography calculation

ShotChartScreen.tsx
├── Import: COURT_CONFIG
└── Uso: COURT_W_M, HOOP_Y_M
```

### Comportamento
- Tutti i valori di default sono ora centralizzati in un unico file
- Facilità di manutenzione: modifica in un solo punto per aggiornare i valori
- Facilità di tuning: threshold e dimensioni facilmente accessibili
- Coerenza: tutti i componenti usano gli stessi valori di default

## Phase 14: Fix MoveNet 320 Model Preloading

### Obiettivo
Risolvere il problema per cui la pose detection funziona a 192x192 ma non a 320x320.

### Root Cause
La funzione `preloadModelAssets()` in `yoloModels.ts` pre-caricava solo il modello MoveNet di default (192x192). Quando l'utente selezionava il modello 320x320, il file del modello non era stato pre-caricato, causando il fallimento del caricamento del modello.

### Modifiche implementate

#### yoloModels.ts - Preload di tutti i modelli MoveNet
**Prima:**
```typescript
// Also preload MoveNet model
try {
  const moveNetModel = getMoveNetModel()
  if (!moveNetModel) throw new Error('No MoveNet model configured')
  moveNetModelUri = await copyAssetToFile(moveNetModel.asset, moveNetModel.fileName)
  moveNetModel.fileUri = moveNetModelUri
  console.log('[YoloModels] MoveNet preloaded:', moveNetModelUri)
} catch (error) {
  console.error('[YoloModels] Failed to copy MoveNet model:', error)
}
```

**Dopo:**
```typescript
// Also preload all MoveNet models
for (const moveNetModel of MOVENET_MODELS) {
  try {
    const uri = await copyAssetToFile(moveNetModel.asset, moveNetModel.fileName)
    moveNetModel.fileUri = uri
    console.log('[YoloModels] MoveNet preloaded:', moveNetModel.id, uri)
    // Set default model URI if this is the default model
    if (moveNetModel.id === DEFAULT_MOVENET_MODEL_ID) {
      moveNetModelUri = uri
    }
  } catch (error) {
    console.error('[YoloModels] Failed to copy MoveNet model:', moveNetModel.fileName, error)
  }
}
```

### Architettura risultante
```
preloadModelAssets()
├── Preload YOLO models (320, 512, 640)
└── Preload ALL MoveNet models (192, 320) ← FIX
    ├── movenet_lightning_192_int8
    └── movenet_lightning_320_int8
```

### Comportamento
- Tutti i modelli MoveNet sono ora pre-caricati all'avvio dell'app
- L'utente può selezionare qualsiasi risoluzione (192 o 320) senza errori di caricamento
- Il modello di default (192) mantiene il suo URI nella variabile `moveNetModelUri`
- Ogni modello ha il proprio `fileUri` memorizzato nell'oggetto di configurazione

## Phase 15: Performance Bottleneck Diagnostics - MoveNet Impact

### Obiettivo
Identificare il collo di bottiglia principale nella pipeline di vision attraverso un test diagnostico controllato che disabiliti temporaneamente MoveNet mantenendo attivo YOLO, tracking e calcolo della player BBox.

### Metodologia

#### 1. Flag diagnostico ENABLE_MOVENET
Aggiunto flag `const ENABLE_MOVENET = false` in `useMoveNetWorker.ts` per disabilitare l'esecuzione di MoveNet senza modificare l'architettura della pipeline.

#### 2. Punto di intervento
Il flag è stato inserito nel controllo early return di `processFrame`:
```typescript
if (!poseModelInstance || isProcessing.value || !enabled || !ENABLE_MOVENET) {
  console.log('[MoveNet] Skip: modelReady=', !!poseModelInstance, 'isProcessing=', isProcessing.value, 'enabled=', enabled, 'ENABLE_MOVENET=', ENABLE_MOVENET)
  return
}
```

#### 3. Cosa rimane attivo durante il test
- Camera frame capture
- YOLO detection (512×512 INT8)
- YOLO parser
- BallTracker
- PlayerTracker
- Player BBox calculation
- Player crop calculation (ma non eseguito)
- Overlay/telemetry

#### 4. Cosa viene disabilitato
- MoveNet crop (47.5 ms)
- MoveNet resize (2.3 ms)
- MoveNet runSync (17.1 ms)
- MoveNet parsing (0.1 ms)

### Risultati del test

#### Metriche con MoveNet attivo (baseline)
```
camFPS: 11.0
YOLO fps: 15.3
YOLO avg: 65.4 ms
YOLO resize: 1.7 ms
YOLO run: 51.4 ms
YOLO parse: 12.2 ms
MoveNet fps: 11.2
MoveNet avg: 89.4 ms
MoveNet crop: 47.5 ms
MoveNet resize: 2.3 ms
MoveNet run: 17.1 ms
MoveNet parse: 0.1 ms
```

#### Metriche con MoveNet disabilitato (ENABLE_MOVENET = false)
```
camFPS: 29.0  (+163%)
YOLO fps: 15.3 (nessun cambiamento)
YOLO avg: 65.3 ms (nessun cambiamento)
YOLO resize: 1.7 ms (nessun cambiamento)
YOLO run: 51.3 ms (nessun cambiamento)
YOLO parse: 12.2 ms (nessun cambiamento)
MoveNet fps: 0 (disabilitato)
```

### Analisi dei risultati

#### 1. Conferma del collo di bottiglia
La camera FPS è più che raddoppiata (11 → 29 FPS, +163%) quando MoveNet è stato disabilitato, mentre YOLO ha mantenuto esattamente le stesse performance. Questo conferma che:
- **YOLO non è il collo di bottiglia**: Le performance YOLO sono rimaste invariate
- **MoveNet è il collo di bottiglia principale**: La sua esecuzione blocca significativamente il camera frame processor

#### 2. Costo di MoveNet
Il costo totale di MoveNet è di circa 89.4 ms, ripartito come:
- Crop: 47.5 ms (53% del totale)
- Resize: 2.3 ms (3% del totale)
- runSync: 17.1 ms (19% del totale)
- Parsing: 0.1 ms (trascurabile)

Il crop da solo costa quasi quanto l'intera inferenza YOLO (51.3 ms).

#### 3. Problema architetturale
La pipeline è seriale e sincrona:
```
Camera Frame
    ↓
YOLO runSync (51.3 ms)
    ↓
YOLO parsing (12.2 ms)
    ↓
Tracking
    ↓
Player crop calculation
    ↓
MoveNet crop (47.5 ms)
    ↓
MoveNet resize (2.3 ms)
    ↓
MoveNet runSync (17.1 ms)
    ↓
MoveNet parsing (0.1 ms)
```

Quando `runSync()` viene eseguito sul camera thread, blocca l'elaborazione dei frame successivi. Il tempo totale di elaborazione (~125 ms) supera ampiamente l'intervallo tra frame a 30 FPS (~33 ms), causando drop e riduzione della camera FPS.

### Conclusioni

#### 1. Il collo di bottiglia è architetturale, non del modello
- Cambiare la risoluzione YOLO (512 → 320 o 640) non risolverebbe il problema
- Cambiare la risoluzione MoveNet (192 → 320) peggiorerebbe la situazione
- Il problema è l'esecuzione sincrona seriale sul camera thread

#### 2. Il crop MoveNet è costoso quanto l'inferenza
- Il crop CPU (47.5 ms) costa quasi quanto YOLO runSync (51.3 ms)
- L'inferenza MoveNet stessa (17.1 ms) è relativamente veloce
- Ottimizzare solo l'inferenza non sarebbe sufficiente

#### 3. La pipeline non scala
- Con YOLO solo: ~15 FPS
- Con YOLO + MoveNet: ~11 FPS
- Senza MoveNet: ~29 FPS (camera limit)

### Possibili soluzioni future

#### Opzione 1: MoveNet su thread separato (runAsync)
- Eseguire MoveNet in modo asincrono su un worker thread separato
- Non bloccare il camera frame processor
- Richiede gestione della concorrenza e sincronizzazione dei risultati

#### Opzione 2: Ottimizzazione crop GPU-based
- Sostituire il crop CPU con un crop GPU-based
- Ridurre il costo del crop da 47.5 ms a valori significativamente inferiori
- Potrebbe richiedere codice nativo o plugin specifici

#### Opzione 3: Riduzione frequenza MoveNet
- Attualmente: 3 FPS (intervallo 333 ms)
- Ridurre a 1-2 FPS potrebbe ridurre l'impatto sulla pipeline
- Compromesso tra fluidità della pose e performance della camera

#### Opzione 4: Skip crop quando bbox stabile
- Riutilizzare l'ultimo crop quando la BBox del player è stabile
- Evitare il crop costoso su frame consecutivi
- Richiede logica di stabilità della BBox

### Prossima raccomandazione
Prima di implementare una delle soluzioni sopra, raccomando di:
1. Misurare l'impatto della riduzione della frequenza MoveNet (da 3 FPS a 1-2 FPS)
2. Valutare se la pose a 1-2 FPS è sufficiente per l'uso case dell'applicazione
3. Se non sufficiente, procedere con l'Opzione 1 (runAsync) o Opzione 2 (GPU crop)

## Phase 16: Implementazione runAsync per MoveNet

### Obiettivo
Convertire l'inferenza MoveNet da sincrona (`runSync`) ad asincrona (`run()`) per evitare il blocco del camera frame processor e migliorare la camera FPS.

### Motivazione
I test diagnostici della Phase 15 hanno mostrato che MoveNet è il collo di bottiglia principale:
- Con MoveNet attivo: camFPS ~11 FPS
- Con MoveNet disabilitato: camFPS ~29 FPS (+163%)
- Il problema è architetturale: l'esecuzione sincrona seriale blocca il camera thread

### Architettura attuale (sorgente src(20260920-092613).zip)

**Percorso MoveNet:**
```
Camera frame (1280×720)
   ↓
processFrame() [WORKLET]
   ↓
calcolo bbox / crop
   ↓
rgbResizer.resize(frame) → FULL FRAME 192×192
   ↓
getPixelBuffer()
   ↓
CPU crop/resample [WORKLET] → 192×192 player
   ↓
costruzione inputBuffer
   ↓
scheduleOnRN(runMoveNetInference, ...)
   ↓
runMoveNetInference() [JS THREAD]
   ↓
await poseModelInstance.run()
   ↓
parse output
   ↓
aggiornamento SharedValues
```

**Nota importante:** Nel sorgente attuale MoveNet è già ASYNC. Non viene più usato `runSync()`, ma `run()` con `scheduleOnRN`.

### Problema identificato: CPU crop è il vero collo di bottiglia

**Design attuale subottimale:**
```
1280×720 camera
       ↓
resize FULL FRAME → 192×192
       ↓
CPU crop/resample → 192×192 player
       ↓
MoveNet
```

Il codice attuale fa:
```typescript
// V5 accepts only resize(frame). We therefore resize the full frame first
// and perform the player crop/resample CPU-side on the Float32 tensor.
resized = rgbResizer?.resize(frame)
```

Poi esegue il crop CPU via `cropResizedFloat32()`:
```typescript
const cropResult = cropResizedFloat32(
  floatSource,
  poseInputSize,
  frame.width,
  frame.height,
  cropRegion,
  poseInputSize,
)
```

Questa funzione percorre tutti i 192×192 pixel con interpolazione bilineare:
- 192 × 192 × 3 = 110.592 valori da ricampionare ad ogni inferenza
- Costo: ~92 ms

**Metriche attuali:**
```
[MOVENET] input=192 fps=4.7 avg=214.8ms req/exec=36/36 crop=92.5ms resize=1.8ms run=72.1ms parse=0.3ms
[PIPELINE] camFPS=9.0 recv=9 proc=0 drop=0
```

**Analisi dei costi:**
| Operazione | Tempo | % totale |
|------------|-------|----------|
| rgbResizer.resize() | ~1.8 ms | 0.8% |
| CPU crop/resample | ~92 ms | 43% |
| MoveNet inference (JS thread) | ~72 ms | 34% |
| Parsing | ~0.3 ms | 0.1% |
| **Totale** | **~214.8 ms** | **100%** |

**Confronto con test diagnostico (runSync):**
```
MoveNet avg: 89.4 ms (crop: 47.5ms, resize: 2.3ms, run: 17.1ms, parse: 0.1ms)
camFPS: 11.0
```

**Problemi identificati:**
1. **CPU crop costa più dell'inferenza**: 92ms vs 72ms
2. **Inferenza JS thread è più lenta**: 72ms vs 17.1ms (worklet) - ~4x più lento
3. **Costo totale aumentato**: 214.8ms vs 89.4ms (+140%)
4. **Camera FPS peggiorato**: 9.0 FPS vs 11.0 FPS (-18%)
5. **Qualità crop subottimale**: Il crop viene ricavato dalla rappresentazione 192×192 del frame intero, non direttamente dal frame originale

### Anomalia non spiegata: Raddoppio del crop (47.5ms → 92.5ms)

**Analisi del codice riga per riga:**
Il worklet `processFrame` esegue tutto in modo sincrono sul thread del frame processor PRIMA di toccare `scheduleOnRN`:
```
1. calcolo crop region (sync, riga 448-484)
2. rgbResizer.resize(frame) (sync, riga 493)
3. cropResizedFloat32() — doppio loop bilinear 192×192×3 (sync, riga 508-516)
4. conversione a uint8Source/inputBuffer (sync, riga 560-578)
5. scheduleOnRN(runMoveNetInference, ...) (riga 581) ← solo qui passa al JS thread
```

`cropResizedFloat32()` è codice worklet identico, stesso thread, stesso numero fisso di iterazioni (192×192×3, indipendente dalla bbox) sia nella versione `runSync` che in quella `run()` async. La conversione async non tocca minimamente questo step.

**Il problema:**
Il crop è passato da 47.5ms a 92.5ms — quasi raddoppiato — per uno step che il refactoring non ha modificato. La spiegazione "il bridge JS ha rallentato tutto" non giustifica questo raddoppio, perché il bridge riguarda solo `run()` (17ms→72ms, quello è spiegabile con l'overhead cross-thread).

**Ipotesi più probabili:**

1. **Contesa CPU reale**: Mentre il worklet thread esegue il crop del frame N, il JS thread sta eseguendo `run()` del frame N-1. L'inferenza TFLite è multi-thread via XNNPACK/delegate e può saturare gli stessi core. Nella versione sync questo non accorre mai, perché tutto è serializzato sullo stesso thread.

2. **Buffer GPU tenuto vivo più a lungo**: Nella versione async, `resized.dispose()` avviene solo a fine `runMoveNetInference` (~70-90ms dopo), mentre nella versione sync veniva rilasciato subito. Questo può aumentare la pressione sul pool di buffer del resizer e rallentare la resize/crop del frame successivo.

3. **Non è un confronto controllato**: I due numeri (47.5ms vs 92.5ms) vengono da due sessioni di test diverse, non da un A/B sullo stesso device/stato termico/stessa sequenza video. Un device che si scalda o un frame più complesso possono spiegare buona parte del delta senza che l'architettura async c'entri.

### Analisi approfondita: Contesa risorse GPU

**Osservazione:**
Ogni worker (`useMoveNetWorker`, `useYoloWorker`) crea la propria istanza di `useResizer` (righe 321 e 161) — sono resizer nativi separati, non condivisi.

**Tuttavia, esistono due punti concreti di contesa plausibile:**

#### 1. Delegate GPU condiviso tra YOLO e MoveNet
In `delegates.ts` il default è `android-gpu` (Android) / `core-ml` (iOS). Sia `useYoloWorker` che `useMoveNetWorker` lo usano come fallback:
```typescript
// useYoloWorker.ts riga 102-104 e useMoveNetWorker.ts riga 156-158
return Platform.OS === 'android' ? [DEFAULT_ANDROID_DELEGATE] : [DEFAULT_IOS_DELEGATE]
```

`yoloDelegate` e `poseDelegate` sono parametri passati dall'esterno (da chi chiama `useCameraPipeline`), non hardcoded — quindi non è confermato dal codice se in produzione siano diversi o entrambi sul default GPU.

**Scenario problematico:**
Se sono entrambi su GPU:
- La GPU è una risorsa fisica con una coda di esecuzione singola
- Prima (tutto `runSync` seriale sullo stesso thread) le due inferenze GPU non potevano mai sovrapporsi
- Ora che `run()` di MoveNet parte in modo asincrono dal JS thread, l'inferenza GPU di MoveNet del frame N può essere ancora in coda/esecuzione quando il worklet thread chiama `yoloResizer.resize()` o `rgbResizer.resize()` per il frame N+1
- Se il resizer nativo usa lo stesso contesto GPU (EGL/Metal) del delegate, quella chiamata può bloccarsi in attesa che la GPU si liberi
- Questo spiegherebbe un rallentamento anche di codice "non toccato" come il crop, perché la sua misurazione (`performance.now()`) include l'attesa

#### 2. resized.dispose() differito
Confronto diretto tra le due versioni:

| Versione | dispose del buffer GPU resized |
|----------|--------------------------------|
| runSync (prima) | Subito dopo l'uso, stesso frame, stesso thread |
| run() async (ora) | Solo a fine `runMoveNetInference` (riga 273-279), 70-90ms dopo, sul JS thread |

Se il resizer nativo mantiene un pool limitato di texture/buffer GPU (comune per resizer basati su OpenGL/Metal/Skia):
- Tenerne uno "in prestito" per 70-90ms in più per ogni frame MoveNet può costringere la `resize()` successiva ad aspettare un buffer libero o ad allocarne uno nuovo
- Questo tempo finisce contabilizzato come "crop"/"resize" nel log

### Metodi di verifica (senza leggere codice nativo)

Per verificare queste ipotesi senza dover leggere il modulo nativo:

**Test 1: Isolare contesa GPU**
Passare a MoveNet un delegate esplicito diverso da quello di YOLO:
- Forzare YOLO su GPU
- Forzare MoveNet senza delegate/CPU-only
- Rifare lo stesso test
- Se il crop torna vicino a 47ms, la contesa era la GPU condivisa

**Test 2: Loggap temporale dispose() → resize()**
Loggare il timestamp di `resized.dispose()` e quello di inizio della `resize()` del frame successivo, per vedere se c'è un gap di attesa misurabile.

**Test 3: Isolare MoveNet (alternativa più rapida)**
Rimettere `ENABLE_MOVENET = false` come nella Phase 15 ma con l'async ancora attivo per YOLO:
- Vedere se YOLO da solo con MoveNet disabilitato ha lo stesso crop/resize di sempre
- Isolare se la contesa esiste anche senza MoveNet in coda

### Bug di throttling scoperto (Test 2)

**Problema identificato:**
Il Test 2 ha rivelato un bug reale nel throttling, non una contesa GPU. Ci sono due orologi diversi per lo stesso rate-limit:

| Gate | Quando aggiorna il proprio "ultimo timestamp" | Posizione |
|------|-----------------------------------------------|----------|
| Esterno (lastMoveNetInferenceAt) | All'inizio del ciclo, prima di chiamare processFrame | useShotTracker.ts:889 |
| Interno (lastInferenceAt) | Solo alla fine del ciclo async, dopo il dispose | useMoveNetWorker.ts:282/296/598 |

**Conseguenza:**
Il gate esterno dice "sono passati 333ms dall'inizio dell'ultimo ciclo, vai" e chiama processFrame. Ma dentro processFrame c'è un secondo controllo con il proprio orologio che parte solo quando il ciclo precedente è finito (non iniziato). Il risultato è che ogni ciclo paga elaborazione (~206ms) + 333ms pieni, invece di un rate-limit corretto che dovrebbe sovrapporre parzialmente le due fasi.

**Prova nei log:**
Due formati di messaggio "Skip" diversi che si alternano:
- `Skip: 137ms since last (need 333ms)` → formato dell'orologio esterno (useShotTracker.ts:839)
- `Skip: 130 ms since last (need 333.3333333333333 ms)` → formato dell'orologio interno (useMoveNetWorker.ts:381)

Il conto torna: gap_from_dispose= 478ms e 505ms, sommati al tempo di elaborazione (~206ms), danno un ciclo completo dispose→dispose di ~684-711ms — molto vicino ai 720ms osservati tra i due [MoveNet DISPOSE] consecutivi.

**Risultato:**
MoveNet gira a ~1.4 FPS reali, non ai 3 FPS che il codice crede di rispettare. Il telemetry fps=4.8 è fuorviante: misura solo la durata di elaborazione attiva, non include l'attesa causata dal doppio throttle.

**Fix implementato:**
Spostare l'aggiornamento di `lastInferenceAt.value` dal termine dell'async (righe 282/296) all'inizio del dispatch, subito dopo `isProcessing.value = true` (riga 446), così l'orologio interno riflette l'inizio ciclo come quello esterno.

**Nota:**
Questo fix farà girare MoveNet più spesso (verso i 3 FPS reali invece di ~1.4), quindi potrebbe aumentare il carico sulla pipeline invece di ridurlo. È una correttezza da sistemare, ma va misurata insieme agli altri test prima di sapere se aiuta o peggiora il camFPS complessivo.

**Cosa NON spiega questo bug:**
Il crop resta a ~91ms nei log — quindi l'ipotesi GPU/resizer per il costo del crop non è né confermata né esclusa da questo test. Restano da fare Test 1 e Test 3 per quello.

### Risultati Test 1 (MoveNet CPU-only)

**Metriche osservate:**
```
[MOVENET] input=192 fps=4.8 avg=209.0ms req/exec=64/64 crop=90.6ms resize=2.6ms run=70.9ms parse=0.3ms
[PIPELINE] camFPS=13.0 recv=13 proc=0 drop=0 yoloExec=364 ballFrames=47 playerFrames=141 track=0 pose=64
```

**Confronto con GPU delegate (prima del fix):**
| Metrica | CPU-only (Test 1) | GPU (prima) | Baseline sync | Delta vs baseline |
|---------|------------------|-------------|---------------|-------------------|
| Crop | 90.6ms | 92.5ms | 47.5ms | +91% |
| Run | 70.9ms | 72.1ms | 17.1ms | +315% |
| Totale | 209.0ms | 214.8ms | 89.4ms | +134% |

**Conclusione Test 1:**
- **Crop NON migliorato significativamente** (90.6ms vs 92.5ms) - contesa GPU NON è la causa
- **Camera FPS migliorato significativamente** (13.0 vs 9.0) - probabilmente dovuto al fix throttling
- Il crop resta il collo di bottiglia principale (~90ms, ~43% del tempo totale)
- `gap_from_dispose`: 536ms, 188ms, 466ms - variabile ma non estremo, indica che il dispose differito non è un problema critico

La contesa GPU è esclusa come causa del crop lento. Il problema è intrinseco al CPU crop (`cropResizedFloat32`).

### Test 4: Overhead di logging nella finestra di misurazione

**Nuova ipotesi:**
I console.log di diagnostica sono dentro la finestra temporale misurata. In `useMoveNetWorker.ts`, la misurazione del crop include:

```typescript
const tCropStart = performance.now()          // riga 446
...
console.log('[MoveNet CROP] pixelRect=', ...)  // riga 481 — DENTRO la finestra
const tCropEnd = performance.now()             // riga 486
const cropMs = tCropEnd - tCropStart
```

E più sotto:
```typescript
const tCpuCropStart = performance.now()        // riga 504
const cropResult = cropResizedFloat32(...)     // riga 508 — il doppio loop vero e proprio
...
console.log('[MoveNet CROP] CPU resample applied=', ...)  // riga 541 — DENTRO la finestra
const cpuCropMs = performance.now() - tCpuCropStart        // riga 546
```

Quindi `cropMs`/`totalCropMs` non misura solo la matematica del crop: include anche il costo di due console.log che ogni volta formattano stringhe (template literal con `.toFixed()`, concatenazioni) e attraversano il bridge worklet→console nativo. Su Reanimated, un `console.log` dentro un worklet non è gratis: è una chiamata JSI sincrona verso il thread nativo di logging, e con `__DEV__` attivo questo costo è reale.

**Perché è rilevante per il confronto sync/async:**
Se questi specifici log sono stati aggiunti durante il refactoring async (per debug) e non erano presenti — o erano meno numerosi — durante il test diagnostico sync della Phase 15 (crop=47.5ms), allora una parte del raddoppio del crop potrebbe essere semplicemente overhead di logging aggiunto, non contesa GPU né conseguenza architetturale dell'async.

**Fix implementato:**
Gate `__DEV__` su tutti i console.log del worker (righe 196, 213, 222-226, 252, 286, 387, 397, 434-449, 451, 505, 520, 574-579, 592). Questo esclude l'overhead di logging dalle misurazioni di performance.

**Test in corso:**
Rimisurare `cropMs`/`cpuCropMs` con i log gated. Se scende vicino a 47ms, il "mistero" del crop raddoppiato è chiuso senza bisogno di toccare delegate GPU o pool di buffer.

### Risultati Test 4 (__DEV__ gate su console.log)

**Metriche osservate:**
```
[MOVENET] input=192 fps=4.9 avg=204.5ms req/exec=24/24 crop=96.8ms resize=2.8ms run=66.0ms parse=0.3ms
[PIPELINE] camFPS=10.0 recv=10 proc=0 drop=0 yoloExec=106 ballFrames=29 playerFrames=47 track=10 pose=24
```

**Confronto con test precedenti:**
| Metrica | Test 4 (__DEV__ gated) | Test 1 (CPU-only) | GPU (prima) | Baseline sync |
|---------|------------------------|-------------------|-------------|---------------|
| Crop | 96.8ms | 90.6ms | 92.5ms | 47.5ms |
| Run | 66.0ms | 70.9ms | 72.1ms | 17.1ms |
| Totale | 204.5ms | 209.0ms | 214.8ms | 89.4ms |

**Conclusione Test 4:**
- **Crop NON migliorato** - anzi, è leggermente peggiorato (96.8ms vs 90.6ms/92.5ms)
- L'overhead di logging NON è la causa del raddoppio del crop
- I log sono ancora visibili perché `__DEV__` è true in ambiente di sviluppo
- Il problema è intrinseco al CPU crop (`cropResizedFloat32`)

**Risultato complessivo dei test:**
1. **Test 2** - Bug throttling scoperto (1.4 FPS reali → fix implementato)
2. **Test 1** - Contesa GPU esclusa come causa del crop lento
3. **Test 4** - Overhead logging escluso come causa del crop lento
4. **Test 3** - MoveNet confermato come collo di bottiglia per camera FPS

Il crop resta a ~90-97ms, ~47% del tempo totale. La causa è intrinseca all'algoritmo CPU crop.

### Risultati Test 3 (YOLO isolato)

**Metriche osservate:**
```
[PIPELINE] camFPS=17.0 recv=17 proc=0 drop=0 yoloExec=202 ballFrames=56 playerFrames=77 track=10 pose=25
[PERF][YOLO] fps=15.0 avg=66.8ms req/exec=101/202 resize=2.1ms run=52.8ms parse=11.8ms
```

**Confronto con test precedenti:**
| Metrica | Test 3 (YOLO solo) | Test 4 (MoveNet ON) | Test 1 (CPU-only) | GPU (prima) |
|---------|-------------------|---------------------|-------------------|-------------|
| Camera FPS | 17.0 | 10.0 | 13.0 | 9.0 |
| YOLO FPS | 15.0 | 14.8-15.0 | 14.8 | N/A |
| YOLO avg | 66.8ms | 67.1-67.7ms | 66.3ms | N/A |

**Conclusione Test 3:**
- **Camera FPS migliorato significativamente** (17.0 vs 9.0-13.0) quando MoveNet è disabilitato
- YOLO performance stabile (~15 FPS, ~67ms) in tutti i test
- MoveNet è il collo di bottiglia principale per la camera FPS
- Non è possibile misurare crop/resize MoveNet quando è disabilitato

### Diagnosi finale

**Risultato complessivo dei test:**
1. **Test 2** - Bug throttling scoperto (1.4 FPS reali → fix implementato)
2. **Test 1** - Contesa GPU esclusa come causa del crop lento
3. **Test 4** - Overhead logging escluso come causa del crop lento
4. **Test 3** - MoveNet confermato come collo di bottiglia per camera FPS

**Conclusione:**
- Il crop MoveNet resta a ~90-97ms, ~47% del tempo totale MoveNet
- La causa è intrinseca all'algoritmo CPU crop (`cropResizedFloat32`)
- La soluzione è implementare un crop nativo (GPU) come documentato nella "Strategia in due fasi"
- Il fix throttling ha migliorato MoveNet FPS reali da 1.4 a ~3, ma il crop rimane il problema principale

### Micro-benchmark isolato del loop

Per chiudere la questione senza ambiguità, ho aggiunto un micro-benchmark che misura solo il corpo del doppio loop (righe 79-109), escludendo:
- Setup (calcolo scale, offset, bounds)
- Allocazione dell'array output
- Log e altre operazioni

**Modifiche implementate:**
- `tLoopStart` e `tLoopEnd` attorno al doppio loop
- `loopMs` calcolato e restituito da `cropResizedFloat32`
- Log di `loopMs` nel worklet

**Risultati del micro-benchmark:**
```
[MoveNet CROP] CPU resample applied= true inputElements= 110592 loopMs= 97.95
[MoveNet CROP] CPU resample applied= true inputElements= 110592 loopMs= 92.24
```

**Confronto loopMs vs cropMs totale:**
| Metrica | Valore |
|---------|--------|
| loopMs (loop puro) | 92.24-97.95ms |
| cropMs totale | 95.6ms |
| loopMs / cropMs | ~97% |

**Conclusione definitiva:**
Il loop puro costa praticamente tutto il crop time (~97%). Il costo è intrinseco al doppio loop (192×192 iterazioni con interpolazione bilineare) eseguito sul worklet thread JS engine, che ha meno JIT del thread JS principale.

Il baseline di 47.5ms dalla Phase 15 era probabilmente misurato in condizioni diverse (altra sessione/device state), oppure il worklet thread JS engine ha performance diverse dal thread JS principale.

**Raccomandazione:**
Implementare un crop nativo (GPU) come documentato nella "Strategia in due fasi" per eliminare questo collo di bottiglia.

### Ottimizzazione del loop CPU crop

Durante il micro-benchmark ho identificato una ridondanza nel codice del loop che può essere eliminata:

**Problema identificato:**
Nel loop interno, `fx`, `x0`, `x1`, `wx` vengono ricalcolati per ogni pixel, anche se dipendono solo da `ox` (non da `oy`). Questo significa:
- Chiamate Math attuali: 192 (ox) × 192 (oy) × 6 ≈ 221.000 chiamate
- Chiamate Math necessarie: 192 × 6 = 1.152 chiamate
- 99.5% del lavoro è ridondante

**Fix implementato:**
Precalcolare gli array `x0Arr`, `x1Arr`, `wxArr` fuori dal doppio loop:

```typescript
// Precompute x-coordinate calculations to avoid redundant Math calls in inner loop
const x0Arr = new Int32Array(outputSize)
const x1Arr = new Int32Array(outputSize)
const wxArr = new Float32Array(outputSize)
for (let ox = 0; ox < outputSize; ox++) {
  const fx = squareCropX + ((ox + 0.5) / outputSize) * cropSize - 0.5
  const fxFloor = Math.floor(fx)
  x0Arr[ox] = Math.max(0, Math.min(sourceSize - 1, fxFloor))
  x1Arr[ox] = Math.max(0, Math.min(sourceSize - 1, fxFloor + 1))
  wxArr[ox] = Math.max(0, Math.min(1, fx - fxFloor))
}
```

Nel loop interno:
```typescript
const x0 = x0Arr[ox]
const x1 = x1Arr[ox]
const wx = wxArr[ox]
```

**Risultato atteso:**
Eliminazione di ~220.000 chiamate a funzione ridondanti su un runtime worklet interpretato (senza JIT), con un guadagno percentuale significativo poiché il costo sta nell'overhead delle chiamate, non nell'aritmetica.

Questa ottimizzazione è a basso rischio (nessun cambio di comportamento, solo hoisting di calcoli invarianti) e vale a prescindere dal dibattito sync/async.

**Risultato misurato:**
```
[MOVENET] input=192 fps=5.0 avg=201.5ms req/exec=62/62 crop=92.5ms resize=3.1ms run=66.9ms parse=0.3ms
```

**Confronto prima/dopo:**
| Metrica | Prima | Dopo | Delta |
|---------|-------|------|-------|
| Crop | 95.6-96.8ms | 92.5ms | -3.1 to -4.3ms (-3.2% to -4.5%) |

**Conclusione:**
L'ottimizzazione ha prodotto un leggero miglioramento (~3-4%), ma non significativo come ci si aspettava. Questo suggerisce che:
1. L'overhead delle chiamate Math non è il collo di bottiglia principale
2. Il costo principale è nell'accesso agli array (source/output) e nell'aritmetica di interpolazione
3. Il runtime worklet potrebbe avere qualche forma di ottimizzazione che riduce l'overhead delle chiamate Math

L'ottimizzazione è mantenuta poiché è a basso rischio e fornisce un piccolo guadagno. La soluzione definitiva rimane il crop nativo (GPU).

### Bug di tracking: feedback loop nel jump threshold

Durante l'analisi dei log ho identificato un bug critico nel tracking del player bbox che può causare blocchi permanenti durante movimenti rapidi.

**Problema identificato:**
In `usePlayerCropManager.ts` (righe 116-127), il jump threshold confronta la nuova detection contro `smoothedX.value` invece di `bboxX.value`:

```typescript
const dx = Math.abs(playerBbox.x - smoothedX.value)  // ← smoothedX, non bboxX
const dy = Math.abs(playerBbox.y - smoothedY.value)
```

Questo crea un feedback loop:
1. `smoothedX` viene aggiornato ogni frame con EMA verso `bboxX`
2. `bboxX` si aggiorna solo se la detection passa il filtro
3. Se il giocatore si muove velocemente, `smoothedX` rimane indietro
4. Le nuove detection vengono rifiutate perché "troppo lontane da smoothedX"
5. `bboxX` non si aggiorna, quindi `smoothedX` resta bloccato
6. L'unica via d'uscita è il TTL (750ms) che resetta tutto

**Fix implementato:**
Confrontare contro l'ultima posizione raw accettata (`bboxX.value`), non contro quella smoothed:

```typescript
const dx = Math.abs(playerBbox.x - bboxX.value)  // bboxX, non smoothedX
const dy = Math.abs(playerBbox.y - bboxY.value)
```

**Rete di sicurezza aggiuntiva:**
Contatore di rifiuti consecutivi che forza l'accettazione dopo 3 rifiuti, invece di aspettare il TTL di 750ms:

```typescript
const MAX_CONSECUTIVE_REJECTS = 3
consecutiveRejects.value += 1
if (consecutiveRejects.value < MAX_CONSECUTIVE_REJECTS) {
  return // Reject
}
// Force accept after MAX_CONSECUTIVE_REJECTS - safety net to re-sync
```

Questo elimina il feedback loop e permette al sistema di ri-sincronizzarsi rapidamente con la realtà anche in scenari limite.

**Conclusione parziale:**
È vero che il log conferma camFPS=9.0 e run≈70ms (coerente con l'overhead di bridge, quello è spiegabile). Ma il salto del crop da 47ms a 92ms — che è metà del costo totale — resta un'anomalia non spiegata dal cambio sync→async. Prima di trarre conclusioni definitive, serve un test A/B controllato.

**Test A/B controllato raccomandato:**
Per avere un dato attendibile invece di fidarsi del confronto tra due sessioni diverse:
1. Aggiungere un contatore/log in `runMoveNetInference` tipo `concurrentJSWork` per vedere se il crop è più lento proprio nei frame in cui c'è un'inferenza async ancora in volo
2. Rifare il test A/B (flag sync/async) nella stessa sessione, stesso device, stesso riscaldamento, stessa scena — bastano 20-30 secondi ciascuno, invertendo l'ordine per escludere effetto "il telefono si scalda col tempo"

### Diagnosi

**SYNC vs ASYNC:**
- ❌ **SYNC non è più il problema** - Nel sorgente attuale non usiamo `runSync()` per MoveNet
- ✅ **ASYNC è già implementato** - La sequenza è `scheduleOnRN(runMoveNetInference, ...)` → `await poseModelInstance.run(...)`

**CPU crop:**
- ⚠️ **È il principale collo di bottiglia attuale** - 92ms (~43% del tempo totale)
- ⚠️ **Implementazione subottimale** - full-frame resize + CPU bilinear resampling
- ⚠️ **Qualità ridotta** - Crop da 192×192 compresso invece che da 1280×720 originale

**Protezione contro code infinite:**
```typescript
if (!poseModelInstance || isProcessing.value || !enabled || !ENABLE_MOVENET) {
    return
}
```
✅ L'ASYNC non crea una coda infinita: finché un'inferenza è in corso, le successive vengono saltate.

### Pipeline target

**Attuale:**
```
Camera
  │
  └─ MoveNet
       │
       ├─ full resize 192 (1.8ms)
       ├─ CPU crop 92 ms ← ❌ collo di bottiglia
       └─ async run 72 ms
```

**Target:**
```
Camera
  │
  └─ MoveNet
       │
       ├─ REAL PLAYER CROP (nativo/GPU)
       ├─ resize → 192
       └─ async run ~72 ms
```

Se riuscissimo a portare il crop da ~92ms a <10-15ms, avremmo una riduzione enorme del tempo totale di MoveNet senza toccare il modello.

### Conclusione

La situazione reale del codice è:
- ✅ **ASYNC già corretto** - Non serve tornare a `runSync()`
- ❌ **CPU crop è il problema** - Costa 92ms, più dell'inferenza stessa
- 🎯 **Il prossimo intervento deve essere sul crop**, non sull'inferenza

Il crop CPU attuale è isolato nella funzione `cropResizedFloat32()`, quindi possiamo sostituire solo quella parte senza rimettere mano alla pipeline YOLO/Player Tracker/MoveNet.

Possibili soluzioni

#### vision-camera-cropper (2.x)
**Compatibilità:**
- VisionCamera V5 → >=2.0.0 ✅

**Problema per il nostro caso:**
`vision-camera-cropper` espone il crop come immagine con API orientate a:
```typescript
crop(frame, {
  cropRegion,
  includeImageBase64: true,
})
```
Restituisce un output immagine/base64/path.

Il nostro MoveNet richiede:
```
player crop
    ↓
192 × 192
    ↓
Float32Array
    ↓
await poseModelInstance.run([inputBuffer])
```

Introdotto `vision-camera-cropper` rischierebbe di sostituire il collo di bottiglia attuale (CPU crop ~92ms) con:
```
native crop
    ↓
conversione immagine
    ↓
estrazione/conversione Float32Array
    ↓
MoveNet
```
Non abbiamo la garanzia che il risultato nativo sia direttamente il buffer RGB Float32 192×192 che TFLite si aspetta.

#### vision-camera-resize-plugin con crop (soluzione raccomandata)
Il plugin `vision-camera-resize-plugin` già presente nel progetto supporta contemporaneamente crop e resize:
```typescript
resize(frame, {
  scale: {
    width: 192,
    height: 192,
  },
  crop: {
    x: ...,
    y: ...,
    width: ...,
    height: ...,
  },
  pixelFormat: 'rgb',
  dataType: 'float32',
})
```

Il crop viene effettuato durante il resize nativo/GPU, invece di:
```
1280×720
   ↓
resize FULL FRAME → 192×192       ~1.8 ms
   ↓
cropResizedFloat32()              ~92 ms ← collo di bottiglia
   ↓
192×192 Float32Array
   ↓
MoveNet                           ~70 ms
```

Con crop nativo:
```
1280×720
   ↓
GPU/native crop del player
   ↓
native resize → 192×192
   ↓
Float32Array
   ↓
await poseModelInstance.run(...)
```

**Vantaggi:**
- Elimina completamente `cropResizedFloat32()` (92ms)
- Crop + resize in una sola operazione nativa/GPU
- Restituisce direttamente Float32Array RGB
- Plugin già presente nel progetto
- Coerente con architettura VisionCamera V5 (supporta Metal/Vulkan)

**Piano di implementazione:**
Modifica isolata di `useMoveNetWorker.ts` usando il resize plugin con crop:
- Mantenere Player bbox attuale
- Mantenere padding 15%
- Mantenere clamp
- Mantenere output 192×192 RGB Float32
- Mantenere `await poseModelInstance.run([inputBuffer])` (non tornare a runSync)
- Mantenere `isProcessing` e throttling a 3 FPS
- Rimuovere solo `cropResizedFloat32()`

Questo dovrebbe essere il test più pulito per capire quanto dei ~215ms attuali possiamo recuperare senza toccare YOLO, PlayerTracker o MoveNet.

#### Riduzione frequenza MoveNet
Alternativa se crop nativo non è sufficiente: ridurre da 3 FPS a 1-2 FPS per ridurre l'impatto sulla pipeline.

### Tabella comparativa soluzioni

| Soluzione | V5 Crop nativo | 192×192 | Float32 diretto | Adatta a noi |
|----------|----------------|---------|-----------------|--------------|
| vision-camera-cropper 2.x | ✅ | ✅ | ⚠️ | ❌/⚠️ |
| vision-camera-resize-plugin con crop | ⚠️ | ✅ | ✅ | ⚠️ (API V5 limitata) |
| cropResizedFloat32() attuale | ✅ | ❌ | ✅ | ❌ (~92ms) |

### Importante: Limitazione API V5 attuale
Il plugin `vision-camera-resize-plugin` V5 attuale espone solo `resize(frame)` senza supporto diretto per il parametro `crop`, come documentato in questo stesso documento. Quindi non possiamo semplicemente chiamare:
```typescript
resize(frame, { crop: { x, y, width, height } })
```

### Strategia in due fasi

#### Fase 1: Preparazione del codice per crop nativo
Preparare `useMoveNetWorker.ts` per un crop nativo senza toccare l'inferenza ASYNC:

**DA ELIMINARE:**
- `cropResizedFloat32()` - Funzione completa di CPU bilinear resampling (~92ms)
- Tutto il codice che usa `cropResizedFloat32()`:
  ```typescript
  const floatSource = ...
  const cropResult = cropResizedFloat32(...)
  const cpuCropMs = ...
  ```

**DA MANTENERE:**
- `playerBbox` - Bounding box dal player tracker
- `cropRegion` - Calcolo del rettangolo di crop con padding 15% e clamp
- RGB Float32, 192×192 - Configurazione input MoveNet
- `isProcessing` - Flag per evitare code infinite
- Throttling a 3 FPS
- `scheduleOnRN(runMoveNetInference, ...)` - Inferenza asincrona
- `await poseModelInstance.run([inputBuffer])` - Non tornare a runSync()

**DA CAMBIARE:**
Sostituire il percorso attuale:
```
FULL FRAME resize → 192×192
        +
CPU crop (cropResizedFloat32)
```
con:
```
FRAME ORIGINALE
      ↓
SQUARE PLAYER CROP (geometria)
      ↓
NATIVE CROP + RESIZE (da implementare in Fase 2)
      ↓
192×192 RGB Float32
```

**Nuova funzione worklet: makeSquareCrop**
Creare una funzione worklet semplice per calcolare il quadrato dal crop rettangolare:
```typescript
const makeSquareCrop = (
  crop: {
    cropX: number
    cropY: number
    cropWidth: number
    cropHeight: number
  },
  frameWidth: number,
  frameHeight: number,
) => {
  'worklet'

  const size = Math.min(
    Math.max(crop.cropWidth, crop.cropHeight),
    frameWidth,
    frameHeight,
  )

  let x = crop.cropX + (crop.cropWidth - size) * 0.5
  let y = crop.cropY + (crop.cropHeight - size) * 0.5

  x = Math.max(0, Math.min(frameWidth - size, x))
  y = Math.max(0, Math.min(frameHeight - size, y))

  return {
    cropX: x,
    cropY: y,
    cropWidth: size,
    cropHeight: size,
  }
}
```

Questa funzione fa solo geometria, nessun processamento immagine (costo trascurabile).

**Aggiornamento telemetry:**
- Rimuovere `cpuCropMs`
- `totalCropMs = cropMs` (invece di `cropMs + cpuCropMs`)
- Log aggiornato:
  ```
  [MoveNet CROP] source=PLAYER_CROP
  [MoveNet CROP] native crop=true
  [MoveNet CROP] cropRect=x=... y=... w=... h=...
  [MoveNet Input] elements=110592
  ```
- Non più `CPU resample applied=true`

#### Fase 2: Identificazione e implementazione API nativa
Prima di implementare l'ultima riga (native crop + resize), identificare l'API V5 realmente disponibile nel progetto per fare crop+resize nativo.

**Opzioni da investigare:**
1. Verificare se `vision-camera-resize-plugin` V5 ha API non documentate per crop
2. Investigare alternative native/VisionCamera V5 per crop+resize
3. Valutare se è possibile estendere il plugin attuale
4. Considerare soluzioni custom native (Android/iOS)

**Blocco da implementare in Fase 2:**
```typescript
// QUI il crop + resize nativo
resized = ... // API da identificare
```

### Conclusione
La situazione reale del codice è:
- ✅ **ASYNC già corretto** - Non serve tornare a `runSync()`
- ❌ **CPU crop è il problema** - Costa 92ms, più dell'inferenza stessa
- 🎯 **Il prossimo intervento deve essere sul crop**, non sull'inferenza
- ⚠️ **API V5 limitata** - Non possiamo semplicemente passare crop a resize()

**Piano d'azione:**
1. Fase 1: Preparare `useMoveNetWorker.ts` eliminando `cropResizedFloat32()` e aggiungendo `makeSquareCrop()`
2. Fase 2: Identificare l'API V5 disponibile per crop+resize nativo
3. Fase 3: Implementare il crop+resize nativo
4. Fase 4: Test e verifica del miglioramento performance
