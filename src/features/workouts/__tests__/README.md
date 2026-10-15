# Test della feature Workout

Questo README descrive i test presenti in `src/features/workouts/__tests__`. I nomi elencati sono derivati dall'albero del repository; non vengono dichiarate percentuali di coverage né esiti di esecuzione non verificati.

## Test presenti

- `WorkoutSessionRuntime.test.ts`: test unitari del runtime sessione.
- `calibration.test.ts`: logica e dati di calibrazione.
- `homography.test.ts`: trasformazioni tramite omografia.
- `manualShotRegistration.test.ts`: registrazione manuale dei tiri.
- `persistentOutbox.test.ts`: persistenza locale degli eventi critici.
- `telemetrySampler.test.ts`: campionamento telemetria.
- `useTrackingEngine.test.ts`: hook e integrazione del tracking.
- `useWorkoutSessions.test.tsx`: hook delle sessioni workout.
- `workoutAsyncQueue.test.ts`: coda asincrona degli eventi.
- `workoutFlow.integration.test.ts`: flusso di integrazione workout.
- `workoutLifecycle.e2e.test.ts`: test di lifecycle con harness di test.
- `workouts.api.test.ts`: API workout.
- Test di coordinamento in `screens/__tests__/RuntimeProcessFrameCoordinator.test.ts`.
- Test engine specifici in `tracking/__tests__/`.

## Esecuzione

Gli script definiti nel `package.json` alla radice sono:

```bash
npm test
npm run test:watch
npm run test:coverage
```

Per un test mirato:

```bash
npm test -- WorkoutSessionRuntime.test.ts
npm test -- workoutAsyncQueue.test.ts
npm test -- persistentOutbox.test.ts
npm test -- RuntimeProcessFrameCoordinator.test.ts
```

Jest accetta il pattern passato dopo `--`; controllare l'output del comando per confermare quali suite sono state effettivamente selezionate.

## Che cosa non dimostra la suite

- I test Jest non sostituiscono una prova con camera reale e native worklets.
- Un test di integrazione con mock non certifica il comportamento del backend remoto, della rete o del dispositivo.
- Il superamento dei test unitari non prova la continuità dell'overlay o un determinato FPS.
- Le percentuali di coverage devono essere ricavate da un run aggiornato di `npm run test:coverage`, non copiate da report precedenti.

## Checklist dopo modifiche

- [ ] Eseguire la suite mirata e verificare l'exit code.
- [ ] Eseguire `npm test` prima di considerare conclusa una modifica trasversale.
- [ ] Per state machine e coordinamento frame, testare chiamate concorrenti, stati non ACTIVE e callback mancanti.
- [ ] Per shot event, testare idempotenza, enqueue fallito e normalizzazione dei risultati.
- [ ] Per queue/outbox, testare retry, recovery e dati persistiti.
- [ ] Per la pipeline vision, completare una verifica su dispositivo separata dai test Jest.
