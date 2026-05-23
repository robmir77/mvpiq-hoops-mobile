# Modelli AI per MVPiQ Hoops

Questa cartella deve contenere i modelli ONNX per il tracking AI on-device.

## Modelli richiesti

### 1. ball_detection.onnx
- **Tipo**: YOLO11n fine-tuned su basketball
- **Input**: [1, 3, 320, 320] float32 normalizzato [0,1]
- **Output**: [1, N, 6] (cx, cy, w, h, confidence, class)
- **Classi**: 0=basketball, 1=hoop, 2=player

### 2. movenet_lightning.onnx
- **Tipo**: MoveNet Lightning per pose detection
- **Input**: [1, 192, 192, 3] float32 normalizzato [0,1]
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
