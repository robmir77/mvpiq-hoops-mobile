# Vision Model Tests

Questa directory contiene i test unitari e di integrazione per i modelli AI di rilevamento palla e tiro.

## Struttura dei Test

### 1. `shotDetector.test.ts`
Test unitari per la classe `ShotDetector`:
- Rilevamento inizio tiro
- Rilevamento rilascio tiro
- Rilevamento canestro
- Rilevamento tiro mancato (timeout)
- Reset dello stato

### 2. `yoloParser.test.ts`
Test unitari per il parser YOLO:
- Rilevamento palla con alta/bassa confidence
- Rilevamento canestro
- Filtraggio rilevamenti multipli
- Gestione casi edge

### 3. `modelIntegration.test.ts`
Test di integrazione con simulazione video:
- Tracking traiettoria palla da frame simulati
- Scenario tiro mancato
- Integrazione con dati di calibrazione
- Metriche performance modello

## Esecuzione dei Test

```bash
# Esegui tutti i test
npm test

# Esegui test in modalità watch
npm run test:watch

# Esegui test con coverage
npm run test:coverage

# Esegui solo test specifici
npm test -- shotDetector.test.ts
```

## Aggiungere Test con Video Preregistrati

Per aggiungere test con video preregistrati:

1. **Prepara i dati di test:**
   - Registra video di tiri reali
   - Estrai i frame chiave (inizio, rilascio, canestro/mancato)
   - Salva le posizioni della palla in formato JSON

2. **Crea file dati di test:**
   ```json
   // test-data/shot_001.json
   {
     "calibration": {
       "hoopCenter": { "x": 0.4, "y": 0.3 },
       "homographyMatrix": [...]
     },
     "frames": [
       { "timestamp": 0, "ball": { "x": 100, "y": 400, "width": 25, "height": 25, "confidence": 0.85 } },
       { "timestamp": 33, "ball": { "x": 105, "y": 380, "width": 24, "height": 24, "confidence": 0.87 } },
       ...
     ],
     "expectedResult": "MADE"
   }
   ```

3. **Crea test che usa i dati:**
   ```typescript
   describe('Real Video Tests', () => {
     it('should detect shot from recorded video data', async () => {
       const testData = require('../test-data/shot_001.json')
       const detector = new ShotDetector()
       
       for (const frame of testData.frames) {
         detector.updateTrajectory(frame.ball)
         detector.detectShotStart(frame.ball)
         detector.detectShotRelease()
       }
       
       const event = detector.getShotEvent()
       expect(event?.shotReleased).toBe(true)
     })
   })
   ```

## Metriche di Performance

I test di integrazione misurano:
- **Accuracy:** Percentuale di rilevamenti corretti
- **Processing Time:** Tempo di elaborazione per frame
- **Detection Rate:** Frequenza di rilevamento palla
- **False Positives:** Rilevamenti errati

## Calibrazione nei Test

I test possono usare dati di calibrazione reali:
- Posizione canestro calibrata
- Matrice omografia
- Angoli campo

Questo permette di testare il sistema in condizioni realistiche.

## Troubleshooting

**Test falliscono con errori di dipendenze:**
```bash
npm install --legacy-peer-deps
```

**Test troppo lenti:**
- Riduci il numero di frame nei test di integrazione
- Usa `jest.setTimeout()` per aumentare il timeout

**Memory leak nei test:**
- Assicurati di chiamare `detector.reset()` dopo ogni test
- Usa `jest.useFakeTimers()` per test che coinvolgono timeout
