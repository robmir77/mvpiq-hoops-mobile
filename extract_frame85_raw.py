import cv2
import numpy as np
import tensorflow as tf
import hashlib
from pathlib import Path

from scripts.benchmark_yolo_videos import preprocess, normalize_output

VIDEO = Path("src/vision/__tests__/media/Tiro a centrocampo.mp4")
MODEL = Path("assets/models/best_640_float16.tflite")
FRAME_INDEX = 85
INPUT_SCALE = 1.0 / 255.0

for path in (VIDEO, MODEL):
    if not path.is_file():
        raise SystemExit(f"File non trovato: {path}")

def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

print("VIDEO SHA256:", sha256(VIDEO))
print("MODEL SHA256:", sha256(MODEL))

cap = cv2.VideoCapture(str(VIDEO))
if not cap.isOpened():
    raise SystemExit("Impossibile aprire il video")

frame = None
for i in range(FRAME_INDEX + 1):
    ok, current = cap.read()
    if not ok:
        raise SystemExit(f"Impossibile leggere il frame {FRAME_INDEX}")
    if i == FRAME_INDEX:
        frame = current

cap.release()

h, w = frame.shape[:2]
print(f"FRAME: {FRAME_INDEX}, resolution: {w}x{h}")

interpreter = tf.lite.Interpreter(
    model_path=str(MODEL),
    num_threads=2
)
interpreter.allocate_tensors()

input_detail = interpreter.get_input_details()[0]
output_detail = interpreter.get_output_details()[0]

tensor, letterbox = preprocess(
    frame,
    int(input_detail["shape"][2]),
    int(input_detail["shape"][1]),
    INPUT_SCALE,
    0.0
)

interpreter.set_tensor(input_detail["index"], tensor)
interpreter.invoke()

raw = interpreter.get_tensor(output_detail["index"])
output = normalize_output(raw)

# Salva il tensore in float32, layout [7, 8400]
output.astype(np.float32).tofile("frame_000085_python_output.f32")

print("\nINPUT:", tensor.shape, tensor.dtype)
print("INPUT min/max/mean:", tensor.min(), tensor.max(), tensor.mean())
print("LETTERBOX:", letterbox)
print("OUTPUT originale:", raw.shape, raw.dtype)
print("OUTPUT normalizzato:", output.shape)
print("OUTPUT salvato: frame_000085_python_output.f32")

for ch, name in [(4, "BALL"), (5, "PLAYER"), (6, "RIM")]:
    idx = int(np.argmax(output[ch]))
    print(f"\n{name}: anchor={idx}, score={output[ch,idx]:.9f}")
    print("Top 10:")
    for j in np.argsort(output[ch])[-10:][::-1]:
        print(f"  anchor={j:4d} score={output[ch,j]:.9f}")
