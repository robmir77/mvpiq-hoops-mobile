# Verifica del refactoring — Validation-1.0

## Ambito e metodo

Verifica statica dei sorgenti nel branch `Validation-1.0`. Questa revisione confronta le affermazioni dei documenti con le implementazioni presenti. Non equivale a un test runtime su Android/iOS; gli esiti di test automatizzati non sono dichiarati senza aver eseguito la suite.

## Matrice di verifica

| Area | Evidenza nel codice | Stato documentale corretto |
|---|---|---|
| Runtime | `WorkoutSessionRuntime.ts` definisce state machine, `processFrame()`, guardia di concorrenza e setter engine | Implementato nel codice; comportamento end-to-end da verificare su device |
| Vision interface | `VisionEngine.types.ts` e `VisionEngine.ts` definiscono contratto e orchestrazione | Presenti; i worker continuano a fare inferenza/parsing |
| Adapter | `VisionEngineAdapter.ts` conserva osservazioni, timestamp e versioni | Presente; callback e freschezza vanno verificati a runtime |
| Coordinamento schermata | `WorkoutSessionScreen.tsx` ha coordinatore e flag `useRuntimeProcessingRef` | Presente, ma la schermata mantiene responsabilità legacy |
| runtimeActive | In `useShotTracker.ts` e `useCameraPipeline.ts` è descritto come parametro non usato nel frame processor | Non dichiarare la disattivazione legacy tramite questo flag; Decision 29 è indicata come reverted |
| Player detection | `TrackingEngine.processFrame()` accetta un oggetto `playerDetection` opzionale | Integrazione via parametro presente; qualità delle detection non provata dal solo wiring |
| Shot detection | `ShotDetectionEngine` ha risultati interni MADE/MISS/AIRBALL | Non assumere generazione automatica di BLOCKED/UNCERTAIN |
| Queue | `WorkoutAsyncQueue.enqueueCritical()` e `PersistentOutbox` esistono | Implementazione presente; affidabilità offline va provata con test e run |
| Telemetry sampler | Classe con intervallo default 500 ms, `shouldSample`, reset e setter | Presente; verificare dove viene effettivamente consumata |
| Overlay | Componenti overlay e SharedValue audit esistono | Rendering fluido non verificato staticamente |

## Discrepanze da non reintrodurre

1. Non descrivere Decision 29 come disabilitazione legacy attiva: i sorgenti correnti dicono che `runtimeActive` non è usato dal frame processor.
2. Non dire che tutte le responsabilità sono state estratte da `WorkoutSessionScreen`: la schermata continua a coordinare callback, connessioni e stato.
3. Non presentare le metriche storiche come valori correnti garantiti.
4. Non confondere i tipi applicativi `ShotResult` (MADE/MISS/BLOCKED/AIRBALL/UNCERTAIN) con i risultati effettivamente prodotti da `ShotDetectionEngine`.
5. Non dichiarare test, build o prove su device come passati senza un risultato registrato.

## Verifiche ancora necessarie

- [ ] Eseguire `npm test` e registrare il riepilogo.
- [ ] Avviare sessione su Android e verificare camera, YOLO, MoveNet, adapter, runtime, tracking e overlay.
- [ ] Catturare metriche dopo lo stato `ACTIVE`, soprattutto quando i contatori restano a zero.
- [ ] Testare un tiro riuscito, un errore, un airball, un tiro manuale e la deduplicazione degli eventi.
- [ ] Verificare queue/outbox in offline, riavvio e riconnessione.
- [ ] Confrontare un run con overlay diagnostico acceso/spento.

## Conclusione

I moduli architetturali sono presenti e collegati in codice, ma alcune proprietà decisive — frequenza di aggiornamento, unicità del dispatch, continuità dell'overlay e affidabilità end-to-end — richiedono test dinamici. Questo documento sostituisce le percentuali di completamento non supportate da una verifica riproducibile.
