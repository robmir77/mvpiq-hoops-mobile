# Double-Check Verifica Refactoring - Ottobre 2026

## Tabella di Verifica: REFACTORING_PROGRESS.md → Sorgenti

| Area | Dichiarazione REFACTORING_PROGRESS.md | File | Implementazione | Evidenza | Stato Reale | Problema |
|------|--------------------------------------|------|-----------------|----------|-------------|----------|
| **Runtime** | 60% - connesso a TelemetrySampler e WorkoutQueue, runtime.start() chiamato | WorkoutSessionScreen.tsx:618 | `await runtimeRef.current.start()` | Chiamata effettiva nel useEffect di inizializzazione | ✅ OPERATIVO | Nessuno |
| **Runtime** | Connesso a TelemetrySampler | WorkoutSessionScreen.tsx:607 | `runtimeRef.current.setTelemetrySampler(telemetrySamplerRef.current)` | Chiamata effettiva dopo creazione TelemetrySampler | ✅ OPERATIVO | Nessuno |
| **Runtime** | Connesso a WorkoutQueue | WorkoutSessionScreen.tsx:612 | `runtimeRef.current.setWorkoutQueue(workoutQueueRef.current)` | Chiamata effettiva dopo creazione Queue | ✅ OPERATIVO | **DOPPIO OWNERSHIP** |
| **Runtime** | Gestisce WorkoutQueue | WorkoutSessionScreen.tsx:351,398,681,725 | `workoutQueue.enqueueCritical()` chiamato direttamente dalla Screen | 4 chiamate dirette a workoutQueueRef.current | ❌ NON OPERATIVO | Screen bypassa Runtime per enqueueCritical |
| **Runtime** | Gestisce WorkoutQueue shutdown | WorkoutSessionScreen.tsx:745 | `await workoutQueue.shutdown()` chiamato direttamente dalla Screen | Chiamata diretta a workoutQueueRef.current | ❌ NON OPERATIVO | Screen bypassa Runtime per shutdown |
| **Runtime** | Lifecycle stop() | WorkoutSessionScreen.tsx | Nessuna chiamata a `runtime.stop()` | runtime.stop() non chiamato nella fase di shutdown | ❌ NON OPERATIVO | Runtime.stop() non invocato |
| **TelemetrySampler** | Registrato nel Runtime | WorkoutSessionRuntime.ts:293-295 | `setTelemetrySampler(sampler)` memorizza in `this.telemetrySampler` | Campo privato impostato correttamente | ✅ OPERATIVO | Nessuno |
| **TelemetrySampler** | Usato dal Runtime | WorkoutSessionRuntime.ts:235-238 | `initializeTelemetry()` logga solo se presente | Solo log, nessun uso effettivo | ⚠️ NOMINALE | Runtime non usa realmente TelemetrySampler |
| **WorkoutQueue** | Registrato nel Runtime | WorkoutSessionRuntime.ts:297-299 | `setWorkoutQueue(queue)` memorizza in `this.workoutQueue` | Campo privato impostato correttamente | ✅ OPERATIVO | Nessuno |
| **WorkoutQueue** | Usato dal Runtime | WorkoutSessionRuntime.ts:138-140,160-172 | `workoutQueue.shutdown()` e `workoutQueue.enqueueCritical()` chiamati in stop() e registerManualShot() | Runtime usa Queue per shutdown e manual shots | ✅ OPERATIVO | **DOPPIO OWNERSHIP** - anche Screen usa direttamente |
| **Vision FPS** | MoveNet 3 FPS limit rimosso | useMoveNetWorker.ts:22 | Commento: "Phase 4.4: Removed MOVENET_TARGET_FPS throttling" | Costante rimossa, throttling rimosso da processFrame | ✅ COMPLETATO | Nessuno |
| **Vision FPS** | Adaptive FPS rimosso da useYoloWorker | useYoloWorker.ts:64-65 | Commento: "Phase 4.4: Removed adaptive FPS system" | Variabili adaptiveFpsEnabled, lastSubmitTime, targetFps rimosse | ✅ COMPLETATO | Nessuno |
| **Vision FPS** | Adaptive FPS code rimosso | useYoloWorker.ts:281-286 | Codice adaptiveTargetFps rimosso, solo theoreticalFps calcolato | Logica adaptive rimossa | ✅ COMPLETATO | Nessuno |
| **Vision FPS** | YOLO_TARGET_FPS rimosso | useYoloWorkerAsync.ts:381-384 | Commento: "Phase 4.4: Removed FPS throttling" | minIntervalMs e YOLO_TARGET_FPS rimossi | ✅ COMPLETATO | Nessuno |
| **Shot Detection** | Dual systems intentionally retained | REFACTORING_PROGRESS.md:253-264 | Documentazione dettagliata di ShotDetectionEngine vs ShotDetector | Documentazione accurata | ✅ DOCUMENTATO | Nessuno |
| **Shot Detection** | ShotDetectionEngine authoritative | useTrackingEngine.ts:48-50 | `new ShotDetectionEngine()` istanziato e usato | Engine istanziato nel hook | ✅ OPERATIVO | Nessuno |
| **Shot Detection** | ShotDetector legacy rimosso | useShotTracker.ts | ShotDetector import e chiamate rimosse | ShotDetector non più presente | ✅ RIMOSSO | Fase 5 completata |
| **Shot Detection** | handleShotEvent rimosso | WorkoutSessionScreen.tsx | handleShotEvent callback rimosso | handleShotEvent non più presente | ✅ RIMOSSO | Fase 5 completata |
| **Vision Pipeline** | VisionPipelineAdapter rimosso | WorkoutSessionRuntime.ts | IVisionPipeline e visionPipeline rimossi | Runtime usa solo VisionEngine | ✅ RIMOSSO | Fase 5 completata |
| **Player Detection** | PlayerDetection integrato | useShotTracker.ts, WorkoutSessionScreen.tsx | onPlayerDetection callback aggiunto | Player fluisce nel nuovo percorso Runtime | ✅ COMPLETATO | Fase 4.4 completata |

## Problemi Critici Identificati

### 1. Doppio Ownership WorkoutQueue - CRITICO
**Dichiarazione:** Runtime gestisce WorkoutQueue (60%)
**Realtà:** Screen chiama direttamente `workoutQueue.enqueueCritical()` e `workoutQueue.shutdown()`
**Impatto:** Violazione del pattern coordinatore, Runtime non è single source of truth per la Queue
**Evidenza:**
- Linea 351: `workoutQueue.enqueueTelemetry()` (telemetry)
- Linea 398: `workoutQueue.enqueueCritical()` (shot detected)
- Linea 681: `workoutQueue.enqueueCritical()` (manual shot fallback)
- Linea 725: `workoutQueue.enqueueCritical()` (SESSION_END)
- Linea 745: `workoutQueue.shutdown()` (session end)

### 2. Runtime.stop() Non Chiamato - CRITICO
**Dichiarazione:** Runtime lifecycle operativo
**Realtà:** `runtime.stop()` non viene chiamato da WorkoutSessionScreen
**Impatto:** Runtime non esegue shutdown pulito, state machine non transisce a STOPPING/SYNCING/COMPLETED
**Evidenza:** Nessuna chiamata a `runtimeRef.current.stop()` nel codice

### 3. TelemetrySampler Non Usato dal Runtime - NOMINALE
**Dichiarazione:** TelemetrySampler connesso al Runtime
**Realtà:** Runtime memorizza il riferimento ma non lo usa effettivamente
**Impatto:** Conessione nominale, nessun beneficio operativo
**Evidenza:** `initializeTelemetry()` in WorkoutSessionRuntime.ts:233-239 solo logga, non usa sampler

## Stato Reale Aggiornato

### Runtime: 40% (non 60%)
- ✅ Istanziato e configurato con callbacks
- ✅ setTelemetrySampler() chiamato
- ✅ setWorkoutQueue() chiamato
- ✅ start() chiamato
- ❌ stop() NON chiamato
- ❌ Screen bypassa Runtime per enqueueCritical (4 volte)
- ❌ Screen bypassa Runtime per shutdown
- ⚠️ TelemetrySampler registrato ma non usato dal Runtime

### Vision FPS: 100% (completato)
- ✅ MoveNet 3 FPS limit rimosso
- ✅ Adaptive FPS code rimosso da useYoloWorker
- ✅ YOLO_TARGET_FPS rimosso da useYoloWorkerAsync
- ✅ Nessun throttling temporale residuo

### Shot Detection: Single Source of Truth (RISOLTO)
- ✅ ShotDetectionEngine autorevole per tracking state
- ✅ ShotDetector legacy rimosso (Fase 5)
- ✅ handleShotEvent rimosso (Fase 5)
- ✅ Single source of truth: Runtime → TrackingEngine → ShotDetectionEngine

## Raccomandazioni

### Immediato (Alta Priorità)
1. **Rimuovere doppio ownership WorkoutQueue:**
   - Sostituire chiamate dirette `workoutQueue.enqueueCritical()` con `runtime.registerManualShot()` dove possibile
   - Sostituire `workoutQueue.shutdown()` con `runtime.stop()`
   - Aggiungere metodo `runtime.enqueueTelemetry()` se necessario per telemetry

2. **Chiamare runtime.stop():**
   - Aggiungere `await runtimeRef.current.stop()` in handleEndSession() prima di `workoutQueue.shutdown()`
   - Verificare che Runtime.stop() gestisca correttamente shutdown queue

### Successivo (Media Priorità)
3. **Mettere TelemetrySampler a uso effettivo:**
   - Rimuovere registrazione nominale se non usato
   - Oppure implementare uso reale nel Runtime (es. sampling metrics)

### Futuro (Bassa Priorità)
4. **TrackingEngine adapter:**
   - Analizzare se possibile creare adapter senza violare React Hooks rules
   - Separare motore puro da lifecycle React

5. **Vision extraction:**
   - Estrarre responsabilità da useShotTracker
   - Creare componenti vision puri

## Conclusione

Il refactoring strutturale ha progressi reali (Vision FPS rimosso, Runtime parzialmente connesso), ma ci sono problemi critici di doppio ownership che violano il pattern coordinatore. La documentazione REFACTORING_PROGRESS.md è troppo ottimistica per il Runtime (dichiara 60% quando è effettivamente 40% a causa del doppio ownership).
