#!/usr/bin/env python3
"""Render YOLO benchmark CSV detections over sampled video frames.

The current benchmark CSV stores at most one detection per class and frame
(the highest-confidence candidate that survives the selected decoder's filters).
This renderer draws those detections and confidence values; it cannot recover
discarded candidates from an existing CSV.
"""
from __future__ import annotations

import argparse
import csv
import math
from collections import defaultdict
from pathlib import Path
from typing import Any

import cv2
import numpy as np

COLORS = {
    "ball": (0, 220, 255),
    "player": (80, 220, 80),
    "rim": (255, 160, 60),
}


def load_csv(path: Path) -> dict[tuple[str, int], list[dict[str, Any]]]:
    grouped: dict[tuple[str, int], list[dict[str, Any]]] = defaultdict(list)
    with path.open("r", newline="", encoding="utf-8-sig") as handle:
        for row in csv.DictReader(handle):
            key = (Path(row["video"].replace("\\", "/")).name, int(row["frame_index"]))
            grouped[key].append(row)
    return grouped


def draw_detections(frame: np.ndarray, rows: list[dict[str, Any]]) -> np.ndarray:
    image = frame.copy()
    height, width = image.shape[:2]
    for row in rows:
        if row.get("detected", "").lower() != "true":
            continue
        try:
            cx = float(row["x_center_norm"]) * width
            cy = float(row["y_center_norm"]) * height
            bw = float(row["width_norm"]) * width
            bh = float(row["height_norm"]) * height
            confidence = float(row["confidence"])
        except (TypeError, ValueError, KeyError):
            continue
        if not all(math.isfinite(v) for v in (cx, cy, bw, bh, confidence)) or bw <= 0 or bh <= 0:
            continue

        x1 = max(0, min(width - 1, int(round(cx - bw / 2))))
        y1 = max(0, min(height - 1, int(round(cy - bh / 2))))
        x2 = max(0, min(width - 1, int(round(cx + bw / 2))))
        y2 = max(0, min(height - 1, int(round(cy + bh / 2))))
        if x2 <= x1 or y2 <= y1:
            continue

        name = row.get("class_name", "object").lower()
        color = COLORS.get(name, (255, 255, 255))
        label = f"{name} {confidence:.3f}"
        cv2.rectangle(image, (x1, y1), (x2, y2), color, 2)
        (text_w, text_h), baseline = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.55, 2)
        label_y = max(text_h + 6, y1)
        cv2.rectangle(image, (x1, label_y - text_h - 6), (min(width - 1, x1 + text_w + 6), label_y + baseline), color, -1)
        cv2.putText(image, label, (x1 + 3, label_y - 3), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 0, 0), 2, cv2.LINE_AA)
    return image


def add_header(image: np.ndarray, text: str) -> np.ndarray:
    out = image.copy()
    cv2.rectangle(out, (0, 0), (out.shape[1], 34), (25, 25, 25), -1)
    cv2.putText(out, text, (10, 23), cv2.FONT_HERSHEY_SIMPLEX, 0.62, (255, 255, 255), 1, cv2.LINE_AA)
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--csv", nargs="+", required=True, type=Path, help="Uno o più CSV prodotti dal benchmark, uno per modello")
    parser.add_argument("--videos", nargs="+", required=True, type=Path, help="Video originali corrispondenti")
    parser.add_argument("--output-dir", type=Path, default=Path("benchmark-results/yolo-ab-app-compatible/visualizations"))
    args = parser.parse_args()

    for path in [*args.csv, *args.videos]:
        if not path.is_file():
            parser.error(f"File non trovato: {path}")

    csv_data = [(path.stem.replace("_detections", ""), load_csv(path)) for path in args.csv]
    args.output_dir.mkdir(parents=True, exist_ok=True)
    manifest: list[dict[str, Any]] = []

    for video_path in args.videos:
        cap = cv2.VideoCapture(str(video_path))
        if not cap.isOpened():
            raise RuntimeError(f"Impossibile aprire il video: {video_path}")
        video_name = video_path.name
        video_output = args.output_dir / video_path.stem
        video_output.mkdir(parents=True, exist_ok=True)
        written = 0

        # Gather only frame indices represented in at least one supplied CSV.
        frame_indices = sorted({
            frame_index
            for _, data in csv_data
            for (csv_video_name, frame_index) in data
            if csv_video_name == video_name
        })
        for frame_index in frame_indices:
            cap.set(cv2.CAP_PROP_POS_FRAMES, frame_index)
            ok, frame = cap.read()
            if not ok:
                print(f"[skip] {video_name}: impossibile leggere frame {frame_index}")
                continue

            panels = []
            for model_name, data in csv_data:
                rows = data.get((video_name, frame_index), [])
                panel = draw_detections(frame, rows)
                detections = sum(row.get("detected", "").lower() == "true" for row in rows)
                panel = add_header(panel, f"{model_name} | frame {frame_index} | detections: {detections}")
                panels.append(panel)

            # Keep original frame dimensions in each panel; join models horizontally.
            comparison = cv2.hconcat(panels) if len(panels) > 1 else panels[0]
            output_path = video_output / f"frame_{frame_index:06d}.jpg"
            if not cv2.imwrite(str(output_path), comparison, [cv2.IMWRITE_JPEG_QUALITY, 92]):
                raise RuntimeError(f"Impossibile scrivere immagine: {output_path}")
            written += 1

        cap.release()
        manifest.append({
            "video": str(video_path),
            "video_name": video_name,
            "sampled_frames_rendered": written,
            "output_directory": str(video_output),
        })
        print(f"[render] {video_name}: {written} immagini -> {video_output}")

    (args.output_dir / "visualization_manifest.json").write_text(
        __import__("json").dumps({
            "source_csvs": [str(path) for path in args.csv],
            "videos": manifest,
            "note": "Draws the detections already recorded in CSV; the current CSV has at most one detection per class per sampled frame.",
        }, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    print(f"[render] Completato. Output: {args.output_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
