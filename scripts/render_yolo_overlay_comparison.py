#!/usr/bin/env python3
"""Render side-by-side visual YOLO diagnostics from benchmark CSV files.

The output shows the benchmark script's top-confidence detection per class,
not the exact app overlay or ground-truth correctness. It is intended for
manual inspection of localization and temporal continuity.

Dependencies:
    pip install opencv-python

Example:
    python scripts/render_yolo_overlay_comparison.py \
      --videos "src/vision/__tests__/media/Tiro Libero.mp4" \
               "src/vision/__tests__/media/Tiro da 3.mp4" \
               "src/vision/__tests__/media/Tirp a centrocampo.mp4" \
      --csv-384 benchmark-results/yolo-ab/best_384_float16_detections.csv \
      --csv-640 benchmark-results/yolo-ab/best_640_float16_detections.csv \
      --output-dir benchmark-results/yolo-ab/overlay-comparison

For each video, writes side-by-side PNGs for frame indices present in both
CSVs and contact sheets to make visual scanning easier.
"""

from __future__ import annotations

import argparse
import csv
import math
import re
import sys
from pathlib import Path
from typing import Any

import cv2
import numpy as np

# BGR colors, shared by both model panels.
CLASS_COLORS = {
    "ball": (0, 220, 255),
    "player": (60, 220, 60),
    "human": (60, 220, 60),
    "rim": (255, 180, 0),
}
CLASS_ORDER = ("ball", "player", "human", "rim")


def safe_name(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "_", value).strip("_") or "video"


def load_csv(path: Path) -> dict[str, dict[int, list[dict[str, Any]]]]:
    """Return detections indexed by source-video basename and frame index."""
    grouped: dict[str, dict[int, list[dict[str, Any]]]] = {}
    with path.open("r", newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        required = {
            "video", "frame_index", "class_name", "detected", "confidence",
            "x_center_norm", "y_center_norm", "width_norm", "height_norm",
        }
        missing = required - set(reader.fieldnames or [])
        if missing:
            raise ValueError(f"{path}: colonne mancanti: {', '.join(sorted(missing))}")

        for row in reader:
            video_key = Path(row["video"]).name.lower()
            try:
                frame_index = int(row["frame_index"])
            except (TypeError, ValueError):
                continue
            grouped.setdefault(video_key, {}).setdefault(frame_index, []).append(row)
    return grouped


def draw_panel(frame: np.ndarray, detections: list[dict[str, Any]], title: str) -> np.ndarray:
    panel = frame.copy()
    height, width = panel.shape[:2]
    for row in detections:
        if str(row.get("detected", "")).strip().lower() not in {"true", "1", "yes"}:
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

        class_name = str(row.get("class_name", "object")).lower()
        color = CLASS_COLORS.get(class_name, (255, 255, 255))
        x1 = max(0, min(width - 1, int(round(cx - bw / 2))))
        y1 = max(0, min(height - 1, int(round(cy - bh / 2))))
        x2 = max(0, min(width - 1, int(round(cx + bw / 2))))
        y2 = max(0, min(height - 1, int(round(cy + bh / 2))))
        if x2 <= x1 or y2 <= y1:
            continue

        cv2.rectangle(panel, (x1, y1), (x2, y2), color, max(2, width // 600))
        label = f"{class_name} {confidence:.3f}"
        font_scale = max(0.45, width / 1800)
        thickness = max(1, width // 900)
        (text_w, text_h), baseline = cv2.getTextSize(
            label, cv2.FONT_HERSHEY_SIMPLEX, font_scale, thickness
        )
        label_y = max(text_h + baseline + 3, y1)
        cv2.rectangle(
            panel,
            (x1, label_y - text_h - baseline - 4),
            (min(width - 1, x1 + text_w + 6), label_y + 2),
            color,
            -1,
        )
        cv2.putText(
            panel, label, (x1 + 3, label_y - baseline - 1),
            cv2.FONT_HERSHEY_SIMPLEX, font_scale, (0, 0, 0), thickness, cv2.LINE_AA,
        )

    header_h = max(36, int(height * 0.055))
    header = np.zeros((header_h, width, 3), dtype=np.uint8)
    cv2.putText(
        header, title, (12, int(header_h * 0.68)), cv2.FONT_HERSHEY_SIMPLEX,
        max(0.6, width / 1500), (255, 255, 255), 2, cv2.LINE_AA,
    )
    return np.vstack((header, panel))


def make_contact_sheet(images: list[np.ndarray], labels: list[str], output_path: Path,
                       columns: int, thumb_width: int) -> None:
    if not images:
        return
    thumb_h = max(1, int(images[0].shape[0] * thumb_width / images[0].shape[1]))
    tile_h = thumb_h + 28
    rows = math.ceil(len(images) / columns)
    sheet = np.full((rows * tile_h, columns * thumb_width, 3), 24, dtype=np.uint8)
    for index, (image, label) in enumerate(zip(images, labels)):
        thumb = cv2.resize(image, (thumb_width, thumb_h), interpolation=cv2.INTER_AREA)
        x = (index % columns) * thumb_width
        y = (index // columns) * tile_h
        sheet[y:y + thumb_h, x:x + thumb_width] = thumb
        cv2.putText(
            sheet, label, (x + 8, y + thumb_h + 20), cv2.FONT_HERSHEY_SIMPLEX,
            0.48, (240, 240, 240), 1, cv2.LINE_AA,
        )
    if not cv2.imwrite(str(output_path), sheet):
        raise RuntimeError(f"Impossibile salvare {output_path}")


def render_video(video_path: Path, csv384: dict[str, dict[int, list[dict[str, Any]]]],
                 csv640: dict[str, dict[int, list[dict[str, Any]]]], output_dir: Path,
                 sheet_columns: int, thumb_width: int) -> tuple[int, Path | None]:
    video_key = video_path.name.lower()
    detections384 = csv384.get(video_key, {})
    detections640 = csv640.get(video_key, {})
    common_frames = sorted(set(detections384) & set(detections640))
    if not common_frames:
        print(
            f"[warning] Nessun frame comune per {video_path.name}; "
            "controllare che i CSV si riferiscano a questo video.",
            file=sys.stderr,
        )
        return 0, None

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise RuntimeError(f"Impossibile aprire il video: {video_path}")
    video_dir = output_dir / safe_name(video_path.stem)
    frames_dir = video_dir / "frames"
    frames_dir.mkdir(parents=True, exist_ok=True)

    contact_images: list[np.ndarray] = []
    contact_labels: list[str] = []
    rendered = 0
    try:
        for frame_index in common_frames:
            cap.set(cv2.CAP_PROP_POS_FRAMES, frame_index)
            ok, frame = cap.read()
            if not ok:
                print(f"[warning] Impossibile leggere frame {frame_index} in {video_path.name}", file=sys.stderr)
                continue
            fps = float(cap.get(cv2.CAP_PROP_FPS) or 0)
            timestamp = frame_index / fps if fps > 0 else 0.0
            left = draw_panel(frame, detections384[frame_index], f"384 FLOAT16 | frame {frame_index} | {timestamp:.2f}s")
            right = draw_panel(frame, detections640[frame_index], f"640 FLOAT16 | frame {frame_index} | {timestamp:.2f}s")
            comparison = np.hstack((left, right))
            frame_name = f"frame_{frame_index:06d}_{timestamp:07.2f}s.png"
            frame_path = frames_dir / frame_name
            if not cv2.imwrite(str(frame_path), comparison):
                raise RuntimeError(f"Impossibile salvare {frame_path}")
            contact_images.append(comparison)
            contact_labels.append(f"frame {frame_index} | {timestamp:.2f}s")
            rendered += 1
    finally:
        cap.release()

    contact_path = video_dir / "contact_sheet.png"
    make_contact_sheet(contact_images, contact_labels, contact_path, sheet_columns, thumb_width)
    print(f"[ok] {video_path.name}: {rendered} frame -> {frames_dir}; contact sheet -> {contact_path}")
    return rendered, contact_path


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--videos", nargs="+", required=True, type=Path, help="Video originali usati nel benchmark")
    parser.add_argument("--csv-384", required=True, type=Path, help="CSV rilevazioni del modello 384")
    parser.add_argument("--csv-640", required=True, type=Path, help="CSV rilevazioni del modello 640")
    parser.add_argument("--output-dir", type=Path, default=Path("benchmark-results/yolo-ab/overlay-comparison"))
    parser.add_argument("--sheet-columns", type=int, default=2, help="Colonne nel contact sheet (default: 2)")
    parser.add_argument("--thumb-width", type=int, default=720, help="Larghezza di ogni miniatura (default: 720)")
    args = parser.parse_args()

    for path in [*args.videos, args.csv_384, args.csv_640]:
        if not path.is_file():
            parser.error(f"File non trovato: {path}")
    if args.sheet_columns < 1 or args.thumb_width < 100:
        parser.error("--sheet-columns deve essere >= 1 e --thumb-width >= 100")

    csv384 = load_csv(args.csv_384)
    csv640 = load_csv(args.csv_640)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    total = 0
    for video_path in args.videos:
        count, _ = render_video(
            video_path, csv384, csv640, args.output_dir, args.sheet_columns, args.thumb_width
        )
        total += count

    print(f"[done] Frame comparativi prodotti: {total}")
    print("[nota] Confidence non equivale a precisione; le box sono diagnostiche e non ground truth.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"ERRORE: {error}", file=sys.stderr)
        raise
