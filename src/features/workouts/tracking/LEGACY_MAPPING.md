# Mapping legacy → engine estratti

> Mappa dei confini presenti in `Validation-1.0`. I nomi legacy sono mantenuti per orientare la lettura; l'equivalenza funzionale va dimostrata con test, non dedotta dalla somiglianza dei nomi.

## Componenti correnti

| Componente | Responsabilità corrente | Punto di integrazione |
|---|---|---|
| `useShotTracker` | Hook camera/vision e collegamento ai worker | Callback in `WorkoutSessionScreen` |
| `VisionEngineAdapter` | Cache per canale, timestamp, freshness e versione | Implementa `IVisionEngine` |
| `WorkoutSessionRuntime` | State machine e coordinamento frame | Riceve `IVisionEngine` e `ITrackingEngine` |
| `TrackingEngine` | Coordina tracking e shot detection | `processFrame(..., playerDetection?)` |
| `BallTrackingEngine` | Stato/traiettoria della palla | Usato dal livello tracking |
| `PlayerTrackingEngine` | Stato del giocatore | Aggiornato dal tracking con detection/pose |
| `BallTrajectoryAnalyzer` | Analisi del moto della palla | Integrato nel tracking |
| `ShotDetectionEngine` | Rilevazione e risultato interno del tiro | Invocato da `TrackingEngine` |
| `ShotEventBuilder` | Costruzione dei dati evento del tiro | Usato nel percorso eventi |
| `WorkoutAsyncQueue` | Eventi critici asincroni | Runtime / servizi workout |
| `PersistentOutbox` | Persistenza e recovery eventi | Servizi workout |

## Mapping concettuale

- Filtraggio e predizione della palla: consultare `BallTrackingEngine.ts` e `BallTrackingState.ts`; non presumere che il comportamento legacy sia identico senza confrontare le formule e i test.
- Analisi traiettoria: `BallTrajectoryAnalyzer.ts`.
- Tracking giocatore: `PlayerTrackingEngine.ts`, alimentato dal percorso di tracking e dalla detection ricevuta.
- Shot detection: `ShotDetectionEngine.ts`, chiamato da `TrackingEngine.processFrame()`.
- Coordinamento delle osservazioni: `VisionEngineAdapter.ts` conserva timestamp separati per palla, giocatore, canestro e posa.
- Orchestrazione della sessione: `WorkoutSessionRuntime.ts`.
- Integrazione UI/callback: `WorkoutSessionScreen.tsx`, che contiene ancora codice di coordinamento legacy e runtime.

## Contratti da rispettare

1. `TrackingEngine.processFrame()` accetta `playerDetection` come parametro opzionale; non documentare un bridge `setPlayerFromYolo()` se non esiste nei sorgenti.
2. `ShotDetectionEngine` produce risultati interni MADE/MISS/AIRBALL. Il tipo workout più ampio supporta anche BLOCKED e UNCERTAIN, ma non significa che questo engine li generi.
3. Alcuni callback pubblici normalizzano AIRBALL a MISS per compatibilità del contratto callback. Tenere distinta la classificazione interna dal payload pubblico.
4. Il runtime protegge `processFrame()` da chiamate concorrenti e verifica lo stato della sessione.
5. I timestamp dei worker non sono necessariamente sincronizzati; non fondere osservazioni di canali diversi senza usare i rispettivi timestamp e freshness.

## Verifica di equivalenza

Per ogni estrazione o modifica:
- aggiungere test unitari per il vecchio comportamento significativo;
- confrontare output su sequenze identiche di frame/observation;
- verificare reset, tracking perso, dati stale e ripartenza sessione;
- testare l'evento tiro fino a callback ed enqueue;
- validare su device i comportamenti dipendenti da camera, worklet e SharedValue.

## Riferimenti

- `BallTrackingEngine.ts`
- `BallTrackingState.ts`
- `BallTrajectoryAnalyzer.ts`
- `PlayerTrackingEngine.ts`
- `ShotDetectionEngine.ts`
- `ShotEventBuilder.ts`
- `TrackingEngine.ts`
- `WorkoutSessionRuntime.ts`
