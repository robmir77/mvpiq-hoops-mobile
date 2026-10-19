#!/usr/bin/env python3
"""Offline YOLO TFLite video benchmark for MVPiQ.

Dependencies (install in a separate Python environment):
    pip install opencv-python numpy tensorflow

Example:
    python scripts/benchmark_yolo_videos.py \
      --models assets/models/best_384_float16.tflite assets/models/best_640_float16.tflite \
      --videos "src/vision/__tests__/media/Tiro Libero.mp4" \
              "src/vision/__tests__/media/Tiro da 3.mp4" \
              "src/vision/__tests__/media/Tirp a centrocampo.mp4" \
      --every-n-frames 5 --warmup 5 --output-dir benchmark-results/yolo-ab

Important:
- This is an offline, CPU/default-delegate benchmark, not an on-device FPS test.
- The resize/letterbox and input value range must be verified against the native
  react-native-vision-camera-resizer output before treating accuracy numbers as
  equivalent to the app. Use --input-scale to explicitly set value scaling.
- The default app-compatible decoder ports the selection/filter logic from
  YoloDetector.ts and BallDetectionProcessor.ts. The diagnostic decoder remains
  available with --decoder diagnostic.
- Preprocessing is still OpenCV-based and must be checked against the native
  resizer before claiming full input-path equivalence.
- No precision/recall is reported without manually annotated ground-truth boxes.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import statistics
import sys
import time
from pathlib import Path
from typing import Any

import cv2
import numpy as np

CLASS_NAMES = ("ball", "player", "rim")
DEFAULT_THRESHOLDS = {"ball": 0.001, "player": 0.03, "rim": 0.30}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def percentile(values: list[float], p: float) -> float | None:
    if not values:
        return None
    return float(np.percentile(np.asarray(values, dtype=np.float64), p))


def model_input_size(detail: dict[str, Any]) -> tuple[int, int]:
    shape = [int(v) for v in detail["shape"]]
    if len(shape) != 4 or shape[0] != 1 or shape[-1] != 3:
        raise ValueError(f"Expected NHWC input [1,H,W,3], got {shape}")
    return shape[2], shape[1]


def preprocess(frame_bgr: np.ndarray, width: int, height: int,
               input_scale: float, pad_value: float) -> tuple[np.ndarray, dict[str, float]]:
    """RGB letterbox/contain preprocessing; parameters are recorded per run."""
    source_h, source_w = frame_bgr.shape[:2]
    scale = min(width / source_w, height / source_h)
    resized_w = max(1, int(round(source_w * scale)))
    resized_h = max(1, int(round(source_h * scale)))
    resized = cv2.resize(frame_bgr, (resized_w, resized_h), interpolation=cv2.INTER_LINEAR)
    resized = cv2.cvtColor(resized, cv2.COLOR_BGR2RGB)

    tensor = np.full((height, width, 3), pad_value, dtype=np.float32)
    left = (width - resized_w) // 2
    top = (height - resized_h) // 2
    tensor[top:top + resized_h, left:left + resized_w] = resized.astype(np.float32) * input_scale

    return np.expand_dims(tensor, axis=0), {
        "scale": scale, "resized_width": resized_w, "resized_height": resized_h,
        "pad_left": left, "pad_top": top,
    }


def normalize_output(raw: np.ndarray) -> np.ndarray:
    """Return output as [7, anchors], matching YoloDetector.parseOutput layout."""
    output = np.asarray(raw).squeeze()
    if output.ndim != 2:
        raise ValueError(f"Expected 2D YOLO output after squeeze, got {output.shape}")
    if output.shape[0] == 7:
        return output.astype(np.float32, copy=False)
    if output.shape[1] == 7:
        return output.T.astype(np.float32, copy=False)
    raise ValueError(f"Expected YOLO output [7,N] or [N,7], got {output.shape}")


def decode_top_detections(raw: np.ndarray, input_w: int, input_h: int,
                          frame_w: int, frame_h: int,
                          letterbox: dict[str, float]) -> dict[str, dict[str, float] | None]:
    """Diagnostic decoder: top confidence box per class, converted to normalized frame coords."""
    output = normalize_output(raw)
    n = output.shape[1]
    results: dict[str, dict[str, float] | None] = {name: None for name in CLASS_NAMES}
    thresholds = DEFAULT_THRESHOLDS
    scale = letterbox["scale"]
    pad_left = letterbox["pad_left"]
    pad_top = letterbox["pad_top"]

    for class_index, class_name in enumerate(CLASS_NAMES):
        scores = output[4 + class_index]
        if scores.size == 0:
            continue
        idx = int(np.argmax(scores))
        confidence = float(scores[idx])
        if not math.isfinite(confidence) or confidence < thresholds[class_name]:
            continue

        cx = float(output[0, idx]) * input_w
        cy = float(output[1, idx]) * input_h
        bw = float(output[2, idx]) * input_w
        bh = float(output[3, idx]) * input_h
        # Reverse the contain/letterbox transform, then normalize to source frame.
        cx_frame = (cx - pad_left) / scale
        cy_frame = (cy - pad_top) / scale
        bw_frame = bw / scale
        bh_frame = bh / scale
        x = cx_frame / frame_w
        y = cy_frame / frame_h
        w = bw_frame / frame_w
        h = bh_frame / frame_h
        if not all(math.isfinite(v) for v in (x, y, w, h)) or w <= 0 or h <= 0:
            continue
        results[class_name] = {
            "x": x, "y": y, "width": w, "height": h, "confidence": confidence,
            "anchor_index": float(idx), "anchor_count": float(n),
        }
    return results


class AppCompatibleDecoder:
    """Stateful Python port of YoloDetector.parseOutput + BallDetectionProcessor.

    This matches selection/filter logic, not the native app's image preprocessing
    or runtime/delegate. State is reset for each video, like a new session.
    """

    def __init__(self) -> None:
        self.base = {"ball": 0.001, "player": 0.03, "rim": 0.30}
        self.threshold = dict(self.base)
        self.history: dict[str, list[bool]] = {k: [] for k in CLASS_NAMES}
        self.confidence_history: dict[str, list[float]] = {k: [] for k in CLASS_NAMES}
        self.window_size = 15
        self.min_threshold = 0.0005
        self.max_threshold = 0.50
        self.adjustment_factor = 0.2
        self.high_conf_threshold = 0.7
        self.low_conf_threshold = 0.2
        self.rim_enabled = False  # VISION_CONFIG.RIM_DETECTION_ENABLED

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

    def decode(self, raw: np.ndarray, frame_w: int, frame_h: int) -> dict[str, dict[str, float] | None]:
        output = normalize_output(raw)
        n = output.shape[1]
        results: dict[str, dict[str, float] | None] = {name: None for name in CLASS_NAMES}
        if n <= 0:
            return results
        tensor_size_by_anchors = {8400: 640, 5376: 512, 4116: 448, 3024: 384, 2100: 320}
        tensor_size = tensor_size_by_anchors.get(n, 512)
        scale = min(tensor_size / (frame_w or 1280), tensor_size / (frame_h or 720))
        resized_w = (frame_w or 1280) * scale
        resized_h = (frame_h or 720) * scale
        offset_x = (tensor_size - resized_w) / 2 if resized_w < tensor_size else 0.0
        offset_y = (tensor_size - resized_h) / 2 if resized_h < tensor_size else 0.0
        resolution_scale = tensor_size / 512
        best: dict[str, dict[str, float] | None] = {name: None for name in CLASS_NAMES}

        for idx in range(n):
            cx, cy, bw, bh = (float(output[k, idx]) for k in range(4))
            scores = {"ball": float(output[4, idx]), "player": float(output[5, idx]), "rim": float(output[6, idx])}
            cx_frame = ((cx * tensor_size) - offset_x) / scale / (frame_w or 1280)
            cy_frame = ((cy * tensor_size) - offset_y) / scale / (frame_h or 720)
            w_frame = (bw * tensor_size) / scale / (frame_w or 1280)
            h_frame = (bh * tensor_size) / scale / (frame_h or 720)
            if not all(math.isfinite(v) for v in (cx_frame, cy_frame, w_frame, h_frame)):
                continue
            if w_frame <= 0.01 or h_frame <= 0.01:
                continue

            # YoloDetector chooses the highest-confidence candidate among those
            # passing each class's filters, rather than argmax over raw scores.
            ball_threshold = self._size_threshold(
                w_frame, h_frame, self.threshold["ball"], 0.10, 0.40, resolution_scale
            )
            if self._valid_ball_geometry(w_frame, h_frame) and scores["ball"] >= ball_threshold:
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

            if self.rim_enabled and scores["rim"] >= self.threshold["rim"]:
                current = best["rim"]
                if current is None or scores["rim"] > current["confidence"]:
                    best["rim"] = {
                        "x": cx_frame, "y": cy_frame, "width": w_frame, "height": h_frame,
                        "confidence": scores["rim"], "anchor_index": float(idx), "anchor_count": float(n),
                    }

        # BallDetectionProcessor runs AFTER YoloDetector has selected its best
        # ball; if it rejects that result, app code does not fall back to #2.
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

        self._update_threshold("ball", best["ball"] is not None,
                               best["ball"]["confidence"] if best["ball"] else None)
        self._update_threshold("player", best["player"] is not None,
                               best["player"]["confidence"] if best["player"] else None)
        self._update_threshold("rim", best["rim"] is not None,
                               best["rim"]["confidence"] if best["rim"] else None)
        return results


def make_interpreter(model_path: Path, threads: int):
    try:
        import tensorflow as tf
    except ImportError as exc:
        raise RuntimeError(
            "TensorFlow non è installato nell'ambiente Python. "
            "Installa le dipendenze con: pip install opencv-python numpy tensorflow"
        ) from exc
    interpreter = tf.lite.Interpreter(model_path=str(model_path), num_threads=threads)
    interpreter.allocate_tensors()
    return interpreter


def benchmark_one(model_path: Path, videos: list[Path], output_dir: Path,
                  every_n_frames: int, warmup: int, threads: int,
                  input_scale: float, pad_value: float, decoder_mode: str) -> dict[str, Any]:
    interpreter = make_interpreter(model_path, threads)
    input_detail = interpreter.get_input_details()[0]
    output_detail = interpreter.get_output_details()[0]
    input_w, input_h = model_input_size(input_detail)
    if np.dtype(input_detail["dtype"]) != np.dtype(np.float32):
        raise ValueError(
            f"{model_path.name}: input dtype {input_detail['dtype']} non supportato da questo runner; "
            "il benchmark corrente è pensato per input float32."
        )

    model_name = model_path.stem
    rows: list[dict[str, Any]] = []
    inference_ms: list[float] = []
    warmup_done = 0
    first_input_stats: dict[str, float] | None = None
    output_shape = [int(v) for v in output_detail["shape"]]
    model_record: dict[str, Any] = {
        "model": str(model_path),
        "model_sha256": sha256_file(model_path),
        "model_size_bytes": model_path.stat().st_size,
        "input_shape": [int(v) for v in input_detail["shape"]],
        "input_dtype": str(input_detail["dtype"]),
        "output_shape": output_shape,
        "output_dtype": str(output_detail["dtype"]),
        "num_threads": threads,
        "input_scale": input_scale,
        "pad_value_after_scaling": pad_value,
        "preprocessing": "RGB, OpenCV linear resize, contain/letterbox, centered padding",
        "decoder_mode": decoder_mode,
        "thresholds": DEFAULT_THRESHOLDS,
        "videos": [],
    }

    for video_path in videos:
        cap = cv2.VideoCapture(str(video_path))
        if not cap.isOpened():
            raise RuntimeError(f"Impossibile aprire il video: {video_path}")
        fps = float(cap.get(cv2.CAP_PROP_FPS) or 0.0)
        frame_count_reported = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        video_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
        video_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
        video_hash = sha256_file(video_path)
        video_record = {
            "path": str(video_path),
            "sha256": video_hash,
            "size_bytes": video_path.stat().st_size,
            "width": video_w, "height": video_h, "fps_reported": fps,
            "frame_count_reported": frame_count_reported,
            "duration_seconds_reported": (frame_count_reported / fps) if fps > 0 else None,
            "sampled_frames": 0,
        }
        frame_index = 0
        app_decoder = AppCompatibleDecoder() if decoder_mode == "app-compatible" else None
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            if frame_index % every_n_frames == 0:
                tensor, letterbox = preprocess(frame, input_w, input_h, input_scale, pad_value)
                if first_input_stats is None:
                    first_input_stats = {
                        "min": float(tensor.min()), "max": float(tensor.max()),
                        "mean": float(tensor.mean()),
                    }
                interpreter.set_tensor(input_detail["index"], tensor)
                started = time.perf_counter()
                interpreter.invoke()
                elapsed_ms = (time.perf_counter() - started) * 1000.0
                raw_output = interpreter.get_tensor(output_detail["index"])
                # Decode every sampled frame so adaptive state evolves during warm-up too.
                if decoder_mode == "app-compatible":
                    assert app_decoder is not None
                    decoded = app_decoder.decode(raw_output, frame.shape[1], frame.shape[0])
                else:
                    decoded = decode_top_detections(
                        raw_output, input_w, input_h, frame.shape[1], frame.shape[0], letterbox
                    )
                if warmup_done < warmup:
                    warmup_done += 1
                else:
                    inference_ms.append(elapsed_ms)
                    for class_name, detection in decoded.items():
                        row: dict[str, Any] = {
                            "model": model_name,
                            "video": str(video_path),
                            "video_sha256": video_hash,
                            "frame_index": frame_index,
                            "timestamp_seconds": (frame_index / fps) if fps > 0 else "",
                            "inference_ms": round(elapsed_ms, 4),
                            "class_name": class_name,
                            "detected": detection is not None,
                            "confidence": detection["confidence"] if detection else "",
                            "x_center_norm": detection["x"] if detection else "",
                            "y_center_norm": detection["y"] if detection else "",
                            "width_norm": detection["width"] if detection else "",
                            "height_norm": detection["height"] if detection else "",
                            "anchor_index": detection["anchor_index"] if detection else "",
                            "anchor_count": detection["anchor_count"] if detection else "",
                        }
                        rows.append(row)
                video_record["sampled_frames"] += 1
            frame_index += 1
        cap.release()
        video_record["frame_count_decoded"] = frame_index
        model_record["videos"].append(video_record)

    output_dir.mkdir(parents=True, exist_ok=True)
    csv_path = output_dir / f"{model_name}_detections.csv"
    fieldnames = [
        "model", "video", "video_sha256", "frame_index", "timestamp_seconds",
        "inference_ms", "class_name", "detected", "confidence",
        "x_center_norm", "y_center_norm", "width_norm", "height_norm",
        "anchor_index", "anchor_count",
    ]
    with csv_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    model_record["input_tensor_stats_first_frame"] = first_input_stats
    model_record["warmup_inferences_discarded"] = warmup_done
    model_record["measured_inferences"] = len(inference_ms)
    model_record["latency_ms"] = {
        "mean": statistics.fmean(inference_ms) if inference_ms else None,
        "median": statistics.median(inference_ms) if inference_ms else None,
        "p95": percentile(inference_ms, 95),
        "min": min(inference_ms) if inference_ms else None,
        "max": max(inference_ms) if inference_ms else None,
    }
    model_record["detections_csv"] = str(csv_path)
    model_record["interpretation_limit"] = (
        "App-compatible mode ports class-wise candidate filtering, adaptive confidence state, and the "
        "post-selection ball filter. It is not full app-path equivalence: OpenCV preprocessing, runtime/delegate, "
        "and device scheduling differ; no ground-truth precision/recall without annotations."
        if decoder_mode == "app-compatible" else
        "Diagnostic top-confidence decoder only: no app filters or adaptive thresholds; no ground-truth precision/recall."
    )
    return model_record


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--models", nargs="+", required=True, type=Path, help="Percorsi ai modelli .tflite")
    parser.add_argument("--videos", nargs="+", required=True, type=Path, help="Video MP4 da confrontare")
    parser.add_argument("--output-dir", type=Path, default=Path("benchmark-results/yolo-ab"))
    parser.add_argument(
        "--decoder", choices=("app-compatible", "diagnostic"), default="app-compatible",
        help="app-compatible replica la selezione/filtri del parser app; diagnostic mantiene il decoder argmax storico",
    )
    parser.add_argument("--every-n-frames", type=int, default=5, help="Inferenza ogni N frame (default: 5)")
    parser.add_argument("--warmup", type=int, default=5, help="Inferenze iniziali da scartare per ogni modello")
    parser.add_argument("--threads", type=int, default=2, help="Thread CPU TFLite (default: 2)")
    parser.add_argument(
        "--input-scale", type=float, default=1.0,
        help="Moltiplicatore dei pixel RGB (default 1.0; verificare contro il resizer nativo)"
    )
    parser.add_argument(
        "--pad-value", type=float, default=0.0,
        help="Valore del padding dopo input-scale (default 0)"
    )
    args = parser.parse_args()

    if args.every_n_frames < 1 or args.warmup < 0 or args.threads < 1:
        parser.error("--every-n-frames e --threads devono essere >= 1; --warmup deve essere >= 0")
    for path in [*args.models, *args.videos]:
        if not path.is_file():
            parser.error(f"File non trovato: {path}")
    if not args.models or not args.videos:
        parser.error("Specificare almeno un modello e un video")

    args.output_dir.mkdir(parents=True, exist_ok=True)
    manifest: dict[str, Any] = {
        "benchmark": "MVPiQ offline YOLO video benchmark",
        "created_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "sampling_every_n_frames": args.every_n_frames,
        "warmup_per_model": args.warmup,
        "preprocessing_options": {"input_scale": args.input_scale, "pad_value": args.pad_value},
        "decoder": args.decoder,
        "decoder_notes": (
            "App-compatible ports YoloDetector.ts + BallDetectionProcessor.ts logic, but OpenCV preprocessing "
            "and Python runtime are not proven equivalent to the native app path."
            if args.decoder == "app-compatible" else "Legacy diagnostic argmax-per-class decoder."
        ),
        "results": [],
    }
    for model_path in args.models:
        print(f"[benchmark] Modello: {model_path}", flush=True)
        result = benchmark_one(
            model_path, args.videos, args.output_dir, args.every_n_frames,
            args.warmup, args.threads, args.input_scale, args.pad_value, args.decoder,
        )
        manifest["results"].append(result)
        latency = result["latency_ms"]
        print(
            f"  inferenze={result['measured_inferences']} "
            f"mediana={latency['median']} ms P95={latency['p95']} ms "
            f"CSV={result['detections_csv']}",
            flush=True,
        )

    manifest_path = args.output_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"[benchmark] Manifest: {manifest_path}")
    print("[benchmark] Nessuna metrica precision/recall è calcolata senza ground truth annotata.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"ERRORE: {error}", file=sys.stderr)
        raise
