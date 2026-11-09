#!/usr/bin/env python3
"""
Riproduce fedelmente la funzione TypeScript letterboxRgbToYoloInput()
per isolare le differenze di interpolazione rispetto a OpenCV.
"""

import numpy as np
import struct

# Percorsi file
ANDROID_RGB = "frame_000085_android_rgb.rgb"
ANDROID_INPUT = "frame_000085_android_input.f32"
PYTHON_REPRODUCTION = "frame_000085_python_reproduction.f32"

# Dimensioni del frame (dai log precedenti)
SOURCE_WIDTH = 1024
SOURCE_HEIGHT = 576
TARGET_SIZE = 640


def letterbox_rgb_to_yolo_input(source: np.ndarray, source_width: int, source_height: int, target_size: int) -> np.ndarray:
    """
    Riproduzione fedele della funzione TypeScript letterboxRgbToYoloInput().
    
    Caratteristiche:
    - Math.round() sulle dimensioni (come in TypeScript)
    - Coordinate half-pixel: (x + 0.5) * sourceWidth / resizedWidth - 0.5
    - Interpolazione bilineare
    - Padding centrato
    - Calcoli in float32
    """
    if (not isinstance(source_width, int) or source_width <= 0 or
        not isinstance(source_height, int) or source_height <= 0 or
        not isinstance(target_size, int) or target_size <= 0 or
        source.size != source_width * source_height * 3):
        raise ValueError('Invalid RGB image dimensions or buffer length for YOLO preprocessing')
    
    scale = min(target_size / source_width, target_size / source_height)
    resized_width = max(1, int(round(source_width * scale)))
    resized_height = max(1, int(round(source_height * scale)))
    offset_x = (target_size - resized_width) // 2
    offset_y = (target_size - resized_height) // 2
    
    output = np.zeros(target_size * target_size * 3, dtype=np.float32)
    
    for y in range(resized_height):
        # Coordinate half-pixel come in TypeScript
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
    print("=== RIPRODUZIONE LETTERBOX TYPESCRIPT ===\n")
    
    # 1. Carica RGB Android decodificato
    print(f"Caricamento RGB Android da {ANDROID_RGB}")
    try:
        with open(ANDROID_RGB, 'rb') as f:
            rgb_bytes = f.read()
        android_rgb = np.frombuffer(rgb_bytes, dtype=np.uint8)
        android_rgb = android_rgb.reshape(SOURCE_HEIGHT, SOURCE_WIDTH, 3)
        print(f"RGB caricato: shape={android_rgb.shape}, dtype={android_rgb.dtype}")
        print(f"Min: {android_rgb.min()}, Max: {android_rgb.max()}, Mean: {android_rgb.mean():.2f}")
    except FileNotFoundError:
        print(f"ERRORE: File {ANDROID_RGB} non trovato.")
        print("Esegui prima il benchmark Android per generare questo file.")
        return
    
    # 2. Converti in float32 (range 0-255)
    android_rgb_float32 = android_rgb.astype(np.float32).flatten()
    
    # 3. Applica letterbox fedele a TypeScript
    print(f"\nApplicazione letterbox TypeScript:")
    print(f"Source: {SOURCE_WIDTH}x{SOURCE_HEIGHT}")
    print(f"Target: {TARGET_SIZE}x{TARGET_SIZE}")
    
    python_tensor = letterbox_rgb_to_yolo_input(
        android_rgb_float32,
        SOURCE_WIDTH,
        SOURCE_HEIGHT,
        TARGET_SIZE
    )
    
    print(f"Tensore generato: shape={python_tensor.shape}, dtype={python_tensor.dtype}")
    print(f"Min: {python_tensor.min()}, Max: {python_tensor.max()}, Mean: {python_tensor.mean():.2f}")
    
    # 4. Salva tensore riprodotto
    python_tensor.tofile(PYTHON_REPRODUCTION)
    print(f"\nTensore salvato in {PYTHON_REPRODUCTION}")
    
    # 5. Confronta con tensore Android
    print("\n=== CONFRONTO CON TENSORE ANDROID ===")
    try:
        android_input = np.fromfile(ANDROID_INPUT, dtype=np.float32)
        print(f"Tensore Android caricato: shape={android_input.shape}")
        
        if android_input.shape != python_tensor.shape:
            print(f"ERRORE: Shape diverso! Android={android_input.shape}, Python={python_tensor.shape}")
            return
        
        diff = np.abs(android_input - python_tensor)
        print(f"Differenza media: {diff.mean():.10f}")
        print(f"Differenza massima: {diff.max():.10f}")
        print(f"Valori identici: {np.array_equal(android_input, python_tensor)}")
        print(f"Percentuale identici: {(diff == 0).sum() / diff.size * 100:.2f}%")
        
        if diff.mean() < 1e-6:
            print("\n[SUCCESS] La riproduzione Python corrisponde al tensore Android!")
            print("La funzione TypeScript è coerente con il tensore salvato.")
        else:
            print("\n[ATTENZIONE] Differenza rilevata tra riproduzione e tensore Android.")
            print("Possibili cause:")
            print("- Il decoder nativo Bitmap produce RGB diversi dal decoder precedente")
            print("- Errore nella riproduzione Python della logica TypeScript")
            
    except FileNotFoundError:
        print(f"File {ANDROID_INPUT} non trovato. Esegui il benchmark Android per generarlo.")
    
    # 6. Confronta con OpenCV (se disponibile)
    print("\n=== CONFRONTO CON OPENCV (se disponibile) ===")
    try:
        import cv2
        
        # Carica JPEG originale con OpenCV
        jpeg_path = "assets/benchmark-images/Tiro a centrocampo/frame_000085.jpg"
        opencv_rgb = cv2.imread(jpeg_path)
        opencv_rgb = cv2.cvtColor(opencv_rgb, cv2.COLOR_BGR2RGB)
        opencv_rgb_float32 = opencv_rgb.astype(np.float32).flatten()
        
        opencv_tensor = letterbox_rgb_to_yolo_input(
            opencv_rgb_float32,
            SOURCE_WIDTH,
            SOURCE_HEIGHT,
            TARGET_SIZE
        )
        
        diff_opencv = np.abs(opencv_tensor - python_tensor)
        print(f"Differenza media vs OpenCV: {diff_opencv.mean():.10f}")
        print(f"Differenza massima vs OpenCV: {diff_opencv.max():.10f}")
        
        if diff_opencv.mean() < 1e-6:
            print("[SUCCESS] La riproduzione Python corrisponde anche a OpenCV!")
        else:
            print("[ATTENZIONE] Differenza tra riproduzione Python e OpenCV.")
            print("Questo indica che la logica di letterbox TypeScript è diversa da OpenCV.")
            
    except ImportError:
        print("OpenCV non disponibile, salto confronto.")
    except Exception as e:
        print(f"Errore confronto OpenCV: {e}")


if __name__ == "__main__":
    main()
