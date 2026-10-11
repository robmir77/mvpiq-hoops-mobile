# Audit: Completamento Gestione Tiri
**Data:** 2026-10-11
**Fase:** Fase 1 COMPLETATA + PASS 5K-A.2 Ottimizzazioni Performance + Refactoring Player Position Snapshot
**Obiettivo:** Documentare lo stato attuale dell'implementazione ShotEvent, ottimizzazioni performance e correzioni tracking

## 1. Tipi ShotEvent Esistenti

**File:** `src/features/workouts/types/workouts.types.ts`

### ShotEvent (linee 39-54)
```typescript
export interface ShotEvent {
    id: string
    sessionId: string
    timestampMs: number
    shotResult: ShotResult  // 'MADE' | 'MISS' | 'BLOCKED' | 'AIRBALL'
    courtX: number
    courtY: number
    distanceFromHoop: number
    releaseAngle?: number
    releaseVelocity?: number
    detectionConfidence: number
    trackingData?: string  // JSON string
    zone?: CourtZone
    shotZone?: string
    releaseTimeMs?: number
}
```

**Gap rispetto alla specifica:**
- ❌ Manca `shotId` (esiste `id` ma non è chiaro se è idempotente)
- ❌ Manca `courtPositionQuality` (CALIBRATED/APPROXIMATE/UNAVAILABLE)
- ❌ Manca `trajectory` come array strutturato (esiste `trackingData` come string JSON)
- ❌ Manca `rawPoseFrames` (posa grezza)
- ❌ Manca `schemaVersion`
- ❌ `shotResult` include 'BLOCKED' e 'AIRBALL' ma non 'UNCERTAIN'

### AddShotEventPayload (linee 56-66)
```typescript
export interface AddShotEventPayload {
    timestampMs: number
    shotResult: ShotResult
    courtX: number
    courtY: number
    distanceFromHoop: number
    releaseAngle?: number
    releaseVelocity?: number
    detectionConfidence: number
    trackingData?: string
}
```

**Gap:**
- ❌ Stessi gap di ShotEvent
- ❌ Manca `sessionId` e `userId` (passati come parametri API)

### TrackingState (linee 92-110)
```typescript
export interface TrackingState {
    ballPosition: { x: number; y: number } | null
    ballPositionRaw: { x: number; y: number } | null
    ballVelocity: { vx: number; vy: number } | null
    ballWidth?: number
    ballHeight?: number
    hoopPosition: { x: number; y: number; width?: number; height?: number; confidence?: number } | null
    shotDetected: boolean
    shotResult: ShotResult | null
    shotId?: string // ✅ Aggiunto: UUID stabile generato quando tiro rilevato
    trajectory: Array<{ x: number; y: number; t: number }>  // ✅ Esiste!
    confidence: number
    inFlight: boolean
    releasePoint?: { x: number; y: number }
    apexPoint?: { x: number; y: number }
    releaseAngle?: number
    shotQuality?: number
}
```

**Note positive:**
- ✅ `trajectory` esiste come array di punti con timestamp
- ✅ `releasePoint` e `apexPoint` esistono
- ✅ `inFlight` esiste per stato volo
- ✅ `shotId` aggiunto per identità stabile del tiro (Fase 1 correzione P0)

### PoseKeypoints (linee 112-125)
```typescript
export interface PoseKeypoints {
    leftShoulder?: { x: number; y: number; score: number }
    rightShoulder?: { x: number; y: number; score: number }
    leftElbow?: { x: number; y: number; score: number }
    rightElbow?: { x: number; y: number; score: number }
    leftWrist?: { x: number; y: number; score: number }
    rightWrist?: { x: number; y: number; score: number }
    leftHip?: { x: number; y: number; score: number }
    rightHip?: { x: number; y: number; score: number }
    leftKnee?: { x: number; y: number; score: number }
    rightKnee?: { x: number; y: number; score: number }
    leftAnkle?: { x: number; y: number; score: number }
    rightAnkle?: { x: number; y: number; score: number }
}
```

**Note:**
- ✅ Formato posa grezzo esistente con coordinate e confidenza
- ❌ Manca `timestampMs` per associare frame al tiro
- ❌ Manca `coordinateSpace` (IMAGE_NORMALIZED vs IMAGE_PIXELS)

---

## 2. ShotDetectionEngine

**File:** `src/features/workouts/tracking/ShotDetectionEngine.ts`

### Stati interni (linee 52-58)
```typescript
private lastShotTs = 0
private peakY = Infinity
private apexPoint: BallPosition | null = null
private inFlight = false
private releasePoint: BallPosition | null = null
private shotDetected = false
private shotResult: 'MADE' | 'MISS' | 'AIRBALL' | null = null
```

### Trajectory buffer (linee 46-50)
```typescript
private readonly MAX_POINTS = 90
private trajectoryBuffer: Array<TrajectoryPoint | null> = new Array(this.MAX_POINTS).fill(null)
private trajectoryHead = 0
private trajectoryCount = 0
```

**Note positive:**
- ✅ Ring buffer per traiettoria (90 punti)
- ✅ Stati: inFlight, releasePoint, apexPoint
- ✅ `getTrajectoryPoints()` restituisce array ordinato
- ✅ `resetShot()` e `resetAll()` per lifecycle

**Gap:**
- ✅ Nessuno stato UNCERTAIN (gestito da ShotEventBuilder.normalizeShotResult)
- ✅ Nessun buffer per posa grezza (gestito da ShotEventBuilder.addPoseFrame)
- ✅ Nessun shotId generato (generato in TrackingEngine quando rileva nuovo tiro)
- ✅ Nessuna associazione timestamp → posa frames (gestito da ShotEventBuilder)

---

## 3. Overlay e Scia (showShotTrail)

**File:** `src/features/workouts/components/RealtimeBallOverlay.tsx`

### SharedValues per scia (linee 63-65)
```typescript
showShotTrail: any
trajectoryPoints: any
trajectoryPointCount: any
```

### Rendering scia (linee 322-345)
```typescript
const shotTrailPath = useDerivedValue(() => {
    const showTrail = sharedValues?.showShotTrail.value ?? false
    const isInFlight = sharedValues?.inFlight.value ?? false

    if (!showTrail) return shotTrailPathRef.current

    const trajPoints = sharedValues?.trajectoryPoints.value
    const trajCount = sharedValues?.trajectoryPointCount.value ?? 0

    if (!trajPoints || trajCount < 2) return shotTrailPathRef.current

    // ... costruzione path Skia
})
```

**Note positive:**
- ✅ `showShotTrail` controlla visibilità scia
- ✅ `trajectoryPoints` (Float32Array flat) contiene punti
- ✅ Rendering Skia per performance

**Gap:**
- ❌ Scia non distingue DETECTION vs PREDICTION
- ❌ Scia non cambia colore per MADE/MISS (usa colore fisso)
- ❌ Nessun colore per UNCERTAIN
- ❌ Scia non persiste per durata configurabile dopo completamento
- ❌ Coordinate non convertite per rotazione/mirroring/crop (solo mapping normalized → screen)

---

## 4. Runtime e Gestione Eventi SHOT

**File:** `src/features/workouts/runtime/WorkoutSessionRuntime.ts`

### processFrame() - Shot detection (linee 186-205)
```typescript
// Fase 1: Correzioni P0/P1 applicate
if (trackingState?.shotDetected && trackingState?.shotResult) {
  // Check idempotency: skip if this shotId was already processed or is pending
  if (trackingState.shotId) {
    if (this.processedShotIds.has(trackingState.shotId)) {
      return
    }
    if (this.pendingShotIds.has(trackingState.shotId)) {
      return
    }
  }

  // Use ShotEventBuilder to build complete payload with trajectory, pose, court position
  const payload = this.shotEventBuilder.buildAddShotPayload(
    trackingState,
    this.config.sessionId,
    {
      calibration: undefined,
      cameraResolution: this.config.cameraResolution,
    }
  )

  // Normalize shot result for public contract
  const normalizedResult = this.shotEventBuilder.normalizeShotResult(trackingState.shotResult)

  // Mark shot as pending before enqueueing
  if (payload.shotId) {
    this.pendingShotIds.add(payload.shotId)
  }

  // Enqueue shot event to critical queue with complete payload and await result
  const enqueueSuccess = await this.enqueueCritical({
    type: 'SHOT',
    sessionId: this.config.sessionId,
    userId: this.config.userId,
    payload: {
      ...payload,
      shotResult: normalizedResult,
    },
  })

  // Only mark as processed and update metrics if enqueue succeeded
  if (enqueueSuccess && payload.shotId) {
    this.pendingShotIds.delete(payload.shotId)
    this.processedShotIds.add(payload.shotId)

    // Clear pose buffer after shot is saved to avoid mixing pose data between shots
    this.shotEventBuilder.clearPoseBuffer()

    // Update metrics
    this.metrics.totalShots++
    if (trackingState.shotResult === 'MADE') {
      this.metrics.madeShots++
    }

    // Notify callback (normalized to MADE/MISS/UNCERTAIN)
    this.callbacks?.onShotDetected?.(normalizedResult)
  } else if (!enqueueSuccess && payload.shotId) {
    // Enqueue failed - remove from pending and log error
    this.pendingShotIds.delete(payload.shotId)
    console.error(`Failed to enqueue shot ${payload.shotId}, not counted in metrics`)
  }
}
```

**Note positive:**
- ✅ Runtime rileva shotDetected da TrackingEngine
- ✅ Usa ShotEventBuilder per payload completo con trajectory, posa, court position
- ✅ shotId stabile da TrackingState (non rigenerato)
- ✅ Check idempotenza su processedShotIds e pendingShotIds
- ✅ Attende esito enqueueCritical prima di aggiornare metriche
- ✅ Normalizza shotResult (AIRBALL/BLOCKED → UNCERTAIN)
- ✅ Callback supporta UNCERTAIN
- ✅ Posa grezza alimentata durante sessione via addPoseFrame()
- ✅ Buffer posa pulito dopo salvataggio tiro

**Gap risolti (Fase 1):**
- ✅ shotId presente e stabile (generato in TrackingEngine)
- ✅ courtX/courtY calcolati da ShotEventBuilder
- ✅ Traiettoria strutturata inclusa nel payload
- ✅ Posa grezza inclusa nel payload
- ✅ Conteggio solo se enqueueSuccess (idempotente)
- ✅ UNCERTAIN gestito coerentemente

### registerManualShot() (linee 266-328)
```typescript
async registerManualShot(result: 'MADE' | 'MISS'): Promise<void> {
  // Generate stable shotId for manual shot
  const shotId = generateUUID()

  // Build minimal TrackingState for manual shot
  const manualTrackingState: any = {
    shotId,
    shotResult: result,
    shotDetected: true,
    ballPosition: null,
    trajectory: [],
    confidence: 1.0,
  }

  // Use ShotEventBuilder to build consistent payload
  const payload = this.shotEventBuilder.buildAddShotPayload(
    manualTrackingState,
    this.config.sessionId,
    {
      calibration: undefined,
      cameraResolution: this.config.cameraResolution,
    }
  )

  // Mark shot as pending before enqueueing
  this.pendingShotIds.add(shotId)

  // Enqueue to critical queue and await result
  const enqueueSuccess = await this.enqueueCritical({
    type: 'SHOT',
    sessionId: this.config.sessionId,
    userId: this.config.userId,
    payload: {
      ...payload,
      shotResult: result,
      trackingData: JSON.stringify({ manualEntry: true }),
    },
  })

  // Only mark as processed and update metrics if enqueue succeeded
  if (enqueueSuccess) {
    this.pendingShotIds.delete(shotId)
    this.processedShotIds.add(shotId)

    // Update metrics
    this.metrics.totalShots++
    if (result === 'MADE') {
      this.metrics.madeShots++
    }

    // Notify callback
    this.callbacks?.onShotDetected?.(result)
  } else {
    // Enqueue failed - remove from pending and log error
    this.pendingShotIds.delete(shotId)
    console.error(`Failed to enqueue manual shot ${shotId}, not counted in metrics`)
  }
}
```

**Note positive:**
- ✅ Usa ShotEventBuilder per unificare percorso automatici/manuali
- ✅ Genera shotId stabile per tiri manuali
- ✅ Stesso pattern pending/processed per idempotenza
- ✅ Metrics aggiornate solo se enqueueSuccess

**Gap risolti (Fase 1):**
- ✅ shotId generato per tiri manuali
- ✅ Unificazione percorso eventi tramite ShotEventBuilder

---

## 5. API Backend e DTO

**File:** `src/features/workouts/api/workouts.api.ts`

### addShotEvent() (linee 113-119)
```typescript
export const addShotEvent = async (
    sessionId: string, userId: string, payload: AddShotEventPayload
): Promise<ShotEvent> => {
    const r = await apiClient.post<ShotEvent>(
        `/workouts/sessions/${sessionId}/shots?userId=${userId}`, payload)
    return r.data
}
```

**Note positive:**
- ✅ Endpoint esistente
- ✅ Restituisce ShotEvent con id generato dal backend

**Gap:**
- ❌ Payload non include trajectory strutturata
- ❌ Payload non include rawPoseFrames
- ❌ Backend genera id, non idempotente per retry
- ❌ Nessun endpoint batch per tiri offline

### getSessionShots() (linee 105-111)
```typescript
export const getSessionShots = async (
    sessionId: string, userId: string
): Promise<ShotEvent[]> => {
    const r = await apiClient.get<ShotEvent[]>(
        `/workouts/sessions/${sessionId}/shots?userId=${userId}`)
    return r.data
}
```

**Note positive:**
- ✅ Recupera tutti i tiri della sessione
- ✅ Utile per shot chart e riepilogo

**Gap:**
- ❌ ShotEvent non contiene trajectory/pose grezza

---

## 6. Persistenza Locale e Offline Queue

**File:** `src/features/workouts/services/workoutAsyncQueue.ts`

### BoundedQueue per telemetry (linee 12-50)
```typescript
class BoundedQueue<T> {
  private queue: T[] = []
  private droppedCount = 0
  // ... drop-oldest behavior
}
```

### Critical outbox (linee 86)
```typescript
private criticalOutbox: PersistentOutbox
```

**Note positive:**
- ✅ PersistentOutbox per eventi critici (SHOT, SESSION_START, SESSION_END)
- ✅ BoundedQueue per telemetry (drop-oldest)
- ✅ Worker asincrono per flush

**Gap:**
- ✅ Critical outbox supporta deduplicazione per shotId (Fase 1 correzione)
- ✅ Meccanismo per evitare duplicati su retry (check shotId in memoryQueue)
- ✅ FrameDataPayload non include pose grezza strutturata (non necessario, posa in SHOT events)

### FrameDataPayload (linee 52-70)
```typescript
interface FrameDataPayload {
  sessionId: string
  userId: string
  frameTimestamp: number
  ballX?: number
  ballY?: number
  ballWidth?: number
  ballHeight?: number
  ballConfidence?: number
  hoopX?: number
  hoopY?: number
  hoopConfidence?: number
  ballVelocityX?: number
  ballVelocityY?: number
  shotDetected?: boolean
  trajectoryData?: {
    points: any[]  // ❌ Non strutturato
  }
}
```

**Gap:**
- ❌ Nessun poseData
- ❌ trajectoryData.points non tipizzato

---

## 7. Schermate Shot Chart e Statistiche

**File:** `src/features/workouts/screens/ShotChartScreen.tsx`

### Rendering shot chart (linee 96-100)
```typescript
{filtered.map((shot, i) => {
    const dotX = mx(shot.x)
    const dotY = my(shot.y)
    // ...
})}
```

**Note positive:**
- ✅ ShotChartResponse con shots array
- ✅ Coordinate campo (m) con zone
- ✅ Filtraggio per zona
- ✅ Colore verde/rosso per made/miss

**Gap:**
- ❌ Nessun dettaglio tiro su tap
- ❌ Nessuna visualizzazione traiettoria
- ❌ Nessuna visualizzazione posa grezza
- ❌ Nessun supporto UNCERTAIN

### StatsScreen.tsw

**Note positive:**
- ✅ SessionStats con totalShots, madeShots, missedShots, shootingPercentage
- ✅ ZoneStatistics per zone
- ✅ CareerStats

**Gap:**
- ❌ Statistiche derivate da API, non da ShotEvent persistiti
- ❌ Nessuna esposizione UNCERTAIN

---

## 8. Formato Posa MoveNet

**File:** `src/features/workouts/types/workouts.types.ts`

Vedi sezione 1 - PoseKeypoints (linee 112-125)

**Gap:**
- ❌ Nessun tipo RawPoseFrame con timestampMs
- ❌ Coordinate non specificano IMAGE_NORMALIZED vs IMAGE_PIXELS
- ❌ Nessuna associazione posa → shotId

---

## 9. Decisioni Aperte (da specifica)

### 1. Backend accetta traiettoria e pose raw?
- **Stato attuale:** ShotEvent ha `trackingData?: string` (JSON generico)
- **Risposta:** Parziale - esiste campo ma non esiste schema specifico per trajectory/pose
- **Azione richiesta:** Estendere DTO o creare nuovo endpoint

### 2. Posizione tiro calibrata via omografia?
- **Stato attuale:** CalibrationData ha homographyMatrix e hoopCenter
- **Risposta:** Calibrazione esiste ma non usata per calcolare courtX/courtY
- **Azione richiesta:** Implementare proiezione coordinate immagine → campo

### 3. Conferma MADE con sola camera?
- **Stato attuale:** ShotDetectionEngine usa distanza palla-ferro + velocità
- **Risposta:** Logica MADE esiste ma basata su euristica, non su conferma visiva
- **Azione richiesta:** Valutare se euristica sufficiente o serve miglioramento

### 4. Gestione UNCERTAIN?
- **Stato attuale:** ShotResult = 'MADE' | 'MISS' | 'BLOCKED' | 'AIRBALL'
- **Risposta:** Nessun UNCERTAIN
- **Azione richiesta:** Aggiungere UNCERTAIN a ShotResult o gestire come stato provvisorio locale

### 5. Persistenza locale esistente?
- **Stato attuale:** PersistentOutbox per eventi critici
- **Risposta:** Persistenza esistente ma senza deduplicazione
- **Azione richiesta:** Aggiungere shotId e deduplicazione

### 6. Policy retention keypoint/traiettoria?
- **Stato attuale:** Nessuna policy definita
- **Risposta:** Non gestito
- **Azione richiesta:** Definire limiti (es. 500ms finestra posa, 90 punti traiettoria)

---

## 12. Riepilogo Gap Critici

| Area | Gap | Priorità | Stato |
|------|-----|----------|-------|
| **Idempotenza** | Nessun shotId - retry duplica conteggi | CRITICA | ✅ RISOLTO (Fase 1) |
| **Posizione tiro** | courtX/courtY non calcolati nel payload | CRITICA | ✅ RISOLTO (Fase 1) |
| **Traiettoria** | Nessun array strutturato in ShotEvent | ALTA | ✅ RISOLTO (Fase 1) |
| **Posa grezza** | Nessun buffer posa → shotId | ALTA | ✅ RISOLTO (Fase 1) |
| **UNCERTAIN** | ShotResult non include UNCERTAIN | MEDIA | ✅ RISOLTO (Fase 1) |
| **Verifica persistenza** | Runtime non attende esito enqueue | CRITICA | ✅ RISOLTO (Fase 1) |
| **Percorso unico** | Tiri manuali non usano ShotEventBuilder | MEDIA | ✅ RISOLTO (Fase 1) |
| **Scia overlay** | Nessun colore MADE/MISS/UNCERTAIN | MEDIA | ⏳ PENDING (Fase 2) |
| **Dettaglio tiro** | Shot chart non mostra traiettoria/posa | MEDIA | ⏳ PENDING (Fase 3) |
| **Posizione calibrata** | Omografia non implementata | MEDIA | ⏳ PENDING (Fase 2+) |

---

## 13. Modifiche Implementate (Fase 1 - Correzioni P0/P1) COMPLETATE

### 1. Tipi estesi (workouts.types.ts)
- ✅ Aggiunto `UNCERTAIN` a `ShotResult`
- ✅ Creato `ShotPoint` con x, y, timestampMs, source, confidence
- ✅ Creato `RawPoseFrame` con timestampMs, keypoints, coordinateSpace
- ✅ Creato `CourtPositionQuality` (CALIBRATED/APPROXIMATE/UNAVAILABLE)
- ✅ Esteso `ShotEvent` con shotId, courtPositionQuality, trajectory, rawPoseFrames, schemaVersion
- ✅ Esteso `AddShotEventPayload` con gli stessi campi
- ✅ **Fase 1 P0:** Aggiunto `shotId?: string` a `TrackingState` per identità stabile

### 2. ShotEventBuilder (tracking/ShotEventBuilder.ts)
- ✅ Creato `ShotEventBuilder` con buffer posa grezza
- ✅ Implementato `addPoseFrame()` per alimentare buffer durante sessione
- ✅ Implementato `clearPoseBuffer()` per pulizia dopo salvataggio tiro
- ✅ Implementato conversione trajectory → ShotPoint[]
- ✅ Implementato calcolo courtX/courtY (placeholder per omografia)
- ✅ Implementato calcolo distanza dal canestro
- ✅ Implementato `buildShotEvent()` per costruire ShotEvent completo
- ✅ Implementato `buildAddShotPayload()` per payload API
- ✅ Implementato `normalizeShotResult()` per convertire AIRBLOCK/AIRBALL → UNCERTAIN
- ✅ **Fase 1 P0:** Modificato per usare `trackingState.shotId` invece di generare nuovo UUID

### 3. TrackingEngine aggiornato (tracking/TrackingEngine.ts)
- ✅ **Fase 1 P0:** Aggiunto funzione `generateUUID()`
- ✅ **Fase 1 P0:** Genera shotId stabile quando rileva nuovo tiro (riga 283)
- ✅ **Fase 1 P0:** Reset shotId in `resetShot()` per preparare prossimo tiro

### 4. Runtime aggiornato (WorkoutSessionRuntime.ts)
- ✅ Importato ShotEventBuilder
- ✅ Aggiunto istanza shotEventBuilder
- ✅ **Fase 1 P0:** Aggiunto `pendingShotIds` per tracciare tiri in attesa di conferma
- ✅ **Fase 1 P0:** Aggiunto `processedShotIds` per tracciare tiri salvati con successo
- ✅ **Fase 1 P0:** Modificato `processFrame()` a async per attendere esito persistenza
- ✅ **Fase 1 P0:** Check idempotenza su processedShotIds e pendingShotIds prima di enqueue
- ✅ **Fase 1 P0:** Metrics aggiornate solo se `enqueueSuccess === true`
- ✅ **Fase 1 P0:** Alimenta buffer posa via `addPoseFrame()` con dati MoveNet
- ✅ **Fase 1 P0:** Pulisce buffer posa dopo salvataggio tiro
- ✅ **Fase 1 P1:** Callback supporta UNCERTAIN (rimosso cast non sicuro)
- ✅ **Fase 1 P1:** `registerManualShot()` usa ShotEventBuilder per unificare percorso
- ✅ **Fase 1 P1:** `registerManualShot()` genera shotId stabile e usa pattern pending/processed

### 5. PersistentOutbox aggiornato (persistentOutbox.ts)
- ✅ Modificato add() per estrarre shotId da payload SHOT
- ✅ Aggiunto check duplicati shotId in memoryQueue
- ✅ Modificato generazione id per usare shotId se disponibile
- ✅ Ritorna false se duplicato rilevato

### 6. Tipi Runtime aggiornati (WorkoutSessionRuntime.types.ts)
- ✅ **Fase 1 P1:** `SessionCallbacks.onShotDetected` accetta `'MADE' | 'MISS' | 'UNCERTAIN'`
- ✅ **Fase 1 P0:** `IWorkoutSessionRuntime.processFrame()` firma aggiornata a async

### 7. WorkoutSessionScreen aggiornato (screens/WorkoutSessionScreen.tsx)
- ✅ **Fase 1 P0:** Chiamate a `runtime.processFrame()` aggiornate con `void` (fire-and-forget)

### 8. Export aggiornato (tracking/index.ts)
- ✅ Aggiunto export ShotEventBuilder

---

## 14. Ottimizzazioni Performance Completate (PASS 5K-A.2)

### Problema Risolto
- PASS 5K-A.2 leggeva 21 SharedValue ogni frame prima di sapere se la cache era valida
- 42+ chiamate Date.now() per misurare ogni singolo .value contaminavano il benchmark
- Cache hit rate ~77% ma sharedValueReads rimaneva ~29 ms perché leggeva comunque tutto

### Soluzione Applicata
1. **Riorganizzato letture SharedValue:**
   - Percorso iniziale: hasBbox, lastSeenAt, detectionId, lastProcessedDetectionId, cachedBboxDetectionId (5 reads)
   - Cache hit: aggiunge cachedBbox×5 + detectedAt (6 reads aggiuntive, totale 11)
   - Cache miss: aggiunge bbox×5 + smoothed×5 + detectedAt (11 reads aggiuntive, totale 16)
   - Prima: 21 reads sempre

2. **Profiling semplificato:**
   - Rimosso 21 timer individuali (svReadHasBboxMs, svReadLastSeenAtMs, ecc.)
   - Sostituito con 2 metriche: cachePathReadMs, missPathReadMs
   - Rimosso dateNowOverheadMs, smoothingUnaccountedMs, resultUnaccountedMs
   - Rimosso getEffectiveBboxSvWritesMs (misurava solo il contatore, non le write reali)

3. **Reset completo:**
   - Aggiunto reset di bboxX, bboxY, bboxWidth, bboxHeight
   - Aggiunto reset di consecutiveRejects
   - Aggiunto reset di cacheHits, cacheMisses
   - Aggiunto reset di tutti i profiler per per-session metrics

4. **Ripristinato smoothingFactor a 0.3** (valore originale, 0.1 era solo per test)

### Nuovi Export
- cachePathReadMs: tempo per leggere SharedValues necessarie alla validazione cache
- missPathReadMs: tempo per leggere SharedValues aggiuntive su cache miss

### Architettura
- Semantica strict-current inalterata
- Semantica cache inalterata
- Solo ottimizzazione del percorso di lettura e riduzione overhead profiler

---

## 15. Vision Migration Completata (Fase 2-5)

### Fase 2 - Pure Layer + Worker Integration
- Creato vision/engine/ con:
  - VisionEngine.ts: orchestrazione YOLO + MoveNet
  - YoloDetector.ts: parsing YOLO puro worklet-safe
  - MoveNetPoseEstimator.ts: parsing MoveNet puro worklet-safe
  - BallDetectionProcessor.ts: filtraggio ball detection
  - VisionEngineAdapter.ts: bridge transitorio
- YoloDetector integrato in useYoloWorker (sostituisce parseYoloOutputFloat16)
- MoveNetPoseEstimator integrato in useMoveNetWorker (sostituisce parseMoveNetOutput)
- Codice legacy rimosso: poseParser.ts, yoloParserFloat16.ts

### Fase 3 - VisionEngine Integration
- Workers restituiscono parsed results (non raw output)
- VisionEngine accetta parsed results con fallback per raw outputs
- VisionEngineAdapter istanzia VisionEngine e gli passa parsed results
- Callbacks aggiornati per feed VisionEngineAdapter
- Conversione tipo: vision/types → VisionEngine.types

### Fase 4 - Runtime.processFrame() Activation
- VisionEngineAdapter istanziato in WorkoutSessionScreen
- Collegato a Runtime via setVisionEngine()
- Runtime.processFrame() chiamato dai callbacks quando Runtime è ACTIVE
- Flag useRuntimeProcessingRef per toggle tra path Runtime e legacy
- Fix double ShotDetectionEngine call
- Tracking state sync via onTrackingStateUpdate callback

### Fase 5 - Legacy Cleanup
- ShotDetector.ts rimosso completamente
- handleShotEvent rimosso da WorkoutSessionScreen
- VisionPipelineAdapter rimosso da Runtime e Screen
- useShotTracker ridotto a wrapper di workers
- BallTrajectoryAnalyzer implementato per separazione palleggio/tiro
- Kalman semantica corretta (ballLastSeenAt basato su detection accettate)
- MoveNet bbox current detection (Decision 31)
- Player stability threshold correction (Decision 32)

### Architettura Finale (Single Path)
```
Camera
  ↓
useWorkoutVisionPipeline (useCameraPipeline)
  ↓
Workers (useYoloWorker, useMoveNetWorker)
  ↓ (inference + parsing)
  ↓
Callbacks (handleBallDetection, handlePoseResult, handleRimDetection, handlePlayerDetection)
  ↓
VisionEngineAdapter.updateParsedResults()
  ↓
Runtime.processFrame() [ATTIVO QUANDO useRuntimeProcessingRef = true]
  ↓
VisionEngine.processFrame() (orchestrazione)
  ↓
TrackingEngine.processFrame()
  ↓
ShotDetectionEngine (interno)
  ↓
onTrackingStateUpdate callback
  ↓
setTrackingState + tracking.updateSharedValuesFromState()
```

---

## Fase 3 - Completamento del Resoconto del Workout

### Obiettivo

Il resoconto dovrà rappresentare i dati reali di una sessione conclusa, non una simulazione.

**A. Tabellone del campo**
- Metà campo da basket con orientamento e proporzioni coerenti
- Un pallino per ciascun tiro registrato, nella posizione del giocatore al momento del rilascio
- Verde per il canestro, rosso per l'errore
- Voto da 1 a 10 dentro il pallino, se disponibile
- Angolo della parabola in gradi sopra il pallino, se disponibile
- Gestione etichette ravvicinate per evitare sovrapposizioni

**B. Riepilogo statistico**
- Tiri totali (N)
- Canestri (N / %)
- Voto medio (— / 10) - solo tiri con voto disponibile
- Angolo medio (—°) - solo tiri con angolo valido

**C. Dettaglio dei singoli tiri**
- Esito, posizione, voto, angolo, distanza dal canestro
- Confronto rapido tra ciò che è disegnato sul campo e il dato salvato

### Fase 0 - Audit dei Sorgenti (In Corso)

Questo documento (SHOT_COMPLETION_AUDIT.md) rappresenta la base della Fase 0 dell'audit. Le verifiche già eseguite in questo documento sono:

**Verifiche completate:**
- ✅ Tipi ShotEvent esistenti analizzati
- ✅ ShotDetectionEngine analizzato
- ✅ Overlay e scia analizzati
- ✅ Runtime e gestione eventi SHOT analizzati
- ✅ API Backend e DTO analizzati
- ✅ Persistenza locale e offline queue analizzata
- ✅ Schermate Shot Chart e statistiche analizzate
- ✅ Formato posa MoveNet analizzato
- ✅ Decisioni aperte identificate
- ✅ Gap critici riepilogati
- ✅ Modifiche implementate (Fase 1 - Correzioni P0/P1) documentate

**Verifiche aggiuntive richieste per Fase 0:**

**0.3 - Verificare la posizione del giocatore (Criticità confermata)**
- ShotEventBuilder usa `trackingState.ballPosition` invece della posizione del giocatore
- Omografia non implementata (commento nel codice)
- `timestampMs` assegnato con `Date.now()` al momento della costruzione dell'evento

**0.4 - Verificare voto e angolo**
- `TrackingState` contiene `releaseAngle` e `shotQuality`
- `ShotEventBuilder` trasferisce `releaseAngle` nell'evento
- Domande aperte:
  - `shotQuality` corrisponde a un voto 1-10?
  - Angolo e qualità vengono salvati e restituiti dall'API?

**0.5 - Verificare salvataggio e recupero**
- Struttura evento inviato: analizzata
- Identificativo sessione/tiro: analizzato
- Coda e retry: analizzati
- Salvataggio database: da verificare nel backend
- API resoconto: da verificare nel backend

**0.6 - Verificare la chiusura del workout**
- Sequenza "Fine workout": da ricostruire nei sorgenti
- Ultimi eventi tiro: da verificare
- Gestione coda: analizzata
- Conferma backend: da verificare
- Recupero resoconto: da verificare

### Fasi Successive - Analisi e Implementazione Guidata

| Fase | Attività | Risultato da verificare |
|------|----------|-------------------------|
| 1 | Definizione del contratto dati del tiro | Tutti i componenti concordano sui campi e sul loro significato |
| 2 | Correttezza temporale e posizione del giocatore | Il tiro è associato al frame e alla posizione corretti |
| 3 | Esito, voto e angolo | Regole definite, dati coerenti e valori mancanti gestiti |
| 4 | Persistenza e API | I dati arrivano al backend e vengono recuperati senza perdite |
| 5 | Schermata del resoconto | Campo, pallini, etichette, dettaglio e statistiche sono coerenti |
| 6 | Chiusura e sincronizzazione | Il resoconto include anche gli ultimi tiri |
| 7 | Collaudo end-to-end | I risultati superano una checklist di test ripetibili |

### Metodologia di Lavoro

Ogni passaggio avrà sempre cinque elementi:
1. **Analisi:** Cosa succede nel codice attuale
2. **Problema dimostrato:** Cosa manca o cosa non funziona, con riferimenti ai file e ai punti pertinenti
3. **Istruzioni operative:** Cosa dovrai fare tu, in quale ordine
4. **Verifica:** Quali risultati, log o test dovrai condividere
5. **Decisione:** Passiamo oltre soltanto se i criteri sono soddisfatti

Non considereremo conclusa una fase perché il codice compila soltanto.

### Matrice di Test Finale

Prima di dichiarare conclusa la Fase 3, prepareremo una matrice di test che comprenda almeno questi casi:
- Workout con soli canestri
- Workout con soli errori
- Workout misto
- Tiri ravvicinati sul tabellone
- Tiro senza voto o senza angolo disponibile
- Più tiri in rapida successione
- Interruzione o ritardo di rete
- Chiusura immediata dopo l'ultimo tiro
- Riapertura del resoconto dopo aver concluso la sessione

Per ogni caso confronteremo tre conteggi: tiri effettivamente eseguiti, eventi registrati e tiri visualizzati. Verificheremo anche le singole coordinate, gli esiti e i valori mostrati.

### Stato Fase 3

- ✅ Fase 0 - Audit dei sorgenti: COMPLETATA
- ✅ Fase 1 - Correzioni P0/P1: COMPLETATA
- ✅ Vision Migration Fase 2-5: COMPLETATE
- ✅ PASS 5K-A.2 Ottimizzazioni Performance: COMPLETATE
- ✅ Refactoring Player Position Snapshot: COMPLETATA
- ✅ Protezione Concorrenza Runtime: COMPLETATA
- ⏳ Fase 2 - Visualizzazione Scia: PENDING
- ⏳ Fase 3 - Report Sessione: PENDING

---

## 16. Refactoring Player Position Snapshot (2026-10-11)

### Problema Risolto
- Il calcolo del centro YOLO aggiungeva metà larghezza e altezza alle coordinate fornite dal detector
- La selezione snapshot playerPositionAtRelease non aveva una gerarchia chiara tra MoveNet e YOLO
- Il Runtime non resettava lo stato del tiro dopo il salvataggio, bloccando il rilevamento dei tiri successivi

### Soluzione Applicata

#### 1. Correzione Calcolo Centro YOLO (TrackingEngine.ts)
- **Prima:** `x: playerDetection.x + width/2, y: playerDetection.y + height/2`
- **Dopo:** `x: playerDetection.x, y: playerDetection.y` (usa coordinate centrali fornite dal detector)
- **File:** `src/features/workouts/tracking/TrackingEngine.ts` (righe 117-140)

#### 2. Riorganizzazione Selezione Snapshot (TrackingEngine.ts)
- **Priorità:** MoveNet (se valido e recente ≤200ms) → YOLO (se valido e recente ≤200ms) → undefined
- **File:** `src/features/workouts/tracking/TrackingEngine.ts` (righe 292-341)
- **Logica:**
  1. Se playerCenter disponibile da poseKeypoints → usa direttamente
  2. Se playerPositionAtRelease non ancora impostato e playerTrackingEngine ha posizione valida e recente → usa YOLO
  3. Se nessuna delle condizioni → undefined

#### 3. Reset Shot dopo Salvataggio (WorkoutSessionRuntime.ts)
- **Posizione:** Nel ramo di successo di `enqueueCritical()` (riga 324)
- **Condizione:** Solo se `enqueueSuccess && payload.shotId`
- **Azione:** `this.trackingEngine?.resetShot()` dopo callback onShotDetected
- **File:** `src/features/workouts/runtime/WorkoutSessionRuntime.ts`

#### 4. Protezione Concorrenza Runtime (WorkoutSessionRuntime.ts)
- **Campi aggiunti:**
  - `isProcessingFrame: boolean` - flag per bloccare chiamate concorrenti
  - `currentFramePromise: Promise<void> | null` - Promise per coordinamento stop()
- **Separazione metodi:**
  - `processFrame()` pubblico - coordinamento e gestione flag
  - `processFrameInternal()` privato - esecuzione effettiva
- **Comportamento:**
  - Se `isProcessingFrame = true` → nuova chiamata scartata
  - try/finally garantisce ripristino flag anche in caso di errore
- **File:** `src/features/workouts/runtime/WorkoutSessionRuntime.ts` (righe 171-349)

#### 5. Coordinamento Stop() (WorkoutSessionRuntime.ts)
- **Modifica:** `stop()` ora attende `currentFramePromise` prima di passare a SYNCING
- **Sequenza:**
  1. Imposta STOPPING (blocca nuove chiamate processFrame)
  2. Se `currentFramePromise` esiste → await completamento
  3. Passa a SYNCING
  4. Chiude coda
  5. Passa a COMPLETED
- **Beneficio:** Garantisce che frame in corso completi metriche, callback e reset prima della chiusura
- **File:** `src/features/workouts/runtime/WorkoutSessionRuntime.ts` (righe 138-165)

### Verifica Persistenza Locale
- `enqueueCritical()` in `workoutAsyncQueue.ts` (riga 119) usa `await this.criticalOutbox.add()`
- Conferma salvataggio nell'outbox locale prima di restituire `success`
- Il backend può fallire ma l'evento è conservato per recupero

### Architettura Aggiornata
```
Camera → useCameraPipeline → Workers → Callbacks
  ↓
VisionEngineAdapter.updateParsedResults()
  ↓
Runtime.processFrame() [con protezione concorrenza]
  ↓
processFrameInternal() [esecuzione]
  ↓
TrackingEngine.processFrame()
  ↓
ShotDetectionEngine (interno)
  ↓
if shotDetected:
  buildAddShotPayload() [snapshot playerPositionAtRelease]
  ↓
await enqueueCritical() [persistenza locale]
  ↓
if success:
  update metrics
  onShotDetected callback
  trackingEngine.resetShot() [permette prossimo tiro]
  ↓
stop() [attende currentFramePromise se presente]
```

### Stato Implementazione
- ✅ Calcolo centro YOLO corretto
- ✅ Selezione snapshot MoveNet → YOLO → undefined
- ✅ ResetShot() dopo salvataggio locale riuscito
- ✅ Protezione concorrenza processFrame()
- ✅ Coordinamento stop() con frame in corso
- ✅ Verifica persistenza locale confermata
