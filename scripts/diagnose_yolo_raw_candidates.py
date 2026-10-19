#!/usr/bin/env python3
"""Inspect raw YOLO TFLite candidates before the app-compatible filters.

Runs the actual TFLite file on sampled video frames, saves every class's top-K
raw anchors to CSV, and renders the top candidates on original frames. This is
diagnostic only: preprocessing is OpenCV letterbox and may differ from the app.
"""
from __future__ import annotations

import argparse
import csv
import json
import math
from pathlib import Path

import cv2
import numpy as np

CLASS_NAMES = ("ball", "player", "rim")


def preprocess(frame, size, input_scale, pad_value):
    h, w = frame.shape[:2]
    scale = min(size / w, size / h)
    rw, rh = max(1, round(w * scale)), max(1, round(h * scale))
    resized = cv2.resize(frame, (rw, rh), interpolation=cv2.INTER_LINEAR)
    resized = cv2.cvtColor(resized, cv2.COLOR_BGR2RGB).astype(np.float32) * input_scale
    tensor = np.full((size, size, 3), pad_value, dtype=np.float32)
    left, top = (size - rw) // 2, (size - rh) // 2
    tensor[top:top + rh, left:left + rw] = resized
    return tensor[None, ...], {"scale": scale, "left": left, "top": top, "size": size}


def normalize(raw):
    out = np.asarray(raw).squeeze()
    if out.ndim != 2:
        raise ValueError(f"Output TFLite inatteso: {out.shape}")
    if out.shape[0] == 7:
        return out
    if out.shape[1] == 7:
        return out.T
    raise ValueError(f"Atteso output [7,N] o [N,7], ricevuto {out.shape}")


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--model", required=True, type=Path)
    ap.add_argument("--videos", nargs="+", required=True, type=Path)
    ap.add_argument("--output-dir", type=Path, default=Path("benchmark-results/yolo-raw-diagnostics"))
    ap.add_argument("--every-n-frames", type=int, default=5)
    ap.add_argument("--top-k", type=int, default=10)
    ap.add_argument("--threads", type=int, default=2)
    ap.add_argument("--input-scale", type=float, default=1.0)
    ap.add_argument("--pad-value", type=float, default=114.0)
    ap.add_argument("--min-score", type=float, default=0.001)
    args = ap.parse_args()
    if args.every_n_frames < 1 or args.top_k < 1:
        ap.error("--every-n-frames e --top-k devono essere >= 1")

    try:
        import tensorflow as tf
    except ImportError as exc:
        raise SystemExit("TensorFlow mancante. Esegui: python -m pip install tensorflow opencv-python numpy") from exc

    interpreter = tf.lite.Interpreter(model_path=str(args.model), num_threads=args.threads)
    interpreter.allocate_tensors()
    inp = interpreter.get_input_details()[0]
    out_detail = interpreter.get_output_details()[0]
    shape = [int(x) for x in inp["shape"]]
    if len(shape) != 4 or shape[0] != 1 or shape[-1] != 3:
        raise SystemExit(f"Input non supportato: {shape}; atteso NHWC [1,H,W,3]")
    size = shape[1]
    if np.dtype(inp["dtype"]) != np.dtype(np.float32):
        raise SystemExit(f"Input dtype {inp['dtype']} non supportato: script diagnostico atteso float32")

    args.output_dir.mkdir(parents=True, exist_ok=True)
    csv_path = args.output_dir / f"{args.model.stem}_raw_candidates.csv"
    manifest = {
        "model": str(args.model), "model_sha256": None,
        "input_shape": shape, "input_dtype": str(inp["dtype"]),
        "output_shape": [int(x) for x in out_detail["shape"]],
        "output_dtype": str(out_detail["dtype"]), "class_index_assumption": {
            "4": "ball", "5": "player/human", "6": "rim"
        },
        "preprocessing": "OpenCV RGB, centered contain/letterbox, float32",
        "input_scale": args.input_scale, "pad_value_after_scaling": args.pad_value,
        "top_k_per_class_per_frame": args.top_k,
        "warning": "Class order and coordinate encoding are assumptions to verify; not proof of app equivalence."
    }
    import hashlib
    h = hashlib.sha256()
    with args.model.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    manifest["model_sha256"] = h.hexdigest()

    fields = ["video", "frame_index", "class_assumption", "class_index", "rank", "anchor_index",
              "confidence_raw", "cx_raw", "cy_raw", "w_raw", "h_raw",
              "cx_frame_px_assuming_normalized", "cy_frame_px_assuming_normalized",
              "x1_frame_px_assuming_normalized", "y1_frame_px_assuming_normalized",
              "x2_frame_px_assuming_normalized", "y2_frame_px_assuming_normalized"]
    total = 0
    with csv_path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=fields)
        writer.writeheader()
        for video in args.videos:
            cap = cv2.VideoCapture(str(video))
            if not cap.isOpened():
                print(f"[warning] Video non apribile: {video}")
                continue
            video_dir = args.output_dir / video.stem
            video_dir.mkdir(parents=True, exist_ok=True)
            frame_index = 0
            rendered = 0
            while True:
                ok, frame = cap.read()
                if not ok:
                    break
                if frame_index % args.every_n_frames == 0:
                    tensor, lb = preprocess(frame, size, args.input_scale, args.pad_value)
                    interpreter.set_tensor(inp["index"], tensor)
                    interpreter.invoke()
                    raw = normalize(interpreter.get_tensor(out_detail["index"]))
                    overlay = frame.copy()
                    fh0, fw0 = frame.shape[:2]
                    scale, left, top = lb["scale"], lb["left"], lb["top"]
                    for ci, cname in enumerate(CLASS_NAMES):
                        scores = raw[4 + ci]
                        finite = np.where(np.isfinite(scores), scores, -np.inf)
                        inds = np.argsort(finite)[::-1][:args.top_k]
                        rank = 0
                        for idx in inds:
                            score = float(scores[idx])
                            if not math.isfinite(score) or score < args.min_score:
                                continue
                            cx, cy, bw, bh = [float(raw[k, idx]) for k in range(4)]
                            # Preserve raw values; this transform assumes normalized xywh.
                            cxp = (cx * size - left) / scale
                            cyp = (cy * size - top) / scale
                            bwp, bhp = bw * size / scale, bh * size / scale
                            x1, y1 = int(round(cxp - bwp/2)), int(round(cyp - bhp/2))
                            x2, y2 = int(round(cxp + bwp/2)), int(round(cyp + bhp/2))
                            rank += 1
                            writer.writerow({
                                "video": str(video), "frame_index": frame_index,
                                "class_assumption": cname, "class_index": ci, "rank": rank,
                                "anchor_index": int(idx), "confidence_raw": score,
                                "cx_raw": cx, "cy_raw": cy, "w_raw": bw, "h_raw": bh,
                                "cx_frame_px_assuming_normalized": cxp, "cy_frame_px_assuming_normalized": cyp,
                                "x1_frame_px_assuming_normalized": x1, "y1_frame_px_assuming_normalized": y1,
                                "x2_frame_px_assuming_normalized": x2, "y2_frame_px_assuming_normalized": y2,
                            })
                            if rank <= min(args.top_k, 5) and bwp > 0 and bhp > 0:
                                color = ((0, 220, 255), (60, 220, 60), (255, 180, 0))[ci]
                                cv2.rectangle(overlay, (max(0,x1), max(0,y1)),
                                              (min(fw0-1,x2), min(fh0-1,y2)), color, 2)
                                cv2.putText(overlay, f"{cname}#{rank} {score:.3f}",
                                            (max(0,x1), max(18,y1-5)), cv2.FONT_HERSHEY_SIMPLEX,
                                            0.5, color, 2, cv2.LINE_AA)
                    out_img = video_dir / f"frame_{frame_index:06d}.jpg"
                    cv2.imwrite(str(out_img), overlay)
                    rendered += 1
                    total += 1
                frame_index += 1
            cap.release()
            print(f"[ok] {video.name}: {rendered} frame -> {video_dir}")
    manifest["sampled_frames_rendered"] = total
    (args.output_dir / f"{args.model.stem}_manifest.json").write_text(
        json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"[ok] CSV raw candidates: {csv_path}")
    print(f"[ok] Manifest: {args.output_dir / f'{args.model.stem}_manifest.json'}")


if __name__ == "__main__":
    main()
