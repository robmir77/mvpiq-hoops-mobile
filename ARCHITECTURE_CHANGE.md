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
