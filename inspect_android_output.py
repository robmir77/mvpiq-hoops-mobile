import os
import json

for f in [
    "frame_000085_android_output.f32",
    "frame_000085_metadata.json"
]:
    print(f, "EXISTS:", os.path.exists(f))
    if os.path.exists(f):
        print("SIZE:", os.path.getsize(f), "bytes")

if os.path.exists("frame_000085_metadata.json"):
    with open("frame_000085_metadata.json", encoding="utf-8") as f:
        m = json.load(f)
    print("\n--- METADATA OUTPUT ---")
    print(json.dumps(m.get("output"), indent=2))
    print("\n--- EXPECTED SHAPE ---")
    print(m.get("outputShapeExpected"))
    print("\n--- DETECTIONS ---")
    print(json.dumps(m.get("detections"), indent=2))

with open("frame_000085_android_output.f32", "rb") as f:
    data = f.read(64)
print("\n--- FIRST 64 BYTES HEX ---")
print(data.hex(" "))
