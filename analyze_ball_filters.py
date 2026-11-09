#!/usr/bin/env python3
"""
Analizza i candidati ball per capire perché vengono scartati dai filtri.
"""

import numpy as np
import cv2
import sys
import math

# Percorsi
JPEG_PATH = "assets/benchmark-images/Tiro a centrocampo/frame_000085.jpg"
MODEL_PATH = "assets/models/best_640_float16.tflite"

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


def valid_ball_geometry(width: float, height: float) -> bool:
    return width > 0 and height > 0 and 0.25 <= width / height <= 4.0


def size_threshold(width: float, height: float, base: float,
                    min_size: float, max_size: float, resolution_scale: float) -> float:
    avg_size = (width + height) / 2
    max_size *= resolution_scale
    min_size *= resolution_scale
    if avg_size >= max_size:
        return base
    t = min(1.0, max(0.0, (avg_size - min_size) / (max_size - min_size)))
    smooth_t = t * t * (3 - 2 * t)
    return 0.01 + (base - 0.01) * smooth_t


def main():
    print("=== ANALISI FILTRI BALL ===\n")
    
    try:
        import tensorflow as tf
    except ImportError as e:
        print(f"ERRORE: {e}")
        return 1
    
    # 1. Carica e preprocessa immagine
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
    
    # 2. Carica modello ed esegui inferenza
    print(f"Caricamento modello TFLite da {MODEL_PATH}")
    interpreter = tf.lite.Interpreter(model_path=MODEL_PATH)
    interpreter.allocate_tensors()
    
    input_details = interpreter.get_input_details()
    output_details = interpreter.get_output_details()
    
    print("Esecuzione inferenza...")
    interpreter.set_tensor(input_details[0]['index'], tensor)
    interpreter.invoke()
    output = interpreter.get_tensor(output_details[0]['index'])
    
    # 3. Converti coordinate
    output_transposed = output.squeeze().T  # (8400, 7)
    n = output_transposed.shape[0]
    
    tensor_size = TARGET_SIZE
    scale = min(tensor_size / SOURCE_WIDTH, tensor_size / SOURCE_HEIGHT)
    resized_w = SOURCE_WIDTH * scale
    resized_h = SOURCE_HEIGHT * scale
    offset_x = (tensor_size - resized_w) / 2 if resized_w < tensor_size else 0.0
    offset_y = (tensor_size - resized_h) / 2 if resized_h < tensor_size else 0.0
    resolution_scale = tensor_size / 512
    
    print(f"\n--- PARAMETRI LETTERBOX ---")
    print(f"Tensor size: {tensor_size}")
    print(f"Scale: {scale:.4f}")
    print(f"Resized: {resized_w:.2f} x {resized_h:.2f}")
    print(f"Offset: {offset_x:.2f}, {offset_y:.2f}")
    print(f"Resolution scale: {resolution_scale:.4f}")
    
    # 4. Analizza candidati ball
    base_threshold = 0.05
    candidates_passed = 0
    geometry_passed = 0
    final_passed = 0
    
    print(f"\n--- ANALISI CANDIDATI BALL > {base_threshold} ---")
    
    for idx in range(n):
        cx, cy, bw, bh = output_transposed[idx, :4]
        ball_score = output_transposed[idx, 4]
        
        if ball_score < base_threshold:
            continue
        
        candidates_passed += 1
        
        # Converti coordinate
        cx_frame = ((cx * tensor_size) - offset_x) / scale / SOURCE_WIDTH
        cy_frame = ((cy * tensor_size) - offset_y) / scale / SOURCE_HEIGHT
        w_frame = (bw * tensor_size) / scale / SOURCE_WIDTH
        h_frame = (bh * tensor_size) / scale / SOURCE_HEIGHT
        
        if not all(math.isfinite(v) for v in (cx_frame, cy_frame, w_frame, h_frame)):
            continue
        if w_frame <= 0.01 or h_frame <= 0.01:
            continue
        
        # Check geometria
        geometry_ok = valid_ball_geometry(w_frame, h_frame)
        aspect_ratio = w_frame / h_frame if h_frame > 0 else 0
        
        # Check threshold adattivo
        adaptive_threshold = size_threshold(
            w_frame, h_frame, base_threshold, 0.10, 0.40, resolution_scale
        )
        threshold_ok = ball_score >= adaptive_threshold
        
        if geometry_ok and threshold_ok:
            geometry_passed += 1
            final_passed += 1
        
        # Stampa top 20 candidati
        if candidates_passed <= 20:
            print(f"\nCandidato {idx}:")
            print(f"  Score: {ball_score:.4f}")
            print(f"  Box frame: [{cx_frame:.4f}, {cy_frame:.4f}, {w_frame:.4f}, {h_frame:.4f}]")
            print(f"  Aspect ratio: {aspect_ratio:.4f}")
            print(f"  Geometria: {geometry_ok}")
            print(f"  Threshold adattivo: {adaptive_threshold:.4f}")
            print(f"  Threshold OK: {threshold_ok}")
            print(f"  Passa tutto: {geometry_ok and threshold_ok}")
    
    print(f"\n--- RIEPILOGO ---")
    print(f"Candidati > {base_threshold}: {candidates_passed}")
    print(f"Passa geometria + threshold: {geometry_passed}")
    print(f"Finali accettati: {final_passed}")
    
    return 0


if __name__ == "__main__":
    sys.exit(main())
