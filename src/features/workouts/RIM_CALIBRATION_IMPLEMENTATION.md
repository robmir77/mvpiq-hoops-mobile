# Implementazione Calibrazione YOLO del Rim

**Repository:** robmir77/mvpiq-hoops-mobile  
**Branch:** Validation-1.0  
**Obiettivo:** Aggiungere alla schermata di calibrazione un riquadro di ricerca YOLO per affinare la posizione del rim selezionato manualmente.

## Riepilogo delle modifiche

### 1. Estensione CalibrationData ✅
**File:** `src/features/workouts/types/workouts.types.ts`

Aggiunto campo `hoopBbox` per salvare le dimensioni del rim dalla calibrazione YOLO:
```typescript
export interface CalibrationData {
    homographyMatrix: number[]
    hoopCenter: { x: number; y: number }
    hoopBbox?: { x: number; y: number; width: number; height: number } // Nuovo
    cameraResolution?: { width: number; height: number }
    // ... altri campi esistenti
}
```

### 2. Configurazione ROI in appConfig ✅
**File:** `src/config/appConfig.ts`

Aggiunta configurazione `RIM_CALIBRATION`:
```typescript
RIM_CALIBRATION: {
    ROI_SIZE_PERCENT: 0.25, // ROI size as percentage of frame (25%)
    MIN_CONFIDENCE: 0.40, // Minimum confidence for rim detection
    MAX_DISTANCE_FROM_CENTER: 0.15, // Max distance from selected center
},
```

## Implementazione Prossimi Passi

### 3. Creare utility useRimCalibration
**File da creare:** `src/vision/useRimCalibration.ts`

Hook per gestire:
- Calcolo ROI centrato sul punto selezionato
- Crop manuale del buffer frame
- Inferenza YOLO singola sul crop
- Conversione coordinate crop → frame originale
- Selezione detection migliore
- Fallback manuale

### 4. Integrazione in CalibrationScreen.tsx
**File da modificare:** `src/features/workouts/screens/CalibrationScreen.tsx`

Aggiungere:
- Stato per ROI e risultato calibrazione
- Overlay SVG del ROI
- Chiamata inferenza al conferma
- Salvataggio con hoopBbox

### 5. Verificare TrackingEngine
**File da verificare:** `src/features/workouts/tracking/TrackingEngine.ts`

Assicurarsi che usi `hoopBbox` se disponibile, altrimenti fallback alle dimensioni fisse.

## Dettagli Tecnici

### Trasformazione Coordinate Preview → Frame
La preview usa `resizeMode="cover"` e `normalizePoint` applica mirroring:
```typescript
const normalizePoint = (rawX: number, rawY: number): Point => {
    const mirroredX = SW - rawX;
    const mirroredY = CAM_H - rawY;
    return {
        x: Math.max(0, Math.min(1, mirroredX / SW)),
        y: Math.max(0, Math.min(1, mirroredY / CAM_H)),
    };
}
```

Per il ROI dobbiamo:
1. Convertire punto selezionato (preview) → coordinate frame originali
2. Calcolare ROI centrato su quel punto
3. Eseguire crop e inferenza
4. Convertire detection (crop) → coordinate frame originali

### Crop Manuale su Buffer
`react-native-vision-camera-resizer` non supporta crop locale nativo. Dobbiamo implementare:
```typescript
function cropBuffer(
    buffer: Uint8Array,
    frameWidth: number,
    frameHeight: number,
    cropX: number,
    cropY: number,
    cropWidth: number,
    cropHeight: number
): Uint8Array
```

### Conversione Coordinate Crop → Frame
Se il crop ha origine (x₀, y₀) e dimensioni (Wc, Hc):
```typescript
x_frame = (x₀ + x_crop * Wc) / W_frame
y_frame = (y₀ + y_crop * Hc) / H_frame
w_frame = (w_crop * Wc) / W_frame
h_frame = (h_crop * Hc) / H_frame
```

## Test da Eseguire

1. **ROI centrato sul punto selezionato**
   - Il centro del crop coincide con il punto
   - Limiti bordi gestiti correttamente

2. **Mapping preview con cover**
   - Punto selezionato convertito correttamente in frame

3. **Crop quadrato elaborato**
   - Bounding box riportato correttamente al frame

4. **Detection con confidenza valida**
   - Centro e dimensioni aggiornati

5. **Detection assente o poco affidabile**
   - Calibrazione manuale invariata

6. **Pipeline allenamento**
   - Nessuna nuova inferenza dedicata al rim

## Ordine di Implementazione Consigliato

1. ✅ Estendere CalibrationData
2. ✅ Aggiungere configurazione appConfig
3. Creare useRimCalibration (ROI, crop, inferenza)
4. Implementare trasformazione coordinate
5. Implementare crop manuale buffer
6. Aggiungere overlay ROI in CalibrationScreen
7. Integrare inferenza al conferma
8. Verificare TrackingEngine
9. Test su dispositivo S21 Ultra
