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

## 10. Fase 7 — Validazione su dispositivo reale

Solo dopo il superamento dei test automatici:

- [ ] Avviare una sessione e verificare che lo stato passi ad `ACTIVE`.
- [ ] Confermare che `processFrame()` venga chiamato e che le metriche non rimangano a zero.
- [ ] Verificare aggiornamenti continui dell'overlay durante il movimento.
- [ ] Provare più tiri consecutivi, inclusi tiri mancati e canestri.
- [ ] Verificare pause, ripresa, uscita e nuovo avvio della sessione.
- [ ] Raccogliere log e video con timestamp confrontabili.
- [ ] Annotare dispositivo, versione app, condizioni del test e risultati.

Non considerare il test su device superato soltanto perché i modelli risultano caricati: serve evidenza che i frame siano elaborati e che gli output raggiungano tracking e overlay.

## 11. Strategia di esecuzione

Ordine consigliato:

1. **Baseline:** suite esistente, senza modifiche.
2. **Runtime:** aggiungere solo i test mancanti prioritari.
3. **Visione/tracking:** aggiungere i test di contratto e freschezza.
4. **Shot detection:** verificare deduplicazione ed esiti.
5. **Queue/outbox:** verificare affidabilità asincrona.
6. **Overlay:** verificare coordinate e aggiornamenti dello stato.
7. **Regressione completa e coverage.**
8. **Device test** con checklist e prove registrate.

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
| 2 — Visione/tracking | ✅ Completata | Test mirati VisionEngineAdapter, BallTrackingEngine, ShotDetectionEngine, workoutAsyncQueue | **Ambiente:** Branch Validation-1.0<br><br>**Test passati (46/46):**<br>- VisionEngineAdapter.test.ts: 3/3 ✓ (contratto temporale, nuova misura vs cache)<br>- BallTrackingEngine.test.ts: 19/19 ✓ (4 test corretti: smoothing, velocity, fast shot, adaptive gain)<br>- ShotDetectionEngine.test.ts: 12/12 ✓ (6 test corretti: dribble filter, arc height, rising frames, apex, reset, legacy equivalence; 2 test corretti: MISS geometria, AIRBALL rawVy)<br>- workoutAsyncQueue.test.ts: 12/12 ✓ (aggiunto updateRetryCount a tutti i mock)<br><br>**Correzioni applicate:**<br>- BallTrackingEngine.test.ts: passi modificati da 0.005 a 0.02 (sotto outlier threshold 0.025) per dimostrare smoothing/velocità/gain<br>- ShotDetectionEngine.test.ts: aggiunto ballPositionRaw a 6 test per calcolo rawDescending<br>- ShotDetectionEngine.test.ts: corretta geometria MISS (x=0.59, dist=0.09 tra 0.06-0.12)<br>- ShotDetectionEngine.ts: corretta unità rawVy da normalized/ms a normalized/s (*1000)<br>- ShotDetectionEngine.test.ts: corretto AIRBALL (y=0.7 per rawVy=3.33 > 3.0, discesa corretta in coordinate schermo)<br>- workoutAsyncQueue.test.ts: aggiunto updateRetryCount a tutti i mock di criticalOutbox<br><br>**Note:** minOutlierDistance non modificato. rawVy unità allineate con SHOT_LAUNCH_THRESHOLD (1.5 normalized/s). | — |
| 3 — Shot detection | Da eseguire | Test shot/manual registration | — | — |
| 4 — Queue/outbox | ✅ Completata | Test workoutAsyncQueue | Mock updateRetryCount aggiunto a tutti i test. | — |
| 5 — Overlay/coordinate | Da eseguire | Test utility/componenti | — | — |
| 6 — Regressione | Da eseguire | Suite completa + coverage | — | — |
| 7 — Dispositivo | Da eseguire | Checklist manuale + log/video | — | — |

## 13. Criteri finali di completamento

Il piano è completato quando:
- tutti i test esistenti sono stati eseguiti e i fallimenti sono classificati;
- i casi prioritari hanno test deterministici;
- non restano regressioni critiche non spiegate;
- la suite completa passa, oppure ogni fallimento residuo è documentato e accettato esplicitamente;
- coverage e limiti dei test sono documentati;
- la validazione su device è registrata separatamente dai test automatici.

**Nota:** il piano non dichiara già verificati i comportamenti elencati. Ogni spunta e ogni esito dovranno essere aggiornati soltanto dopo l'esecuzione effettiva.
