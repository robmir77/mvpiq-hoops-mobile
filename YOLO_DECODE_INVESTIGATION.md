# Investigazione Differenze YOLO Android vs Python

## Obiettivo
Identificare la causa delle differenze nelle rilevazioni YOLO tra Android e Python, in particolare i falsi positivi sugli alberi nel benchmark "Tiro a centrocampo".

## Problema Iniziale
- Android rileva falsi positivi (alberi) che Python non rileva
- Modello: `best_640_float16.tflite` (MD5: d520b2ae9a303d6ee4dcea087cf20809)
- Frame di test: `frame_000085.jpg` (1024x576, Tiro a centrocampo)

## Strategia di Investigazione
Isolare ogni componente della pipeline YOLO:
1. JPEG decoding
2. Letterbox/resize preprocessing
3. TFLite inference
4. YOLO post-processing (thresholds, filtri)

## Passaggi Eseguiti

### 1. JPEG Decoding
**Problema sospettato:** `jpeg-js` (JavaScript) vs OpenCV (Python) producono RGB diversi.

**Soluzione implementata:**
- Sostituito `jpeg-js` con decoder nativo Android Bitmap usando `react-native-nitro-image`
- File modificato: `src/vision/useImageBenchmark.ts`
- Metodo: `loadImage()` → `toRawPixelData()` → conversione BGRA/RGBA → RGB

**Risultato:**
- Decoder nativo Bitmap produce pixel identici a OpenCV
- Confermato da `reproduce_letterbox_ts.py`: differenza RGB = 0.0

### 2. Letterbox/Resize Preprocessing
**Problema sospettato:** Interpolazione bilineare TypeScript vs OpenCV produce tensori diversi.

**Test eseguito:**
- Script: `reproduce_letterbox_ts.py`
- Riproduce fedelmente `letterboxRgbToYoloInput()` in Python
- Confronta tensore Python con tensore Android

**Risultato:**
- Differenza media: 0.0000000000
- Differenza massima: 0.0000000000
- Valori identici: True (100%)
- Letterbox TypeScript = OpenCV

### 3. TFLite Inference
**Problema sospettato:** Runtime TFLite Android (GPU) vs Python (CPU) produce output diverso.

**Test eseguito:**
- Script: `compare_tflite_outputs.py`
- Usa lo stesso tensore input Android (verificato identico)
- Esegue inferenza Python con input identico
- Confronta output grezzo TFLite (1, 7, 8400) tra Python e Android

**Risultato:**
- Input: (1, 640, 640, 3), float32, range 0-255
- Output: (1, 7, 8400), float32, range 0-1
- Differenza media: 0.0000001099
- Differenza massima: 0.0000456572
- Percentuale identici: 28.87%
- Output praticamente identico (differenza dovuta a precisione floating point GPU vs CPU)

### 4. YOLO Post-Processing
**Problema sospettato:** Logica di parsing YOLO (thresholds, filtri) diversa tra Android e Python.

**Test eseguito:**
- Script: `compare_detections.py`
- Implementa `AppCompatibleDecoder` (port di `YoloDetector.ts`)
- Confronta rilevazioni finali

**Risultato Python:**
- BALL: x=0.0260, y=0.3317, width=0.0589, height=0.1815, confidence=1.0000
- PLAYER: x=0.0245, y=0.0667, width=0.0771, height=0.1446, confidence=1.0000
- RIM: Nessuna rilevazione

## Conclusioni Attuali

### Componenti Verificati ✅
1. **JPEG decoding:** Decoder nativo Bitmap = OpenCV
2. **Letterbox preprocessing:** TypeScript = OpenCV
3. **TFLite inference:** Output grezzo praticamente identico
4. **YOLO post-processing:** Logica identica tra TypeScript e Python (`AppCompatibleDecoder`)

### Pipeline Verificata
- Input: JPEG identico
- RGB: Identico
- Tensore input: Identico
- Output TFLite: Praticamente identico
- Logica parsing: Identica

### Stato Attuale
La pipeline di preprocessing e inference è verificata come identica tra Android e Python:
- **JPEG decoding:** 100% identico (decoder nativo Bitmap = OpenCV)
- **Letterbox preprocessing:** 100% identico (TypeScript = OpenCV)
- **TFLite inference:** Praticamente identico (differenza floating point GPU vs CPU)
- **YOLO post-processing:** Logica identica tra TypeScript e Python (`AppCompatibleDecoder`)

### Ipotesi Errata ❌
**Ipotesi:** I confidence scores Android sono tutti approssimati a 1.0, rendendo impossibile distinguere i candidati.

**Risultato test `compare_raw_scores.py`:**
- Differenza media raw scores: 0.0000001099
- Differenza massima: 0.0000456572
- BALL score=1.0: Python 9/8400, Android 12/8400
- PLAYER score=1.0: Python 244/8400, Android 260/8400
- I raw scores sono praticamente identici, NON approssimati a 1.0

### Nuova Ipotesi: Precisione SharedValue Reanimated
I raw scores TFLite sono identici tra Python e Android, quindi il problema deve essere nel passaggio dati dopo il parsing.

**Sospetto:** I SharedValue di Reanimated potrebbero avere limitazioni di precisione che arrotondano i confidence scores.

**Test in corso:**
Aggiunti log di debug in `useYoloWorker.ts` (righe 330-339, 365-374) e `useYoloWorkerAsync.ts` (righe 343-352, 423-432):
- Log confidence scores **prima** dell'assegnazione ai SharedValue (direttamente da YoloDetector)
- Log confidence scores **dopo** l'assegnazione ai SharedValue (letti dal SharedValue)

Se i valori sono diversi, conferma che il problema è nella precisione dei SharedValue.

**Nota:** Il benchmark statico (`useImageBenchmark.ts`) usa direttamente `YoloDetector` senza SharedValue, quindi questi log non compaiono nel benchmark. L'ipotesi SharedValue è applicabile solo al runtime live (camera), non al benchmark statico.

## Risultati Benchmark Android (9 Nov 2026)

### Esecuzione Benchmark
- Modello: `best_640_float16.tflite` (MD5: d520b2ae9a303d6ee4dcea087cf20809)
- Risoluzione: 1024x576 → 640x640 letterbox
- Video testati:
  - Tiro Libero: 27 frames, avg inference 178.7ms
  - Tiro da 3: 22 frames, avg inference 180.5ms
  - Tiro a centrocampo: 33 frames, avg inference 181.1ms

### Rilevazioni
- **Ball detections:** 82/82 frames (100%)
- **Player detections:** 82/82 frames (100%)
- **Rim detections:** 0/82 frames (0%)

### Frame Target Salvato
- Frame: `Tiro a centrocampo/frame_000085.jpg` (frame 18 del video)
- Input salvato: `frame_000085_android_input.f32` (1228800 elements, 640x640x3)
- Output salvato: `frame_000085_android_output.f32` (58800 elements, 1x7x8400)
- Metadata salvato: `frame_000085_metadata.json`

### Letterbox Parameters
- SCALE: 0.625
- LETTERBOX_OFFSET_X: 0
- LETTERBOX_OFFSET_Y: 140
- RESIZED_WIDTH: 640
- RESIZED_HEIGHT: 360
- TENSOR_SIZE: 640

### Coordinate Detection
- coordinatesAreNormalized: true
- coordinateScale: 640
- nDetections: 8400
- coordinatesOutsideNormalizedRange: 0

## Prossimi Passi

### 1. Copiare File dal Dispositivo
```bash
adb pull /data/user/0/com.mvpiqhoopsmobile/files/yolo-debug/frame_000085_android_input.f32 .
adb pull /data/user/0/com.mvpiqhoopsmobile/files/yolo-debug/frame_000085_android_output.f32 .
adb pull /data/user/0/com.mvpiqhoopsmobile/files/yolo-debug/frame_000085_metadata.json .
```

### 2. Confrontare Rilevazioni
```bash
python .\compare_detections.py
```

### 3. Analisi Risultati
- Se Android = Python: Pipeline confermata identica, problema altrove
- Se Android ≠ Python: Investigare thresholds adattivi o stato temporale

## Risultati Confronto (9 Nov 2026)

### Confronto Rilevazioni Finali
**PLAYER: [OK] IDENTICO**
- Android: x=0.0245, y=0.0667, width=0.0771, height=0.1446
- Python: x=0.0245, y=0.0667, width=0.0771, height=0.1446
- Differenza: 0.0 (perfettamente identico)

**BALL: [DIFF] DIVERSO**
- Android: x=0.5247, y=0.2837, width=0.0620, height=0.1484
- Python: x=0.0260, y=0.3317, width=0.0589, height=0.1815
- Differenza x: 0.4987 (quasi 50% del frame!)
- Differenza y: 0.0480
- Differenza width: 0.0030
- Differenza height: 0.0331

**RIM: [OK] NESSUNA RILEVAZIONE (entrambi)**

### Analisi
- PLAYER identico → Pipeline YOLO corretta per player
- BALL completamente diverso → Problema specifico per ball
- Differenza enorme su x (0.5247 vs 0.0260) suggerisce problema coordinate raw o anchor selection

### Ipotesi Nuova
Il problema potrebbe essere nell'anchor selection per la palla. Android potrebbe selezionare un anchor diverso da Python per la stessa classe, causando coordinate diverse.

### Prossima Investigazione
Confrontare le coordinate raw del modello (output TFLite) tra Android e Python per vedere se l'anchor index della palla è diverso.

## Risultati Confronto Output TFLite (9 Nov 2026)

### Confronto Output Grezzo
- Differenza media: 0.0000001099
- Differenza massima: 0.0000456572
- Percentuale identici: 28.87%
- Valori identici: False

### Conclusione
**Output TFLite praticamente identico** (differenza dovuta a precisione floating point GPU vs CPU).
Il problema NON è nell'inferenza TFLite, ma nel post-processing YOLO (thresholds, filtri, anchor selection).

### Prossima Investigazione
Poiché PLAYER è identico ma BALL è completamente diverso, il problema è specifico per la palla. Devo analizzare:
1. Anchor selection per ball tra Android e Python
2. Filtri geometrici ball (aspect ratio, size)
3. Thresholds adattivi per ball

## Script di Supporto

### `reproduce_letterbox_ts.py`
Riproduce `letterboxRgbToYoloInput()` in Python per verificare l'interpolazione.

### `compare_raw_outputs.py`
Confronta output grezzo TFLite tra Python e Android.

### `compare_raw_scores.py`
Confronta raw scores YOLO per canale (cx, cy, w, h, ball, player, rim).

### `analyze_raw_scores.py`
Analizza statistiche raw scores per identificare candidati.

### `analyze_ball_filters.py`
Analizza filtri ball per capire perché candidati vengono scartati.

### `compare_detections.py`
Confronta rilevazioni finali tra Python e Android usando `AppCompatibleDecoder`.

## File Modificati

### `src/vision/useImageBenchmark.ts`
- Sostituito `jpeg-js` con `react-native-nitro-image`
- Implementato decoder nativo Bitmap
- Gestione conversione BGRA/RGBA → RGB

## Note Tecniche

### Decoder Nativo Bitmap
- Libreria: `react-native-nitro-image`
- Metodo: `loadImage()` → `toRawPixelData()`
- Pixel format: BGRA (Android little-endian ARGB_8888)
- Conversione: BGRA → RGB (scambio canali)

### Letterbox TypeScript
- Coordinate half-pixel: `(x + 0.5) * sourceWidth / resizedWidth - 0.5`
- Interpolazione bilineare manuale
- Padding centrato
- Math.round() sulle dimensioni

### YOLO Post-Processing
- Thresholds base: ball=0.05, player=0.01, rim=0.10
- Threshold adattivo basato su size: `getAdaptiveThreshold()`
- Filtri geometrici: aspect ratio 0.25-4.0 per ball
- Post-selection filter: threshold più severo sul best candidate

## Riferimenti
- Modello: `assets/models/best_640_float16.tflite`
- Frame test: `assets/benchmark-images/Tiro a centrocampo/frame_000085.jpg`
- Script benchmark Python: `scripts/benchmark_yolo_videos.py`
