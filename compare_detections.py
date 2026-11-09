#!/usr/bin/env python3
"""
Confronta le rilevazioni YOLO tra Python e Android per un singolo frame.
Usa AppCompatibleDecoder per replicare la logica di parsing dell'app.
"""

import numpy as np
import cv2
import sys
import json
import math

# Percorsi
JPEG_PATH = "assets/benchmark-images/Tiro a centrocampo/frame_000085.jpg"
MODEL_PATH = "assets/models/best_640_float16.tflite"
ANDROID_METADATA = "frame_000085_metadata.json"

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


class AppCompatibleDecoder:
    """Port di AppCompatibleDecoder da benchmark_yolo_videos.py."""

    def __init__(self) -> None:
        self.base = {"ball": 0.05, "player": 0.01, "rim": 0.10}
        self.threshold = dict(self.base)
        self.history: dict[str, list[bool]] = {"ball": [], "player": [], "rim": []}
        self.confidence_history: dict[str, list[float]] = {"ball": [], "player": [], "rim": []}
        self.window_size = 15
        self.min_threshold = 0.0005
        self.max_threshold = 0.50
        self.adjustment_factor = 0.2
        self.high_conf_threshold = 0.7
        self.low_conf_threshold = 0.2
        self.rim_enabled = False

    @staticmethod
    def _valid_ball_geometry(width: float, height: float) -> bool:
        return width > 0 and height > 0 and 0.25 <= width / height <= 4.0

    @staticmethod
    def _size_threshold(width: float, height: float, base: float,
                        min_size: float, max_size: float, resolution_scale: float) -> float:
        avg_size = (width + height) / 2
        max_size *= resolution_scale
        min_size *= resolution_scale
        if avg_size >= max_size:
            return base
        t = min(1.0, max(0.0, (avg_size - min_size) / (max_size - min_size)))
        smooth_t = t * t * (3 - 2 * t)
        return 0.01 + (base - 0.01) * smooth_t

    def decode(self, raw: np.ndarray, frame_w: int, frame_h: int) -> dict:
        # raw è già (8400, 7), non serve trasporre
        output = raw
        n = output.shape[0]
        results = {"ball": None, "player": None, "rim": None}
        if n <= 0:
            return results
        
        tensor_size_by_anchors = {8400: 640, 5376: 512, 4116: 448, 3024: 384, 2100: 320}
        tensor_size = tensor_size_by_anchors.get(n, 512)
        # Usa le dimensioni passate, non i fallback
        scale = min(tensor_size / frame_w, tensor_size / frame_h)
        resized_w = frame_w * scale
        resized_h = frame_h * scale
        offset_x = (tensor_size - resized_w) / 2 if resized_w < tensor_size else 0.0
        offset_y = (tensor_size - resized_h) / 2 if resized_h < tensor_size else 0.0
        resolution_scale = tensor_size / 512
        best = {"ball": None, "player": None, "rim": None}
        ball_candidates_count = 0
        ball_geometry_count = 0
        ball_threshold_count = 0

        for idx in range(n):
            cx, cy, bw, bh = (float(output[idx, k]) for k in range(4))
            scores = {"ball": float(output[idx, 4]), "player": float(output[idx, 5]), "rim": float(output[idx, 6])}
            cx_frame = ((cx * tensor_size) - offset_x) / scale / frame_w
            cy_frame = ((cy * tensor_size) - offset_y) / scale / frame_h
            w_frame = (bw * tensor_size) / scale / frame_w
            h_frame = (bh * tensor_size) / scale / frame_h
            if not all(math.isfinite(v) for v in (cx_frame, cy_frame, w_frame, h_frame)):
                continue
            if w_frame <= 0.01 or h_frame <= 0.01:
                continue

            ball_threshold = self._size_threshold(
                w_frame, h_frame, self.threshold["ball"], 0.10, 0.40, resolution_scale
            )
            
            geometry_ok = self._valid_ball_geometry(w_frame, h_frame)
            threshold_ok = scores["ball"] >= ball_threshold
            
            if geometry_ok and threshold_ok:
                ball_candidates_count += 1
                current = best["ball"]
                if current is None or scores["ball"] > current["confidence"]:
                    best["ball"] = {
                        "x": cx_frame, "y": cy_frame, "width": w_frame, "height": h_frame,
                        "confidence": scores["ball"], "anchor_index": float(idx), "anchor_count": float(n),
                    }
            
            if scores["player"] >= self.threshold["player"]:
                current = best["player"]
                if current is None or scores["player"] > current["confidence"]:
                    best["player"] = {
                        "x": cx_frame, "y": cy_frame, "width": w_frame, "height": h_frame,
                        "confidence": scores["player"], "anchor_index": float(idx), "anchor_count": float(n),
                    }
        
        print(f"[DEBUG] Ball candidates passing filters: {ball_candidates_count}")

        # Post-selection ball filter
        ball = best["ball"]
        if ball is not None:
            if not self._valid_ball_geometry(ball["width"], ball["height"]):
                ball = None
            else:
                post_threshold = self._size_threshold(
                    ball["width"], ball["height"], 0.005, 0.01, 0.30, 1.0
                )
                print(f"[DEBUG] Best ball before post-filter: confidence={ball['confidence']:.4f}, post_threshold={post_threshold:.4f}")
                if ball["confidence"] < post_threshold:
                    print(f"[DEBUG] Ball rejected by post-selection filter")
                    ball = None
                else:
                    print(f"[DEBUG] Ball accepted by post-selection filter")
        else:
            print(f"[DEBUG] No ball candidate passed initial filters")
        results["ball"] = ball
        results["player"] = best["player"]
        results["rim"] = best["rim"] if self.rim_enabled else None
        
        return results


def main():
    print("=== CONFRONTO RILEVAZIONI YOLO PYTHON VS ANDROID ===\n")
    
    try:
        import tensorflow as tf
        import math
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
    
    # 3. Decodifica con AppCompatibleDecoder
    print("\nDecodifica con AppCompatibleDecoder...")
    decoder = AppCompatibleDecoder()
    # L'output TFLite è (1, 7, 8400), squeeze() dà (7, 8400), .T dà (8400, 7)
    # Ma il decoder ora si aspetta (8400, 7) direttamente
    output_transposed = output.squeeze().T  # Da (1, 7, 8400) a (8400, 7)
    # Passa le dimensioni corrette del frame, non i fallback 1280x720
    python_detections = decoder.decode(output_transposed, SOURCE_WIDTH, SOURCE_HEIGHT)
    
    print("\n--- RILEVAZIONI PYTHON ---")
    for class_name, detection in python_detections.items():
        if detection:
            print(f"{class_name.upper()}:")
            print(f"  x: {detection['x']:.4f}")
            print(f"  y: {detection['y']:.4f}")
            print(f"  width: {detection['width']:.4f}")
            print(f"  height: {detection['height']:.4f}")
            print(f"  confidence: {detection['confidence']:.4f}")
            print(f"  anchor_index: {int(detection['anchor_index'])}")
        else:
            print(f"{class_name.upper()}: Nessuna rilevazione")
    
    # 4. Confronta con Android
    print("\n--- CONFRONTO CON ANDROID ---")
    try:
        with open(ANDROID_METADATA, 'r') as f:
            android_metadata = json.load(f)

        print("Metadata Android:")
        print(f"  image: {android_metadata['image']}")
        print(f"  width: {android_metadata['width']}")
        print(f"  height: {android_metadata['height']}")
        print(f"  inputSize: {android_metadata['inputSize']}")

        # Check if detections are present
        if 'detections' in android_metadata:
            print("\nRilevazioni Android:")
            android_detections = android_metadata['detections']

            for class_name in ['ball', 'player', 'rim']:
                detection = android_detections[class_name]
                if detection:
                    print(f"{class_name.upper()}:")
                    print(f"  x: {detection['x']:.4f}")
                    print(f"  y: {detection['y']:.4f}")
                    print(f"  width: {detection['width']:.4f}")
                    print(f"  height: {detection['height']:.4f}")
                    print(f"  confidence: {detection['confidence']:.4f}")
                else:
                    print(f"{class_name.upper()}: Nessuna rilevazione")

            # Compare with Python
            print("\n--- DIFFERENZE ---")
            for class_name in ['ball', 'player', 'rim']:
                android_det = android_detections[class_name]
                python_det = python_detections[class_name]

                if android_det and python_det:
                    x_diff = abs(android_det['x'] - python_det['x'])
                    y_diff = abs(android_det['y'] - python_det['y'])
                    w_diff = abs(android_det['width'] - python_det['width'])
                    h_diff = abs(android_det['height'] - python_det['height'])

                    if x_diff < 0.01 and y_diff < 0.01 and w_diff < 0.01 and h_diff < 0.01:
                        print(f"{class_name.upper()}: [OK] IDENTICO")
                    else:
                        print(f"{class_name.upper()}: [DIFF] DIVERSO")
                        print(f"  x: Android {android_det['x']:.4f} vs Python {python_det['x']:.4f} (diff {x_diff:.4f})")
                        print(f"  y: Android {android_det['y']:.4f} vs Python {python_det['y']:.4f} (diff {y_diff:.4f})")
                        print(f"  width: Android {android_det['width']:.4f} vs Python {python_det['width']:.4f} (diff {w_diff:.4f})")
                        print(f"  height: Android {android_det['height']:.4f} vs Python {python_det['height']:.4f} (diff {h_diff:.4f})")
                elif android_det and not python_det:
                    print(f"{class_name.upper()}: [DIFF] ANDROID HA RILEVAZIONE, PYTHON NO")
                elif not android_det and python_det:
                    print(f"{class_name.upper()}: [DIFF] PYTHON HA RILEVAZIONE, ANDROID NO")
                else:
                    print(f"{class_name.upper()}: [OK] NESSUNA RILEVAZIONE (entrambi)")
        else:
            print("\n[INFO] Il metadata Android non contiene le rilevazioni finali.")
            print("Per confrontare le rilevazioni, esegui il benchmark Android e confronta il CSV.")

    except FileNotFoundError:
        print(f"File {ANDROID_METADATA} non trovato.")
        print("Esegui il benchmark Android per generarlo.")
    
    return 0


if __name__ == "__main__":
    sys.exit(main())
