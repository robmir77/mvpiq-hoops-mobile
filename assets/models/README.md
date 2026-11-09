# Modelli AI on-device

Questa directory contiene i modelli TensorFlow Lite usati dal percorso vision mobile. L'inventario sotto riflette i file presenti nel branch `Validation-1.0`; la presenza del file non certifica da sola che il modello venga selezionato dalla configurazione runtime o che produca una specifica accuratezza/FPS.

## File presenti nel repository

| File | Input dichiarato dal nome/configurazione | Formato | Epoche | Risoluzione camera default |
|---|---:|---|---:|---|
| `best_320_float16.tflite` | 320×320 | TFLite | 50 | 640×360 |
| `best_384_float16.tflite` | 384×384 | TFLite | 200 | 1280×720 |
| `best_448_float16.tflite` | 448×448 | TFLite | 20 | 1280×720 |
| `best_512_float16.tflite` | 512×512 | TFLite | 40 | 1280×720 |
| `best_640_float16.tflite` | 640×640 | TFLite | 120 | 1280×720 |
| `movenet_lightning_192_int8.tflite` | 192×192 | TFLite | - | - |

## YOLO

I modelli `best_N_float16.tflite` sono varianti YOLO11n esportate con NMS disattivata (`nms=False`) e quantizzazione FLOAT16. Tutti i modelli seguono lo **stesso schema di esportazione**:

- **Input**: `[1, SIZE, SIZE, 3]` dove SIZE corrisponde al nome del modello (320, 384, 448, 512, 640)
- **Output**: `[1, 7, N]` dove N = numero di anchor per la risoluzione
- **Layout output**: 4 coordinate (xc, yc, w, h) + 3 class scores (ball, human, rim)
- **Dtype**: float32 (nessuna quantizzazione nel tensore di output)

Il numero di anchor N segue la griglia YOLO standard con stride 8, 16, 32:
- 320 → 2100 (40² + 20² + 10²)
- 384 → 3024 (48² + 24² + 12²)
- 448 → 4116 (56² + 28² + 14²)
- 512 → 5376 (64² + 32² + 16²)
- 640 → 8400 (80² + 40² + 20²)

Il parser e la configurazione effettivi vanno verificati in `src/vision/yoloModels.ts` e `src/vision/engine/YoloDetector.ts`. Il codice worker gestisce preprocessamento, esecuzione e parsing.

Il repository include anche `compare_models.py`, `inspect_model.py`, `convert_model.py` e `convert_ballrim_model.py` per attività di analisi/conversione. Prima di cambiare modello, verificare la compatibilità del tensore input/output con il parser corrente.

## MoveNet

Il file `movenet_lightning_192_int8.tflite` è il modello pose presente. Il percorso di esecuzione e la conversione dell'output sono in `src/vision/useMoveNetWorker.ts` e `src/vision/engine/MoveNetPoseEstimator.ts`. Verificare dtype, shape e ordine dei keypoint con il codice prima di sostituirlo.

## Selezione e prestazioni

- La selezione effettiva del modello è gestita dal codice di configurazione e dai worker, non da questo README.
- Il modello YOLO di default è configurato in `src/config/appConfig.ts` (attualmente: `best_384_float16`).
- Non trattare gli FPS storici come prestazioni garantite: dipendono da dispositivo, delegate, risoluzione camera, scheduler, preprocessing e carico UI.
- Per confrontare modelli registrare commit, dispositivo, delegate, risoluzione, warm-up, durata, FPS e percentili di latenza.
- Non sostituire un modello senza verificare che il nome configurato esista e che il parser supporti il suo output.

## Storia del training YOLO

Tutti i modelli derivano da `yolo11n.pt` e sono stati addestrati sul dataset `Basketball.v1i.yolov11` con `data.yaml`. Il modello `best_384_float16` è l'unico addestrato per 200 epoche ed è stato validato sul device come il più affidabile per il riconoscimento dei tiri.

### best_384_float16 (200 epoche) - Baseline funzionante
```bash
yolo detect train model=yolo11n.pt data=data.yaml imgsz=384 epochs=20
yolo detect train model=runs/detect/train-9/weights/last.pt data=data.yaml imgsz=384 epochs=30 resume=True
yolo detect train model=runs/detect/train-9/weights/last.pt data=data.yaml imgsz=384 epochs=50 resume=True
yolo detect train model=runs/detect/train-12/weights/last.pt data=data.yaml imgsz=384 epochs=50 resume=True
yolo detect train model=runs/detect/train-13/weights/last.pt data=data.yaml imgsz=384 epochs=50 resume=True
```
Checkpoint finale: `runs/detect/train-14/weights/best.pt`

### best_320_float16 (50 epoche)
```bash
yolo detect train model=yolo11n.pt data=data.yaml imgsz=320 epochs=20
yolo detect train model=runs/detect/train/weights/last.pt data=data.yaml imgsz=320 epochs=30 resume=True
```

### best_512_float16 (40 epoche)
```bash
yolo detect train model=yolo11n.pt data=data.yaml imgsz=512 epochs=20
yolo detect train model=runs/detect/train-3/weights/last.pt data=data.yaml imgsz=512 epochs=20 resume=True
```

### best_640_float16 (120 epoche)
```bash
yolo detect train model=yolo11n.pt data=data.yaml imgsz=640 epochs=20
yolo detect train model=runs/detect/train-2/weights/last.pt data=data.yaml imgsz=640 epochs=10 resume=True
yolo detect train model=runs/detect/train-2/weights/last.pt data=data.yaml imgsz=640 epochs=90 resume=True
```

### best_448_float16 (20 epoche)
```bash
yolo detect train model=yolo11n.pt data=data.yaml imgsz=448 epochs=20
```

### Nota sulle prestazioni
Il modello 384 con 200 epoche ha dimostrato il miglior riconoscimento dei tiri nei test sul device. Le performance di inferenza YOLO (FPS) sono simili tra tutti i modelli, ma l'overlay soffre di prestazioni inferiori con modelli di input più grandi (512, 640). Il modello 384 offre il miglior bilanciamento tra accuratezza del rilevamento (200 epoche di training) e fluidità dell'overlay. Gli altri modelli, con meno epoche di training (20-50 epoche), mostrano prestazioni inferiori nel rilevamento. Il modello 640 è stato aggiornato a 120 epoche per ridurre false positive. Per migliorare gli altri modelli, eseguire training resume aggiuntivi fino a raggiungere 150-200 epoche totali.

## Verifica schema TFLite

Lo script `scripts/verify_tflite_metadata.py` verifica i metadati di tutti i modelli TFLite per confermare che seguono lo stesso schema di esportazione. Lo script controlla:
- Dimensione e tipo dell'input
- Forma e tipo dell'output
- Quantizzazione
- Numero di tensori di input/output

Eseguire `python scripts/verify_tflite_metadata.py` per verificare la coerenza dei modelli dopo aggiunte o modifiche.

## Test e diagnostica

I test del parser sono in `src/vision/__tests__/yoloParser.test.ts`; i test dell'adapter sono in `src/vision/__tests__/VisionEngineAdapter.test.ts`. Eseguire `npm test -- yoloParser.test.ts` e `npm test -- VisionEngineAdapter.test.ts` dopo modifiche a modello o parsing.

## Nota di manutenzione

Questa directory contiene modelli TFLite, non modelli ONNX. Qualsiasi istruzione di conversione o installazione deve essere aggiornata solo dopo aver verificato la toolchain effettivamente usata dal progetto mobile.
