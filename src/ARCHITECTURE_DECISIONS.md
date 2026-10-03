# MVPIQ Hoops - Architecture Decisions

## Decision 1: Separazione Pipeline Realtime vs Async

**Contesto:** La pipeline di vision deve elaborare frame a 20+ FPS, ma il backend HTTP e la persistenza non possono bloccare il realtime.

**Decisione:**
- Il frame processor non aspetta mai il backend, React state, persistenza o telemetria JS
- Tutto ciò che può essere asincrono viene separato dal percorso realtime
- YOLO/MoveNet rimangono sincroni nel worklet (runSync) come documentato da react-native-fast-tflite
- La queue async gestisce il backend e la persistenza in background

**Rationale:**
- react-native-fast-tflite documentazione per VisionCamera mostra `runSync()` nel worklet
- Il problema vero è YOLO + MoveNet sequenziali sullo stesso thread, non la sincronicità
- Non inventare pseudo-asincronità che sposta il carico sul JS thread

**Conseguenze:**
- Vision pipeline: 20 FPS realtime
- Backend telemetry: 2 Hz (sampling)
- Critical events: queue con retry
- UI: SharedValues per rendering a 60 FPS

---

## Decision 2: Queue Session-Scoped vs Singleton Globale

**Contesto:** La queue async era implementata come singleton globale, causando race condition tra sessioni.

**Decisione:**
- WorkoutAsyncQueue è session-scoped, non singleton
- Ogni sessione crea la sua istanza con `createWorkoutQueue({ sessionId, userId })`
- La queue viene distrutta alla fine della sessione con `shutdown()`

**Rationale:**
- Evita race condition tra sessioni concorrenti
- Garantisce che eventi critici non vengano mescolati tra sessioni
- Semplifica il lifecycle management

**Conseguenze:**
- Ogni sessione ha la sua queue isolata
- PersistentOutbox per eventi critici per sessione
- Pulizia automatica alla fine della sessione

---

## Decision 3: Durable Outbox per Eventi Critici

**Contesto:** Gli eventi critici (SHOT, SESSION_START, SESSION_END, CALIBRATION) non possono essere persi in caso di crash o riavvio.

**Decisione:**
- PersistentOutbox con AsyncStorage per eventi critici
- Eventi critici vengono salvati in AsyncStorage prima dell'invio
- Retry con backoff esponenziale in caso di fallimento
- Caricamento automatico di item pendenti da sessioni precedenti

**Rationale:**
- Garantisce che eventi critici non vengano persi
- Permette recovery dopo crash o riavvio
- La telemetria può essere persa (best-effort), ma gli eventi critici no

**Conseguenze:**
- SHOT, SESSION_START, SESSION_END, CALIBRATION sono persistenti
- Telemetry frame data è best-effort (bounded queue con drop oldest)
- Retry automatico con backoff esponenziale

---

## Decision 4: Sampling 2 Hz per Telemetry Backend

**Contesto:** Inviare ogni frame al backend (20 FPS) causa carico HTTP eccessivo.

**Decisione:**
- TelemetrySampler per limitare invio a 2 Hz (ogni 500ms)
- Solo 1 frame su 10 viene inviato al backend
- Batch di 20 frame per richiesta HTTP

**Rationale:**
- Riduce carico HTTP da 20 richieste/sec a 1 richiesta batch/sec
- Il backend non ha bisogno di ricevere ogni frame
- Sampling sufficiente per analisi post-sessione

**Conseguenze:**
- Camera: 20 FPS
- YOLO: ~10-15 FPS
- Tracking: realtime
- Backend telemetry: 2 FPS
- Shot events: 100%

---

## Decision 5: Throttling Bridge scheduleOnRN

**Contesto:** scheduleOnRN viene chiamato troppo frequentemente (ogni 16ms), causando crossing JS bridge eccessivi.

**Decisione:**
- Throttling aumentato da 16ms a 66ms (15 FPS)
- SharedValues/Skia gestiscono rendering a 60 FPS
- Solo dati critici attraversano il bridge a 15 FPS

**Rationale:**
- Riduce crossing JS bridge da ~62/sec a ~15/sec
- Il rendering UI rimane fluido grazie a SharedValues
- Riduce overhead di serializzazione

**Conseguenze:**
- Bridge calls: 15 FPS
- UI rendering: 60 FPS (via SharedValues)
- Vision pipeline: 20+ FPS

---

## Decision 6: Flush Semantics Granulari

**Contesto:** flushCritical() e flushTelemetry() chiamavano entrambi lo stesso metodo flush(), causando confusione.

**Decisione:**
- flushCriticalOnly() - processa solo critical queue
- flushTelemetryOnly() - processa solo telemetry queue
- flushAll() - processa entrambe le queue
- shutdown() - flushAll() + pulizia outbox

**Rationale:**
- Semantica chiara per ogni operazione
- Permette flush selettivo a seconda del contesto
- shutdown() garantisce pulizia completa

**Conseguenze:**
- Fine sessione: shutdown() per flush completo
- Mid-session: flushCriticalOnly() per eventi urgenti
- Telemetry: flushTelemetryOnly() per dati non critici

---

## Decision 7: Propagazione Errori da saveFrameDataBatch

**Contesto:** saveFrameDataBatch() ingoiava gli errori, rendendo impossibile il retry a livello queue.

**Decisione:**
- saveFrameDataBatch() propaga errori al chiamante
- La queue decide cosa fare (telemetry = drop, critical = retry)
- Error handling centralizzato nella queue

**Rationale:**
- La queue deve controllare la strategia di retry
- Telemetry può essere persa (best-effort)
- Critical events devono essere ritentati

**Conseguenze:**
- Errori HTTP vengono gestiti dalla queue
- Telemetry: drop su errore
- Critical: retry con backoff

---

## Decision 8: Flag Compile/Config per Log Hot Path

**Contesto:** Log __DEV__ nel hot path causano overhead di serializzazione e allocation.

**Decisione:**
- debugConfig.ts con flag centralizzati
- HOT_PATH_LOGS disabilitato di default anche in DEV
- ENABLE_PLAYER_CROP_LOGS, ENABLE_ADAPTIVE_PERFORMANCE_LOGS, ENABLE_MOVENET_LOGS
- Flag possono essere abilitati singolarmente per debugging

**Rationale:**
- Elimina overhead di log in produzione
- Permette debugging selettivo
- Centralizzazione della configurazione

**Conseguenze:**
- Nessun log hot path in produzione
- Debugging selettivo per componente
- Facile toggle per performance testing

---

## Decision 9: Ring Buffer per detectionHistory

**Contesto:** detectionHistory usava array con push/filter, creando continuamente nuovi array.

**Decisione:**
- Ring buffer con dimensione fissa (60 elementi)
- Index ciclico per evitare allocation
- Contatore per tracciare elementi validi

**Rationale:**
- Evita allocation continue
- Performance prevedibile
- Memoria costante

**Conseguenze:**
- detectionHistory: ring buffer 60 elementi
- Nessuna allocation durante runtime
- Memory footprint costante

---

## Decision 10: Set → Contatori per Telemetry

**Contesto:** telemetry.ts usava Set per tracciare frame, crescendo potenzialmente all'infinito.

**Decisione:**
- Sostituire Set con contatori semplici
- yoloProcessedFramesCount, ballDetectionFramesCount, playerDetectionFramesCount
- Incremento atomico per ogni frame

**Rationale:**
- 20 FPS × 60 minuti = 72.000 frame
- Set cresce all'infinito
- Contatori hanno footprint costante

**Conseguenze:**
- Telemetry: contatori invece di Set
- Memory footprint costante
- Performance migliorata

---

## Decision 11: Endpoint Batch per Backend

**Contesto:** Il frontend inviava frame data singolarmente, causando carico HTTP eccessivo.

**Decisione:**
- Endpoint POST /api/workouts/sessions/{sessionId}/frames/batch
- Accetta lista di FrameDataRequest
- Salva tutti i frame in una singola transazione

**Rationale:**
- Riduce richieste HTTP da 20/sec a 1/sec
- Batch più efficiente per il database
- Allineato con architettura queue async

**Conseguenze:**
- Frontend: batch di 20 frame per richiesta
- Backend: transazione singola per batch
- Carico HTTP ridotto del 95%
