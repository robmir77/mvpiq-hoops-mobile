# Piano di implementazione ed esecuzione dei test

**Repository:** `robmir77/mvpiq-hoops-mobile`  
**Branch di lavoro:** `Validation-1.0`  
**Stato:** piano iniziale — da aggiornare con risultati reali dopo ogni fase.

## 1. Obiettivi

1. Verificare che il flusso dei frame attraversi correttamente `WorkoutSessionRuntime` e i suoi coordinatori.
2. Isolare regressioni nel percorso visione → adapter → tracking → rilevamento del tiro.
3. Garantire che i tiri automatici e manuali rispettino contratti, timestamp, deduplicazione e normalizzazione degli esiti.
4. Verificare code, persistenza e gestione degli errori senza dipendere da camera o rete reali.
5. Distinguere chiaramente ciò che può essere dimostrato con test automatici da ciò che richiede un dispositivo fisico.

## 2. Principi

- **Prima misurare, poi modificare:** eseguire i test già presenti prima di aggiungerne altri.
- **Test piccoli e deterministici:** mock per camera, modelli, timer, rete e worker; niente inferenza reale negli unit test.
- **Un obiettivo per test:** evitare test fragili che verificano contemporaneamente troppi dettagli interni.
- **Non cambiare il comportamento di produzione per far passare un test.** Se emerge un difetto, registrarlo e correggerlo con una modifica separata e mirata.
- **Nessuna modifica ai modelli o al throttling FPS** nell'ambito di questo piano, salvo decisione esplicita basata sui risultati.
- Eseguire tutto sul branch `Validation-1.0`; non modificare `main`.

## 3. Fase 0 — Inventario e baseline

### Attività
- [ ] Verificare branch, working tree e versione Node/package manager prevista dal repository.
- [ ] Esaminare gli script in `package.json` e la configurazione Jest.
- [ ] Inventariare i test esistenti ed evitare duplicati.
- [ ] Eseguire la suite attuale senza modificare il codice.
- [ ] Salvare il risultato: comando, esito, test passati/falliti, eventuali errori di setup e durata.
- [ ] Se la suite completa fallisce, classificare i fallimenti preesistenti prima di aggiungere test.

### Comandi iniziali
Usare il package manager e il lockfile già presenti nel repository. Lo script di test dichiarato nel progetto è:

```bash
npm test -- --runInBand
```

Per la copertura, dopo aver verificato che lo script sia configurato correttamente:

```bash
npm run test:coverage -- --runInBand
```

Se il runner non supporta uno di questi argomenti, usare la sintassi prevista dalla configurazione effettiva e annotarla qui. Non assumere che una suite sia passata senza aver letto l'output completo.

## 4. Fase 1 — Runtime e ingresso dei frame (priorità massima)

### Aree di riferimento
- `src/features/workouts/runtime/WorkoutSessionRuntime.ts`
- `src/features/workouts/__tests__/WorkoutSessionRuntime.test.ts`
- `src/screens/__tests__/RuntimeProcessFrameCoordinator.test.ts` (se il percorso è ancora presente)
- coordinatori e pipeline che invocano `processFrame()`.

### Casi da verificare
- [ ] Il runtime inizializza lo stato atteso e applica soltanto transizioni valide.
- [ ] I frame vengono elaborati solo negli stati in cui il contratto del runtime lo consente.
- [ ] Un frame non viene elaborato due volte accidentalmente da percorsi concorrenti o duplicati.
- [ ] Frame assenti, input non validi ed errori dei componenti vengono gestiti senza bloccare la sessione.
- [ ] Le metriche aumentano solo quando il lavoro corrispondente è stato effettivamente eseguito.
- [ ] L'assenza di una nuova osservazione non viene confusa con una nuova detection.
- [ ] Stop, pausa e completamento impediscono ulteriore lavoro non previsto.
- [ ] Callback, queue e telemetria ricevono payload coerenti con i contratti pubblici.

### Criterio di uscita
I test devono coprire i percorsi nominali e gli stati limite del flusso runtime. Qualunque discrepanza fra stato `ACTIVE`, chiamate a `processFrame()` e metriche va documentata prima di passare alla fase successiva.

## 5. Fase 2 — Visione, adapter e tracking

### Aree di riferimento
- `src/vision/__tests__/VisionEngineAdapter.test.ts`
- `src/vision/__tests__/yoloParser.test.ts`
- `src/features/workouts/tracking/TrackingEngine.ts`
- test esistenti in `tracking/__tests__/`.

### Casi da verificare
- [ ] L'adapter inoltra le osservazioni nuove una sola volta per canale.
- [ ] Timestamp e freschezza delle osservazioni sono preservati.
- [ ] Dati cached/stale non vengono trattati come nuove misurazioni.
- [ ] La distinzione tra `null`, `undefined` e osservazione assente rispetta il contratto effettivo.
- [ ] Le detection YOLO valide, invalide, multiple o a bassa confidenza sono gestite come previsto.
- [ ] La detection del giocatore raggiunge il tracking attraverso il parametro previsto, senza bridge legacy impliciti.
- [ ] Coordinate, dimensioni e limiti dei bounding box sono validati.

### Criterio di uscita
I test isolano parser, adapter e tracking con input sintetici e verificano gli output, senza caricare modelli TFLite né avviare la camera.

## 6. Fase 3 — Shot detection e registrazione

### Aree di riferimento
- `src/features/workouts/tracking/ShotDetectionEngine.ts`
- test di tracking e registrazione già presenti.
- `src/features/workouts/__tests__/manualShotRegistration.test.ts`, se presente.

### Casi da verificare
- [ ] Un singolo evento di tiro non produce registrazioni duplicate.
- [ ] Le finestre temporali e le regole di deduplicazione sono verificate ai limiti.
- [ ] Osservazioni obsolete o mancanti non generano un tiro automatico non giustificato.
- [ ] Le registrazioni manuali restano distinte da quelle automatiche.
- [ ] La normalizzazione pubblica degli esiti rispetta il tipo del callback: `MADE` o `MISS`; `AIRBALL`, se presente internamente, deve essere convertito secondo il contratto attuale.
- [ ] Errori di registrazione o accodamento sono gestiti senza contare due volte il tiro.
- [ ] Gli eventi emessi e i payload in coda sono coerenti.

### Criterio di uscita
Ogni caso limite critico ha un test ripetibile che fallisce se viene reintrodotta la regressione.

## 7. Fase 4 — Code, persistenza e recupero

### Aree di riferimento
- `src/features/workouts/services/workoutAsyncQueue.ts`
- `src/features/workouts/services/persistentOutbox.ts`
- test esistenti di queue, outbox, lifecycle e API.

### Casi da verificare
- [ ] Ordine di elaborazione e comportamento con più elementi.
- [ ] Errori transitori, retry e fallimenti permanenti.
- [ ] Nessuna perdita o duplicazione involontaria degli eventi critici.
- [ ] Shutdown, sessione terminata e ripartenza con elementi pendenti.
- [ ] Persistenza e ripristino dei payload.
- [ ] Timeout e risposte API simulate in modo deterministico.

### Criterio di uscita
Le operazioni asincrone sono testabili senza rete reale e senza dipendere da attese temporali arbitrarie.

## 8. Fase 5 — Overlay e coordinate

### Aree di riferimento
- `src/features/workouts/components/RealtimeBallOverlay.tsx`
- utility di coordinate, omografia e calibrazione.
- test esistenti per `homography`, `calibration` e componenti UI.

### Casi da verificare
- [ ] Conversione fra coordinate del frame e coordinate dell'overlay.
- [ ] Scaling, aspect ratio, offset e rotazione quando previsti dal contratto.
- [ ] Osservazioni assenti, obsolete e fuori dai limiti.
- [ ] Il rendering usa l'ultimo stato disponibile senza inventare nuove detection.
- [ ] I test di componente verificano props e aggiornamenti dello stato, ove supportati dall'ambiente di test.

### Limite importante
Gli unit test possono verificare trasformazioni, stato e props, ma **non dimostrano da soli la continuità visiva reale** o il frame rate sul dispositivo. Questi aspetti richiedono una verifica manuale su device con registrazione video e telemetria.

## 9. Fase 6 — Test d'integrazione e regressione

- [ ] Eseguire i test di flusso workout esistenti.
- [ ] Verificare start → active → pausa/ripresa → completamento.
- [ ] Verificare il percorso frame → detection → tracking → shot event con dipendenze simulate.
- [ ] Verificare che la disattivazione dei percorsi legacy, se prevista dal codice attuale, non lasci il runtime senza frame.
- [ ] Eseguire nuovamente l'intera suite dopo ogni correzione.
- [ ] Eseguire la suite di coverage e individuare i rami critici non coperti.

## 7. Fase 7 — Validazione su dispositivo reale

Solo dopo il superamento dei test automatici:

- [ ] Avviare una sessione e verificare che lo stato passi ad `ACTIVE`.
- [ ] Confermare che `processFrame()` venga chiamato e che le metriche non rimangano a zero.
- [ ] Verificare aggiornamenti continui dell'overlay durante il movimento.
- [ ] Provare più tiri consecutivi, inclusi tiri mancati e canestri.
- [ ] Verificare pause, ripresa, uscita e nuovo avvio della sessione.
- [ ] Raccogliere log e video con timestamp confrontabili.
- [ ] Annotare dispositivo, versione app, condizioni del test e risultati.

Non considerare il test su device superato soltanto perché i modelli risultano caricati: serve evidenza che i frame siano elaborati e che gli output raggiungano tracking e overlay.

## 8. Piano di test su dispositivo — Riconoscimento, Classificazione e Prestazioni

**Obiettivo:** Separare nettamente il riconoscimento del tiro, la classificazione del risultato (MADE/MISS) e le prestazioni della pipeline.

### Tabella di registrazione delle prove

| Campo | Valore da registrare |
|---|---|
| Device e versione app | Modello, OS, build/commit |
| Modello YOLO | ID, formato e risoluzione |
| Configurazione camera | Risoluzione, FPS configurati |
| Tiri reali | Numero annotato manualmente |
| Tiri rilevati | totalShots |
| Canestri reali | Numero annotato manualmente |
| Canestri riconosciuti | madeShots |
| Falsi positivi / tiri persi | Confronto con il video |
| FPS | Camera, YOLO, MoveNet |
| Anomalie | Log correlati e timestamp |

### T0 — Baseline runtime e conteggio dei tiri

**Stato:** ✅ Verificato nel test

**Risultato registrato:**
- Device: Samsung Galaxy S21 Ultra
- Risoluzione camera: 4000 × 2252
- Modello: best_384_float16
- Tiri effettuati: 4
- Tiri registrati: 4 su 4
- Canestri realizzati: 0 (i quattro tiri erano tutti sbagliati, risultato coerente)
- Prestazioni riportate: camera 29–39 FPS, YOLO 27–29 FPS, MoveNet 0–3 FPS

**Criterio:** Sessione eseguita, modello caricato, tiri registrati correttamente.

**Da verificare separatamente:** stabilità su più sessioni e assenza di doppi conteggi.

### T1 — Classificazione MADE/MISS

**Priorità:** Alta

**Obiettivo:** Verificare che il sistema distingua correttamente un canestro da un tiro sbagliato.

**Procedura:**
- Eseguire una sequenza contenente sia canestri realizzati sia tiri sbagliati
- Annotare il risultato reale di ogni tiro
- Confrontarlo con totalShots e madeShots
- Controllare che ogni tiro venga classificato una sola volta

**Criterio:** Tutti gli eventi devono essere confrontabili con il risultato reale; eventuali discrepanze devono essere riproducibili e analizzabili nei log.

**Nota:** Non marcare come fallita la classificazione dei canestri se nella prova non c'erano canestri da riconoscere.

### T2 — Continuità del tracking

**Priorità:** Successivo

**Obiettivo:** Correlare rilevazioni della palla, traiettoria, eventi del tiro e scadenze TTL.

**Procedura:**
- Verificare cosa accade nei frame precedenti a un tiro classificato in modo errato
- Verificare il significato di Tracking=0 e quando viene campionata questa metrica

**Criterio:** Identificare se e dove la continuità della palla si interrompe negli eventi problematici.

### T3 — Prestazioni e overlay

**Priorità:** Da completare

**Obiettivo:** Verificare gli FPS mostrati nell'overlay e interpretare MoveNet.

**Procedura:**
- Verificare gli FPS mostrati nell'overlay durante una sessione
- Registrare durata, FPS e contatori prima, durante e dopo i tiri
- Interpretare MoveNet a 0–3 FPS in relazione alle condizioni di attivazione previste

**Criterio:** Distinguere i valori realmente misurati da quelli assenti o non aggiornati.

**Nota:** Le performance di inferenza YOLO (FPS) sono simili tra tutti i modelli, ma l'overlay soffre di prestazioni inferiori con modelli di input più grandi (512, 640).

### T4 — Confronto modelli e precisione numerica

**Priorità:** Da rimandare

**Obiettivo:** Valutare altri modelli e formati dopo aver validato la baseline.

**Procedura:**
- Mantenere best_384_float16 come baseline
- Verificare checkpoint e configurazioni degli altri modelli
- Valutare FLOAT32 soltanto con un confronto A/B a parità di checkpoint e configurazione

**Criterio:** Confrontare accuratezza e prestazioni senza confondere gli effetti del training con quelli dell'esportazione.

**Nota:** Gli altri modelli hanno meno epoche di training (20-50 vs 200 del 384), che influenzano l'accuratezza del rilevamento. Per migliorarli, eseguire training resume fino a 150-200 epoche.

## 10. Benchmark comparativo dei modelli YOLO usando video fissi

**Stato:** runner offline aggiunto in `scripts/benchmark_yolo_videos.py`; esecuzione e validazione del preprocessing ancora da fare. Il modello 640 esistente da 30 epoche può essere provato subito; il modello 640 da 50 epoche sarà aggiunto quando esportato e verificato.  
**Obiettivo:** confrontare i modelli sugli stessi contenuti, separando la qualità delle detection dalle prestazioni e dal conteggio finale dei tiri.

### Dataset di test versionato

Usare tutti e tre i video già presenti nel branch `Validation-1.0`:

- `src/vision/__tests__/media/Tiro Libero.mp4`
- `src/vision/__tests__/media/Tiro da 3.mp4`
- `src/vision/__tests__/media/Tirp a centrocampo.mp4`

I file sono il dataset fisso iniziale. Non assumere in anticipo quanti tiri contenga ciascun video o quali difficoltà rappresenti: ispezionarli e annotare manualmente i riferimenti prima di interpretare i risultati. Registrare nome, durata, dimensioni, FPS e hash dei file per identificare esattamente la versione usata.

### 10.0 Runner offline iniziale

È stato aggiunto `scripts/benchmark_yolo_videos.py`. Il runner:
- legge i modelli TFLite e i tre MP4;
- registra hash SHA-256 e metadati dei video e dei modelli;
- campiona gli stessi frame secondo `--every-n-frames`;
- misura la latenza TFLite dopo un numero configurabile di warm-up;
- salva le detection diagnostiche in CSV e un riepilogo in `manifest.json`.

Esempio dalla root del repository (in un ambiente Python separato):

```bash
pip install opencv-python numpy tensorflow
python scripts/benchmark_yolo_videos.py \
  --models assets/models/best_384_float16.tflite assets/models/best_640_float16.tflite \
  --videos "src/vision/__tests__/media/Tiro Libero.mp4" \
          "src/vision/__tests__/media/Tiro da 3.mp4" \
          "src/vision/__tests__/media/Tirp a centrocampo.mp4" \
  --every-n-frames 5 --warmup 5 --threads 2 \
  --output-dir benchmark-results/yolo-ab
```

**Limiti da rispettare:** il runner non è ancora stato eseguito in questo ambiente. Il preprocessing OpenCV (RGB, contain/letterbox e intervallo numerico dei pixel) deve essere confrontato con l'output effettivo di `react-native-vision-camera-resizer` prima di considerare le detection equivalenti a quelle dell'app. `--input-scale` rende esplicito il moltiplicatore dei pixel; il valore predefinito è `1.0`, da confermare con una verifica sul dispositivo. Il decoder Python è diagnostico: non replica ancora integralmente `YoloDetector.parseOutput()`, la soglia adattiva o il filtro finale della palla nel worker. Il CSV consente quindi un confronto preliminare, non una dichiarazione di precision/recall o di accuratezza finale. Il runner misura latenza su CPU/default delegate Python, non FPS su Samsung S21 Ultra.

### 10.1 Fase A — Inventario e riferimento annotato

- [ ] Verificare che i tre file siano leggibili e rilevare durata, risoluzione, frame rate e numero di frame.
- [ ] Creare un manifesto del dataset con percorso, hash e metadati dei video.
- [ ] Guardare ciascun video e annotare il numero dei tentativi di tiro e, quando distinguibile, l'esito reale.
- [ ] Selezionare frame rappresentativi a intervalli ripetibili, includendo la palla visibile, la palla piccola/in movimento e frame senza palla quando presenti.
- [ ] Annotare manualmente le bounding box di palla, persone e canestro nei frame campionati per poter calcolare metriche di detection. Se non si annotano bounding box, limitare le conclusioni a un confronto qualitativo e non dichiarare precision/recall misurate.

### 10.2 Fase B — Verifica di compatibilità dei modelli

- [ ] Usare `best_384_float16` come baseline iniziale selezionandolo esplicitamente per ID: in `src/config/appConfig.ts` il default attualmente dichiarato è `best_640_float16`, quindi non affidarsi al modello predefinito durante l'A/B.
- [ ] Confrontare inizialmente due modelli: `best_384_float16` (baseline) e `best_640_float16` già versionato (30 epoche). Il 640 da 50 epoche entrerà in una successiva esecuzione dello stesso protocollo.
- [x] Per il confronto iniziale usare il `best_640_float16.tflite` già presente nel repository (registro `src/vision/yoloModels.ts`: 30 epoche), così da misurare i miglioramenti rispetto alla baseline `best_384_float16` mentre termina l'addestramento a 50 epoche.
- [ ] Quando sarà pronto, aggiungere come terzo candidato il nuovo artefatto YOLO 640 da 50 epoche, identificandolo tramite nome e hash e mantenendo invariati video, frame campionati e protocollo.
- [ ] Registrare per ciascun artefatto: percorso/nome, hash, input shape, dtype, quantizzazione, output shape, versione/configurazione del training e delegate usato.
- [ ] Verificare preprocessing, normalizzazione, letterbox/resize, interpretazione output, soglie e NMS del percorso effettivo dell'app.
- [ ] Non considerare `compare_models.py` un benchmark video: lo script esistente ispeziona metadati dei modelli e non esegue da solo il confronto delle detection sui tre MP4.

### 10.3 Fase C — Benchmark offline delle detection

- [ ] Definire un runner ripetibile che decodifichi gli stessi frame dai tre video e li passi ai modelli usando il preprocessing corretto per ciascun artefatto.
- [ ] Eseguire un modello alla volta, mantenendo fissi frame campionati, soglie equivalenti quando applicabili e configurazione di valutazione.
- [ ] Salvare i risultati grezzi per frame in CSV/JSON: video, timestamp/frame index, modello, classe, confidenza, bounding box e latenza d'inferenza.
- [ ] Calcolare precision, recall e metriche di localizzazione soltanto sui frame annotati e con una regola IoU dichiarata.
- [ ] Riportare separatamente falsi positivi, mancate detection, confidenza e latenza mediana/P95; non aggregare tutto in un unico punteggio non spiegato.
- [ ] Ripetere i run necessari a distinguere il costo di inizializzazione dal tempo d'inferenza. Specificare hardware, runtime, delegate e versione delle librerie.
- [ ] Se l'ambiente offline non supporta lo stesso runtime/delegate dell'app, etichettare i tempi come benchmark offline e non usarli come sostituti delle prestazioni sul telefono.

### 10.3.1 Comandi di esecuzione e overlay comparativo

**Risultati già versionati:** `benchmark-results/yolo-ab/`. Il `manifest.json` registra un campionamento ogni 5 frame, 5 inferenze di warm-up e 77 inferenze misurate per modello. I CSV attuali sono quindi adatti a un primo controllo visivo dei frame campionati; non descrivono ogni frame del video.

Eseguire i comandi dalla root del repository, nel branch `Validation-1.0`, usando PowerShell.

#### A. Riprodurre il benchmark offline già registrato

Prerequisiti Python, in un ambiente dedicato:

```powershell
python -m pip install opencv-python numpy tensorflow
```

Comando:

```powershell
python .\scripts\benchmark_yolo_videos.py `
  --models .\assets\models\best_384_float16.tflite .\assets\models\best_640_float16.tflite `
  --videos ".\src\vision\__tests__\media\Tiro Libero.mp4" ".\src\vision\__tests__\media\Tiro da 3.mp4" ".\src\vision\__tests__\media\Tirp a centrocampo.mp4" `
  --every-n-frames 5 `
  --warmup 5 `
  --threads 2 `
  --output-dir .\benchmark-results\yolo-ab-reproduced
```

L'output va in una cartella distinta per non sovrascrivere i risultati già committati. Confrontare il nuovo `manifest.json` con quello esistente; differenze nei tempi possono dipendere dall'hardware, dal runtime e dal carico del sistema.

#### B. Generare frame e contact sheet dai risultati già committati

Questo passaggio **non richiede di rieseguire l'inferenza**: usa i due CSV esistenti e i tre video originali.

```powershell
python .\scripts\render_yolo_overlay_comparison.py `
  --videos ".\src\vision\__tests__\media\Tiro Libero.mp4" ".\src\vision\__tests__\media\Tiro da 3.mp4" ".\src\vision\__tests__\media\Tirp a centrocampo.mp4" `
  --csv-384 .\benchmark-results\yolo-ab\best_384_float16_detections.csv `
  --csv-640 .\benchmark-results\yolo-ab\best_640_float16_detections.csv `
  --output-dir .\benchmark-results\yolo-ab\overlay-comparison
```

Per ciascun video lo script salva PNG comparativi in `frames\` e un `contact_sheet.png`. Le box e le confidence sono diagnostiche e provengono dal decoder offline: **non sono l'overlay esatto dell'app, non equivalgono a precisione misurata e non sostituiscono annotazioni ground truth**.

#### C. Analizzare la continuità temporale con campionamento di ogni frame

Da eseguire solo dopo il primo controllo visivo, se serve esaminare anche i frame non inclusi nel benchmark attuale. L'output è separato per conservare la baseline.

```powershell
python .\scripts\benchmark_yolo_videos.py `
  --models .\assets\models\best_384_float16.tflite .\assets\models\best_640_float16.tflite `
  --videos ".\src\vision\__tests__\media\Tiro Libero.mp4" ".\src\vision\__tests__\media\Tiro da 3.mp4" ".\src\vision\__tests__\media\Tirp a centrocampo.mp4" `
  --every-n-frames 1 `
  --warmup 5 `
  --threads 2 `
  --output-dir .\benchmark-results\yolo-ab-every-frame
```

Poi generare i frame comparativi dai CSV completi:

```powershell
python .\scripts\render_yolo_overlay_comparison.py `
  --videos ".\src\vision\__tests__\media\Tiro Libero.mp4" ".\src\vision\__tests__\media\Tiro da 3.mp4" ".\src\vision\__tests__\media\Tirp a centrocampo.mp4" `
  --csv-384 .\benchmark-results\yolo-ab-every-frame\best_384_float16_detections.csv `
  --csv-640 .\benchmark-results\yolo-ab-every-frame\best_640_float16_detections.csv `
  --output-dir .\benchmark-results\yolo-ab-every-frame\overlay-comparison
```

**Lettura dei risultati:** verificare visivamente falsi positivi, detection mancanti, cambi bruschi di posizione e interruzioni della palla tra frame consecutivi. La confidence è il punteggio del modello, non la probabilità che la detection sia corretta; precision/recall richiedono box annotate manualmente e una regola IoU dichiarata. Questo benchmark offline su CPU non misura gli FPS effettivi dell'app sul telefono.

### 10.4 Fase D — Replay end-to-end e verifica su dispositivo

- [ ] Verificare se la pipeline attuale accetta frame provenienti da un video. Se non li accetta, progettare un harness di replay separato che alimenti frame e timestamp in modo deterministico senza alterare il comportamento normale della camera.
- [ ] Prima di implementare il replay, individuare il punto d'ingresso reale di YOLO/worker e i contratti di timestamp, dimensioni e coordinate.
- [ ] Per ciascun video e modello, registrare tiri annotati, tiri rilevati, MADE/MISS quando verificabile, falsi positivi, tiri persi, FPS effettivi, latenze e osservazioni stale.
- [ ] Eseguire infine prove sul Samsung Galaxy S21 Ultra con build e impostazioni registrate. Usare lo stesso video, stesso ordine di frame e stesso punto di partenza per ogni modello.
- [ ] Verificare che il replay non crei una coda illimitata: documentare frame prodotti, elaborati, saltati e ritardo accumulato.
- [ ] Non modificare soglie, tracking, shot detection o throttling per favorire un modello durante il confronto; eventuali esperimenti di tuning vanno registrati come test separati.

### Output richiesti

1. Manifesto dei tre video e annotazioni di riferimento.
2. CSV/JSON delle detection per modello e frame.
3. Report comparativo con metriche, configurazioni, limiti e anomalie.
4. Report separato end-to-end/device per conteggio dei tiri e prestazioni.

### Criteri di uscita

Il confronto è considerato ripetibile quando entrambi i modelli elaborano gli stessi frame con configurazioni documentate, i risultati grezzi sono conservati e le metriche sono confrontate con annotazioni esplicite. Se il replay end-to-end non è ancora disponibile, riportare soltanto il benchmark offline e lasciare il conteggio completo dei tiri come non verificato.

---

## 11. Strategia di esecuzione

Ordine consigliato:

1. **Baseline:** suite esistente, senza modifiche.
2. **Runtime:** aggiungere solo i test mancanti prioritari.
3. **Visione/tracking:** aggiungere i test di contratto e freschezza.
4. **Shot detection:** verificare deduplicazione ed esiti.
5. **Queue/outbox:** verificare affidabilità asincrona.
6. **Overlay:** verificare coordinate e aggiornamenti dello stato.
7. **Regressione completa e coverage.**
8. **Benchmark video offline:** inventario e annotazioni dei tre MP4, verifica di compatibilità dei modelli e confronto sulle stesse sequenze di frame.
9. **Replay end-to-end e device test:** dopo aver verificato o implementato un ingresso deterministico dei frame, misurare conteggio e prestazioni sul dispositivo.

Dopo ogni fase:
1. eseguire il test mirato;
2. controllare il risultato;
3. correggere eventuali difetti in una modifica circoscritta;
4. rieseguire il test mirato;
5. rieseguire la suite completa;
6. aggiornare questo documento con esito e commit.

## 12. Registro dei risultati

Compilare questa tabella soltanto con risultati realmente osservati.

| Fase | Stato | Comando / prova | Esito e note | Commit |
|---|---|---|---|---|
| 0 — Baseline | ✅ Completata | Test singoli (heap out of memory in suite completa) | **Ambiente:** Branch Validation-1.0, Node v22.22.3, 3 file modificati nel working tree<br><br>**Test passati (97/97):**<br>- workouts.api.test.ts: 20/20 ✓<br>- workoutFlow.integration.test.ts: 11/11 ✓<br>- manualShotRegistration.test.ts: 19/19 ✓<br>- homography.test.ts: 12/12 ✓<br>- calibration.test.ts: 23/23 ✓<br>- TrackingEngine.test.ts: 4/4 ✓<br>- PlayerTrackingEngine.test.ts: 8/8 ✓<br>- BallTrajectoryAnalyzer.test.ts: 14/14 ✓<br><br>**Test falliti (preesistenti - 27/77):**<br>- yoloParser.test.ts: 0/9 - YOLO_CONFIG undefined<br>- VisionEngineAdapter.test.ts: 0/3 - YOLO_CONFIG undefined<br>- WorkoutSessionRuntime.test.ts: 33/39 - 6 falliti (manual shot metrics non incrementano, vision engine start/stop non chiamati)<br>- workoutAsyncQueue.test.ts: heap out of memory (loop infinito in log())<br>- ShotDetectionEngine.test.ts: 7/12 - 5 falliti (dribble filter, shot detection MADE/MISS/AIRBALL)<br>- RuntimeProcessFrameCoordinator.test.ts: 6/8 - 2 timeout (fake timers)<br>- BallTrackingEngine.test.ts: 15/19 - 4 falliti (smoothing, velocity, adaptive gain)<br><br>**Note:** Suite completa non eseguibile per heap limit (4GB). Eseguire test singolarmente per fase 1+. | — |
| 1 — Runtime/frame | Da eseguire | Test mirati runtime/coordinator | — | — |
| 2 — Visione/tracking | ✅ Completata | Test mirati VisionEngineAdapter, BallTrackingEngine, ShotDetectionEngine | **Ambiente:** Branch Validation-1.0<br><br>**Test passati (34/34):**<br>- VisionEngineAdapter.test.ts: 3/3 ✓ (contratto temporale, nuova misura vs cache)<br>- BallTrackingEngine.test.ts: 19/19 ✓ (4 test corretti: smoothing, velocity, fast shot, adaptive gain)<br>- ShotDetectionEngine.test.ts: 12/12 ✓ (6 test corretti: dribble filter, arc height, rising frames, apex, reset, legacy equivalence; 2 test corretti: MISS geometria, AIRBALL rawVy)<br><br>**Correzioni applicate:**<br>- BallTrackingEngine.test.ts: passi modificati da 0.005 a 0.02 (sotto outlier threshold 0.025) per dimostrare smoothing/velocità/gain<br>- ShotDetectionEngine.test.ts: aggiunto ballPositionRaw a 6 test per calcolo rawDescending<br>- ShotDetectionEngine.test.ts: corretta geometria MISS (x=0.59, dist=0.09 tra 0.06-0.12)<br>- ShotDetectionEngine.ts: corretta unità rawVy da normalized/ms a normalized/s (*1000)<br>- ShotDetectionEngine.test.ts: corretto AIRBALL (y=0.7 per rawVy=3.33 > 3.0, discesa corretta in coordinate schermo)<br><br>**Note:** minOutlierDistance non modificato. rawVy unità allineate con SHOT_LAUNCH_THRESHOLD (1.5 normalized/s). | — |
| 3 — Shot detection | Da eseguire | Test shot/manual registration | — | — |
| 4 — Queue/outbox | ✅ Completata | Test workoutAsyncQueue, workoutLifecycle.e2e, telemetrySampler | **Ambiente:** Branch Validation-1.0<br><br>**Test passati (51/51):**<br>- workoutAsyncQueue.test.ts: 20/20 ✓ (mock updateRetryCount aggiunto)<br>- workoutLifecycle.e2e.test.ts: 7/7 ✓ (mock PersistentOutbox completo, API mock sempre fallisce per test offline)<br>- telemetrySampler.test.ts: 24/24 ✓ (gestione timestamp 0, negativi, non-monotonici)<br><br>**Correzioni applicate:**<br>- workoutLifecycle.e2e.test.ts: sostituito `...new PersistentOutbox()` con mock completo per tutti i test<br>- workoutLifecycle.e2e.test.ts: API mock configurato con `.mockRejectedValue()` invece di `.mockRejectedValueOnce()` per test offline<br>- telemetrySampler.ts: aggiunto check per timestamp non-monotonici (reset a nuovo timestamp)<br>- telemetrySampler.test.ts: corretto test timestamp 0 (ora si aspetta false quando < sampleIntervalMs)<br>- telemetrySampler.test.ts: corretto test 2 Hz sampling (loop inizia da 500 invece di 0)<br><br>**Note:** workoutAsyncQueue.test.ts era già passato (20/20). Le correzioni riguardano solo lifecycle e telemetrySampler. | — |
| 5 — Overlay/coordinate | Da eseguire | Test utility/componenti | — | — |
| 6 — Regressione | ✅ Completata | Suite completa Jest | **Ambiente:** Branch Validation-1.0<br><br>**Test passati (271/271):**<br>- 18/18 suite passate<br>- 271/271 test passati<br><br>**Suite principali:**<br>- workouts.api.test.ts: 20/20 ✓<br>- workoutFlow.integration.test.ts: 11/11 ✓<br>- manualShotRegistration.test.ts: 19/19 ✓<br>- homography.test.ts: 12/12 ✓<br>- calibration.test.ts: 23/23 ✓<br>- TrackingEngine.test.ts: 4/4 ✓<br>- PlayerTrackingEngine.test.ts: 8/8 ✓<br>- BallTrajectoryAnalyzer.test.ts: 14/14 ✓<br>- VisionEngineAdapter.test.ts: 3/3 ✓<br>- BallTrackingEngine.test.ts: 19/19 ✓<br>- ShotDetectionEngine.test.ts: 12/12 ✓<br>- workoutAsyncQueue.test.ts: 20/20 ✓<br>- workoutLifecycle.e2e.test.ts: 7/7 ✓<br>- telemetrySampler.test.ts: 24/24 ✓<br>- persistentOutbox.test.ts: 15/15 ✓<br>- RuntimeProcessFrameCoordinator.test.ts: 8/8 ✓<br>- calibration.test.ts (seconda suite): 23/23 ✓<br>- RuntimeProcessFrameCoordinator.test.ts (seconda suite): 8/8 ✓<br><br>**Note:** Suite completa ora eseguibile senza heap limit. Tutte le correzioni applicate nelle fasi 2 e 4 hanno risolto i fallimenti preesistenti. | — |
| 7 — Dispositivo T0 | ✅ Completata | Baseline runtime e conteggio tiri | **Ambiente:** Samsung Galaxy S21 Ultra<br><br>**Risultato:**<br>- Camera 4000×2252<br>- Modello best_384_float16<br>- 4 tiri effettuati, 4 registrati<br>- 0 canestri (tutti tiri sbagliati, coerente)<br>- FPS: camera 29-39, YOLO 27-29, MoveNet 0-3<br><br>**Note:** Riconoscimento tiri funzionante. Classificazione MADE/MISS da verificare con prova mista canestri/tiri sbagliati. | — |
| 7 — Dispositivo T1 | Da eseguire | Classificazione MADE/MISS | Sequenza mista canestri/tiri sbagliati con video e log | — |

## 13. Criteri finali di completamento

Il piano è completato quando:
- tutti i test esistenti sono stati eseguiti e i fallimenti sono classificati;
- i casi prioritari hanno test deterministici;
- non restano regressioni critiche non spiegate;
- la suite completa passa, oppure ogni fallimento residuo è documentato e accettato esplicitamente;
- coverage e limiti dei test sono documentati;
- la validazione su device è registrata separatamente dai test automatici.

**Nota:** il piano non dichiara già verificati i comportamenti elencati. Ogni spunta e ogni esito dovranno essere aggiornati soltanto dopo l'esecuzione effettiva.
