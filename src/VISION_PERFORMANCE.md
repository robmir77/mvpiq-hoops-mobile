# MVPiQ Hoops — Misurazione delle prestazioni vision

Questa pagina definisce come misurare il percorso vision presente nel codice. Non contiene benchmark storici né valori FPS considerati garantiti.

## Livelli da misurare

| Livello | Dati da raccogliere | Che cosa verifica |
|---|---|---|
| Camera | FPS effettivi, timestamp, intervallo fra frame | Continuità dell'acquisizione |
| YOLO | frame inviati, inferenze completate, attesa scheduler, preprocessing, inferenza, parsing | Frequenza e costo del rilevatore |
| MoveNet | frame inviati, inferenze completate, attesa scheduler, preparazione input, inferenza | Frequenza e costo della stima pose |
| Adapter | aggiornamenti per canale, timestamp, età dell'osservazione | Arrivo e freschezza dei risultati |
| Runtime | chiamate pianificate, avviate, saltate per stato/guardia, errori e durata | Continuità del coordinamento |
| Tracking | frame processati, aggiornamenti palla/giocatore, stato traiettoria | Propagazione delle osservazioni |
| Overlay | aggiornamenti delle SharedValue e rendering visibile | Presentazione dei risultati |
| Eventi | shot rilevati, callback, enqueue, persistenza e acknowledgement | Percorso dal detector alla sincronizzazione |

Un modello caricato, un FPS camera elevato o un'inferenza completata non dimostrano che i risultati arrivino fino all'overlay o alla registrazione del tiro.

## Procedura di misura

Per ogni prova registrare:

- commit SHA e versione/build dell'app;
- dispositivo e versione Android;
- modello YOLO e MoveNet selezionati;
- delegate utilizzato da ciascun modello;
- risoluzione camera e frequenza richiesta;
- durata della sessione e periodo di warm-up;
- condizioni della scena e condizioni termiche rilevanti.

Eseguire il warm-up prima della finestra misurata. Durante la prova raccogliere timestamp monotoni e calcolare almeno mediana, P95 e P99 per attese e latenze. Ripetere le prove con la stessa configurazione prima di confrontare due risultati.

Modificare una sola variabile per volta: modello, risoluzione, delegate, frequenza di scheduling o carico dell'overlay. Non attribuire a una singola modifica un miglioramento osservato mentre cambiano più parametri.

## Localizzazione dei colli di bottiglia

- **Camera senza frame regolari:** verificare configurazione camera, lifecycle e timestamp prima di analizzare il modello.
- **Frame acquisiti ma poche inferenze:** verificare scheduler, throttling, gate e frequenza di invio ai worker.
- **Inferenze completate ma adapter fermo:** verificare parsing, callback e aggiornamento del canale.
- **Adapter aggiornato ma runtime fermo:** verificare stato `ACTIVE`, coordinatore della schermata e guardie di concorrenza.
- **Runtime e tracking aggiornati ma overlay fermo:** verificare scrittura e lettura delle SharedValue e rendering del componente.
- **Tiro rilevato ma non registrato:** verificare deduplicazione, callback, enqueue, outbox e risposta del backend.

Non dedurre la causa da un singolo valore FPS o da un singolo contatore.

## Interpretazione delle metriche

- Separare tempo di attesa scheduler, preprocessing, inferenza e parsing: non sommare misure che includono già le stesse fasi.
- Non confrontare medie ottenute da sessioni con dispositivi, modelli, delegate o risoluzioni differenti.
- Distinguere eventi accodati, persistiti localmente, inviati e confermati dal backend.
- Una detection stale non equivale a una detection appena aggiornata.
- La frequenza di inferenza non coincide necessariamente con la frequenza camera o con quella di aggiornamento dell'overlay.

## Componenti coinvolti

- `src/vision/useShotTracker.ts`
- `src/vision/useYoloWorker.ts`
- `src/vision/useYoloWorkerAsync.ts`
- `src/vision/useMoveNetWorker.ts`
- `src/vision/VisionEngineAdapter.ts`
- `src/features/workouts/screens/WorkoutSessionScreen.tsx`
- `src/features/workouts/runtime/WorkoutSessionRuntime.ts`
- `src/features/workouts/services/telemetrySampler.ts`

Le metriche devono essere lette insieme al codice corrente: la presenza di un contatore o di `TelemetrySampler` non dimostra che ogni valore venga raccolto o inviato al backend.
