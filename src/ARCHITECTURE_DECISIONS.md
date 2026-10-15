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

Dopo aver cambiato un modello verificare file selezionato, input/output shape, dtype, parser, delegate e prestazioni. La presenza di più modelli in `assets/models/` non significa che siano tutti caricati o utilizzati.

### D28 — Test unitari vs verifica su device
**Stato:** regola di qualità.

Jest copre i casi implementati nei test, ma non certifica automaticamente camera nativa, worklets, FPS, overlay reale, rete o recovery dopo riavvio. Riportare separatamente test automatici, build e validazione dinamica.

### D29 — VisionPipelineAdapter
**Stato:** mantenere distinta l'interfaccia dal percorso attivo.

La presenza di wrapper/adapters non prova che ogni callback di un'interfaccia sia collegata all'esecuzione. Verificare chi invoca `initialize()`, chi pubblica gli eventi e quali callback sono effettivamente sottoscritte.

### D30 — Completamento del resoconto workout
**Stato:** da validare end-to-end.

Un tiro è completato soltanto quando il detector produce l'evento, il runtime lo tratta una sola volta, la queue lo accetta, la persistenza/rete ne gestisce lo stato e la UI riflette il risultato. Misurare ogni passaggio con un identificatore stabile.

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
