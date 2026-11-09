#!/usr/bin/env python3
"""
Confronta l'output grezzo TFLite tra Python e Android per lo stesso frame.
Esclude post-processing per isolare differenze nell'inferenza.
"""

import numpy as np
import cv2
import sys
import base64

# Percorsi
JPEG_PATH = "assets/benchmark-images/Tiro a centrocampo/frame_000085.jpg"
MODEL_PATH = "assets/models/best_640_float16.tflite"
ANDROID_OUTPUT = "frame_000085_android_output.f32"
PYTHON_OUTPUT = "frame_000085_python_output.f32"

# Dimensioni
SOURCE_WIDTH = 1024
SOURCE_HEIGHT = 576
TARGET_SIZE = 640


def letterbox_rgb_to_yolo_input(source: np.ndarray, source_width: int, source_height: int, target_size: int) -> np.ndarray:
    """Riproduzione fedele della funzione TypeScript letterboxRgbToYoloInput()."""
    scale = min(target_size / source_width, target_size / source_height)
    resized_width = max(1, int(round(source_width * scale)))
    resized_height = max(1, int(round(source_height * scale)))
    offset_x = (target_size - resized_width) // 2
    offset_y = (target_size - resized_height) // 2
    
    output = np.zeros(target_size * target_size * 3, dtype=np.float32)
    
    for y in range(resized_height):
        source_y = max(0, min(source_height - 1,
            (y + 0.5) * source_height / resized_height - 0.5))
        y0 = int(np.floor(source_y))
        y1 = min(source_height - 1, y0 + 1)
        fy = source_y - y0
        
        for x in range(resized_width):
            source_x = max(0, min(source_width - 1,
                (x + 0.5) * source_width / resized_width - 0.5))
            x0 = int(np.floor(source_x))
            x1 = min(source_width - 1, x0 + 1)
            fx = source_x - x0
            
            destination = ((y + offset_y) * target_size + x + offset_x) * 3
            top_left = (y0 * source_width + x0) * 3
            top_right = (y0 * source_width + x1) * 3
            bottom_left = (y1 * source_width + x0) * 3
            bottom_right = (y1 * source_width + x1) * 3
            
            for channel in range(3):
                top = source[top_left + channel] * (1 - fx) + source[top_right + channel] * fx
                bottom = source[bottom_left + channel] * (1 - fx) + source[bottom_right + channel] * fx
                output[destination + channel] = top * (1 - fy) + bottom * fy
    
    return output


def main():
    print("=== CONFRONTO OUTPUT GREZZO TFLITE ===\n")
    
    try:
        import tensorflow as tf
    except ImportError:
        print("ERRORE: TensorFlow non installato.")
        print("Installa con: pip install tensorflow")
        return 1
    
    # 1. Carica e preprocessa immagine con logica TypeScript
    print(f"Caricamento JPEG da {JPEG_PATH}")
    frame_bgr = cv2.imread(JPEG_PATH)
    frame_rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
    rgb_float32 = frame_rgb.astype(np.float32).flatten()
    
    print(f"Applicazione letterbox TypeScript")
    tensor = letterbox_rgb_to_yolo_input(
        rgb_float32,
        SOURCE_WIDTH,
        SOURCE_HEIGHT,
        TARGET_SIZE
    )
    tensor = tensor.reshape(1, TARGET_SIZE, TARGET_SIZE, 3)
    print(f"Tensore input: shape={tensor.shape}, dtype={tensor.dtype}")
    print(f"Min: {tensor.min():.2f}, Max: {tensor.max():.2f}, Mean: {tensor.mean():.2f}")
    
    # 2. Carica modello TFLite
    print(f"\nCaricamento modello TFLite da {MODEL_PATH}")
    interpreter = tf.lite.Interpreter(model_path=MODEL_PATH)
    interpreter.allocate_tensors()
    
    input_details = interpreter.get_input_details()
    output_details = interpreter.get_output_details()
    
    print(f"Input shape: {input_details[0]['shape']}")
    print(f"Output shape: {output_details[0]['shape']}")
    
    # 3. Esegui inferenza
    print("\nEsecuzione inferenza...")
    interpreter.set_tensor(input_details[0]['index'], tensor)
    interpreter.invoke()
    output = interpreter.get_tensor(output_details[0]['index'])
    
    print(f"Output shape: {output.shape}")
    print(f"Output dtype: {output.dtype}")
    print(f"Min: {output.min():.6f}, Max: {output.max():.6f}, Mean: {output.mean():.6f}")
    
    # 4. Salva output Python
    output_flat = output.flatten().astype(np.float32)
    output_flat.tofile(PYTHON_OUTPUT)
    print(f"\nOutput Python salvato in {PYTHON_OUTPUT}")
    
    # 5. Confronta con output Android
    print("\n=== CONFRONTO CON OUTPUT ANDROID ===")
    try:
        # Android saves as base64 in UTF-16 encoding
        # Read as binary first to detect encoding, then decode
        with open(ANDROID_OUTPUT, 'rb') as f:
            raw_bytes = f.read()
        # Try UTF-16 first (Android default)
        try:
            android_base64 = raw_bytes.decode('utf-16').strip()
        except UnicodeDecodeError:
            # Fallback to UTF-8
            android_base64 = raw_bytes.decode('utf-8').strip()
        android_bytes = base64.b64decode(android_base64)
        android_output = np.frombuffer(android_bytes, dtype=np.float32)
        print(f"Output Android caricato: shape={android_output.shape}")
        
        if android_output.shape != output_flat.shape:
            print(f"ERRORE: Shape diverso! Android={android_output.shape}, Python={output_flat.shape}")
            return 1
        
        diff = np.abs(android_output - output_flat)
        print(f"Differenza media: {diff.mean():.10f}")
        print(f"Differenza massima: {diff.max():.10f}")
        print(f"Valori identici: {np.array_equal(android_output, output_flat)}")
        print(f"Percentuale identici: {(diff == 0).sum() / diff.size * 100:.2f}%")
        
        if diff.mean() < 1e-5:
            print("\n[SUCCESS] Output TFLite praticamente identico!")
            print("Il problema NON è nell'inferenza TFLite.")
            print("Deve essere nel post-processing YOLO (thresholds, filtri, NMS).")
        else:
            print("\n[ATTENZIONE] Differenza rilevata nell'output TFLite.")
            print("Possibili cause:")
            print("- Runtime TFLite diverso (Python CPU vs Android GPU)")
            print("- Delegato GPU Android introduce differenze numeriche")
            print("- Differenze nel preprocessing non ancora isolate")
            
    except FileNotFoundError:
        print(f"File {ANDROID_OUTPUT} non trovato.")
        print("Esegui il benchmark Android per generarlo.")
        return 1
    
    return 0


if __name__ == "__main__":
    sys.exit(main())
