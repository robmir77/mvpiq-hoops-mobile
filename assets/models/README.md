# Modelli AI on-device

Questa directory contiene i modelli TensorFlow Lite usati dal percorso vision mobile. L'inventario sotto riflette i file presenti nel branch `Validation-1.0`; la presenza del file non certifica da sola che il modello venga selezionato dalla configurazione runtime o che produca una specifica accuratezza/FPS.

## File presenti nel repository

| File | Input dichiarato dal nome/configurazione | Formato | Epoche | Risoluzione camera default |
|---|---:|---|---:|---|
| `best_320_float16.tflite` | 320×320 | TFLite | 50 | 640×360 |
| `best_384_float16.tflite` | 384×384 | TFLite | 200 | 1280×720 |
| `best_448_float16.tflite` | 448×448 | TFLite | 20 | 1280×720 |
| `best_512_float16.tflite` | 512×512 | TFLite | 40 | 1280×720 |
| `best_640_float16.tflite` | 640×640 | TFLite | 30 | 1280×720 |
| `movenet_lightning_192_int8.tflite` | 192×192 | TFLite | - | - |

## YOLO

I modelli `best_N_float16.tflite` sono varianti YOLO esportate per input quadrato di dimensione N. Il parser e la configurazione effettivi vanno verificati in `src/vision/yoloModels.ts` e `src/vision/engine/YoloDetector.ts`; non assumere shape, ordine dei campi, classi o normalizzazione soltanto dal nome del file. Il codice worker gestisce preprocessamento, esecuzione e parsing.

Il repository include anche `compare_models.py`, `inspect_model.py`, `convert_model.py` e `convert_ballrim_model.py` per attività di analisi/conversione. Prima di cambiare modello, verificare la compatibilità del tensore input/output con il parser corrente.

## MoveNet

Il file `movenet_lightning_192_int8.tflite` è il modello pose presente. Il percorso di esecuzione e la conversione dell'output sono in `src/vision/useMoveNetWorker.ts` e `src/vision/engine/MoveNetPoseEstimator.ts`. Verificare dtype, shape e ordine dei keypoint con il codice prima di sostituirlo.

## Selezione e prestazioni

- La selezione effettiva del modello è gestita dal codice di configurazione e dai worker, non da questo README.
- Il modello YOLO di default è configurato in `src/config/appConfig.ts` (attualmente: `best_448_float16`).
- Non trattare gli FPS storici come prestazioni garantite: dipendono da dispositivo, delegate, risoluzione camera, scheduler, preprocessing e carico UI.
- Per confrontare modelli registrare commit, dispositivo, delegate, risoluzione, warm-up, durata, FPS e percentili di latenza.
- Non sostituire un modello senza verificare che il nome configurato esista e che il parser supporti il suo output.

## Test e diagnostica

I test del parser sono in `src/vision/__tests__/yoloParser.test.ts`; i test dell'adapter sono in `src/vision/__tests__/VisionEngineAdapter.test.ts`. Eseguire `npm test -- yoloParser.test.ts` e `npm test -- VisionEngineAdapter.test.ts` dopo modifiche a modello o parsing.

## Nota di manutenzione

Questa directory contiene modelli TFLite, non modelli ONNX. Qualsiasi istruzione di conversione o installazione deve essere aggiornata solo dopo aver verificato la toolchain effettivamente usata dal progetto mobile.
