# Modelli on-device

Questa directory contiene i modelli TensorFlow Lite inclusi nell'app. La selezione runtime è definita da `src/config/appConfig.ts` e dal registry statico `src/vision/yoloModels.ts`.

## Modelli inclusi

| File | Input YOLO | Anchor/output detections |
|---|---:|---:|
| `best_320_float16.tflite` | 320 × 320 | 2.100 |
| `best_384_float16.tflite` | 384 × 384 | 3.024 |
| `best_448_float16.tflite` | 448 × 448 | 4.116 |
| `best_512_float16.tflite` | 512 × 512 | 5.376 |
| `best_640_float16.tflite` | 640 × 640 | 8.400 |
| `movenet_lightning_192_int8.tflite` | 192 × 192 | 17 keypoint |

Il registry dichiara `best_640_float16` come modello YOLO predefinito e `movenet_lightning_192_int8` come modello MoveNet predefinito. La schermata di calibrazione e la sessione possono utilizzare il modello selezionato dall'utente: il valore predefinito non prova quale modello sia stato usato in una specifica sessione.

## Schema YOLO

I modelli YOLO sono registrati con input quadrato RGB e output con 7 canali per anchor:

- 4 coordinate della bounding box;
- 3 score di classe: ball, human/player e rim.

Il numero di anchor associato a ciascuna risoluzione è dichiarato nel registry. `YoloDetector` valida lo schema dell'output prima di interpretarlo. Per dtype, shape e quantizzazione effettivi fare riferimento ai metadati del file e allo script di verifica, non al solo nome del modello.

## Registry e caricamento

Gli asset sono importati staticamente in `src/vision/yoloModels.ts`, perché Metro/Expo non enumera automaticamente i file della directory a runtime.

Dopo aver aggiunto o rimosso un modello:

1. aggiornare gli asset TFLite;
2. rigenerare il registry con:

```bash
node scripts/generate-yolo-models.mjs
```

3. verificare che il modello sia registrato e che il codice di parsing supporti il suo schema;
4. eseguire:

```bash
python scripts/verify_tflite_metadata.py
```

Lo script verifica i metadati dei modelli presenti. Non misura accuratezza, FPS o qualità del tracking.

## MoveNet

Il modello pose incluso è `movenet_lightning_192_int8.tflite`. La configurazione del modello e il numero di keypoint sono dichiarati in `src/vision/yoloModels.ts`; il worker e l'estimatore definiscono il percorso di esecuzione e l'interpretazione dell'output:

- `src/vision/useMoveNetWorker.ts`
- `src/vision/engine/MoveNetPoseEstimator.ts`

## Test

I test del parser e del preprocessing YOLO sono in `src/vision/__tests__/`; i test dell'adapter sono nello stesso percorso.

```bash
npm test -- yoloParser.test.ts
npm test -- yoloPreprocessing.test.ts
npm test -- VisionEngineAdapter.test.ts
```

I test automatici non sostituiscono una verifica su dispositivo con il modello, il delegate e la camera effettivamente utilizzati.
