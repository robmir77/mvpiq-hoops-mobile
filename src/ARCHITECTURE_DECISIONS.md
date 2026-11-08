# Decisioni architetturali — MVPIQ Hoops Mobile

> **Baseline:** branch `Validation-1.0`. Questo registro descrive le decisioni ancora rilevanti per leggere e modificare il codice attuale. Le misure di performance e i risultati di test devono essere registrati separatamente con commit, dispositivo e configurazione.

## Come leggere il registro

- **Implementato nel codice** significa che la struttura o il comportamento è presente nei sorgenti.
- **Da validare** significa che la presenza del codice non prova il funzionamento end-to-end su dispositivo o backend.
- **Storico/da riconfermare** indica una decisione precedente che non deve essere considerata attiva senza riscontro nel codice corrente.

## Configurazione modelli

I modelli TFLite presenti sotto `assets/models/` sono le varianti YOLO `best_320_float16.tflite`, `best_384_float16.tflite`, `best_448_float16.tflite`, `best_512_float16.tflite`, `best_640_float16.tflite` e MoveNet `movenet_lightning_192_int8.tflite`. Il modello effettivamente selezionato dipende da `src/vision/yoloModels.ts`, dalla configurazione e dai worker. Non assumere che il file `best_384` sia sempre attivo soltanto perché esiste nel repository.

## Decisioni attuali

### D01 — Inferenza e parsing nei worker vision
**Stato:** implementato nel codice.

I worker YOLO/MoveNet sono responsabili del percorso di inferenza e parsing che dipende dalle librerie native. `VisionEngine` orchestra i risultati già parsati e mantiene anche un percorso alternativo per output grezzi. Evitare di duplicare il parsing in più livelli senza una migrazione deliberata.

### D02 — Adapter vision come cache delle osservazioni
**Stato:** implementato nel codice; comportamento end-to-end da validare.

`VisionEngineAdapter` implementa `IVisionEngine`, mantiene risultati separati per ball/player/rim/pose e relativi timestamp/versioni. Le callback possono aggiornare un singolo canale; `undefined` significa non aggiornare quel canale, mentre `null` rappresenta un aggiornamento senza detection.

### D03 — Timestamp e freschezza per canale
**Stato:** implementato nel codice; soglie da verificare con le condizioni di runtime.

Le soglie correnti dichiarate dall'adapter sono 2000 ms per ball, 500 ms per player, 500 ms per rim e 750 ms per pose. Sono scelte di policy, non una garanzia che l'osservazione sia adeguata per ogni uso. Non trattare callback YOLO e MoveNet come temporalmente sincronizzate.

### D04 — Coordinamento centralizzato del runtime
**Stato:** implementato nel codice; continuità delle callback da validare su device.

`WorkoutSessionScreen` contiene `scheduleRuntimeProcessFrame` e abilita il percorso tramite `useRuntimeProcessingRef`. La schermata resta un punto centrale di integrazione: non descrivere l'estrazione runtime come completa eliminazione delle responsabilità legacy.

### D05 — State machine della sessione
**Stato:** implementato nel codice.

`WorkoutSessionRuntime` definisce gli stati `IDLE`, `STARTING`, `ACTIVE`, `PAUSED`, `STOPPING`, `SYNCING`, `COMPLETED` ed `ERROR`, con transizioni esplicite. `processFrame()` elabora solo nello stato `ACTIVE`.

### D06 — Protezione da chiamate concorrenti
**Stato:** implementato nel codice.

Il runtime contiene una guardia per evitare che più invocazioni di `processFrame()` vengano elaborate contemporaneamente. I test devono coprire sia la concorrenza sia le chiamate ricevute in stati non attivi.

### D07 — TrackingEngine riceve player detection
**Stato:** implementato nel codice.

`TrackingEngine.processFrame()` accetta `playerDetection` come parametro opzionale. Non reintrodurre un bridge `setPlayerFromYolo()` se non esiste nel codice attuale.

### D08 — ShotDetectionEngine e risultati interni
**Stato:** implementato nel codice.

Il motore di rilevamento tiro usa risultati interni `MADE`, `MISS` e `AIRBALL`. Il tipo applicativo `ShotResult` include anche `BLOCKED` e `UNCERTAIN`, ma questi valori non sono automaticamente prodotti dal detector.

### D09 — Normalizzazione del risultato pubblico
**Stato:** presente nei percorsi applicabili; verificare ogni chiamante.

Alcuni callback pubblici con contratto ristretto normalizzano `AIRBALL` a `MISS`; il percorso runtime e il builder hanno regole proprie per normalizzare i risultati destinati ai payload. Mantenere distinta la classificazione interna dal risultato API/callback e coprire le conversioni con test.

### D10 — Idempotenza e dispatch del tiro
**Stato:** da confermare per l'intero percorso.

L'identità del tiro, i set di eventi in pending/processed e il dispatch critico devono impedire duplicati. Non dichiarare unicità end-to-end senza verificare runtime, callback legacy, registrazione manuale e queue insieme.

### D11 — Queue critica separata dalla telemetria
**Stato:** architettura presente nel codice.

`WorkoutAsyncQueue` fornisce `enqueueCritical()`; la telemetria campionata è un percorso separato. Non mettere eventi di business critici in un canale che può essere campionato o scartato come diagnostica.

### D12 — Persistent outbox e recovery
**Stato:** moduli presenti; affidabilità da testare dinamicamente.

`PersistentOutbox` e `outboxRecoveryWorker` gestiscono persistenza e recupero. La presenza dei moduli non dimostra che ogni evento sia stato confermato dal backend. Verificare separatamente persistenza locale, retry, acknowledgement, retry exhausted, riavvio e riconnessione.

### D13 — TelemetrySampler
**Stato:** implementato come classe; consumo effettivo da verificare.

`TelemetrySampler` usa un intervallo configurabile con default 500 ms e offre `shouldSample()`, `reset()`, `getLastSampleTime()` e `setSampleInterval()`. Verificare i punti in cui viene chiamato prima di affermare che tutte le metriche sono campionate o inviate.

### D14 — Nessun benchmark dedotto dal codice
**Stato:** regola di manutenzione.

Non promuovere FPS, latenza o percentuali di detection storici a benchmark corrente. Ogni confronto deve includere commit, dispositivo, modello, delegate, risoluzione, warm-up, durata e percentili.

### D15 — Scheduling e inferenza vanno misurati separatamente
**Stato:** criterio diagnostico.

Raccogliere separatamente schedule wait, preprocessing/crop, inferenza, parsing e tempo end-to-end. Un'attesa lunga con inferenza breve indica un problema diverso da un'inferenza lenta. Evitare di sommare metriche che si sovrappongono temporalmente.

### D16 — FPS camera richiesto non equivale a FPS inferenza
**Stato:** criterio diagnostico.

Il frame rate della camera, il throughput YOLO, il throughput MoveNet e il rate di tracking/overlay sono grandezze diverse. Ogni pannello diagnostico deve indicare chiaramente quale contatore mostra.

### D17 — Overlay e SharedValue sono un livello separato
**Stato:** componenti presenti; continuità visiva da validare.

Le SharedValue possono aggiornarsi senza un render React completo. Per un overlay fermo, distinguere scrittura del valore, timestamp della detection, lettura del componente e rendering Skia. Un FPS positivo non prova che il valore mostrato sia fresco.

### D18 — Disattivazione legacy (Decision 29)
**Stato:** **reverted nel codice corrente**.

Il parametro `runtimeActive` resta nell'API di `useCameraPipeline` e `useShotTracker`, ma i commenti correnti dichiarano che non è usato nel frame processor. Non affermare che il percorso legacy viene disabilitato automaticamente quando il runtime è attivo. Qualsiasi nuova disattivazione deve essere implementata esplicitamente, testata e documentata dopo aver verificato che il runtime riceva tutte le osservazioni necessarie.

### D19 — Runtime e callback worker non sono sinonimi di frame camera
**Stato:** criterio di progettazione.

I worker possono produrre osservazioni a frequenze diverse e il coordinatore può saltare o ritardare chiamate. Strumentare callback ricevute, aggiornamenti adapter, chiamate pianificate, chiamate eseguite e frame processati come contatori distinti.

### D20 — Registrazione manuale separata dal detector automatico
**Stato:** percorsi presenti; coerenza da testare.

La registrazione manuale passa attraverso handler/API propri. Non presumere che condivida tutte le garanzie del detector automatico. Testare payload, contatori, deduplicazione e sincronizzazione per entrambi i percorsi.

### D21 — Coordinate e calibrazione
**Stato:** implementazioni presenti; validazione su device necessaria.

La calibrazione e le trasformazioni omografiche sono sotto `src/features/workouts/`. Le coordinate image, overlay e court space devono essere esplicitate e testate per risoluzione, orientamento, crop e mirror. Non dichiarare corretto il mapping solo perché la matrice è calcolabile.

### D22 — Configurazione vision persistita
**Stato:** documentata nel codice; verificare tutte le letture/scritture.

La configurazione selezionata deve essere associata alla sessione e ripristinata coerentemente. Controllare la fonte autorevole, i default, i cambi di modello e il comportamento quando un valore persistito non è più supportato.

### D23 — Natural FPS e throttling
**Stato:** decisione storica da verificare per ogni worker.

Non aggiungere throttling temporale senza un benchmark che dimostri il beneficio. Allo stesso tempo, “natural FPS” non significa che non esistano limiti dovuti a latest-frame-wins, scheduling, stato worker o frequenza di callback. Documentare il comportamento effettivo del singolo worker.

### D24 — Scheduler duplicati e bridge
**Stato:** da verificare quando si modifica il percorso di callback.

Prima di introdurre un nuovo scheduler o una chiamata bridge, individuare i punti esistenti in `useShotTracker`, worker e `WorkoutSessionScreen`. Misurare il costo delle chiamate e mantenere una responsabilità chiara per ogni livello.

### D25 — Ring buffer e allocazioni hot path
**Stato:** implementazioni locali presenti; ottimizzazione da benchmarkare.

Buffer circolari e contatori possono ridurre allocazioni o scansioni, ma una micro-ottimizzazione va accettata solo se preserva il comportamento e mostra un miglioramento riproducibile.

### D26 — Feature flag e diagnostica
**Stato:** dipendente dalle singole opzioni.

I flag diagnostici non devono cambiare la logica di business. Quando un flag disabilita log o overlay, verificare che non disabiliti anche aggiornamenti necessari al tracking.

### D27 — Modifiche ai modelli TFLite
**Stato:** criterio di rilascio.

Dopo aver cambiare un modello verificare file selezionato, input/output shape, dtype, parser, delegate e prestazioni. La presenza di più modelli in `assets/models/` non significa che siano tutti caricati o utilizzati. Eseguire `scripts/verify_tflite_metadata.py` per confermare che tutti i modelli seguono lo stesso schema di esportazione YOLO11n (input [1, SIZE, SIZE, 3], output [1, 7, N] con N anchor per risoluzione).

### D28 — Test unitari vs verifica su device
**Stato:** regola di qualità.

Jest copre i casi implementati nei test, ma non certifica automaticamente camera nativa, worklets, FPS, overlay reale, rete o recovery dopo riavvio. Riportare separatamente test automatici, build e validazione dinamica.

### D29 — VisionPipelineAdapter
**Stato:** mantenere distinta l'interfaccia dal percorso attivo.

La presenza di wrapper/adapters non prova che ogni callback di un'interfaccia sia collegata all'esecuzione. Verificare chi invoca `initialize()`, chi pubblica gli eventi e quali callback sono effettivamente sottoscritte.

### D30 — Completamento del resoconto workout
**Stato:** da validare end-to-end.

Un tiro è completato soltanto quando il detector produce l'evento, il runtime lo tratta una sola volta, la queue lo accetta, la persistenza/rete ne gestisce lo stato e la UI riflette il risultato. Misurare ogni passaggio con un identificatore stabile.

### D31 — Filtri geometrici per riduzione false positive
**Stato:** implementato nel codice; soglie definitive tarate con log [YOLO RAW] e benchmark video.

`YoloDetector` applica filtri geometrici prima di accettare una detection. I filtri controllano aspect ratio in pixel space (corretto per frame aspect ratio) e dimensioni normalizzate. I parametri sono configurati in `YOLO_CONFIG`:

- **Palla:** aspect ratio [0.6, 1.7], dimensione media [0.008, 0.15]
- **Giocatore:** larghezza [0.05, 0.6], altezza minima 0.1, aspect ratio h/w [0.8, 6.0]
- **Canestro:** larghezza [0.015, 0.25], aspect ratio w/h [0.7, 6.0]

Le soglie confidence definitive (tarate con log device e benchmark video) sono:
- BALL: 0.05 (modello confident per palla, score 0.76-0.84 quando inquadrata)
- PLAYER: 0.01 (massimi osservati ~0.002)
- RIM: 0.10 (massimo 0.22, tipico ~0.006)

Il log diagnostico [YOLO RAW] è stato rimosso da `useYoloWorkerAsync.ts` dopo aver determinato le soglie definitive.

### D36 — Validazione schema tensore YOLO
**Stato:** implementato nel codice.

`YoloDetector.validateOutputSchema()` verifica che il tensore di output corrisponda al formato YOLO11n atteso:
- Divisibilità per OUTPUT_CHANNELS (7)
- Numero di anchor corrispondente a risoluzioni note (2100, 3024, 4116, 5376, 8400)
- Inferenza automatica di TENSOR_SIZE dal numero di anchor
- Errori espliciti se il tensore non corrisponde allo schema atteso

Tutti i modelli `best_N_float16.tflite` seguono lo stesso schema di esportazione: input [1, SIZE, SIZE, 3], output [1, 7, N] con layout [xc, yc, w, h, ball_score, human_score, rim_score]. La validazione previene detection errate con modelli incompatibili.

### D32 — Gestione risoluzione camera
**Stato:** implementato nel codice; comportamento da validare su device.

La risoluzione della camera è gestita in due punti chiave:

**CalibrationScreen.tsx**
- Default: massimo supportato dal dispositivo (`availableResolutions[0]`)
- L'utente può selezionare manualmente una risoluzione diversa nel Picker
- La scelta manuale persiste (non viene sovrascritta da auto-selezione)
- Log aggiunti per debug chi sovrascrive la risoluzione
- Wrapper `setSelectedResolution` con log e stack trace per identificare chiamate

**WorkoutSessionScreen.tsx**
- `effectiveResolution` è uno stato (non un ref) per garantire coerenza tra consumatori
- Aggiornato con `setEffectiveResolution` in `loadSession` e `setCalibration`
- `scheduleRuntimeProcessFrame` ha `effectiveResolution` nelle dipendenze per evitare closure obsoleta
- Camera montata solo dopo caricamento sessione (`sessionLoaded`)

**Log di verifica**
- `useShotTracker.ts` stampa frame resolution e target resolution al primo frame
- Valore grezzo senza fallback per identificare se la risoluzione è impostata correttamente

### D33 — Tracking TTL per modelli YOLO lenti
**Stato:** implementato nel codice; da validare con modelli diversi.

Il tracking della palla usa una TTL (Time To Live) per predizioni senza nuove rilevazioni. La TTL è configurata in `BallTrackingState.ts`:

- `predictionTtlMs: 400` ms (aggiornato da 150 ms)

La TTL deve coprire l'intervallo tra inferenze successive del modello YOLO:
- `best_384_float16`: fpsMin 20 / fpsMax 21 (intervallo ~50 ms)
- `best_640_float16`: fpsMin 5 / fpsMax 7 (intervallo 143-200 ms)

Con la vecchia TTL di 150 ms, il modello 640 non riusciva a costruire traiettorie continue. Con 400 ms, il tracker può mantenere lo stato anche con modelli più lenti.

### D34 — Correzioni cablaggi minori
**Stato:** implementato nel codice.

**YoloDetector.ts - resolutionScale**
- Portato da `TENSOR_SIZE / 512` a `1.0`
- Le bounding box sono normalizzate sul frame e non dipendono dalla dimensione del tensore
- Eliminava scaling errato (+25% con 640, -25% con 384) delle soglie dimensione palla

**CalibrationScreen.tsx - fallback yoloInputSize**
- Rimosso fallback `|| 384`
- Ora usa solo `yoloModel?.inputSize` dal modello selezionato

### D35 — Discrepanza resolutionScale tra benchmark e app (RISOLTA)
**Stato:** risolto allineando l'app al benchmark.

Il benchmark offline `yolo-ab` (`scripts/benchmark_yolo_videos.py`) usa `resolution_scale = tensor_size / 512`, mentre l'app usava `resolutionScale = 1.0` fisso in `YoloDetector.ts`.

**Benchmark Python**:
- Per modello 384: `resolution_scale = 0.75`
- Per modello 640: `resolution_scale = 1.25`

**App TypeScript (prima)**:
- Fisso a `1.0` per tutti i modelli

**App TypeScript (dopo)**:
- Calcolato come `TENSOR_SIZE / 512` per allinearsi al benchmark

**Impatto precedente**: Con modello 640, il benchmark aumentava le soglie di dimensione della palla del 25% rispetto all'app, causando differenze di detection.

**Decisione**: Allineare l'app al benchmark ripristinando `resolutionScale = TENSOR_SIZE / 512`. Le bounding box sono normalizzate sul frame, ma le soglie adattive dipendono dalla dimensione del tensore per mantenere coerenza con il benchmark.

**File modificati**:
- `YoloDetector.ts` (riga 388): `const resolutionScale = TENSOR_SIZE / 512`
- `VISION_PERFORMANCE.md`: Documentata la risoluzione

## Decisioni storiche da non considerare automaticamente attive

Le voci storiche su outbox, retry persistenti, recovery globale, batch API, configurazione half/full court, worker asincroni, telemetria, mirror coordinate, confidence adattiva e shot chart devono essere riconfermate nei sorgenti che le implementano prima di modificarle. Il titolo di una vecchia decisione non è prova sufficiente che il comportamento sia ancora attivo o che la relativa verifica sia passata.

## Checklist per ogni nuova decisione

- [ ] Descrivere il problema e l'evidenza osservata.
- [ ] Indicare i file e i contratti coinvolti.
- [ ] Distinguere implementazione, test automatico e prova su dispositivo.
- [ ] Registrare alternative e motivazione della scelta.
- [ ] Definire come misurare il risultato.
- [ ] Aggiornare insieme architettura, performance, piano e verifica se cambiano.
- [ ] Rimuovere o marcare come storico il testo superato, senza lasciare istruzioni contraddittorie.
