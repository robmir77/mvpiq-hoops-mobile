import base64
import numpy as np
from pathlib import Path

source = Path("frame_000085_android_output.f32")
target = Path("frame_000085_android_output_decoded.f32")

# Il file è testo UTF-16 LE contenente Base64
encoded = source.read_bytes().decode("utf-16").strip()
raw = base64.b64decode(encoded)

target.write_bytes(raw)

android = np.frombuffer(raw, dtype=np.float32)
python = np.fromfile("frame_000085_python_output.f32", dtype=np.float32)

print("ANDROID decoded:", android.shape)
print("PYTHON:", python.shape)

if android.size != 58800 or python.size != 58800:
    raise SystemExit("Dimensione inattesa")

a = android.reshape(7, 8400)
p = python.reshape(7, 8400)

for name, idx in [("BALL", 3659), ("PLAYER", 7350)]:
    print(f"\n--- {name} anchor {idx} ---")
    for ch, label in enumerate(["cx", "cy", "w", "h", "ball", "player", "rim"]):
        print(f"{label:8} Android={a[ch,idx]:.9f} Python={p[ch,idx]:.9f} diff={a[ch,idx]-p[ch,idx]:.9f}")

d = np.abs(a-p)
print("\n--- DIFFERENZA GLOBALE ---")
print("Max:", d.max())
print("Mean:", d.mean())
print("Elementi identici:", np.mean(a == p) * 100, "%")

print("\n--- MASSIMI GREZZI PER CLASSE ---")
for ch, label in [(4,"BALL"),(5,"PLAYER"),(6,"RIM")]:
    ia = int(np.argmax(a[ch]))
    ip = int(np.argmax(p[ch]))
    print(f"{label}:")
    print(f" Android max={a[ch,ia]:.9f}, anchor={ia}")
    print(f" Python  max={p[ch,ip]:.9f}, anchor={ip}")
