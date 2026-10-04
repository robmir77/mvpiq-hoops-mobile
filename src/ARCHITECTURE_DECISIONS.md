# MVPIQ Hoops - Architecture Decisions

## Model Configurations

### YOLO Models

| Model ID | Input Size | Precision | Epochs | Expected FPS | Actual FPS | Note |
|----------|------------|-----------|--------|--------------|------------|------|
| best_320_float16 | 320x320 | FP16 | 50 | 10-37 | 2-7 | Measured at 640x360 resolution |
| best_384_float16 | 384x384 | FP16 | 100 | 20-21 | 3-6 | Updated to 100 epochs, actual FPS lower due to device bottleneck |
| best_448_float16 | 448x448 | FP16 | 5 | 12-21 | TBD | Early training |
| best_512_float16 | 512x512 | FP16 | 40 | 8-10 | TBD | Balanced performance |
| best_640_float16 | 640x640 | FP16 | 30 | 5-7 | TBD | High resolution |

## Decision 0: Rimozione Throttling Temporale (Natural FPS)

---

## Decision 0.1: Sincronizzazione Reanimated Shared Values

**Contesto:** I shared values di Reanimated (es. `actualCameraFps.value`) venivano letti direttamente durante il render dei componenti React, causando warning di Reanimated: "Reading from `value` during component render."

**Decisione:**
- Sincronizzare i shared values a variabili di stato regolari tramite useEffect
- `WorkoutSessionScreen.tsx`: aggiunto `cameraFps` state aggiornato ogni 1000ms da `actualCameraFps.value`
- `TelemetryOverlay.tsx`: riceve `cameraFps` come prop regolare invece di shared value
- Stesso pattern applicato per `yoloFps` e `moveNetFps`

**Rationale:**
- Reanimated richiede che i shared values non siano letti durante il render
- La sincronizzazione tramite useEffect garantisce che il valore sia disponibile come state regolare
- Evita warning e potenziali problemi di performance

**Conseguenze:**
- Warning Reanimated eliminati
- FPS metrics aggiornati ogni secondo (sufficiente per UI)
- Componenti UI ricevono props regolari invece di shared values
- Architettura più pulita con separazione tra vision layer (shared values) e UI layer (state)

---

**Contesto:** Il sistema throttling deterministico (YOLO 10 FPS, MoveNet 3 FPS) limitava artificialmente la detection rate. Rimuovendo i limiti temporali, i modelli possono girare al massimo FPS possibile dato il tempo di inferenza sincrono.

**Decisione:**
- Rimozione completa del throttling temporale da YOLO e MoveNet
- Rimozione di VISION_CONFIG.YOLO.TARGET_FPS e VISION_CONFIG.MOVENET.TARGET_FPS
- YOLO esegue ogni frame se `!isProcessing` (FPS naturale ~7-10)
- MoveNet esegue ogni frame se `!isProcessing` e bbox player valido (FPS naturale ~0-6)
- Camera FPS: 30 (configurabile via CAMERA_CONFIG.DEFAULT_FPS)
- Tracking: realtime (ogni frame)
- Bridge calls: 15 FPS (throttled a 66ms)

**Rationale:**
- L'architettura sincrona attuale (runSync() nel worklet) ha un limite naturale basato sul tempo di inferenza
- Ogni inferenza YOLO costa ~35-45ms (resize + run + parse)
- Ogni inferenza MoveNet costa ~150-160ms (crop + resize + run + parse)
- Rimuovere limiti artificiali massimizza la detection rate
- FPS naturale dipende solo dal tempo di inferenza sincrono
- Sistema più semplice senza logica di throttling temporale

**Conseguenze:**
- Camera può girare a 30 FPS indipendentemente da YOLO/MoveNet
- YOLO gira a FPS naturale (~7-10) basato su tempo inferenza
- MoveNet gira a FPS naturale (~0-6) basato su tempo inferenza e disponibilità bbox player
- Tracking usa l'ultimo risultato YOLO + Kalman prediction nei frame intermedi
- Telemetry YOLO throttled a 15 FPS (66ms) per ridurre overhead bridge
- Nessun limite temporale artificiale che riduce detection rate
- Configurazione semplice in VISION_CONFIG (solo ENABLED flags)

---

## Decision 0.5: Rimozione Scheduler Duplicati (Single Responsibility)

**Contesto:** useShotTracker.ts conteneva scheduler duplicati per YOLO e MoveNet, creando confusione e accoppiamento inappropriato. Lo scheduling esterno in useShotTracker usava selectedFps (camera FPS) mentre lo scheduling interno nei worker usava VISION_CONFIG (target FPS deterministici).

**Decisione:**
- Rimozione completa dello scheduling YOLO da useShotTracker.ts
- Rimozione completo dello scheduling MoveNet da useShotTracker.ts
- I worker (useYoloWorker, useMoveNetWorker) sono gli unici responsabili del proprio scheduling
- useShotTracker chiama processFrame() ogni frame per entrambi i worker
- Ogni worker decide internamente se eseguire in base a `isProcessing` flag
- Rimozione residui adaptive performance (TARGET_DETECTION_RATE, ADAPTATION_WINDOW_MS, lastAdjustmentTs, updateAdaptiveThreshold)
- Rimozione currentModelIndex e commenti adaptiveModelIndex

**Rationale:**
- Single Responsibility Principle: ogni worker gestisce il proprio scheduling
- Elimina accoppiamento tra camera FPS e worker FPS
- Rimuove ridondanza: ShotTracker scheduler → Worker scheduler
- Semplifica diagnosi: un solo punto di decisione per ogni worker
- Metriche FPS diventano semanticamente corrette (throughput reale vs teorico)
- Log più comprensibili: non c'è più confusione tra scheduler esterno e interno

**Conseguenze:**
- Architettura pulita: Camera → ShotTracker → Worker (con scheduling interno)
- YOLO: scheduling interno basato su `isProcessing` flag (no throttling temporale)
- MoveNet: scheduling interno basato su `isProcessing` flag e bbox player valido (no throttling temporale)
- useShotTracker: orchestrazione semplice, chiama workers ogni frame
- Nessun accoppiamento tra selectedFps e worker scheduling
- Code più facile da mantenere e debuggare

**Risultati (post-implementazione):**
- Camera FPS migliorata da ~4 FPS a 10-14 FPS (senza throttling)
- YOLO FPS naturale ~7-10 confermato dai log
- MoveNet FPS naturale ~0-6 confermato dai log (limitato da disponibilità bbox player)
- Log molto più leggibili e semanticamente corretti
- Problema spostato da "chi decide quando eseguire" a "quanto costa elaborare un frame"
- ✅ Sincronizzazione shared values → state implementata per evitare warning Reanimated

**Roadmap (non implementata):**
1. ✅ Rinominare metriche fps → throughputFps/theoreticalFps per chiarezza semantica
2. ✅ Rimozione throttling temporale per massimizzare detection rate
3. ✅ Sincronizzazione Reanimated shared values per evitare warning
4. Misurare separatamente tempo totale del frame processor
5. Analizzare e ridurre costo MoveNet CPU crop (~30 ms)
6. Investigare parallelizzazione YOLO/MoveNet
7. Verificare rerender/remount di WorkoutSession/ShotTracker

---

## Decision 0.7: Correzione Metriche MoveNet Throughput

**Contesto:** La metrica `theoreticalFps` in MoveNet era calcolata come `1000 / inferenceTime`, rappresentando la capacità di latenza teorica invece del throughput reale. Inoltre, il PERF 1s mostrava sempre `MOVE fps=0.0 exec=0` perché i contatori di performance tracking non venivano aggiornati dal MoveNet worker.

**Decisione:**
- Rimozione completa di `theoreticalFps` da `useMoveNetWorker.ts` (metrica latenza-based errata)
- Implementazione throughput tracking corretto in `telemetry.ts`:
  - `moveNetStartTime` per calcolare throughput reale (executed / elapsedSeconds)
  - `moveNetSkipped` per tracciare frame scartati per bbox non valido
  - `moveNetDroppedBusy` per tracciare frame scartati per busy (latest-frame-wins)
  - `throughputFps` calcolato come `executed / elapsedSeconds` (non 1000/latency)
- Aggiornamento `TelemetryOverlay.tsx`:
  - Mostra `Req/Exec/Drop` per completezza
  - Mostra `Throughput` FPS (reale) invece di FPS generico
  - Mostra `Avg Latency` per chiarezza separata
- Correzione errore worklet: uso di SharedValues invece di accesso diretto a telemetryLogger
  - `telemetryRequested` e `telemetryExecuted` SharedValues nel worklet
  - Polling interval trasferisce i count al telemetry logger sul JS thread
- Connessione MoveNet a PERF 1s diagnostic window:
  - Aggiunti parametri performance tracking SharedValues a `useMoveNetWorker`
  - `perfMoveNetRequested`, `perfMoveNetExecuted`, `perfMoveNetSkipped`
  - `perfMoveNetInferenceTotal/Min/Max`
  - `perfMoveNetCropTotal`, `perfMoveNetResizeTotal`, `perfMoveNetRunTotal`, `perfMoveNetParseTotal`
  - Passati da `useShotTracker` e aggiornati nel worklet quando le inferenze completano

**Rationale:**
- `theoreticalFps` (1000/latency) non rappresenta throughput reale con latest-frame-wins
- Throughput reale deve essere `executed / elapsedTime` per riflettere frame processati al secondo
- PERF 1s deve mostrare metriche accurate per debugging performance
- Worklet non può accedere a oggetti JS esterni (telemetryLogger) - deve usare SharedValues
- Separazione chiara tra latenza (tempo per inferenza) e throughput (inferenze per secondo)

**Conseguenze:**
- Metriche MoveNet ora semanticamente corrette:
  - `throughputFps`: inferences reali per secondo
  - `avgLatencyMs`: tempo medio inferenza
  - `requested/executed/droppedBusy`: contatori accurati
- PERF 1s mostra metriche MoveNet accurate invece di fps=0.0
- TelemetryOverlay mostra metriche più informative e corrette
- Nessun errore worklet per accesso a telemetryLogger
- Architettura worklet-safe rispettata (solo SharedValues tra worklet e JS)

**Risultati (post-implementazione):**
- PERF 1s ora mostra: `MOVE fps=X exec=Y attempt=Z skip=W avg=XXms max=YYms`
- TelemetryOverlay mostra: `Req/Exec/Drop`, `Throughput FPS`, `Avg Latency`
- Throughput reale MoveNet riflette capacità del sistema con latest-frame-wins
- Latenza separata da throughput per diagnosi più chiara

---

## Decision 0.8: Default Camera FPS 30

**Contesto:** Il default FPS della camera era impostato a 15 per testing async YOLO, ma questo limitava la performance generale dell'applicazione.

**Decisione:**
- Cambiato `CAMERA_CONFIG.DEFAULT_FPS` da 15 a 30
- Camera ora gira a 30 FPS di default
- YOLO e MoveNet continuano a girare a FPS naturale basato su tempo inferenza

**Rationale:**
- 30 FPS è lo standard per applicazioni video
- Migliore esperienza utente con frame rate più alto
- YOLO/MoveNet non dipendono dal FPS della camera (architettura decoupled)

**Conseguenze:**
- Camera: 30 FPS di default
- YOLO: FPS naturale ~7-10 (indipendente)
- MoveNet: FPS naturale ~0-6 (indipendente)
- Tracking: realtime (ogni frame)

---

## Decision 0.2: Unificazione Stili TelemetryOverlay

**Contesto:** TelemetryOverlay aveva stili inconsistente per diverse voci, con FPS section separata con styling diverso dalle altre sezioni.

**Decisione:**
- Rimozione sezione `fpsSection` separata con stile speciale
- Tutte le voci usano formato uniforme: `section` → `row` → `label`/`value`
- Camera, YOLO e MoveNet FPS ora su righe separate nello stesso stile delle altre metriche
- Rimozione stili `fpsSection` e `fpsLabel` non più necessari
- Ordine FPS: Camera → YOLO → MoveNet (YOLO sopra MoveNet come richiesto)

**Rationale:**
- Unificazione stili migliora consistenza visiva
- Codice più semplice con meno stili special case
- Più facile manutenzione futura

**Conseguenze:**
- Overlay più uniforme e leggibile
- Codice più pulito senza duplicazione stili
- Tutte le metriche hanno lo stesso aspetto

---

## Decision 0.3: Session Usage Time Tracking con Ref Globale

**Contesto:** Il tracking del tempo di utilizzo della sessione veniva resettato quando il componente veniva unmounted/mountato frequentemente, causando valori sempre a 0.

**Decisione:**
- Uso di `sessionStartTimeGlobal` ref per persistere timestamp di inizio tra unmount/mount
- Calcolo tempo trascorso ogni secondo basato su timestamp globale
- Display formato minuti:secondi (es. 0:17 per 17 secondi)
- Aggiornamento ogni secondo invece di ogni minuto per feedback immediato
- Timer attivo quando `isActive && isModelReady`

**Rationale:**
- I frequenti unmount/mount del componente resettavano il timer locale
- Ref globale persiste anche quando il componente viene ricreato
- Formato minuti:secondi fornisce feedback più immediato

**Conseguenze:**
- Tempo di utilizzo ora persiste tra unmount/mount
- Valori aggiornati ogni secondo per feedback immediato
- Display più informativo con secondi
- Log di debug per verificare funzionamento timer

---

## Decision 0.6: Separazione Metriche Throughput vs Latency

**Contesto:** Le metriche FPS precedenti erano semanticamente ambigue. `fps=20.4` derivava da 1000/inferenceTime, indicando la capacità di latenza teorica, non il throughput reale di inferenze al secondo. Questo causava confusione nei log: YOLO mostrava 20 FPS ma eseguiva solo ~5 inferenze/s.

**Decisione:**
- Separare chiaramente throughput da latenza nelle metriche
- `throughputFps`: inferences reali per secondo (executed / elapsedSeconds)
- `theoreticalFps`: capacità di latenza (1000 / avgInferenceTime)
- Rinominare contatori: requested/executed/skipped invece di scheduled/executed
- Aggiungere contatori MoveNet per completezza
- Nuovo formato log:
  ```
  [PERF 1s]
  CAM  fps=10.8 recv=11 proc=10 drop=1 avg=78.2ms max=142.1ms
  YOLO fps=4.9 exec=5 attempt=11 skip=6 avg=46.7ms max=58.3ms
  MOVE fps=2.9 exec=3 attempt=11 skip=8 avg=101.4ms max=114.8ms
  ```

**Rationale:**
- Elimina ambiguità tra throughput reale e capacità teorica
- Permette di distinguere limite della camera/pipeline da throttle del detector
- Log più leggibili e semanticamente corretti
- Facilita diagnosi: se camera=10, yolo=4.9, moveNet=2.9, è chiaro che il device è il bottleneck

**Conseguenze:**
- Metriche ora rispondono a tre domande distinte:
  1. Quanti frame stiamo realmente processando? (CAM fps)
  2. Quante inference YOLO/MoveNet stiamo realmente eseguendo? (YOLO/MOVE fps)
  3. Quanto costa ogni inference? (avgMs)
- Eliminato il falso fps=20 di YOLO che sembrava indicare 20 inference/s
- Log molto più comprensibili per debugging

---

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
- Vision pipeline: 30 FPS realtime (camera)
- YOLO: FPS naturale ~7-10 (basato su tempo inferenza)
- MoveNet: FPS naturale ~0-6 (basato su tempo inferenza e disponibilità bbox player)
- Tracking: realtime (ogni frame con Kalman prediction)
- Backend telemetry: 2 Hz (sampling)
- Critical events: queue con retry
- UI: SharedValues per rendering a 60 FPS
- Bridge calls: 15 FPS (throttled)

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

**⚠️ NON IMPLEMENTATO:**
- `CALIBRATION` in `CalibrationScreen.tsx` chiama direttamente `saveCourtCalibration()` senza passare dalla critical queue
- `SESSION_END` in `WorkoutSessionScreen.tsx` chiama direttamente `endWorkoutSession()` senza passare dalla critical queue
- Solo `SHOT` usa realmente la PersistentOutbox
- Questo significa che CALIBRATION e SESSION_END possono essere persi se il backend è offline o se c'è un crash

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
- Camera: 30 FPS
- YOLO: FPS naturale ~7-10 (basato su tempo inferenza)
- Tracking: realtime (ogni frame con Kalman prediction)
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
- Bridge calls: 15 FPS (throttled a 66ms)
- YOLO telemetry: 15 FPS (throttled a 66ms)
- UI rendering: 60 FPS (via SharedValues)
- Vision pipeline: 30+ FPS (camera)

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

## Decision 11: Inizializzazione Async della Queue

**Contesto:** Il costruttore di WorkoutAsyncQueue chiamava loadPending() senza await, creando race condition.

**Decisione:**
- Costruttore reso privato
- Metodo statico async `create()` per inizializzazione
- Flag `initialized` previene enqueue prematuro
- `await createWorkoutQueue()` obbligatorio

**Rationale:**
- Garantisce che loadPending() sia completato prima di accettare eventi
- Previene race condition tra loadPending() e enqueueCritical()
- Pattern factory per controllo lifecycle

**Conseguenze:**
- Inizializzazione esplicita e sicura
- Race condition eliminate
- Chiamanti devono usare await

**⚠️ NON IMPLEMENTATO:**
- In `WorkoutSessionScreen.tsx`, la camera viene attivata PRIMA che la queue sia pronta:
  ```typescript
  setSession(s)
  setIsActive(true)  // Camera ON
  setShotCount(...)
  workoutQueueRef.current = await createWorkoutQueue(...)  // Queue pronta DOPO
  ```
- Per un breve periodo, la camera è attiva ma la queue è null
- Eventi generati in questo intervallo possono essere persi

---

## Decision 12: Global Recovery da Tutte le Sessioni

**Contesto:** PersistentOutbox caricava solo item della sessione corrente, perdendo dati da sessioni precedenti.

**Decisione:**
- `loadAllPending()` carica item da TUTTE le sessioni precedenti
- `loadPending()` carica item della sessione corrente e merge
- WorkoutAsyncQueue chiama entrambi all'inizializzazione
- Sorting per timestamp globale

**Rationale:**
- Recupera eventi persi da crash precedenti
- Una sessione può recuperare eventi di sessioni precedenti
- Garantisce zero data loss across sessioni

**Conseguenze:**
- Recovery automatico di eventi pendenti
- Sessione corrente può completare eventi di sessioni precedenti
- Merge ordinato per timestamp

**⚠️ BUG CRITICO:**
- `WorkoutAsyncQueue.create()` chiama:
  1. `await queue.criticalOutbox.loadAllPendingAndMerge()` - include sessione corrente
  2. `await queue.criticalOutbox.loadPending()` - ricarica sessione corrente
- Senza deduplica per id, questo causa duplicazione degli item nella memory queue
- Gli stessi eventi possono essere processati più volte

---

## Decision 13: Rimozione Limite MAX_OUTBOX_SIZE

**Contesto:** MAX_OUTBOX_SIZE = 100 causava rifiuto di eventi critici quando raggiunto.

**Decisione:**
- Rimozione completa di MAX_OUTBOX_SIZE
- Eventi critici mai rifiutati per dimensione
- Unbounded queue per critical events

**Rationale:**
- Critical events = non perdere dati
- Storage AsyncStorage ha capacità sufficiente
- Rifiuto viola definizione "critical"

**Conseguenze:**
- Nessun overflow per critical events
- Garanzia di accettazione per tutti gli eventi critici
- Memory management affidato a AsyncStorage

---

## Decision 14: Retry Count Persistente

**Contesto:** retryCount era salvato ma non aggiornato durante retry, perdendo stato.

**Decisione:**
- `updateRetryCount()` chiamato prima di ogni tentativo
- Retry count persistito in AsyncStorage
- Recovery conosce stato esatto dopo riavvio
- Backoff esponenziale basato su retry count persistito

**Rationale:**
- Retry deve essere resumable dopo crash
- Evita retry infiniti o prematuri
- Stato persistente per affidabilità

**Conseguenze:**
- Retry count incrementato e persistito
- Recovery riprende dal retry count corretto
- Backoff esponenziale corretto

---

## Decision 15: Shutdown Sicuro

**Contesto:** shutdown() chiamava clear() anche con eventi pendenti, perdendo dati.

**Decisione:**
- `shutdown()` controlla se critical outbox vuoto
- Se vuoto: `clearSession()` (memoria + storage)
- Se pendenti: `clear()` (solo memoria, storage per recovery)
- Log warning se shutdown con eventi pendenti

**Rationale:**
- Non cancellare eventi non consegnati
- Storage deve persistere per recovery
- Memoria può essere pulita

**Conseguenze:**
- Shutdown non perdere dati
- Recovery possibile dopo shutdown
- Logging per situazioni anomale

**⚠️ BUG CRITICO:**
- `shutdown()` chiama `flushAll()` che contiene un loop while:
  ```typescript
  while (this.criticalOutbox.size > 0 || this.telemetry.size > 0) {
    await this.flush(...)
  }
  ```
- Se il backend è offline con critical events pendenti, questo loop può continuare indefinitamente
- Nonostante `flushCriticalOnly(maxAttempts)` esista, `shutdown()` non lo usa direttamente
- L'utente che preme "Fine" con backend offline può rimanere bloccato in `await workoutQueue.shutdown()` senza mai arrivare alla navigation

---

## Decision 16: Separazione clear() da clearSession()

**Contesto:** clear() cancellava sia memoria che storage, pericoloso per recovery.

**Decisione:**
- `clear()` - pulisce solo memory queue
- `clearSession()` - pulisce memory + storage
- `clear()` usato in shutdown con eventi pendenti
- `clearSession()` usato solo quando tutti eventi consegnati

**Rationale:**
- Separazione responsabilità memoria vs storage
- Storage deve persistere per recovery
- Memoria può essere pulita liberamente

**Conseguenze:**
- Semantica chiara per ogni operazione
- Recovery garantito con storage persistente
- Memory management flessibile

---

## Decision 17: API Reali per SESSION_END/CALIBRATION

**Contesto:** SESSION_END e CALIBRATION erano placeholder (console.log), non inviati al backend.

**Decisione:**
- `SESSION_END` chiama API `endWorkoutSession()`
- `CALIBRATION` chiama API `saveCourtCalibration()`
- `SESSION_START` confermato (gestito da creazione sessione)
- Retry con backoff per API calls

**Rationale:**
- Eventi critici devono essere realmente inviati
- Backend deve ricevere conferma sessione
- Calibration deve essere persistita

**Conseguenze:**
- SESSION_END e CALIBRATION realmente critici
- Backend riceve tutti gli eventi
- Retry automatico su fallimento

**⚠️ NON IMPLEMENTATO:**
- Le API esistono e funzionano, ma la UI non le usa attraverso la critical queue
- `CalibrationScreen.tsx` chiama direttamente `await saveCourtCalibration(...)`
- `WorkoutSessionScreen.tsx` chiama direttamente `await endWorkoutSession(...)`
- La funzione nella queue per gestirli esiste (`case 'SESSION_END'`, `case 'CALIBRATION'`) ma il normale flow UI non la utilizza
- Questo significa che non c'è retry automatico se il backend è offline

---

## Decision 18: Eventi Rimangono in Outbox dopo Retry Exhaustion

**Contesto:** Dopo 5 retry falliti, eventi venivano rimossi dall'outbox (persi).

**Decisione:**
- Eventi rimangono in outbox dopo esaurimento retry
- `processCriticalFromOutbox()` break dopo fallimento
- Eventi ritentati in batch successivi
- Rimozione solo su successo API

**Rationale:**
- Retry exhaustion ≠ fallimento permanente
- Network può riprendere dopo retry exhaustion
- Eventi critici non devono essere persi mai

**Conseguenze:**
- Eventi persistono indefinitamente finché non consegnati
- Retry continuo in batch successivi
- Garanzia di consegna a lungo termine

---

## Decision 20: OutboxRecoveryWorker Background

**Contesto:** Eventi pendenti da sessioni precedenti non venivano ritentati automaticamente dopo crash o riavvio.

**Decisione:**
- `OutboxRecoveryWorker` - singleton worker background
- Intervallo configurabile (default 30 secondi)
- Carica item da TUTTE le sessioni precedenti
- Retry con backoff esponenziale (1s, 2s, 4s, 8s, 16s)
- Max 5 retry per evento
- Rimozione solo su successo API
- Avvio/arresto manuale

**Rationale:**
- Recovery automatico senza bloccare sessioni attive
- Worker indipendente non impatta performance sessione corrente
- Garantisce retry continuo di eventi pendenti
- Separazione responsabilità: sessione attiva vs recovery background

**Conseguenze:**
- Eventi pendenti ritentati automaticamente
- Sessione corrente non bloccata da recovery
- Zero data loss a lungo termine
- Recovery continuo finché successo o retry exhaustion

**⚠️ BUG CRITICO:**
- `OutboxRecoveryWorker` usa chiavi AsyncStorage sbagliate:
  - `PersistentOutbox.add()` salva con chiave: `workout_outbox_<id>`
  - `OutboxRecoveryWorker.removeItem()` usa: `await AsyncStorage.removeItem(id)`
  - `OutboxRecoveryWorker.incrementRetryCount()` usa: `await AsyncStorage.setItem(item.id, ...)`
- Questo causa:
  - L'evento viene trovato correttamente
  - Viene inviato con successo
  - Il worker tenta di rimuoverlo con chiave sbagliata
  - L'evento originale rimane nello storage
  - Alla prossima recovery può essere reinviato (duplicazione)

---

## Decision 21: Endpoint Batch per Backend

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

**⚠️ NON IMPLEMENTATO:**
- Il worker chiama `flush()` immediatamente su ogni `enqueueTelemetry()`
- `telemetry.drain(20)` tende a restituire 1 elemento invece di 20
- Comportamento reale: sample → HTTP batch da 1 → 500ms → sample → HTTP batch da 1
- Il batching da 20 frame non è garantito dall'implementazione
- Il carico HTTP reale è molto più alto del previsto

---

## Decision 22: Configurazione HALF_COURT vs FULL_COURT

**Contesto:** L'applicazione supporta due tipi di campo: HALF_COURT e FULL_COURT, con dimensioni diverse.

**Decisione:**
- `COURT_CONFIG.WIDTH_M: 15.24` (50 feet) - larghezza costante
- `COURT_CONFIG.HEIGHT_M: 28.65` (94 feet) - altezza FULL court
- HALF_COURT dovrebbe avere altezza ~14m
- `courtType` deve essere propagato attraverso il navigation flow
- Homography deve usare dimensioni corrette in base al tipo di campo

**Rationale:**
- Le coordinate campo (courtX, courtY) dipendono dalle dimensioni reali
- Distance from hoop, zone e shot chart richiedono coordinate accurate
- Analytics basati sulla posizione richiedono configurazione corretta

**Conseguenze:**
- FULL_COURT: 15.24 x 28.65 metri
- HALF_COURT: 15.24 x ~14 metri
- Overlay e calibrazione devono adattarsi al tipo di campo

**⚠️ NON IMPLEMENTATO:**
- `COURT_CONFIG.HEIGHT_M` è hardcoded a 28.65m senza configurazione separata per half court
- `CalibrationScreen.tsx` usa sempre `COURT_CONFIG.HEIGHT_M` anche per HALF_COURT
- `courtType` non viene propagato nel navigation flow:
  - `WorkoutSetupScreen.tsx` seleziona `courtType` e lo invia al backend
  - `CalibrationScreen.tsx` riceve `undefined` per `courtType` nei params
  - Fallback a `HALF_COURT` anche se l'utente ha selezionato FULL_COURT

---

## Decision 23: Conversione YOLO/MoveNet ad Async con Schedule Wait Measurement

**Contesto:** L'architettura sincrona precedente (runSync() nel worklet) causava frame processor latency elevata (75-100 ms). Il CPU crop nel worklet bloccava per ~50 ms, e non era possibile misurare la contesa del runtime RN separatamente dal tempo di inferenza.

**Decisione:**
- Convertire YOLO ad async con `scheduleOnRN()` in `useYoloWorker.ts`
- Convertire MoveNet ad async con `scheduleOnRN()` in `useMoveNetWorker.ts`
- Separare `t0` (worklet start) da `tScheduleStart` (post-preparation) per MoveNet
- Calcolare `workletPrepMs = tScheduleStart - t0` per MoveNet
- Calcolare `scheduleWaitMs = tCallbackStart - tScheduleStart` per entrambi i worker
- Aggiungere `perfYoloScheduleWaitTotal` SharedValue in `useShotTracker.ts`
- Aggiungere `perfMoveNetWorkletPrepTotal` e `perfMoveNetScheduleWaitTotal` SharedValue in `useShotTracker.ts`
- Aggiungere `yoloScheduleWaitMs` e `moveNetWorkletPrepMs` a `DiagnosticWindowSnapshot` in `telemetry.ts`
- Aggiornare logging per mostrare breakdown completo:
  - `YOLO DETAIL schedule=Xms resize=Yms run=Zms parse=Ams`
  - `MOVE DETAIL prep=Xms schedule=Yms crop=Zms resize=Ams run=Bms parse=Cms`

**Rationale:**
- L'architettura async permette di misurare la contesa del runtime RN separatamente dal tempo di inferenza
- scheduleOnRN() entra in una coda e attende disponibilità runtime - questo tempo deve essere misurato
- Separare worklet prep da schedule wait permette di identificare se il collo di bottiglia è nella preparazione o nella contesa runtime
- CPU crop spostato su JS thread async riduce frame processor latency
- Misurazione precisa permette di identificare se YOLO runSync() blocca MoveNet scheduleWait

**Conseguenze:**
- Camera FPS migliorata da ~10-14 FPS a 27-30 FPS (target raggiunto)
- Frame latency ridotta da 75-100 ms a 17-32 ms
- YOLO FPS naturale ~4-5 (basato su tempo inferenza async ~40-50ms)
- MoveNet FPS naturale ~3-4 (basato su tempo inferenza async ~200-230ms)
- Schedule wait misurato: 45-134 ms per MoveNet (variabile)
- Worklet prep misurato: ~5 ms per MoveNet
- CPU crop ridotto a ~15 ms (accettabile)
- Nuovo collo di bottiglia identificato: contesa RN runtime
- Breakdown completo disponibile nei log per debugging

**Risultati (post-implementazione):**
- Log mostrano: `CAM fps=29.6 recv=30 proc=28 drop=2 avg=17.0ms max=32.1ms`
- Log mostrano: `MOVE DETAIL prep=4.8ms schedule=77.1ms crop=15.4ms resize=3.9ms run=103.2ms parse=0.4ms total=213.4ms`
- Log mostrano: `YOLO DETAIL schedule=Xms resize=Yms run=Zms parse=Ams`
- Schedule wait variabile (44-134 ms) indica contesa runtime RN
- Frame processor non più collo di bottiglia
- CPU crop non più collo di bottiglia

**Roadmap (basata su nuova misurazione):**
1. Misurare scheduleWaitMs YOLO vs MoveNet per identificare contesa bidirezionale
2. Ridurre trasferimento buffer 640×360×3 (~2.64 MB) eliminando resize intermedio
3. Investigare crop/resize native prima di scheduleOnRN
4. Ottimizzare delegate MoveNet (GPU/NPU se disponibile)
5. Considerare worker thread separati per YOLO/MoveNet
