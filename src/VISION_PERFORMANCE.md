# MVPIQ Hoops — Analisi delle prestazioni vision

> Documento operativo riferito al codice presente in `Validation-1.0`. Le cifre storiche riportate in log o audit non sono garanzie di prestazione attuale: ripetere la misura sul dispositivo e sulla build in esame prima di dichiarare un miglioramento.

## Obiettivi della misurazione

La telemetria deve distinguere quattro livelli indipendenti:

1. **Acquisizione:** frame camera e timestamp.
2. **Inferenza:** esecuzioni YOLO e MoveNet, inclusi scheduling, resize/preparazione, inferenza e parsing.
3. **Coordinamento:** callback worker → aggiornamento `VisionEngineAdapter` → chiamata `WorkoutSessionRuntime.processFrame()` → tracking.
4. **Presentazione/eventi:** aggiornamenti SharedValue/overlay, shot detection, callback pubblico e accodamento critico.

Un modello caricato o un contatore FPS positivo non dimostra che i livelli successivi siano corretti.

## Pipeline corrente

- `useShotTracker.ts` gestisce il percorso integrato con i worker.
- YOLO è eseguito dai worker YOLO e MoveNet dal worker pose; i callback aggiornano i risultati parsati.
- `VisionEngineAdapter` conserva timestamp distinti per ball/player/rim/pose e soglie di freschezza diverse: 2000 ms per ball, 500 ms per player e rim, 750 ms per pose.
- `WorkoutSessionScreen` coordina le callback e abilita `Runtime.processFrame()` quando le connessioni sono pronte.
- `WorkoutSessionRuntime` protegge `processFrame()` dalla concorrenza e processa soltanto nello stato `ACTIVE`.
- Il parametro `runtimeActive` rimane nell'API di `useCameraPipeline`/ `useShotTracker`, ma è documentato nel codice come non usato nel frame processor dopo il revert di Decision 29. Non attribuire a questo flag una riduzione del carico legacy.

## Metriche da raccogliere

| Livello | Metriche minime | Interpretazione |
|---|---|---|
| Camera | FPS effettivi, timestamp e gap tra frame | Verifica se il flusso camera è vivo e regolare |
| YOLO | numero inferenze, FPS, schedule wait, preprocess/resize, inferenza, parse | Separa attesa e costo del modello |
| MoveNet | numero inferenze, FPS, schedule wait, crop/prep, quantizzazione, inferenza | Distingue ritardo di scheduling da lavoro del modello |
| Adapter | update per canale, età osservazione, freshness e versione | Identifica canali che non aggiornano o sono stale |
| Runtime | chiamate pianificate, avviate, saltate per guardia/stato, errori | Verifica che le callback raggiungano il runtime |
| Tracking | frame processati, ball/player aggiornati, stato tracking | Separa vision dal tracking |
| Overlay | aggiornamenti SharedValue e render visibili | Individua eventuale collo di bottiglia UI |
| Shot events | rilevazioni interne, callback, enqueue, ack/sync | Separa mancata rilevazione da mancata persistenza |

## Diagnosi del ritardo

La misura end-to-end deve usare timestamp monotoni coerenti. Per ogni worker raccogliere almeno P50/P95/P99 di schedule wait e latenza totale. Non sommare metriche sovrapposte né confrontare medie provenienti da sessioni diverse.

- Schedule wait alto con inferenza breve suggerisce contesa/scheduling, non necessariamente un modello lento.
- Inferenza alta con attesa bassa suggerisce un costo modello/preprocess.
- Worker attivo ma adapter senza aggiornamenti suggerisce un problema di callback o di parsing.
- Adapter aggiornato ma `processFrame` assente suggerisce il coordinatore della schermata o guardie di stato.
- Runtime attivo e tracking aggiornato ma overlay fermo suggerisce la propagazione delle SharedValue/render.
- Shot rilevato internamente ma callback/queue assenti suggerisce il dispatch dell'evento, non il detector.

## Stato dei dati disponibili

I precedenti audit di progetto riportavano schedule wait significativo per YOLO e MoveNet. Questi valori sono storici e non sono qui promossi a benchmark corrente: i sorgenti non contengono da soli una misura aggiornata del dispositivo. Nessun numero FPS va definito “garantito” senza un run riproducibile con dispositivo, build, modello, delegate, risoluzione, durata e condizioni termiche documentati.

## Procedura di benchmark

1. Registrare commit SHA, modello YOLO/MoveNet, delegate, risoluzione camera e FPS richiesto.
2. Avviare una sessione nuova e attendere lo stato `ACTIVE`.
3. Eseguire un periodo di riscaldamento separato dal periodo misurato.
4. Acquisire almeno 60 secondi di dati e ripetere almeno tre volte.
5. Esportare contatori e percentili per tutti i livelli della tabella.
6. Ripetere una volta con overlay diagnostico ridotto per stimare il costo della UI, senza cambiare altre variabili.
7. Annotare temperatura, throttling, modello e condizioni di scena.
8. Non cambiare contemporaneamente scheduler, risoluzione e modello durante un esperimento.

## Telemetria e rete

`TelemetrySampler` usa un intervallo configurabile (default 500 ms) e offre `shouldSample()`, `reset()` e `setSampleInterval()`. La sua esistenza non prova che ogni metrica sia inviata al backend: verificare la chiamata effettiva e il payload. La coda critica e la outbox persistente sono separate dalla telemetria campionata.

## Criteri di accettazione

- Nessun contatore rimane a zero senza spiegazione dopo che la sessione è `ACTIVE`.
- Ogni perdita tra worker, adapter, runtime, tracking, overlay e queue è misurabile.
- L'overlay mostra osservazioni recenti con una politica di freschezza esplicita.
- Un tiro produce al massimo un dispatch pubblico per evento e l'esito della queue è osservabile.
- Ogni confronto di performance include commit, configurazione, durata e percentili.

## Riferimenti

- `src/vision/useShotTracker.ts`
- `src/vision/useYoloWorker.ts`, `useYoloWorkerAsync.ts`, `useMoveNetWorker.ts`
- `src/vision/VisionEngineAdapter.ts`
- `src/features/workouts/screens/WorkoutSessionScreen.tsx`
- `src/features/workouts/runtime/WorkoutSessionRuntime.ts`
- `src/features/workouts/services/telemetrySampler.ts`
