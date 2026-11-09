# MVPiQ Hoops Mobile — Architettura workout e vision

Questo documento descrive l'implementazione presente nel branch `Validation-1.0`. I sorgenti sono la fonte autorevole: se il codice cambia, aggiornare questa pagina senza mantenere registri di fasi o ricostruzioni storiche.

## Ambito

La sessione workout integra acquisizione camera, inferenza on-device, osservazioni vision, tracking, rilevamento del tiro, overlay e sincronizzazione degli eventi.

I principali punti di ingresso sono:

- `src/features/workouts/screens/WorkoutSessionScreen.tsx`: composizione della schermata e collegamento fra camera, worker, adapter, runtime e UI.
- `src/vision/useShotTracker.ts`: integrazione camera/vision usata dalla feature workout.
- `src/vision/useYoloWorker.ts`, `useYoloWorkerAsync.ts`, `useMoveNetWorker.ts`: inferenza e parsing dei modelli.
- `src/vision/engine/YoloDetector.ts`: validazione e decodifica dell'output YOLO.
- `src/vision/VisionEngineAdapter.ts`: cache delle osservazioni con timestamp e versione per canale.
- `src/features/workouts/runtime/WorkoutSessionRuntime.ts`: stato della sessione, coordinamento dei frame e dispatch degli eventi.
- `src/features/workouts/tracking/TrackingEngine.ts`: tracking e integrazione della shot detection.
- `src/features/workouts/services/workoutAsyncQueue.ts` e `persistentOutbox.ts`: gestione asincrona e persistenza degli eventi critici.

## Flusso runtime

1. Vision Camera fornisce i frame al percorso camera/worklet.
2. I worker YOLO e MoveNet eseguono inferenza e parsing e pubblicano le osservazioni tramite callback.
3. `WorkoutSessionScreen` aggiorna `VisionEngineAdapter` e pianifica `WorkoutSessionRuntime.processFrame()` quando il runtime è attivo e il coordinamento è abilitato.
4. L'adapter conserva separatamente le osservazioni di palla, giocatore, canestro e posa, con i rispettivi timestamp.
5. Il runtime processa i frame soltanto nello stato `ACTIVE` e impedisce chiamate concorrenti a `processFrame()`.
6. `TrackingEngine` aggiorna lo stato del tracking e invoca `ShotDetectionEngine`.
7. Gli eventi critici passano dal runtime alla coda e alla persistenza locale.

Il caricamento del modello o l'esecuzione di un worker non dimostrano da soli che l'osservazione abbia raggiunto tracking, overlay o dispatch degli eventi.

## Stato della sessione

La state machine di `WorkoutSessionRuntime` usa gli stati:

`IDLE`, `STARTING`, `ACTIVE`, `PAUSED`, `STOPPING`, `SYNCING`, `COMPLETED`, `ERROR`.

Le transizioni ammesse sono definite nel runtime. L'avvio della sessione non garantisce che i frame siano già in elaborazione: le dipendenze vision e tracking devono essere collegate e il percorso runtime deve essere abilitato.

## Integrazione runtime e codice legacy

`WorkoutSessionScreen` resta il compositore centrale e contiene ancora responsabilità di integrazione e callback del percorso legacy. Il coordinamento di `Runtime.processFrame()` è controllato da `useRuntimeProcessingRef`.

Il parametro `runtimeActive` è ancora presente nell'API di alcuni hook, ma non deve essere considerato un interruttore affidabile per disabilitare il frame processor legacy. Non descrivere l'architettura come una migrazione completa in cui la schermata non ha più responsabilità di tracking.

## Responsabilità dei componenti

| Componente | Responsabilità |
|---|---|
| Worker YOLO / MoveNet | Inferenza, preprocessing previsto dal worker, parsing e callback |
| `YoloDetector` | Validazione dello schema YOLO, selezione dei candidati e filtri |
| `VisionEngineAdapter` | Osservazioni correnti e timestamp per canale |
| `VisionEngine` | Accesso/orchestrazione dei risultati vision |
| `WorkoutSessionRuntime` | State machine, coordinamento frame e dispatch eventi |
| `TrackingEngine` | Tracking di palla e giocatore, invocazione shot detection |
| `ShotDetectionEngine` | Classificazione interna del tiro |
| `WorkoutAsyncQueue` | Elaborazione asincrona degli eventi critici |
| `PersistentOutbox` | Persistenza locale e recupero degli eventi |
| `TelemetrySampler` | Campionamento temporale della telemetria |

## Contratti funzionali

- `TrackingEngine.processFrame()` riceve `playerDetection` come parametro opzionale.
- Il risultato automatico interno di `ShotDetectionEngine` comprende `MADE`, `MISS`, `AIRBALL` o `null`. Il tipo applicativo `ShotResult` è più ampio: non significa che il detector automatico produca ogni valore previsto dal tipo.
- I callback pubblici che accettano soltanto `MADE` e `MISS` normalizzano `AIRBALL` a `MISS` nel relativo percorso.
- La registrazione manuale del tiro è un percorso distinto dal rilevamento automatico.
- Le osservazioni YOLO e MoveNet hanno timestamp indipendenti. Non presumere che siano sincronizzate o disponibili a ogni frame camera.
- `CalibrationData.hoopBbox` è opzionale. La calibrazione può salvare la bounding box del rim quando è disponibile una detection raffinata; il tracking mantiene un fallback quando il dato manca.

## Test automatici

I test Jest sono organizzati sotto:

- `src/features/workouts/__tests__/`
- `src/features/workouts/screens/__tests__/`
- `src/features/workouts/tracking/__tests__/`
- `src/vision/__tests__/`

Comandi definiti nel `package.json`:

```bash
npm test
npm run test:watch
npm run test:coverage
```

I test unitari e d'integrazione con mock non sostituiscono la verifica della camera, dei worklet, dei delegate nativi, dell'overlay e delle prestazioni su un dispositivo reale.

## Validazione su dispositivo

Per verificare un flusso end-to-end correlare, nella stessa sessione:

1. frame camera e timestamp;
2. inferenze e callback YOLO/MoveNet;
3. aggiornamenti dell'adapter e freschezza delle osservazioni;
4. chiamate e risultati di `WorkoutSessionRuntime.processFrame()`;
5. aggiornamenti di tracking e overlay;
6. rilevamento del tiro, callback, enqueue e sincronizzazione.

Un contatore fermo in un livello non identifica da solo la causa: seguire la catena dal livello precedente al successivo.
