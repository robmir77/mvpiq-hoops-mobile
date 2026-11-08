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

## Qualità del modello e accuratezza

Le prestazioni di FPS e latenza YOLO sono simili tra tutti i modelli, ma l'overlay soffre di prestazioni inferiori con modelli di input più grandi (512, 640). I modelli YOLO disponibili hanno livelli di training diversi che influenzano l'accuratezza del rilevamento:
- `best_384_float16`: 200 epoche (validato come più affidabile per riconoscimento tiri)
- `best_320_float16`: 50 epoche
- `best_512_float16`: 40 epoche
- `best_640_float16`: 120 epoche (aggiornato per ridurre false positive)
- `best_448_float16`: 20 epoche

Per dettagli sui comandi di training e checkpoint, vedere `assets/models/README.md`. Quando si confrontano modelli, distinguere tra:
- Problemi di throughput (FPS bassi, latenza alta)
- Problemi di accuratezza (modello poco addestrato, soglie inadeguate)
- Problemi di overlay (modelli con input grande causano rendering lento)
- Problemi di configurazione (preprocessing, NMS, delegate)

## Filtri geometrici e riduzione false positive

Il parser YOLO (`YoloDetector`) applica filtri geometrici per ridurre i false positive basati su forma e dimensione delle bounding box. I filtri sono configurati in `YOLO_CONFIG`:

**Filtri palla:**
- Aspect ratio in pixel space: [BALL_MIN_ASPECT, BALL_MAX_ASPECT] = [0.6, 1.7]
- Dimensione media: [BALL_MIN_SIZE, BALL_MAX_SIDE] = [0.008, 0.15] (normalizzato al frame)

**Filtri giocatore:**
- Larghezza: [PLAYER_MIN_WIDTH, PLAYER_MAX_WIDTH] = [0.05, 0.6]
- Altezza minima: PLAYER_MIN_HEIGHT = 0.1
- Aspect ratio in pixel space (h/w): [PLAYER_MIN_ASPECT, PLAYER_MAX_ASPECT] = [0.8, 6.0]

**Filtri canestro:**
- Larghezza: [RIM_MIN_WIDTH, RIM_MAX_WIDTH] = [0.015, 0.25]
- Aspect ratio in pixel space (w/h): [RIM_MIN_ASPECT, RIM_MAX_ASPECT] = [0.7, 6.0]

Gli aspect ratio sono calcolati in pixel space corretti per il frame aspect ratio (es. 16:9). Su un frame 16:9, un oggetto quadrato ha w/h normalizzato ≈ 0.56.

## Validazione schema tensore

`YoloDetector.validateOutputSchema()` verifica che il tensore di output corrisponda al formato YOLO11n atteso:
- Divisibilità per OUTPUT_CHANNELS (7)
- Numero di anchor corrispondente a risoluzioni note (2100, 3024, 4116, 5376, 8400)
- Inferenza automatica di TENSOR_SIZE dal numero di anchor
- Errori espliciti se il tensore non corrisponde allo schema atteso

Tutti i modelli `best_N_float16.tflite` seguono lo stesso schema di esportazione:
- **Input**: `[1, SIZE, SIZE, 3]` dove SIZE corrisponde al nome del modello
- **Output**: `[1, 7, N]` dove N = numero di anchor per la risoluzione
- **Layout**: 4 coordinate (xc, yc, w, h) + 3 class scores (ball, human, rim)
- **Dtype**: float32 (nessuna quantizzazione nel tensore di output)

Il numero di anchor N segue la griglia YOLO standard con stride 8, 16, 32:
- 320 → 2100 (40² + 20² + 10²)
- 384 → 3024 (48² + 24² + 12²)
- 448 → 4116 (56² + 28² + 14²)
- 512 → 5376 (64² + 32² + 16²)
- 640 → 8400 (80² + 40² + 20²)

Lo script `scripts/verify_tflite_metadata.py` verifica i metadati di tutti i modelli TFLite per confermare la coerenza dello schema di esportazione.

## Soglie confidence definitive

Le soglie confidence sono state tarate con log [YOLO RAW] e benchmark su video reali:

- BALL_CONF_THRESHOLD: 0.05 (definitivo)
- PLAYER_CONF_THRESHOLD: 0.01 (definitivo)
- RIM_CONF_THRESHOLD: 0.10 (definitivo)
- ADAPTIVE_CONF.MIN_THRESHOLD: 0.03 (era 0.0005, ora evita rilassamento nel noise)

Le soglie sono state determinate analizzando i massimi score osservati sul device e dai benchmark video. Il modello best_640_float16 (120 epoche) produce confidence molto alte per la palla (0.76-0.84) quando inquadrata, mentre player e rim hanno score tipicamente più bassi.

## Tracking della palla e TTL

Il tracking della palla usa un filtro Kalman con una TTL (Time To Live) per le predizioni senza nuove rilevazioni. La TTL è configurata in `BallTrackingState.ts`:

- `predictionTtlMs: 400` ms (aggiornato da 150 ms)

La TTL deve essere sufficientemente grande da coprire l'intervallo tra inferenze successive del modello YOLO. I modelli hanno FPS diversi:
- `best_384_float16`: fpsMin 20 / fpsMax 21 (intervallo ~50 ms)
- `best_640_float16`: fpsMin 5 / fpsMax 7 (intervallo 143-200 ms)

Con la vecchia TTL di 150 ms, il modello 640 non riusciva a costruire traiettorie continue perché ogni rilevazione scadeva prima della successiva. Con 400 ms, il tracker può mantenere lo stato anche con modelli più lenti.

## Correzioni cablaggi minori

**YoloDetector.ts - resolutionScale**
- Ripristinato da `1.0` a `TENSOR_SIZE / 512`
- Allineamento con benchmark Python per coerenza delle soglie adattive
- Per modello 640: scaling +25% delle soglie dimensione palla (1.25x)
- Per modello 384: scaling -25% delle soglie dimensione palla (0.75x)

**CalibrationScreen.tsx - fallback yoloInputSize**
- Rimosso fallback `|| 384`
- Ora usa solo `yoloModel?.inputSize` dal modello selezionato

## Discrepanza YOLO-AB benchmark vs applicazione (RISOLTA)

Il benchmark offline `yolo-ab` (`scripts/benchmark_yolo_videos.py`) usa la modalità `app-compatible` per replicare la logica di `YoloDetector.ts` e `BallDetectionProcessor.ts`. È stata identificata e risolta una discrepanza critica nel parametro `resolutionScale`.

**Risoluzione**: Allineamento dell'app al benchmark Python

**Benchmark Python** (`benchmark_yolo_videos.py` riga 223):
```python
resolution_scale = tensor_size / 512
```
- Per modello 384: `resolution_scale = 384/512 = 0.75`
- Per modello 640: `resolution_scale = 640/512 = 1.25`

**App TypeScript** (`YoloDetector.ts` riga 388):
```typescript
const resolutionScale = TENSOR_SIZE / 512
```
- Ora calcolato dinamicamente come `TENSOR_SIZE / 512` per allinearsi al benchmark

**Impatto precedente**: Con il modello 640, il benchmark aumentava le soglie di dimensione della palla del 25% (1.25x), mentre l'app non le scala (1.0x). Questo causava il rifiuto di più detection nell'app rispetto al benchmark.

**Altre differenze verificate (tutte risolte/identiche)**:
- **Runtime**: Benchmark usa CPU Python, app usa GPU/NNAPI su Android (differenze numeriche possibili ma accettabili)
- **Letterbox**: Calcolo identico tra benchmark e app (verificato con logging: SCALE=0.16, OFFSET_Y=139.84)
- **Coordinate**: Entrambi usano coordinate normalizzate (0-1) con `coordinateScale = 640` (verificato)
- **Normalizzazione input**: Verificata con logging (`inputTensorStats`: min=0, max=1, mean=~0.24-0.29)

**Logging diagnostici attivi**:
- `useYoloWorkerAsync.ts`: Log statistico del tensore di input (min/max/mean) ogni 10 frame per verificare normalizzazione 0-1
- `YoloDetector.ts`: Log calcolo letterbox, rilevamento formato coordinate e validazione schema tensore per confronto con benchmark
- `scripts/verify_tflite_metadata.py`: Script Python per verifica metadati TFLite (input/output shape, dtype, quantizzazione)
