# Vision Pipeline Architecture

## Overview

La pipeline di vision dell'applicazione MVPIQ Hoops elabora frame dalla camera per rilevare e tracciare tre oggetti chiave: la palla, il canestro e il giocatore. La pipeline è costruita su React Native Vision Camera V5 con un'architettura worklet-safe per garantire performance real-time.

## Architettura Corrente

### Pipeline Principale

```
Camera Frame (1280×720 @ 30 FPS)
    ↓
YOLO Detection (512×512 INT8)
    ↓
YOLO Parser
    ↓
    ├── Ball → BallTracker (TTL 500ms) → Kalman Prediction
    ├── Hoop → RimTracker (TTL 500ms)
    └── Player → PlayerTracker (TTL 750ms) → MoveNet (192×192)
```

### Componenti Principali

#### 1. YOLO Detection
- **Modello**: `best_512_int8.tflite`
- **Risoluzione**: 512×512 INT8
- **Output**: Bounding boxes per ball, hoop, player
- **Performance**: ~15 FPS, ~65ms per inferenza

#### 2. Ball Tracking
- **TTL**: 500ms (time-based)
- **Kalman Prediction**: Eseguita anche durante gap YOLO
- **Telemetria**: `ballDetected`, `ballPrediction`, `ballTrackingExpired`

#### 3. Player Tracking
- **TTL**: 750ms (time-based)
- **Smoothing**: EMA su coordinate bbox
- **Jump Threshold**: 0.15 per filtrare detection spurie
- **Safety Net**: Force accept dopo 3 rifiuti consecutivi

#### 4. MoveNet Pose Estimation
- **Modello**: `movenet_lightning_192_int8.tflite` o `320_int8`
- **Risoluzione**: 192×192 o 320×320
- **Frequenza**: 3 FPS (throttled)
- **Preprocessing**: Full-frame resize → CPU crop (92ms) → Float32
- **Inferenza**: Asincrona su JS thread (~70ms)

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

## Performance Analysis

### Bottleneck Principale: MoveNet CPU Crop

Il collo di bottiglia principale della pipeline è il crop CPU di MoveNet:

| Operazione | Tempo | % totale MoveNet |
|------------|-------|------------------|
| rgbResizer.resize() | ~2.8 ms | 1.4% |
| CPU crop/resample | ~92 ms | 46% |
| MoveNet inference | ~67 ms | 33% |
| Parsing | ~0.3 ms | 0.1% |
| **Totale** | **~200 ms** | **100%** |

Il crop CPU (`cropResizedFloat32`) percorre tutti i 192×192 pixel con interpolazione bilineare (110.592 valori) sul worklet thread JS engine, che ha meno JIT del thread JS principale.

### Camera FPS Impact

| Configurazione | Camera FPS | YOLO FPS | MoveNet FPS |
|----------------|------------|----------|-------------|
| YOLO + MoveNet | ~10 FPS | ~15 FPS | ~3 FPS |
| YOLO solo | ~17 FPS | ~15 FPS | N/A |
| MoveNet disabilitato | ~29 FPS | N/A | N/A |

MoveNet riduce la camera FPS di ~40% quando attivo, principalmente a causa del crop CPU.

### Ottimizzazioni Implementate

1. **Hoisting calcoli invarianti**: Precalcolo di x0Arr/x1Arr/wxArr fuori dal doppio loop per eliminare ~220.000 chiamate Math ridondanti
   - **Risultato**: Miglioramento ~3-4% (da 96.8ms a 92.5ms)
   - **Conclusione**: L'overhead delle chiamate Math non è il collo di bottiglia principale

2. **Fix throttling**: Spostamento aggiornamento `lastInferenceAt` all'inizio del dispatch invece che alla fine dell'async
   - **Risultato**: MoveNet FPS reali da 1.4 a ~3 FPS
   - **Nota**: Questo aumenta il carico sulla pipeline, quindi non migliora necessariamente la camera FPS

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

### MoveNet 320 Model: Preloading

Solo il modello 192×192 veniva pre-caricato, causando errore quando selezionato 320×320.

**Soluzione**: Pre-caricare tutti i modelli MoveNet (192 e 320) all'avvio dell'app.

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
- Player perso → BBox persiste per 750ms
- BBox scaduto (>750ms) → MoveNet non esegue
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
- Ball rilevato → `ballLastSeenAt` aggiornato
- Ball perso → Kalman PREDICT esegue (fino a 500ms)
- TTL scaduto (>500ms) → Tracking invalidato

### MoveNet Pipeline

**Hook**: `useMoveNetWorker`

**Preprocessing attuale**:
```
Camera Frame 1280×720
    ↓
Player BBox (normalizzato)
    ↓
Padding 15% + Clamp
    ↓
makeSquareCrop() (geometria)
    ↓
rgbResizer.resize(frame) → FULL FRAME 192×192
    ↓
Float32Array (110.592 elementi)
    ↓
Conversione dataType (uint8/int8/float32)
    ↓
MoveNet inference (async su JS thread)
    ↓
Pose parser
    ↓
Keypoints trasformati (se crop attivo)
```

**Problema**: Il crop viene calcolato geometricamente ma non applicato all'immagine. MoveNet riceve sempre il full-frame 192×192.

**Fase 1 (implementata)**: Preparazione del codice per crop nativo
- Eliminato `cropResizedFloat32()` (CPU crop ~92ms)
- Aggiunto `makeSquareCrop()` (solo geometria)
- Aggiunto flag `usingPlayerCrop = false` (attualmente crop non applicato)
- Modificato trasformazione keypoint con check `usingPlayerCrop`

**Fase 2 (da implementare)**: Identificare API V5 per crop+resize nativo
- Verificare se `vision-camera-resize-plugin` V5 ha API non documentate per crop
- Investigare alternative native/VisionCamera V5 per crop+resize

**Fase 3 (da implementare)**: Implementare crop+resize nativo
- Sostituire `rgbResizer.resize(frame)` con API crop+resize nativo
- Impostare `usingPlayerCrop = true` quando crop nativo attivo

## Future Improvements

### 1. Native Crop+Resize per MoveNet

**Obiettivo**: Eliminare il crop CPU (~92ms) implementando crop+resize nativo/GPU.

**Stima miglioramento**: Riduzione del tempo MoveNet da ~200ms a ~110ms (-45%)

**Strategia**:
1. Identificare API V5 disponibile per crop+resize nativo
2. Implementare crop nativo nel frame originale 1280×720
3. Resize diretto a 192×192 Float32
4. Rimuovere completamente `cropResizedFloat32()`

### 2. Riduzione Frequenza MoveNet

**Alternativa**: Ridurre da 3 FPS a 1-2 FPS se crop nativo non sufficiente.

**Trade-off**: Pose meno fluida ma miglioramento camera FPS.

### 3. Modello YOLO Migliorato per Player Detection

**Problema attuale**: Il modello `best_512_int8.tflite` produce confidence player estremamente basse (0.0001-0.0003).

**Soluzioni**:
1. Riaddestrare il modello con più dati umani
2. Utilizzare un modello separato per person detection (es. COCO)
3. Valutare un modello YOLO diverso addestrato specificamente per persone

## Debug e Telemetria

### Overlay Debug

**WorkoutSessionScreen** mostra:
- Debug box con confidence e rejection reason per ball, hoop, player
- Colori dinamici: verde (valido), rosso (scartato)
- Overlay labels con confidence percentuale
- Skia drawing con coordinate real-time

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

Il principale collo di bottiglia è il crop CPU di MoveNet (~92ms). La soluzione è implementare un crop nativo (GPU) per eliminare questo costo e migliorare significativamente la camera FPS.
