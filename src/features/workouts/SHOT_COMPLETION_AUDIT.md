# Audit gestione eventi di tiro — Validation-1.0

## Scopo e perimetro

Questo documento riassume i contratti e il percorso degli eventi di tiro presenti nel branch. È un audit statico dei sorgenti, non una certificazione del comportamento sul dispositivo o del backend remoto.

## Tipi e dati

Il file `src/features/workouts/types/workouts.types.ts` definisce `ShotResult` come `MADE | MISS | BLOCKED | AIRBALL | UNCERTAIN`. `ShotEvent` e `AddShotEventPayload` contengono dati del tiro, mentre `TrackingState` include stato di tracking, traiettoria e campi relativi al rilascio/qualità. Verificare il tipo completo nel sorgente prima di modificare i payload: non tutte le proprietà opzionali del tipo sono necessariamente popolate da ogni percorso.

## Motore di rilevamento

`src/features/workouts/tracking/ShotDetectionEngine.ts` mantiene stato interno per traiettoria, rilascio, volo e risultato. Il risultato automatico del motore è tipizzato come `MADE | MISS | AIRBALL | null`; il fatto che `ShotResult` applicativo includa BLOCKED e UNCERTAIN non significa che questo motore li produca automaticamente.

`TrackingEngine.ts` invoca il motore e propaga lo stato risultante. L'identità del tiro, la costruzione del payload e la normalizzazione vanno verificate nei rispettivi punti di integrazione prima di assumere che siano identiche per registrazione automatica e manuale.

## Percorso runtime

1. Le osservazioni vision vengono conservate dall'adapter e passate al runtime.
2. `WorkoutSessionRuntime.processFrame()` processa i frame soltanto nello stato `ACTIVE` e ha una guardia contro elaborazioni concorrenti.
3. Il runtime legge il risultato di tracking e, quando rileva un nuovo tiro, costruisce/invia un evento attraverso il percorso di queue critica.
4. Il callback pubblico e il conteggio metriche dipendono dall'esito del dispatch/enqueue nel ramo applicabile.
5. La registrazione manuale ha un proprio percorso nella schermata/API e va testata separatamente.

Per il comportamento esatto di idempotenza, buffer di posa, normalizzazione e gestione enqueue fallito, consultare il codice corrente di `WorkoutSessionRuntime.ts`, `ShotEventBuilder.ts`, `workoutAsyncQueue.ts` e `persistentOutbox.ts`.

## Persistenza e sincronizzazione

`WorkoutAsyncQueue` espone `enqueueCritical()`; `PersistentOutbox` fornisce il livello di persistenza per il recupero degli eventi. La presenza di questi moduli non dimostra che ogni evento sia stato sincronizzato con successo: distinguere enqueue, persistenza locale, tentativi di rete, acknowledgement e recupero dopo riavvio.

## Overlay e traiettoria

`RealtimeBallOverlay.tsx` e le SharedValue collegate gestiscono la visualizzazione real-time e della traiettoria. Per un problema di scia o aggiornamento overlay, verificare separatamente: scrittura SharedValue, timestamp della detection, stato in volo, lettura nel componente e rendering. Non dedurre la continuità visiva soltanto dal numero di inferenze.

## Matrice di test raccomandata

| Scenario | Verifica |
|---|---|
| MADE / MISS | Risultato interno, callback, enqueue e contatori coerenti |
| AIRBALL | Normalizzazione corretta fra risultato interno e contratto pubblico |
| Risultato nullo/stale | Nessun tiro spurio da osservazioni non aggiornate |
| Duplicato | Un solo dispatch per identità tiro |
| Enqueue fallito | Evento non conteggiato come completato senza evidenza |
| Tiro manuale | Payload e contatori coerenti con il percorso manuale |
| Reset/sessione nuova | Buffer e identità del tiro non contaminano la sessione successiva |
| Offline/restart | Evento recuperabile dalla persistenza locale |
| Overlay | Scia aggiornata, coordinate corrette e chiusura dopo completamento |

## Stato dell'audit

- Contratti e moduli individuati staticamente: verificati nei sorgenti.
- Test automatizzati: da eseguire e registrare nel run corrente.
- Camera, overlay e rilevamento su device: da validare dinamicamente.
- Sincronizzazione reale backend e recovery dopo riavvio: da provare in ambiente integrato.

## Riferimenti

- `src/features/workouts/types/workouts.types.ts`
- `src/features/workouts/tracking/ShotDetectionEngine.ts`
- `src/features/workouts/tracking/TrackingEngine.ts`
- `src/features/workouts/tracking/ShotEventBuilder.ts`
- `src/features/workouts/runtime/WorkoutSessionRuntime.ts`
- `src/features/workouts/services/workoutAsyncQueue.ts`
- `src/features/workouts/services/persistentOutbox.ts`
- `src/features/workouts/components/RealtimeBallOverlay.tsx`
