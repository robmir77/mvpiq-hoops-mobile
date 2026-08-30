# Workout Feature Tests

Questa directory contiene i test unitari e di integrazione per le feature di workout.

## Struttura dei Test

### 1. `workouts.api.test.ts`
Test unitari per le funzioni API di workout:
- **Session Management**: Creazione, recupero, eliminazione, pausa, ripresa, fine sessione
- **Shot Management**: Recupero tiri, aggiunta eventi tiro (automatici e manuali)
- **Calibration**: Salvataggio calibrazione campo (centro canestro, angoli, matrice omografia)
- **AI Tracking Data**: Salvataggio frame data e analisi pose

### 2. `useTrackingEngine.test.ts`
Test unitari per il hook `useTrackingEngine`:
- **Ball Tracking**: Rilevamento palla, filtro Kalman, calcolo velocità
- **Shot Detection**: Rilevamento inizio tiro, rilascio, canestro, mancato
- **Trajectory Analysis**: Costruzione traiettoria, metriche, qualità tiro
- **Hoop Position**: Impostazione posizione canestro da calibrazione/detection
- **Shared Values**: Valori condivisi per overlay Skia

### 3. `useWorkoutSessions.test.ts`
Test unitari per il hook `useWorkoutSessions`:
- **Data Fetching**: Recupero sessioni per utente
- **Caching Behavior**: Configurazione cache React Query
- **Loading States**: Stati di caricamento
- **Data Transformation**: Preservazione struttura dati sessioni
- **Multiple Users**: Gestione dati multi-utente

### 4. `manualShotRegistration.test.ts`
Test unitari per la registrazione manuale dei tiri:
- **Manual MADE Shot**: Registrazione tiri segnati manualmente
- **Manual MISS Shot**: Registrazione tiri mancati manualmente
- **Manual BLOCKED Shot**: Registrazione tiri bloccati
- **Manual AIRBALL Shot**: Registrazione tiri a vuoto
- **Validation**: Validazione campi obbligatori ed enum
- **Tracking Data**: Flag manualEntry e metadati aggiuntivi
- **Error Handling**: Gestione errori API
- **Shot Counter Updates**: Aggiornamento contatori tiri

### 5. `calibration.test.ts`
Test unitari per la logica di calibrazione:
- **Hoop Center Detection**: Rilevamento e salvataggio centro canestro
- **Court Corners Detection**: Rilevamento angoli campo (full/half court)
- **Homography Matrix**: Matrice per trasformazione coordinate
- **Coordinate Transformation**: Trasformazione schermo → coordinate campo
- **Calibration Validation**: Validazione dati calibrazione
- **Camera Mode Calibration**: Calibrazione per diversi modi camera
- **Error Handling**: Gestione errori API
- **Calibration Persistence**: Salvataggio e aggiornamento calibrazione

### 6. `workoutFlow.integration.test.ts`
Test di integrazione per il flusso completo di workout:
- **Complete Workout Session Flow**: Creazione → Calibrazione → Tiri → Fine sessione
- **Session with Only Manual Shots**: Sessione con solo tiri manuali
- **Session Pause and Resume**: Pausa e ripresa sessione
- **Shot Retrieval and Analytics**: Recupero tiri e calcolo statistiche
- **Distinguish Automatic/Manual Shots**: Distinguere tiri automatici da manuali
- **Error Recovery**: Recupero da errori (calibrazione, registrazione tiri)
- **Session State Transitions**: Transizioni ACTIVE → PAUSED → COMPLETED

## Esecuzione dei Test

```bash
# Esegui tutti i test
npm test

# Esegui solo test workout
npm test -- workout

# Esegui test in modalità watch
npm run test:watch

# Esegui test con coverage
npm run test:coverage

# Esegui test specifici
npm test -- workouts.api.test.ts
npm test -- useTrackingEngine.test.ts
npm test -- manualShotRegistration.test.ts
```

## Copertura dei Test

| Componente | Stato | Copertura |
|------------|-------|-----------|
| workouts.api.ts | ✅ Completo | ~90% |
| useTrackingEngine | ✅ Completo | ~85% |
| useWorkoutSessions | ✅ Completo | ~90% |
| Manual Shot Registration | ✅ Completo | ~95% |
| Calibration Logic | ✅ Completo | ~85% |
| Workout Flow Integration | ✅ Completo | ~80% |

## Note Importanti

### Mocking
- Tutti i test usano Jest per mockare le dipendenze esterne
- `apiClient` è mockato per evitare chiamate API reali
- `react-native-reanimated` è mockato per i test dei hook

### Limitazioni
- I test non coprono i componenti UI (Screens)
- I test non coprono la navigazione tra schermate
- I test non coprono l'integrazione con la camera reale
- I test non coprono i WebSocket reali

### Miglioramenti Futuri
- Aggiungere test per i componenti UI (WorkoutSessionScreen, WorkoutSetupScreen, etc.)
- Aggiungere test E2E con Detox o Appium
- Aggiungere test per la navigazione
- Aggiungere test per l'integrazione WebSocket
- Aggiungere test con dati reali di video preregistrati

## Troubleshooting

**Test falliscono con errori di dipendenze:**
```bash
npm install --legacy-peer-deps
```

**Test troppo lenti:**
- Riduci il numero di test case nei test di integrazione
- Usa `jest.setTimeout()` per aumentare il timeout

**Memory leak nei test:**
- Assicurati di chiamare `jest.clearAllMocks()` in beforeEach
- Usa `jest.useFakeTimers()` per test che coinvolgono timeout
