#!/usr/bin/env python3
"""
Analizza i raw scores YOLO per capire perché non ci sono rilevazioni.
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


def main():
    print("=== ANALISI RAW SCORES YOLO ===\n")
    
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
    
    # 3. Analizza raw scores
    output_transposed = output.squeeze().T  # (8400, 7)
    n = output_transposed.shape[0]
    
    # Estrai scores per classe
    ball_scores = output_transposed[:, 4]
    player_scores = output_transposed[:, 5]
    rim_scores = output_transposed[:, 6]
    
    print(f"\n--- STATISTICHE RAW SCORES ---")
    print(f"Totale anchors: {n}")
    
    print(f"\nBALL scores:")
    print(f"  Max: {ball_scores.max():.4f}")
    print(f"  Min: {ball_scores.min():.4f}")
    print(f"  Mean: {ball_scores.mean():.4f}")
    print(f"  > 0.05: {(ball_scores > 0.05).sum()}")
    print(f"  > 0.01: {(ball_scores > 0.01).sum()}")
    print(f"  > 0.001: {(ball_scores > 0.001).sum()}")
    
    print(f"\nPLAYER scores:")
    print(f"  Max: {player_scores.max():.4f}")
    print(f"  Min: {player_scores.min():.4f}")
    print(f"  Mean: {player_scores.mean():.4f}")
    print(f"  > 0.01: {(player_scores > 0.01).sum()}")
    print(f"  > 0.001: {(player_scores > 0.001).sum()}")
    
    print(f"\nRIM scores:")
    print(f"  Max: {rim_scores.max():.4f}")
    print(f"  Min: {rim_scores.min():.4f}")
    print(f"  Mean: {rim_scores.mean():.4f}")
    print(f"  > 0.10: {(rim_scores > 0.10).sum()}")
    print(f"  > 0.01: {(rim_scores > 0.01).sum()}")
    
    # 4. Top 10 candidati per classe
    print(f"\n--- TOP 10 CANDIDATI BALL ---")
    top_ball_indices = np.argsort(ball_scores)[-10:][::-1]
    for idx in top_ball_indices:
        cx, cy, bw, bh = output_transposed[idx, :4]
        score = ball_scores[idx]
        print(f"  Anchor {idx}: score={score:.4f}, box=[{cx:.2f}, {cy:.2f}, {bw:.2f}, {bh:.2f}]")
    
    print(f"\n--- TOP 10 CANDIDATI PLAYER ---")
    top_player_indices = np.argsort(player_scores)[-10:][::-1]
    for idx in top_player_indices:
        cx, cy, bw, bh = output_transposed[idx, :4]
        score = player_scores[idx]
        print(f"  Anchor {idx}: score={score:.4f}, box=[{cx:.2f}, {cy:.2f}, {bw:.2f}, {bh:.2f}]")
    
    return 0


if __name__ == "__main__":
    sys.exit(main())
