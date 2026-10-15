# Test della pipeline Vision

## Test presenti

- `yoloParser.test.ts`: casi di parsing e interpretazione dei risultati YOLO.
- `VisionEngineAdapter.test.ts`: comportamento dell'adapter vision.

Il codice di produzione correlato è in `src/vision/`, in particolare `VisionEngineAdapter.ts`, `engine/YoloDetector.ts`, `engine/VisionEngine.ts`, `useShotTracker.ts` e i worker YOLO/MoveNet.

## Esecuzione

```bash
npm test -- yoloParser.test.ts
npm test -- VisionEngineAdapter.test.ts
npm test
npm run test:coverage
```

Gli script sono quelli definiti nel `package.json` alla radice. Controllare l'output Jest per confermare il numero di test eseguiti e l'esito.

## Limiti

- I test unitari non eseguono necessariamente inferenza nativa sul dispositivo.
- Il parsing corretto non prova che il worker riceva frame o che le callback raggiungano il runtime.
- La freshness dell'osservazione, la fluidità dell'overlay e gli FPS richiedono misure end-to-end.
- Non sono dichiarate percentuali di coverage senza un report generato da un run corrente.

## Dopo modifiche a modelli o worker

- [ ] Verificare input/output shape, dtype e coordinate del modello.
- [ ] Eseguire i test del parser e dell'adapter.
- [ ] Verificare le callback con risultati validi, null e canale non aggiornato.
- [ ] Validare su dispositivo inferenza, timestamp, adapter, runtime e overlay.
