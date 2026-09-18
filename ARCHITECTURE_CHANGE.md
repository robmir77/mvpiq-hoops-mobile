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

## Proposed Solution

### Fix 2A: Rendere PlayerCropManager worklet-safe
Convertire PlayerCropManager da singleton JavaScript a stato basato su SharedValues per compatibilità con Worklet Runtime.

### Fix 2B: Verificare soglia confidence player
Investigare perché il player ha confidence 0.008 e aggiungere un filtro appropriato prima di passare il BBox al PlayerCropManager.

### Fix 2C: Aggiungere log debug
Già aggiunto log debug per confermare che `playerCropManager` è `undefined` nel worklet.

## Approcci possibili per Fix 2A

### Opzione 1: Modifica graduale di playerCrop.ts
Convertire le funzioni esistenti in worklet-safe passo per passo usando il tool `edit`.

### Opzione 2: Nuovo file playerCropWorklet.ts
Creare un nuovo file con implementazione worklet-safe e migrare gradualmente.

### Opzione 3: Gestire stato direttamente in useShotTracker
Gestire lo stato del player tracking direttamente in useShotTracker usando SharedValues invece di un manager separato.

## Domanda per l'utente
Quale approccio preferisci per rendere PlayerCropManager worklet-safe?
1. Modifica graduale di playerCrop.ts
2. Nuovo file playerCropWorklet.ts
3. Gestire stato direttamente in useShotTracker
