# Analisi tecnica UI — MVPiQ Hoops Mobile

> Baseline del branch `Validation-1.0`. Il documento è un inventario orientativo: per i dettagli implementativi fanno fede sorgenti, tipi e configurazioni attuali. Le feature presenti in una directory non sono necessariamente tutte abilitate in ogni build.

## 1. Stack verificato

Dal `package.json`:

- React Native `0.86.3`, React `19.2.3`, Expo `^57.0.0`.
- TypeScript `~6.0.3`.
- React Navigation 7 e TanStack React Query 5.
- Vision Camera `5.2.3`, Fast TFLite `^3.0.1`, Vision Camera Resizer `5.0.11`, Vision Camera Worklets e React Native Worklets `0.12.2`.
- Reanimated `4.6.0`, React Native Skia `^2.6.9`, SVG e Gesture Handler.
- Firebase React Native SDK, Supabase, Axios e AsyncStorage.
- Jest 29, jest-expo e React Native Testing Library.

Le versioni sopra sono quelle dichiarate dal manifest del branch; non sostituiscono il lockfile né attestano quali versioni siano installate nell'ambiente di sviluppo.

## 2. Struttura ad alto livello

Il codice applicativo è organizzato sotto `src/`, con feature in `src/features/`, codice condiviso in `src/shared/` e pipeline vision in `src/vision/`. Tra le directory feature presenti nell'albero ci sono auth, CV, goals, journal, messaging, notifications, profile, training, video analysis e workouts. Consultare l'albero del branch per l'inventario completo e aggiornato.

Struttura indicativa della feature workout:

```text
src/features/workouts/
  api/
  components/
  hooks/
  navigation/
  runtime/
  screens/
  services/
  tracking/
  types/
  utils/
  vision/
```

La pipeline vision ha un livello dedicato in `src/vision/`, con adapter, engine, worker, tipi, telemetria e test.

## 3. Architettura UI e dati

Il pattern generale è basato su schermate React Native, hook di feature, moduli API e tipi TypeScript. Le query e mutazioni server-side possono usare TanStack React Query; non assumere che ogni chiamata API sia mediata da React Query senza controllare l'implementazione della singola feature.

I servizi esterni dichiarati nel manifest includono Firebase, Supabase e client HTTP Axios. La fonte autorevole per ogni integrazione è il codice del relativo modulo API/configurazione, non questa panoramica.

## 4. Feature e punti di ingresso

| Area | Punti di ingresso indicativi |
|---|---|
| Workout e tracking | `src/features/workouts/screens/`, `runtime/`, `tracking/`, `services/` |
| Vision on-device | `src/vision/` e `assets/models/` |
| CV sportivo | `src/features/cv/screens/`, `api/`, `types/` |
| API condivisa | `src/shared/api/` |
| Tema e componenti condivisi | `src/shared/` |

Le altre feature devono essere consultate nel proprio codice prima di aggiungere dettagli funzionali a questa analisi.

## 5. Workout e vision

Il percorso workout coinvolge `WorkoutSessionScreen`, `WorkoutSessionRuntime`, `VisionEngineAdapter`, `TrackingEngine` e `ShotDetectionEngine`. I worker YOLO/MoveNet eseguono inferenza/parsing e consegnano osservazioni tramite callback. L'adapter mantiene risultati e timestamp per canale; il runtime coordina i frame quando la sessione è `ACTIVE`.

L'integrazione mantiene ancora logica di coordinamento nella schermata e nel hook `useShotTracker`; non descrivere la migrazione come completamente priva di legacy. La continuità della camera, il throughput, la fluidità dell'overlay e l'affidabilità della registrazione dei tiri devono essere verificati su dispositivo.

## 6. Test

Gli script dichiarati nel `package.json` sono:

```bash
npm test
npm run test:watch
npm run test:coverage
```

Non sono dichiarati script `lint` o `typecheck` nella sezione scripts del manifest attuale. Non inserire percentuali di coverage o risultati CI senza un report verificato.

## 7. Manutenzione del documento

Quando cambia lo stack:
1. confrontare questo testo con `package.json` e il lockfile;
2. verificare percorsi reali nell'albero Git;
3. confermare i nomi e le responsabilità nei sorgenti;
4. distinguere codice presente, codice attivo nel percorso runtime e funzionalità validate;
5. aggiornare i documenti specifici di feature per i dettagli, mantenendo questa pagina come overview.
