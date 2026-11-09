#!/usr/bin/env python3
"""
Registra detection intermedie per 33 frame di "Tiro a centrocampo".
Per ogni frame registra:
- Detection prima del post-processing (raw candidates)
- Detection dopo il post-processing (thresholds/filtri)
- Detection finale (dopo filtri temporali)
"""

import numpy as np
import cv2
import sys
import json
import math
from pathlib import Path
from typing import Dict, List, Any

# Configurazione
VIDEO_DIR = "assets/benchmark-images/Tiro a centrocampo"
MODEL_PATH = "assets/models/best_640_float16.tflite"
OUTPUT_FILE = "intermediate_detections_python.json"

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


class IntermediateDecoder:
    """Decoder che registra detection intermedie."""

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

    def decode_with_intermediates(self, raw: np.ndarray, frame_w: int, frame_h: int) -> Dict[str, Any]:
        """Decodifica con registrazione di detection intermedie."""
        output = raw
        n = output.shape[0]
        
        tensor_size_by_anchors = {8400: 640, 5376: 512, 4116: 448, 3024: 384, 2100: 320}
        tensor_size = tensor_size_by_anchors.get(n, 512)
        scale = min(tensor_size / frame_w, tensor_size / frame_h)
        resized_w = frame_w * scale
        resized_h = frame_h * scale
        offset_x = (tensor_size - resized_w) / 2 if resized_w < tensor_size else 0.0
        offset_y = (tensor_size - resized_h) / 2 if resized_h < tensor_size else 0.0
        resolution_scale = tensor_size / 512
        
        # Raw candidates (prima di qualsiasi filtro)
        raw_candidates = []
        
        best = {"ball": None, "player": None, "rim": None}
        
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
            
            # Registra raw candidates con score > 0.01
            for class_name in ["ball", "player", "rim"]:
                if scores[class_name] > 0.01:
                    raw_candidates.append({
                        "class": class_name,
                        "anchor_index": int(idx),
                        "confidence": scores[class_name],
                        "x": cx_frame,
                        "y": cy_frame,
                        "width": w_frame,
                        "height": h_frame
                    })
            
            # Ball filtering
            ball_threshold = self._size_threshold(
                w_frame, h_frame, self.threshold["ball"], 0.10, 0.40, resolution_scale
            )
            geometry_ok = self._valid_ball_geometry(w_frame, h_frame)
            threshold_ok = scores["ball"] >= ball_threshold
            
            if geometry_ok and threshold_ok:
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
        
        # Post-selection ball filter
        ball = best["ball"]
        if ball is not None:
            if not self._valid_ball_geometry(ball["width"], ball["height"]):
                ball = None
            else:
                post_threshold = self._size_threshold(
                    ball["width"], ball["height"], 0.005, 0.01, 0.30, 1.0
                )
                if ball["confidence"] < post_threshold:
                    ball = None
        
        return {
            "raw_candidates": raw_candidates,
            "before_post_selection": {
                "ball": best["ball"],
                "player": best["player"],
                "rim": best["rim"] if self.rim_enabled else None
            },
            "final": {
                "ball": ball,
                "player": best["player"],
                "rim": best["rim"] if self.rim_enabled else None
            }
        }


def main():
    print("=== REGISTRAZIONE DETECTION INTERMEDIE (33 FRAME) ===\n")
    
    try:
        import tensorflow as tf
    except ImportError as e:
        print(f"ERRORE: {e}")
        return 1
    
    # Carica modello
    print(f"Caricamento modello TFLite da {MODEL_PATH}")
    interpreter = tf.lite.Interpreter(model_path=MODEL_PATH)
    interpreter.allocate_tensors()
    
    input_details = interpreter.get_input_details()
    output_details = interpreter.get_output_details()
    
    # Ottieni tutti i frame
    video_dir = Path(VIDEO_DIR)
    frame_files = sorted(video_dir.glob("frame_*.jpg"))
    
    print(f"Trovati {len(frame_files)} frame")
    
    decoder = IntermediateDecoder()
    all_detections = {}
    
    for frame_file in frame_files:
        frame_name = frame_file.stem
        print(f"\nElaborazione {frame_name}...")
        
        # Carica e preprocessa
        frame_bgr = cv2.imread(str(frame_file))
        frame_rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
        rgb_float32 = frame_rgb.astype(np.float32).flatten()
        
        tensor = letterbox_rgb_to_yolo_input(
            rgb_float32,
            SOURCE_WIDTH,
            SOURCE_HEIGHT,
            TARGET_SIZE
        )
        tensor = tensor.reshape(1, TARGET_SIZE, TARGET_SIZE, 3)
        
        # Inferenza
        interpreter.set_tensor(input_details[0]['index'], tensor)
        interpreter.invoke()
        output = interpreter.get_tensor(output_details[0]['index'])
        
        # Decodifica con intermedi
        output_transposed = output.squeeze().T
        detections = decoder.decode_with_intermediates(output_transposed, SOURCE_WIDTH, SOURCE_HEIGHT)
        
        all_detections[frame_name] = detections
    
    # Salva risultati
    with open(OUTPUT_FILE, 'w') as f:
        json.dump(all_detections, f, indent=2)
    
    print(f"\nRisultati salvati in {OUTPUT_FILE}")
    print(f"Totali frame elaborati: {len(all_detections)}")
    
    # Statistiche
    total_raw = sum(len(d["raw_candidates"]) for d in all_detections.values())
    total_ball_final = sum(1 for d in all_detections.values() if d["final"]["ball"] is not None)
    total_player_final = sum(1 for d in all_detections.values() if d["final"]["player"] is not None)
    
    print(f"\n--- STATISTICHE ---")
    print(f"Totali raw candidates: {total_raw}")
    print(f"Frame con ball finale: {total_ball_final}/{len(all_detections)}")
    print(f"Frame con player finale: {total_player_final}/{len(all_detections)}")
    
    return 0


if __name__ == "__main__":
    sys.exit(main())
