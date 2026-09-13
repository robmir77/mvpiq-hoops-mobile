"""
convert_ballrim_model.py

Converte ballRim.pt in tre modelli TFLite FLOAT16:
    - 320x320
    - 512x512
    - 640x640

Output:
    ./tflite_models/ballRim_320_float16.tflite
    ./tflite_models/ballRim_512_float16.tflite
    ./tflite_models/ballRim_640_float16.tflite
"""

from ultralytics import YOLO
import os
import shutil
import glob


MODEL_PATH = "ballRim.pt"
OUTPUT_DIR = "./tflite_models"

INPUT_SIZES = [320, 512, 640]


def convert_to_tflite():

    print("=" * 70)
    print("ballRim.pt -> TFLite FLOAT16")
    print("=" * 70)

    if not os.path.exists(MODEL_PATH):
        raise FileNotFoundError(
            f"Model not found: {MODEL_PATH}"
        )

    os.makedirs(OUTPUT_DIR, exist_ok=True)

    for imgsz in INPUT_SIZES:

        print("\n" + "-" * 70)
        print(f"Exporting FLOAT16 {imgsz}x{imgsz}")
        print("-" * 70)

        # Directory temporanea diversa per ogni risoluzione.
        # Evita che Ultralytics sovrascriva l'export precedente.
        temp_dir = os.path.abspath(
            os.path.join(
                OUTPUT_DIR,
                f"_export_{imgsz}"
            )
        )

        os.makedirs(temp_dir, exist_ok=True)

        # Pulizia eventuali vecchi TFLite
        for file in glob.glob(
            os.path.join(temp_dir, "**", "*.tflite"),
            recursive=True
        ):
            os.remove(file)

        try:

            model = YOLO(MODEL_PATH)

            exported_path = model.export(
                format="tflite",
                imgsz=imgsz,

                # FLOAT16
                half=True,

                # No INT8 quantization
                int8=False,

                # NMS gestito dall'app/parser
                nms=False,

                simplify=True,

                # Directory separata per questo export
                project=temp_dir,
                name=f"ballRim_{imgsz}",
                exist_ok=True
            )

            print("\nUltralytics export result:")
            print(exported_path)

            # Cerca il TFLite effettivamente generato
            candidates = glob.glob(
                os.path.join(
                    temp_dir,
                    "**",
                    "*.tflite"
                ),
                recursive=True
            )

            if not candidates:
                raise RuntimeError(
                    f"No TFLite file found after "
                    f"{imgsz}x{imgsz} export."
                )

            source = candidates[0]

            # Nome definitivo
            destination = os.path.abspath(
                os.path.join(
                    OUTPUT_DIR,
                    f"ballRim_{imgsz}_float16.tflite"
                )
            )

            if os.path.exists(destination):
                os.remove(destination)

            shutil.copy2(
                source,
                destination
            )

            size_mb = (
                os.path.getsize(destination)
                / (1024 * 1024)
            )

            print("\nSUCCESS")
            print(f"Source:")
            print(source)

            print(f"\nDestination:")
            print(destination)

            print(f"Size: {size_mb:.2f} MB")

        except Exception as e:

            print("\nERROR")
            print(f"Export {imgsz}x{imgsz} failed:")
            print(e)

        finally:

            # Elimina directory temporanea
            if os.path.exists(temp_dir):
                shutil.rmtree(
                    temp_dir,
                    ignore_errors=True
                )

    # -------------------------------------------------------------
    # Final report
    # -------------------------------------------------------------

    print("\n" + "=" * 70)
    print("FINAL RESULT")
    print("=" * 70)

    for imgsz in INPUT_SIZES:

        path = os.path.abspath(
            os.path.join(
                OUTPUT_DIR,
                f"ballRim_{imgsz}_float16.tflite"
            )
        )

        if os.path.exists(path):

            size_mb = (
                os.path.getsize(path)
                / (1024 * 1024)
            )

            print(
                f"[OK] {imgsz}x{imgsz} FLOAT16 "
                f"- {size_mb:.2f} MB"
            )

            print(f"     {path}")

        else:

            print(
                f"[ERROR] {imgsz}x{imgsz} "
                f"- NOT GENERATED"
            )

    print("=" * 70)


if __name__ == "__main__":
    convert_to_tflite()