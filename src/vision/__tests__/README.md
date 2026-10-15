# Vision Model Tests

Questa directory contiene i test unitari e di integrazione per i modelli AI di rilevamento palla e tiro.

## Struttura dei Test

### 1. `yoloParser.test.ts`
Test unitari per il parser YOLO:
- Rilevamento palla con alta/bassa confidence
- Rilevamento canestro
- Filtraggio rilevamenti multipli
- Gestione casi edge

## Esecuzione dei Test

```bash
# Esegui tutti i test
npm test

# Esegui test in modalità watch
npm run test:watch

# Esegui test con coverage
npm run test:coverage
```

## Troubleshooting

**Test falliscono con errori di dipendenze:**
```bash
npm install --legacy-peer-deps
```

**Test troppo lenti:**
- Riduci il numero di frame nei test di integrazione
- Usa `jest.setTimeout()` per aumentare il timeout
