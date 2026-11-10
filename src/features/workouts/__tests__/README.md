# Test automatici — Workout

Questa cartella contiene esclusivamente test Jest unitari della feature workout.

## Test presenti

| File | Ambito |
|---|---|
| `WorkoutSessionRuntime.test.ts` | State machine, coordinamento frame ed eventi runtime |
| `calibration.test.ts` | Calibrazione |
| `homography.test.ts` | Trasformazioni omografiche |
| `manualShotRegistration.test.ts` | Registrazione manuale dei tiri |
| `persistentOutbox.test.ts` | Persistenza locale degli eventi |
| `telemetrySampler.test.ts` | Campionamento telemetria |
| `useTrackingEngine.test.ts` | Hook di tracking |
| `useWorkoutSessions.test.tsx` | Hook delle sessioni workout |
| `workoutAsyncQueue.test.ts` | Coda asincrona |
| `workouts.api.test.ts` | API workout |
| `screens/__tests__/RuntimeProcessFrameCoordinator.test.ts` | Coordinamento delle chiamate runtime |
| `tracking/__tests__/BallTrackingEngine.test.ts` | Tracking della palla |
| `tracking/__tests__/BallTrajectoryAnalyzer.test.ts` | Analisi della traiettoria |
| `tracking/__tests__/PlayerTrackingEngine.test.ts` | Tracking del giocatore |
| `tracking/__tests__/ShotDetectionEngine.test.ts` | Rilevamento e classificazione del tiro |
| `tracking/__tests__/TrackingEngine.test.ts` | Orchestrazione tracking |

## Esecuzione

Dalla root del progetto:

```bash
npm test
npm run test:watch
npm run test:coverage
```

Per eseguire una suite mirata:

```bash
npm test -- WorkoutSessionRuntime.test.ts
npm test -- workoutAsyncQueue.test.ts
npm test -- ShotDetectionEngine.test.ts
```

Verificare sempre l'output e l'exit code del comando: questo README descrive i test presenti, non dichiara che siano tutti superati.

## Limiti

I test Jest non certificano il comportamento della camera reale, dei worklet nativi, dei delegate TFLite, della fluidità dell'overlay o della sincronizzazione con un backend remoto. Questi aspetti richiedono verifiche separate nell'ambiente corrispondente.
