#!/usr/bin/env python3
"""
Verify TFLite model metadata for all YOLO models.
This script checks input/output tensor shapes, types, and quantization
to ensure all models follow the same export schema.
"""

import tensorflow as tf
import glob
import os
import json

def verify_model(path):
    """Verify a single TFLite model."""
    print("\n" + "=" * 80)
    print(f"Model: {os.path.basename(path)}")
    print("=" * 80)

    try:
        interpreter = tf.lite.Interpreter(model_path=path)
        interpreter.allocate_tensors()

        result = {
            "filename": os.path.basename(path),
            "input": [],
            "output": []
        }

        for label, tensors in [
            ("INPUT", interpreter.get_input_details()),
            ("OUTPUT", interpreter.get_output_details())
        ]:
            print(f"\n{label} TENSORS ({len(tensors)})")
            print("-" * 80)

            for tensor in tensors:
                tensor_info = {
                    "name": tensor["name"],
                    "shape": tensor["shape"].tolist(),
                    "dtype": str(tensor["dtype"]),
                    "quantization": tensor["quantization"],
                    "quantization_parameters": {
                        "scales": tensor["quantization_parameters"]["scales"].tolist(),
                        "zero_points": tensor["quantization_parameters"]["zero_points"].tolist(),
                    }
                }

                print(f"  Name: {tensor_info['name']}")
                print(f"  Shape: {tensor_info['shape']}")
                print(f"  Dtype: {tensor_info['dtype']}")
                print(f"  Quantization: {tensor_info['quantization']}")
                print(f"  Scales: {tensor_info['quantization_parameters']['scales']}")
                print(f"  Zero points: {tensor_info['quantization_parameters']['zero_points']}")

                if label == "INPUT":
                    result["input"].append(tensor_info)
                else:
                    result["output"].append(tensor_info)

        return result

    except Exception as e:
        print(f"\nERROR: Failed to load model: {e}")
        return None

def main():
    """Verify all YOLO models in assets/models/."""
    models_dir = os.path.join(os.path.dirname(__file__), "..", "assets", "models")
    pattern = os.path.join(models_dir, "best_*.tflite")

    model_files = sorted(glob.glob(pattern))

    if not model_files:
        print(f"No YOLO models found matching pattern: {pattern}")
        return

    print(f"Found {len(model_files)} YOLO models to verify")

    all_results = []

    for path in model_files:
        result = verify_model(path)
        if result:
            all_results.append(result)

    # Summary comparison
    print("\n" + "=" * 80)
    print("SUMMARY - Output Schema Comparison")
    print("=" * 80)

    if all_results:
        # Extract output shapes
        output_shapes = [r["output"][0]["shape"] for r in all_results if r["output"]]
        output_dtypes = [r["output"][0]["dtype"] for r in all_results if r["output"]]

        print("\nOutput shapes:")
        for result, shape in zip(all_results, output_shapes):
            print(f"  {result['filename']}: {shape}")

        print("\nOutput dtypes:")
        for result, dtype in zip(all_results, output_dtypes):
            print(f"  {result['filename']}: {dtype}")

        # Check consistency
        unique_shapes = set(tuple(s) for s in output_shapes)
        unique_dtypes = set(output_dtypes)

        print("\n" + "-" * 80)
        if len(unique_shapes) == 1:
            print("[OK] All models have CONSISTENT output shape")
        else:
            print("[WARNING] Models have INCONSISTENT output shapes")
            print(f"  Unique shapes: {unique_shapes}")

        if len(unique_dtypes) == 1:
            print("[OK] All models have CONSISTENT output dtype")
        else:
            print("[WARNING] Models have INCONSISTENT output dtypes")
            print(f"  Unique dtypes: {unique_dtypes}")

        # Save results to JSON
        output_file = os.path.join(os.path.dirname(__file__), "tflite_metadata_verification.json")
        with open(output_file, "w") as f:
            json.dump(all_results, f, indent=2)
        print(f"\n[OK] Results saved to: {output_file}")

if __name__ == "__main__":
    main()
