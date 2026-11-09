import cv2
import numpy as np
from pathlib import Path

IMAGE = "frame_000085_android.jpg"
ANDROID_INPUT = "frame_000085_android_input.f32"
PYTHON_INPUT = "frame_000085_python_input.f32"
SIZE = 640

# Decodifica JPEG
image = cv2.imread(IMAGE)
if image is None:
    raise RuntimeError(f"Impossibile leggere {IMAGE}")

# BGR -> RGB, come richiesto dal modello
rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
h, w = rgb.shape[:2]

scale = min(SIZE / w, SIZE / h)
new_w = round(w * scale)
new_h = round(h * scale)

resized = cv2.resize(
    rgb,
    (new_w, new_h),
    interpolation=cv2.INTER_LINEAR
)

# Letterbox centrato, padding nero
canvas = np.zeros((SIZE, SIZE, 3), dtype=np.float32)
x = (SIZE - new_w) // 2
y = (SIZE - new_h) // 2
canvas[y:y + new_h, x:x + new_w] = resized.astype(np.float32)

python_input = canvas.reshape(-1).astype(np.float32)

# Salva il tensore Python
python_input.tofile(PYTHON_INPUT)

# Legge il tensore Android
android_input = np.fromfile(ANDROID_INPUT, dtype=np.float32)

if android_input.size != python_input.size:
    raise RuntimeError(
        f"Elementi diversi: Android={android_input.size}, "
        f"Python={python_input.size}"
    )

diff = np.abs(android_input - python_input)

print("\n--- PREPROCESSING ---")
print("Immagine:", w, "x", h)
print("Dimensioni ridimensionate:", new_w, "x", new_h)
print("Padding:", x, y)

print("\n--- CONFRONTO TENSORI ---")
print("Elementi:", android_input.size)
print("Differenza media:", diff.mean())
print("Differenza massima:", diff.max())
print("Valori identici:", np.allclose(android_input, python_input))
print("Percentuale identici:", (diff == 0).sum() / diff.size * 100, "%")

print("\n--- STATISTICHE ANDROID ---")
print("Min:", android_input.min())
print("Max:", android_input.max())
print("Mean:", android_input.mean())

print("\n--- STATISTICHE PYTHON ---")
print("Min:", python_input.min())
print("Max:", python_input.max())
print("Mean:", python_input.mean())
