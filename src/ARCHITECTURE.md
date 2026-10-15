# MVPIQ Hoops Mobile — Architettura della pipeline workout e vision

> Stato verificato sul branch `Validation-1.0`. Questo documento descrive il codice presente nel repository, non un'architettura target. Le metriche runtime devono essere raccolte su dispositivo: la presenza di una classe o di un test non prova da sola il funzionamento end-to-end.

## Scopo e confini

La feature workout combina acquisizione camera, inferenza on-device, coordinamento delle osservazioni, tracking, rilevamento del tiro, overlay e sincronizzazione degli eventi. I principali punti di ingresso sono:

- `src/features/workouts/screens/WorkoutSessionScreen.tsx`: composizione della schermata, callback dei worker, connessione degli engine e ciclo di vita della sessione.
- `src/vision/useShotTracker.ts`, `useYoloWorker.ts`, `useYoloWorkerAsync.ts`, `useMoveNetWorker.ts`: hook e worker che gestiscono il percorso di inferenza e parsing.
- `src/vision/VisionEngineAdapter.ts`: conserva gli ultimi risultati per canale, timestamp/versioni e li espone attraverso il contratto `IVisionEngine`.
- `src/vision/engine/VisionEngine.ts`: orchestrazione pura dei risultati già parsati o, nel percorso alternativo, degli output grezzi.
- `src/features/workouts/runtime/WorkoutSessionRuntime.ts`: stato della sessione e coordinamento del frame verso vision, tracking e gestione eventi.
- `src/features/workouts/tracking/TrackingEngine.ts`: integrazione tracking, inclusa la rilevazione giocatore ricevuta come argomento e il risultato di `ShotDetectionEngine`.
- `src/features/workouts/services/workoutAsyncQueue.ts` e `persistentOutbox.ts`: accodamento e persistenza degli eventi da sincronizzare.

## Flusso effettivo dei dati

1. Vision Camera fornisce i frame al percorso camera/worklet.
2. I worker YOLO e MoveNet eseguono inferenza e parsing; i callback consegnano le osservazioni parsate.
3. `WorkoutSessionScreen` aggiorna `VisionEngineAdapter` e coordina le chiamate al runtime quando il runtime è attivo e il percorso runtime è abilitato.
4. L'adapter espone le osservazioni correnti con timestamp separati per palla, giocatore, canestro e posa. La freschezza è specifica per canale: ball 2000 ms, player/rim 500 ms, pose 750 ms nei valori correnti del codice.
5. `WorkoutSessionRuntime.processFrame()` applica una guardia contro chiamate concorrenti e ignora il processamento se lo stato non è `ACTIVE`.
6. Il runtime invoca il vision engine e passa il risultato a `TrackingEngine.processFrame()`, che integra la player detection e il motore di rilevamento tiro.
7. Gli eventi critici vengono inviati attraverso `enqueueCritical()`; il callback pubblico del tiro normalizza `AIRBALL` a `MISS` nel percorso in cui il contratto callback accetta soltanto MADE/MISS. Il risultato interno può conservare AIRBALL.

## Stato della sessione

La state machine definita in `WorkoutSessionRuntime.ts` comprende `IDLE`, `STARTING`, `ACTIVE`, `PAUSED`, `STOPPING`, `SYNCING`, `COMPLETED` ed `ERROR`. Le transizioni consentite sono definite nella mappa interna del runtime; non assumere che `start()` implichi da solo che i frame arrivino. La schermata collega prima tracking e adapter vision, abilita il percorso runtime e avvia la sessione quando le dipendenze risultano collegate.

## Runtime e percorso legacy

Il codice della schermata contiene ancora callback e logica del percorso legacy, con un flag interno `useRuntimeProcessingRef` che abilita il coordinamento runtime. Non documentare la pipeline come una migrazione completamente priva di legacy: la schermata e `useShotTracker` mantengono responsabilità di integrazione. In particolare, il parametro `runtimeActive` è ancora presente nell'API di `useCameraPipeline` e `useShotTracker`, ma i commenti correnti dichiarano che non viene usato nel frame processor (Decision 29 reverted). Di conseguenza non affermare che il percorso legacy si disattiva automaticamente grazie a quel parametro.

## Responsabilità principali

| Componente | Responsabilità corrente |
|---|---|
| `useShotTracker` e worker | Acquisizione dei risultati dei modelli, parsing e callback |
| `VisionEngineAdapter` | Cache delle osservazioni e timestamp/versioni per canale |
| `VisionEngine` | Normalizzazione/orchestrazione dei risultati vision |
| `WorkoutSessionRuntime` | State machine, coordinamento frame e dispatch degli eventi |
| `TrackingEngine` | Tracking della palla/giocatore e invocazione della shot detection |
| `ShotDetectionEngine` | Stato e classificazione interna del tiro, inclusi MADE/MISS/AIRBALL |
| `WorkoutAsyncQueue` | Coda degli eventi critici e sincronizzazione asincrona |
| `PersistentOutbox` | Persistenza locale per recupero/sync degli eventi |
| `TelemetrySampler` | Campionamento temporale; il runtime lo riceve tramite `setTelemetrySampler()` |

## Contratti e verifiche

- `TrackingEngine.processFrame()` accetta `playerDetection` come parametro opzionale; la documentazione non deve riferirsi a un bridge `setPlayerFromYolo()` se non presente nei sorgenti.
- I tipi workout definiscono `ShotResult` come MADE, MISS, BLOCKED, AIRBALL e UNCERTAIN. La shot detection interna usa MADE/MISS/AIRBALL; non presumere che ogni valore del tipo sia generato automaticamente.
- Le osservazioni vision hanno timestamp per canale. Non trattare callback YOLO e MoveNet come se arrivassero sincronizzati o a ogni frame camera.
- Le metriche FPS, latenza, overlay e contatori tiri sono dati runtime. Devono essere validate su dispositivo e non inferite dal fatto che il modello sia caricato.

## Test rilevanti

I test sono collocati sotto `src/features/workouts/__tests__`, `src/features/workouts/tracking/__tests__`, `src/features/workouts/screens/__tests__` e `src/vision/__tests__`. Per eseguire la suite: `npm test`; watch: `npm run test:watch`; coverage: `npm run test:coverage`. Questi script sono definiti in `package.json`.

## Limiti noti e prossimi controlli

1. Verificare su dispositivo che il coordinatore in `WorkoutSessionScreen` riceva callback YOLO/MoveNet dopo il passaggio a `ACTIVE`.
2. Registrare separatamente frame camera, output YOLO, output MoveNet, chiamate runtime, aggiornamenti overlay e tiri rilevati: uno zero in un livello non identifica automaticamente il guasto negli altri.
3. Verificare che non si creino percorsi duplicati di tracking/event dispatch tra runtime e callback legacy.
4. Misurare l'uso effettivo di `TelemetrySampler` e la persistenza degli eventi in condizioni offline e di riavvio.
5. Aggiornare questo documento dopo modifiche ai sorgenti, mantenendo esplicita la distinzione tra implementazione, test automatici e validazione su dispositivo.
