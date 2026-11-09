#!/usr/bin/env python3
"""Visualizza i risultati del benchmark dell'app disegnando i bbox sulle immagini.

Uso:
    python scripts/visualize_benchmark_results.py \
        --csv benchmark-results/app_detections.csv \
        --images assets/benchmark-images \
        --output benchmark-results/app-visualizations
"""

import argparse
import csv
from pathlib import Path
from typing import Any

import cv2
import numpy as np

# Colori per le classi (BGR per OpenCV)
CLASS_COLORS = {
    "ball": (0, 255, 255),      # Giallo
    "player": (0, 255, 0),      # Verde
    "rim": (255, 0, 0),         # Blu
}

CLASS_NAMES = ["ball", "player", "rim"]


def draw_bbox(image: np.ndarray, x_center: float, y_center: float, width: float, height: float,
              confidence: float, class_name: str) -> np.ndarray:
    """Disegna un bbox normalizzato sull'immagine."""
    h, w = image.shape[:2]
    
    # Converti coordinate normalizzate in pixel
    x1 = int((x_center - width / 2) * w)
    y1 = int((y_center - height / 2) * h)
    x2 = int((x_center + width / 2) * w)
    y2 = int((y_center + height / 2) * h)
    
    # Clip alle dimensioni dell'immagine
    x1 = max(0, min(w - 1, x1))
    y1 = max(0, min(h - 1, y1))
    x2 = max(0, min(w - 1, x2))
    y2 = max(0, min(h - 1, y2))
    
    color = CLASS_COLORS.get(class_name, (255, 255, 255))
    
    # Disegna il rettangolo
    cv2.rectangle(image, (x1, y1), (x2, y2), color, 2)
    
    # Disegna l'etichetta con confidence
    label = f"{class_name} {confidence:.2f}"
    (label_w, label_h), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
    cv2.rectangle(image, (x1, y1 - label_h - 10), (x1 + label_w, y1), color, -1)
    cv2.putText(image, label, (x1, y1 - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 0), 1)
    
    return image


def visualize_results(csv_path: Path, images_dir: Path, output_dir: Path) -> None:
    """Genera immagini con bbox disegnati dai risultati del benchmark."""
    output_dir.mkdir(parents=True, exist_ok=True)
    
    # Leggi il CSV
    with csv_path.open("r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        rows = list(reader)
    
    print(f"[visualize] Letti {len(rows)} righe dal CSV")
    
    # Raggruppa per frame_index e video_name
    frames: dict[tuple[str, int], dict[str, Any]] = {}
    for row in rows:
        key = (row["video_name"], int(row["frame_index"]))
        if key not in frames:
            frames[key] = {
                "video_name": row["video_name"],
                "frame_index": int(row["frame_index"]),
                "ball": None,
                "player": None,
                "inference_ms": float(row.get("inference_ms", 0)),
            }
        
        # Estrai detections
        if row["ball_detected"] == "true":
            frames[key]["ball"] = {
                "x": float(row["ball_x"]),
                "y": float(row["ball_y"]),
                "width": float(row["ball_width"]),
                "height": float(row["ball_height"]),
                "confidence": float(row["ball_confidence"]),
            }
        
        if row["player_detected"] == "true":
            frames[key]["player"] = {
                "x": float(row["player_x"]),
                "y": float(row["player_y"]),
                "width": float(row["player_width"]),
                "height": float(row["player_height"]),
                "confidence": float(row["player_confidence"]),
            }
    
    print(f"[visualize] {len(frames)} frame unici da processare")
    
    # Processa ogni frame
    for (video_name, frame_index), frame_data in frames.items():
        # Trova l'immagine corrispondente
        # Il nome del file dovrebbe essere frame_{frame_index:04d}.jpg
        image_filename = f"frame_{frame_index:04d}.jpg"
        image_path = images_dir / video_name / image_filename
        
        if not image_path.exists():
            # Prova anche senza leading zeros
            image_filename = f"frame_{frame_index}.jpg"
            image_path = images_dir / video_name / image_filename
        
        if not image_path.exists():
            print(f"[visualize] Immagine non trovata: {image_path}")
            continue
        
        # Carica l'immagine
        image = cv2.imread(str(image_path))
        if image is None:
            print(f"[visualize] Impossibile caricare: {image_path}")
            continue
        
        # Disegna i bbox
        for class_name in ["ball", "player"]:
            detection = frame_data[class_name]
            if detection is not None:
                image = draw_bbox(
                    image,
                    detection["x"],
                    detection["y"],
                    detection["width"],
                    detection["height"],
                    detection["confidence"],
                    class_name
                )
        
        # Salva l'immagine annotata
        output_path = output_dir / video_name / image_filename
        output_path.parent.mkdir(parents=True, exist_ok=True)
        cv2.imwrite(str(output_path), image)
        print(f"[visualize] Salvato: {output_path}")
    
    print(f"[visualize] Completato. Immagini salvate in: {output_dir}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--csv", type=Path, required=True, help="Percorso al CSV delle detections dell'app")
    parser.add_argument("--images", type=Path, required=True, help="Percorso alla cartella delle immagini originali")
    parser.add_argument("--output", type=Path, default=Path("benchmark-results/app-visualizations"), help="Cartella di output per le immagini annotate")
    
    args = parser.parse_args()
    
    if not args.csv.exists():
        print(f"ERRORE: CSV non trovato: {args.csv}")
        return 1
    
    if not args.images.exists():
        print(f"ERRORE: Cartella immagini non trovata: {args.images}")
        return 1
    
    try:
        visualize_results(args.csv, args.images, args.output)
        return 0
    except Exception as e:
        print(f"ERRORE: {e}")
        import traceback
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
