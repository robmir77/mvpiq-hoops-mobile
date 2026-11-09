import json
import csv
import numpy as np
from pathlib import Path

# Android metadata
with open("frame_000085_metadata.json", encoding="utf-8") as f:
    m = json.load(f)

print("=== ANDROID METADATA ===")
print("Image:", m.get("image"))
print("Resolution:", m.get("width"), "x", m.get("height"))
print("Input:", m.get("input"))
print("Detections:", m.get("detections"))

# Raw Android tensor
a = np.fromfile("frame_000085_android_output_decoded.f32", np.float32).reshape(7, 8400)

print("\n=== TOP 10 RAW SCORES ANDROID ===")
for ch, label in [(4, "BALL"), (5, "PLAYER"), (6, "RIM")]:
    indices = np.argsort(a[ch])[-10:][::-1]
    print(f"\n{label}:")
    for idx in indices:
        print(f"anchor={idx:4d} score={a[ch,idx]:.9f}")

# Python benchmark CSV
path = Path("benchmark-results/yolo-ab/best_640_float16_detections.csv")

print("\n=== PYTHON CSV ===")
if not path.exists():
    print("CSV non trovato:", path)
else:
    with path.open(encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        print("Colonne:", reader.fieldnames)
        for row in reader:
            if row.get("frame_index") == "85":
                print(row)
