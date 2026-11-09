#!/usr/bin/env python3
"""
Test diagnostico per il frame 85: riproduce la sequenza completa con stato adattivo.
Confronta lo stato del decoder Python dopo 84 frame con i log Android.
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

# Dimensioni del frame originale (da YOLO_DECODE_INVESTIGATION.md)
SOURCE_WIDTH = 1024
SOURCE_HEIGHT = 576


class AppCompatibleDecoder:
    """Port di AppCompatibleDecoder da benchmark_yolo_videos.py con logging diagnostico."""

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
        self.inference_counter = 0

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

    def _update_threshold(self, name: str, detected: bool, confidence: float | None) -> None:
        history = self.history[name]
        confidences = self.confidence_history[name]
        history.append(detected)
        if detected and confidence is not None:
            confidences.append(confidence)
        if len(history) > self.window_size:
            history.pop(0)
            if len(confidences) > self.window_size:
                confidences.pop(0)
        detection_rate = sum(history) / len(history)
        avg_confidence = sum(confidences) / len(confidences) if confidences else 0.0
        current = self.threshold[name]
        base = self.base[name]
        new = current
        if detection_rate > 0.7 and avg_confidence > self.high_conf_threshold:
            target = min(base * 2, self.max_threshold)
            new = current + (target - current) * self.adjustment_factor
        elif detection_rate < 0.3:
            target = max(base * 0.5, self.min_threshold)
            new = current + (target - current) * self.adjustment_factor
        elif avg_confidence > self.high_conf_threshold and len(confidences) > 5:
            new = current + (base - current) * self.adjustment_factor * 0.5
        elif avg_confidence < self.low_conf_threshold and len(confidences) > 5:
            new = current + (base * 0.5 - current) * self.adjustment_factor * 0.5
        self.threshold[name] = max(self.min_threshold, min(self.max_threshold, new))

    def decode(self, raw: np.ndarray, frame_w: int, frame_h: int, target_frame: int = None) -> dict:
        self.inference_counter += 1
        output = raw
        n = output.shape[0]
        results = {"ball": None, "player": None, "rim": None}
        if n <= 0:
            return results

        tensor_size_by_anchors = {8400: 640, 5376: 512, 4116: 448, 3024: 384, 2100: 320}
        tensor_size = tensor_size_by_anchors.get(n, 512)
        scale = min(tensor_size / frame_w, tensor_size / frame_h)
        resized_w = frame_w * scale
        resized_h = frame_h * scale
        offset_x = (tensor_size - resized_w) / 2 if resized_w < tensor_size else 0.0
        offset_y = (tensor_size - resized_h) / 2 if resized_h < tensor_size else 0.0
        resolution_scale = tensor_size / 512
        best = {"ball": None, "player": None, "rim": None}

        # DIAGNOSTIC: Log state before parsing for frame 85
        if self.inference_counter == 85:
            print(f"[PYTHON] FRAME {target_frame} DIAGNOSTIC - Before parsing")
            print(f"  inferenceCounter: {self.inference_counter}")
            print(f"  adaptiveBallThreshold: {self.threshold['ball']:.6f}")
            print(f"  adaptivePlayerThreshold: {self.threshold['player']:.6f}")
            print(f"  baseBallThreshold: {self.base['ball']:.6f}")
            print(f"  ballDetectionHistory: {self.history['ball']}")
            print(f"  ballConfidenceHistory: {[f'{c:.4f}' for c in self.confidence_history['ball']]}")

        # DIAGNOSTIC: Track candidates with score 1.0 for frame 85
        ball_candidates_with_score1 = []

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
                current = best["ball"]
                if current is None or scores["ball"] > current["confidence"]:
                    best["ball"] = {
                        "x": cx_frame, "y": cy_frame, "width": w_frame, "height": h_frame,
                        "confidence": scores["ball"], "anchor_index": float(idx), "anchor_count": float(n),
                    }

            # DIAGNOSTIC: Track candidates with score 1.0 for frame 85
            if self.inference_counter == 85 and scores["ball"] >= 0.9999:
                ball_candidates_with_score1.append({
                    "index": idx,
                    "confidence": scores["ball"],
                    "x": cx_frame,
                    "y": cy_frame,
                    "width": w_frame,
                    "height": h_frame
                })

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
        results["ball"] = ball
        results["player"] = best["player"]
        results["rim"] = best["rim"] if self.rim_enabled else None

        # Update adaptive thresholds
        self._update_threshold("ball", best["ball"] is not None,
                               best["ball"]["confidence"] if best["ball"] else None)
        self._update_threshold("player", best["player"] is not None,
                               best["player"]["confidence"] if best["player"] else None)
        self._update_threshold("rim", best["rim"] is not None,
                               best["rim"]["confidence"] if best["rim"] else None)

        # DIAGNOSTIC: Log state after parsing for frame 85
        if self.inference_counter == 85:
            print(f"\n[PYTHON] FRAME {target_frame} DIAGNOSTIC - After parsing")
            print(f"  ball (local var): {ball}")
            print(f"  results['ball'] (before return): {results['ball']}")
            print(f"  bestBall: {best['ball']}")
            print(f"  bestPlayer: {best['player']}")
            print(f"  ballCandidatesWithScore1Count: {len(ball_candidates_with_score1)}")
            if ball_candidates_with_score1:
                print(f"  ballCandidatesWithScore1 (first 5):")
                for i, cand in enumerate(ball_candidates_with_score1[:5]):
                    print(f"    [{i}] index={cand['index']}, conf={cand['confidence']:.6f}, x={cand['x']:.4f}, y={cand['y']:.4f}")
            post_threshold = self._size_threshold(
                ball["width"], ball["height"], 0.005, 0.01, 0.30, 1.0
            ) if ball else None
            print(f"  postSelectionThreshold: {post_threshold}")
            print(f"  adaptiveBallThresholdAfter: {self.threshold['ball']:.6f}")
            print(f"  id(ball): {id(ball)}, id(results['ball']): {id(results['ball'])}")

        return results


def preprocess(frame_bgr: np.ndarray, width: int, height: int) -> np.ndarray:
    """OpenCV-based letterbox preprocessing (simplified for diagnostic)."""
    source_h, source_w = frame_bgr.shape[:2]
    scale = min(width / source_w, height / source_h)
    resized_w = max(1, int(round(source_w * scale)))
    resized_h = max(1, int(round(source_h * scale)))
    resized = cv2.resize(frame_bgr, (resized_w, resized_h), interpolation=cv2.INTER_LINEAR)
    resized = cv2.cvtColor(resized, cv2.COLOR_BGR2RGB)

    tensor = np.zeros((height, width, 3), dtype=np.float32)
    left = (width - resized_w) // 2
    top = (height - resized_h) // 2
    tensor[top:top + resized_h, left:left + resized_w] = resized.astype(np.float32)
    return np.expand_dims(tensor, axis=0)


def main():
    print("=== DIAGNOSTICO FRAME 85 - IMMAGINE JPEG SINGOLA ===\n")

    try:
        import tensorflow as tf
    except ImportError as e:
        print(f"ERRORE: {e}")
        return 1

    # Load model
    print(f"Caricamento modello TFLite da {MODEL_PATH}")
    interpreter = tf.lite.Interpreter(model_path=MODEL_PATH)
    interpreter.allocate_tensors()

    input_details = interpreter.get_input_details()
    output_details = interpreter.get_output_details()
    input_w, input_h = input_details[0]['shape'][2], input_details[0]['shape'][1]

    # Load JPEG image (same frame used in Android test)
    print(f"Caricamento JPEG da {JPEG_PATH}")
    frame_bgr = cv2.imread(JPEG_PATH)
    if frame_bgr is None:
        print(f"ERRORE: Impossibile leggere {JPEG_PATH}")
        return 1

    # Preprocess and run inference
    tensor = preprocess(frame_bgr, input_w, input_h)
    interpreter.set_tensor(input_details[0]['index'], tensor)
    interpreter.invoke()
    output = interpreter.get_tensor(output_details[0]['index'])
    output_transposed = output.squeeze().T  # (1, 7, 8400) -> (8400, 7)

    # Decode with diagnostic logging (single frame, no adaptive state)
    decoder = AppCompatibleDecoder()
    detections = decoder.decode(output_transposed, SOURCE_WIDTH, SOURCE_HEIGHT, target_frame=85)

    print(f"\n--- RILEVAZIONI PYTHON FRAME 85 (JPEG) ---")
    print(f"[VERIFY] detections['ball'] immediately after decode: {detections['ball']}")
    for class_name, detection in detections.items():
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

    # Compare with Android if metadata available
    try:
        with open(ANDROID_METADATA, 'r') as f:
            android_metadata = json.load(f)

        if 'detections' in android_metadata:
            print(f"\n--- CONFRONTO CON ANDROID ---")
            android_detections = android_metadata['detections']

            for class_name in ['ball', 'player', 'rim']:
                android_det = android_detections[class_name]
                python_det = detections[class_name]

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
    except FileNotFoundError:
        print(f"\n[INFO] File {ANDROID_METADATA} non trovato. Confronto non disponibile.")

    return 0


if __name__ == "__main__":
    sys.exit(main())
