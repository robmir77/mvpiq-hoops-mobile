#!/usr/bin/env python3
"""Extract frames from benchmark videos for in-app image benchmark.

This script extracts frames from the 3 benchmark videos used by benchmark_yolo_videos.py
and saves them as PNG images that can be loaded by the React Native app.

Usage:
    python scripts/extract_frames_from_videos.py \
      --videos "src/vision/__tests__/media/Tiro Libero.mp4" \
              "src/vision/__tests__/media/Tiro da 3.mp4" \
              "src/vision/__tests__/media/Tiro a centrocampo.mp4" \
      --every-n-frames 5 \
      --output-dir assets/benchmark-images
"""

import argparse
import cv2
import hashlib
from pathlib import Path
from typing import Any


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def extract_frames(video_path: Path, output_dir: Path, every_n_frames: int) -> dict[str, Any]:
    """Extract frames from video and save as PNG images."""
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise RuntimeError(f"Impossibile aprire il video: {video_path}")

    fps = float(cap.get(cv2.CAP_PROP_FPS) or 0.0)
    frame_count_reported = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    video_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
    video_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
    video_hash = sha256_file(video_path)

    video_name = video_path.stem
    video_output_dir = output_dir / video_name
    video_output_dir.mkdir(parents=True, exist_ok=True)

    frame_index = 0
    extracted_count = 0
    frame_records = []

    while True:
        ok, frame = cap.read()
        if not ok:
            break

        if frame_index % every_n_frames == 0:
            frame_filename = f"frame_{frame_index:06d}.jpg"
            frame_path = video_output_dir / frame_filename
            cv2.imwrite(str(frame_path), frame, [cv2.IMWRITE_JPEG_QUALITY, 95])
            extracted_count += 1
            frame_records.append({
                "frame_index": frame_index,
                "filename": frame_filename,
                "timestamp_seconds": (frame_index / fps) if fps > 0 else None,
            })

        frame_index += 1

    cap.release()

    return {
        "video_path": str(video_path),
        "video_sha256": video_hash,
        "video_width": video_w,
        "video_height": video_h,
        "fps": fps,
        "total_frames": frame_count_reported,
        "extracted_frames": extracted_count,
        "every_n_frames": every_n_frames,
        "output_dir": str(video_output_dir),
        "frames": frame_records,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--videos",
        nargs="+",
        required=True,
        type=Path,
        help="Video MP4 da processare",
    )
    parser.add_argument(
        "--every-n-frames",
        type=int,
        default=5,
        help="Estrarre un frame ogni N frame (default: 5)",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("assets/benchmark-images"),
        help="Directory di output per le immagini (default: assets/benchmark-images)",
    )
    args = parser.parse_args()

    if args.every_n_frames < 1:
        parser.error("--every-n-frames deve essere >= 1")

    for path in args.videos:
        if not path.is_file():
            parser.error(f"File non trovato: {path}")

    args.output_dir.mkdir(parents=True, exist_ok=True)

    manifest = {
        "extraction_config": {
            "every_n_frames": args.every_n_frames,
            "output_dir": str(args.output_dir),
        },
        "videos": [],
    }

    for video_path in args.videos:
        print(f"[extract] Video: {video_path}", flush=True)
        result = extract_frames(video_path, args.output_dir, args.every_n_frames)
        manifest["videos"].append(result)
        print(f"  estratti: {result['extracted_frames']} frame", flush=True)

    manifest_path = args.output_dir / "manifest.json"
    import json
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"[extract] Manifest: {manifest_path}")

    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"ERRORE: {error}", file=__import__("sys").stderr)
        raise
