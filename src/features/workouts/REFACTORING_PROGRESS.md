# Stato del refactoring — Workout/Vision

> Stato ricostruito dai sorgenti presenti nel branch `Validation-1.0`. Non usare questa pagina come dichiarazione di benchmark su dispositivo.

## Sintesi

Il repository contiene i principali componenti separati per runtime, vision, tracking e sincronizzazione. L'integrazione è ancora orchestrata in larga parte da `WorkoutSessionScreen.tsx`, e `useShotTracker` resta parte del percorso di inferenza. Quindi il refactoring ha prodotto estrazioni utili, ma non equivale a una rimozione completa del codice legacy.

## Componenti verificati

- `WorkoutSessionRuntime`: state machine, guardia contro chiamate concorrenti a `processFrame()`, dispatch eventi e setter per Vision/Tracking/ShotDetection engine e telemetry sampler.
- `VisionEngineAdapter`: cache per canale con timestamp e versioni, aggiornata dalle callback worker.
- `VisionEngine`: orchestrazione dei risultati parsati, con fallback per output grezzi.
- `TrackingEngine`: riceve `playerDetection` opzionale e invoca `ShotDetectionEngine`.
- `WorkoutAsyncQueue` e `PersistentOutbox`: infrastruttura per eventi critici e persistenza.
- `TelemetrySampler`: campionamento con intervallo predefinito di 500 ms.

## Decisioni che richiedono attenzione

### Percorso runtime e legacy
La schermata contiene `useRuntimeProcessingRef`, coordina chiamate runtime dalle callback e mantiene logica legacy. `runtimeActive` è passato a `useShotTracker`, ma i commenti correnti in `useShotTracker.ts` e `useCameraPipeline.ts` dichiarano che il parametro non viene usato nel frame processor (Decision 29 reverted). Non considerare completata la disattivazione legacy sulla base di questo parametro.

### Shot detection
`ShotDetectionEngine` può restituire MADE, MISS o AIRBALL. Il tipo applicativo `ShotResult` è più ampio (include BLOCKED e UNCERTAIN), ma ciò non prova che il detector automatico generi tutti questi risultati. Alcuni callback pubblici normalizzano AIRBALL a MISS per rispettare un contratto più ristretto; mantenere questa distinzione documentata.

### Freschezza delle osservazioni
`VisionEngineAdapter` usa timestamp separati e soglie diverse per ball, player, rim e pose. Verificare che gli overlay e il tracking non presentino dati vecchi come aggiornamenti correnti.

## Checklist

- [x] Estrarre il contratto vision e il relativo adapter.
- [x] Introdurre `WorkoutSessionRuntime` e la state machine.
- [x] Collegare la player detection al tracking engine tramite parametro.
- [x] Separare queue/outbox e campionatore telemetria in moduli dedicati.
- [ ] Verificare su dispositivo che le callback YOLO/MoveNet alimentino regolarmente il runtime.
- [ ] Diagnosticare i casi in cui camera/model risultano pronti ma FPS/processed restano a zero.
- [ ] Verificare aggiornamenti overlay continui e freshness.
- [ ] Verificare che ogni tiro sia dispatchato una sola volta e persistito.
- [ ] Misurare schedule wait e latenza end-to-end con P50/P95/P99.
- [ ] Ridurre il ruolo della schermata solo dopo aver isolato e testato i confini.
- [ ] Eseguire suite Jest e registrare l'esito effettivo del run.

## Validazione

Gli script disponibili in `package.json`: `npm test`, `npm run test:watch`, `npm run test:coverage`. Il codice del repository è stato ispezionato per aggiornare questo documento; non è stato eseguito un build Android/iOS né un test camera su dispositivo durante questa revisione. Tali verifiche restano aperte.

## Riferimenti

- `src/features/workouts/screens/WorkoutSessionScreen.tsx`
- `src/features/workouts/runtime/WorkoutSessionRuntime.ts`
- `src/vision/VisionEngineAdapter.ts`
- `src/vision/useShotTracker.ts`
- `src/features/workouts/tracking/TrackingEngine.ts`
- `src/features/workouts/tracking/ShotDetectionEngine.ts`
