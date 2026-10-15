# Piano di refactoring — Workout e Vision

> Baseline: sorgenti del branch `Validation-1.0`. Le percentuali storiche non vengono mantenute come stato corrente senza una verifica ripetibile.

## Obiettivo

Ridurre l'accoppiamento della schermata workout, rendere espliciti i contratti fra inferenza, adapter vision, runtime, tracking e sincronizzazione, e mantenere una sola fonte di verità per ogni evento di tiro.

## Architettura presente

- `WorkoutSessionScreen.tsx` resta il compositore che collega camera, callback dei worker, adapter, engine e runtime.
- `useShotTracker` e i worker eseguono ancora inferenza e parsing.
- `VisionEngineAdapter` implementa il contratto vision e conserva le osservazioni correnti con timestamp/versioni.
- `WorkoutSessionRuntime` gestisce la state machine e il coordinamento di `processFrame()`.
- `TrackingEngine` integra player detection e `ShotDetectionEngine`.
- `WorkoutAsyncQueue` e `PersistentOutbox` gestiscono gli eventi critici e il recupero.

Questa è un'architettura di migrazione: non dichiarare che tutti i hook legacy siano stati rimossi. Il parametro `runtimeActive` esiste ma è attualmente documentato come non usato nel frame processor (Decision 29 reverted).

## Fasi e stato verificabile

### A. Contratti e audit
- [x] `IVisionEngine`, tipi vision e adapter presenti.
- [x] `WorkoutSessionRuntime` e tipi runtime presenti.
- [x] `TrackingEngine.processFrame()` accetta `playerDetection`.
- [ ] Verificare che i contratti descritti corrispondano alle implementazioni e ai test aggiornati.

### B. Integrazione vision → runtime
- [x] La schermata crea/collega `VisionEngineAdapter`.
- [x] Il codice contiene un coordinatore che pianifica `Runtime.processFrame()` da callback vision.
- [ ] Validare su dispositivo che i callback arrivino dopo `ACTIVE` e che i contatori runtime aumentino.
- [ ] Verificare la politica di freschezza e la gestione delle osservazioni stale per ogni canale.

### C. Tracking e tiro
- [x] `TrackingEngine` invoca `ShotDetectionEngine`.
- [x] `AIRBALL` è un risultato interno supportato; alcuni callback pubblici lo normalizzano a `MISS` dove il contratto ammette soltanto MADE/MISS.
- [ ] Verificare che un singolo tiro non venga dispatchato da due percorsi.
- [ ] Verificare MADE/MISS, rimbalzo, airball, reset e registrazione manuale su device.

### D. Persistenza e sincronizzazione
- [x] Esistono `WorkoutAsyncQueue` e `PersistentOutbox`.
- [x] Esiste un `TelemetrySampler` configurabile.
- [ ] Confermare i punti reali di enqueue, retry, ack, exhaustion e recovery nei test e nei log.
- [ ] Verificare offline, riavvio app e ripristino sessione.

### E. Performance e overlay
- [x] Esistono contatori e strumenti diagnostici vision.
- [ ] Separare attesa di scheduling, costo inferenza, callback, runtime, tracking e overlay.
- [ ] Misurare P50/P95/P99 su device, senza usare numeri storici come benchmark attuale.
- [ ] Controllare aggiornamenti SharedValue e fluidità overlay con scena reale.

## Criteri di completamento

Una fase è completata soltanto quando:
1. i sorgenti sono coerenti con il contratto documentato;
2. i test pertinenti passano;
3. il percorso runtime è verificato su dispositivo quando dipende da camera/worklet/native runtime;
4. i log distinguono errori, salti intenzionali e mancanza di input;
5. i documenti collegati sono aggiornati nello stesso cambiamento.

## Comandi disponibili

Gli script definiti in `package.json` sono `npm test`, `npm run test:watch` e `npm run test:coverage`. Non esistono script `lint` o `typecheck` dichiarati nel blocco `scripts` del package manifest corrente.

## Ordine consigliato

1. Stabilire un benchmark riproducibile dei contatori zero.
2. Validare callback worker → adapter → coordinator → runtime.
3. Validare il percorso unico di tracking e dispatch del tiro.
4. Verificare overlay/SharedValue.
5. Testare queue/outbox offline.
6. Solo dopo, rimuovere o semplificare codice legacy con una modifica isolata e testata.
