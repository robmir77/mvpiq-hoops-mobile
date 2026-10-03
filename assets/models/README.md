# Modelli AI per MVPiQ Hoops

Questa cartella deve contenere i modelli TFLite per il tracking AI on-device.

## Modelli richiesti

### YOLO Models (Ball/Player/Rim Detection)

| File | Input Size | Precision | Epochs | Expected FPS | Actual FPS | Note |
|------|------------|-----------|--------|--------------|------------|------|
| best_320_float16.tflite | 320x320 | FP16 | 50 | 10-37 | 2-7 | Measured at 640x360 resolution |
| best_384_float16.tflite | 384x384 | FP16 | 100 | 20-21 | 3-6 | Updated to 100 epochs, actual FPS lower due to device bottleneck |
| best_448_float16.tflite | 448x448 | FP16 | 5 | 12-21 | TBD | Early training |
| best_512_float16.tflite | 512x512 | FP16 | 40 | 8-10 | TBD | Balanced performance |
| best_640_float16.tflite | 640x640 | FP16 | 30 | 5-7 | TBD | High resolution |

**YOLO Model Details:**
- **Tipo**: YOLO11n fine-tuned su basketball
- **Input**: [1, 3, N, N] float16 normalizzato [0,1] (dove N = input size)
- **Output**: [1, M, 6] (cx, cy, w, h, confidence, class)
- **Classi**: 0=basketball, 1=hoop, 2=player

### MoveNet Model (Pose Detection)

| File | Input Size | Precision | Note |
|------|------------|-----------|------|
| movenet_lightning_192_int8.tflite | 192x192 | INT8 | Lightning model |

**MoveNet Model Details:**
- **Tipo**: MoveNet Lightning per pose detection
- **Input**: [1, 192, 192, 3] int8 normalizzato [0,255]
- **Output**: [1, 1, 17, 3] (y, x, score) normalizzati [0,1]
- **Keypoints**: 17 keypoints COCO standard

## Come ottenere i modelli

### Opzione A: Modelli pre-addestrati pubblici
1. Scarica YOLO11n da: https://github.com/ultralytics/ultralytics
2. Scarica MoveNet Lightning da: https://tfhub.dev/google/lite-model/movenet/singlepose/lightning/tflite/float16/4
3. Converti in ONNX se necessario

### Opzione B: Fine-tuning su dataset basketball
1. Dataset: https://universe.roboflow.com/search?q=basketball
2. Export YOLO11 → ONNX: `yolo export model=yolo11n.pt format=onnx imgsz=320`
3. Converti MoveNet TFLite → ONNX con `tf2onnx`

### Opzione C: Modelli placeholder per testing
Per testing iniziale senza modelli reali, puoi creare file dummy:
```bash
# Crea file dummy (solo per testing, non funzionerà per detection reale)
echo "placeholder" > ball_detection.onnx
echo "placeholder" > movenet_lightning.onnx
```

## Note importanti
- I modelli devono essere in formato ONNX
- Assicurati che i nomi dei file corrispondano esattamente a quelli richiesti
- I modelli devono essere ottimizzati per mobile (quantizzati se possibile)
- Dimensioni consigliate: < 20MB per modello per performance ottimali
