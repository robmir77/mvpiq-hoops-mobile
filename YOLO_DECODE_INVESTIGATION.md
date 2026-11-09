# Investigazione YOLO Android vs Python — registro delle evidenze

## Obiettivo
Confrontare il comportamento del rilevatore YOLO Android con il test Python sul benchmark, usando gli stessi frame e gli stessi output del modello quando disponibili.

Questo documento registra risultati osservati e comportamento effettivo del codice. Non contiene ipotesi causali o conclusioni non dimostrate.

## Configurazione del test documentata
- Branch analizzato: `Validation-1.0`
- Modello: `assets/models/best_640_float16.tflite`
- Frame di riferimento usato nei dump precedenti: `assets/benchmark-images/Tiro a centrocampo/frame_000085.jpg`
- Dimensioni frame riportate nei metadata: 1024x576
- Input modello: 640x640x3
- Output modello: 1x7x8400

## Risultati di test già registrati

### Decodifica JPEG e preprocessing
Nei test riportati in precedenza:
- Il dump RGB Android è stato confrontato con la decodifica OpenCV.
- Il tensore di input Android è stato confrontato con la riproduzione Python del preprocessing TypeScript.
- I risultati registrati riportano uguaglianza pixel per pixel e uguaglianza del tensore.

Script citato nei test: `reproduce_letterbox_ts.py`.

### Output TFLite
Nel confronto registrato tra output Android e Python:
- Differenza media: 0.0000001099
- Differenza massima: 0.0000456572
- Percentuale di valori identici: 28.87%

Questi numeri descrivono il confronto effettuato; da soli non dimostrano che ogni candidato selezionato dai due decoder debba essere lo stesso.

Script citato nei test: `compare_tflite_outputs.py`.

### Risultati del dump Android del frame 000085
I metadata e i log Android precedentemente condivisi riportano:
- Frame: `Tiro a centrocampo/frame_000085.jpg`
- Frame nel benchmark Android: 18/33
- Output salvato: `frame_000085_android_output.f32`
- Input salvato: `frame_000085_android_input.f32`
- Metadata: `frame_000085_metadata.json`
- Rilevazione Player riportata: x=0.02445, y=0.06670, width=0.07711, height=0.14461, confidence=1.0
- Rilevazione Ball riportata: x=0.52466, y=0.28366, width=0.06196, height=0.14840, confidence=1.0

Nel log del frame target compare anche un candidato Ball aggiornato con anchorIndex=2600, confidence=0.999999821.

### Immagine del test A/B Python condivisa in chat
L'immagine condivisa mostra:
- Player: confidence visualizzata 0.82, box sul giocatore.
- Ball: confidence visualizzata 0.07, box vicino al giocatore.

L'immagine deve essere associata al frame esatto e alla configurazione del test prima di usarla in un confronto numerico diretto con il dump Android del frame 000085.

## Comportamento effettivo del codice esaminato

### Android — `src/vision/useImageBenchmark.ts`
- `yoloDetectorRef` contiene un'unica istanza di `YoloDetector` per la durata del hook.
- `runBenchmark()` scorre i frame e chiama `processImage()`.
- In `runBenchmark()` non viene chiamato `resetAdaptiveState()` all'inizio di ciascun video.
- Il parser riceve l'output TFLite e le dimensioni originali del frame.

### Android — `src/vision/engine/YoloDetector.ts`
- Il tensore viene interpretato come 7 canali per anchor: cx, cy, width, height, ball, player, rim.
- Il parser determina se le coordinate box sono normalizzate o in pixel.
- Ball e Player vengono selezionati separatamente in base ai rispettivi score e filtri.
- Per Ball viene applicato un controllo geometrico sul rapporto width/height e una soglia dipendente dalle dimensioni del box.
- Per Player viene applicata la soglia adattiva della classe.
- Le soglie adattive e le cronologie sono mantenute come stato dell'istanza.
- `resetAdaptiveState()` azzera le cronologie e ripristina le soglie iniziali.
- La selezione conserva il primo anchor in caso di confidence esattamente uguali, perché la sostituzione avviene solo con `>`.

### Python — `scripts/benchmark_yolo_videos.py`
- `AppCompatibleDecoder` mantiene soglie e cronologie adattive.
- Nel ciclo `benchmark_one()`, viene creata una nuova istanza di `AppCompatibleDecoder` per ciascun video.
- Il decoder viene eseguito sui frame campionati, compresi quelli di warm-up.
- La selezione dei candidati e i filtri sono implementati in Python.

### Python — `compare_detections.py`
- È uno script distinto da `scripts/benchmark_yolo_videos.py`.
- La classe `AppCompatibleDecoder` contenuta in questo file non implementa l'aggiornamento delle soglie adattive tra chiamate.
- Il risultato di questo script non va considerato automaticamente equivalente al benchmark sequenziale Python.

## Verifiche ancora da eseguire
1. Associare senza ambiguità l'immagine A/B Python al nome del video e all'indice esatto del frame.
2. Eseguire Android e Python sullo stesso file immagine, con lo stesso modello e lo stesso output grezzo.
3. Confrontare, per ogni anchor rilevante, i sette valori raw e l'indice dell'anchor.
4. Confrontare separatamente i candidati Ball e Player prima e dopo ciascun filtro.
5. Registrare soglie adattive e cronologie all'ingresso di ogni frame in entrambi i decoder.
6. Verificare il comportamento del parser con confidence uguali, quasi uguali e coordinate fuori dal frame.

## File di codice esaminati
- `src/vision/engine/YoloDetector.ts`
- `src/vision/useImageBenchmark.ts`
- `scripts/benchmark_yolo_videos.py`
- `compare_detections.py`

