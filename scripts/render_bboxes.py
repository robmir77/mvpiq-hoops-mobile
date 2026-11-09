#!/usr/bin/env python3
"""Render YOLO detection bounding boxes on video frames.

Usage:
    python scripts/render_bboxes.py \
      --csv benchmark-results/yolo-ab/best_384_float16_detections.csv \
      --output-dir benchmark-results/yolo-ab/frames-384
"""

import argparse
import csv
import math
from pathlib import Path
from typing import Any

import cv2


CLASS_COLORS = {
    "ball": (0, 255, 0),      # Green
    "player": (255, 0, 0),    # Blue (BGR format)
    "rim": (0, 0, 255),       # Red
}


def load_detections(csv_path: Path) -> dict[str, list[dict[str, Any]]]:
    """Load detections grouped by video path."""
    detections_by_video: dict[str, list[dict[str, Any]]] = {}
    
    with csv_path.open("r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            video = row["video"]
            if video not in detections_by_video:
                detections_by_video[video] = []
            
            # Parse numeric fields
            if row["detected"] == "True":
                detection = {
                    "frame_index": int(row["frame_index"]),
                    "class_name": row["class_name"],
                    "detected": True,
                    "confidence": float(row["confidence"]),
                    "x_center_norm": float(row["x_center_norm"]),
                    "y_center_norm": float(row["y_center_norm"]),
                    "width_norm": float(row["width_norm"]),
                    "height_norm": float(row["height_norm"]),
                }
            else:
                detection = {
                    "frame_index": int(row["frame_index"]),
                    "class_name": row["class_name"],
                    "detected": False,
                }
            
            detections_by_video[video].append(detection)
    
    return detections_by_video


def draw_bbox(frame: cv2.Mat, detection: dict[str, Any], frame_w: int, frame_h: int) -> None:
    """Draw bounding box and label on frame."""
    if not detection["detected"]:
        return
    
    x_center = detection["x_center_norm"] * frame_w
    y_center = detection["y_center_norm"] * frame_h
    width = detection["width_norm"] * frame_w
    height = detection["height_norm"] * frame_h
    
    # Convert center/size to corner coordinates
    x1 = int(x_center - width / 2)
    y1 = int(y_center - height / 2)
    x2 = int(x_center + width / 2)
    y2 = int(y_center + height / 2)
    
    # Clamp to frame bounds
    x1 = max(0, min(frame_w - 1, x1))
    y1 = max(0, min(frame_h - 1, y1))
    x2 = max(0, min(frame_w - 1, x2))
    y2 = max(0, min(frame_h - 1, y2))
    
    class_name = detection["class_name"]
    color = CLASS_COLORS.get(class_name, (255, 255, 255))
    confidence = detection["confidence"]
    
    # Draw rectangle
    cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)
    
    # Draw label
    label = f"{class_name}: {confidence:.2f}"
    (label_w, label_h), baseline = cv2.getTextSize(
        label, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1
    )
    cv2.rectangle(
        frame, 
        (x1, y1 - label_h - baseline - 2),
        (x1 + label_w, y1),
        color,
        -1
    )
    cv2.putText(
        frame, label, (x1, y1 - baseline - 2),
        cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1
    )


def render_video(video_path: Path, detections: list[dict[str, Any]], output_dir: Path, project_root: Path) -> None:
    """Render bounding boxes on frames from a single video."""
    # Try both absolute and relative paths
    if not video_path.is_file():
        video_path = project_root / video_path
    
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        print(f"[ERROR] Cannot open video: {video_path}")
        return
    
    fps = float(cap.get(cv2.CAP_PROP_FPS) or 0.0)
    frame_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
    frame_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
    
    print(f"[render] Video: {video_path.name} ({frame_w}x{frame_h} @ {fps:.1f} fps)")
    
    # Group detections by frame index
    detections_by_frame: dict[int, list[dict[str, Any]]] = {}
    for det in detections:
        frame_idx = det["frame_index"]
        if frame_idx not in detections_by_frame:
            detections_by_frame[frame_idx] = []
        detections_by_frame[frame_idx].append(det)
    
    frame_index = 0
    rendered_count = 0
    
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        
        if frame_index in detections_by_frame:
            for det in detections_by_frame[frame_index]:
                draw_bbox(frame, det, frame_w, frame_h)
            
            # Save frame
            output_path = output_dir / f"{video_path.stem}_frame_{frame_index:04d}.jpg"
            output_path.parent.mkdir(parents=True, exist_ok=True)
            success = cv2.imwrite(str(output_path), frame)
            if not success:
                print(f"[ERROR] Failed to save frame: {output_path}")
            else:
                rendered_count += 1
        
        frame_index += 1
    
    cap.release()
    print(f"[render] Rendered {rendered_count} frames to {output_dir}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--csv", type=Path, required=True, help="Path to detections CSV")
    parser.add_argument("--output-dir", type=Path, required=True, help="Output directory for rendered frames")
    parser.add_argument("--project-root", type=Path, default=Path(__file__).parent.parent, help="Project root directory")
    args = parser.parse_args()
    
    if not args.csv.is_file():
        print(f"[ERROR] CSV not found: {args.csv}")
        return 1
    
    detections_by_video = load_detections(args.csv)
    print(f"[render] Loaded detections for {len(detections_by_video)} videos")
    
    args.output_dir.mkdir(parents=True, exist_ok=True)
    
    for video_path_str, detections in detections_by_video.items():
        video_path = Path(video_path_str)
        video_output_dir = args.output_dir / video_path.stem
        render_video(video_path, detections, video_output_dir, args.project_root)
    
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
