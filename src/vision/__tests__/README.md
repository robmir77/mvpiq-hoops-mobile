# Test automatici — Vision

Questa cartella contiene i test Jest relativi alla pipeline vision.

## Test presenti

| File | Ambito |
|---|---|
| `VisionEngineAdapter.test.ts` | Cache delle osservazioni e adapter vision |
| `yoloParser.test.ts` | Parsing e validazione dei risultati YOLO |
| `yoloPreprocessing.test.ts` | Preprocessing e trasformazioni dell'input YOLO |

## Esecuzione

Dalla root del progetto:

```bash
npm test -- VisionEngineAdapter.test.ts
npm test -- yoloParser.test.ts
npm test -- yoloPreprocessing.test.ts
npm test
```

Gli script disponibili sono quelli dichiarati nel `package.json`. Verificare l'output Jest e l'exit code per conoscere l'esito effettivo.

## Limiti

I test automatici non dimostrano da soli che il worker riceva frame dalla camera, che l'inferenza nativa venga eseguita correttamente sul dispositivo o che le callback raggiungano runtime e overlay. Questi comportamenti richiedono una verifica end-to-end su device.
