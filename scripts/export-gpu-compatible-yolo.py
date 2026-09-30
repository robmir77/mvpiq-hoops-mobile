#!/usr/bin/env python3
"""
Export YOLO model to TFLite with GPU delegate compatibility.

This script exports a YOLO model to TFLite format optimized for
Android GPU delegate. The GPU delegate has specific requirements:
- Only supports a subset of TensorFlow operations
- Prefers certain quantization formats
- Requires specific tensor shapes and layouts

Usage:
    python scripts/export-gpu-compatible-yolo.py \
        --model-path path/to/best.pt \
        --input-size 416 \
        --output-path assets/models/best_416_float16_gpu.tflite

Requirements:
    pip install ultralytics onnx onnx-tf tensorflow
"""

import argparse
import sys
from pathlib import Path

try:
    from ultralytics import YOLO
    import tensorflow as tf
except ImportError as e:
    print(f"Error: Missing required package: {e}")
    print("Install with: pip install ultralytics onnx onnx-tf tensorflow")
    sys.exit(1)


def export_to_tflite_gpu_compatible(
    model_path: str,
    input_size: int,
    output_path: str,
    half: bool = True
):
    """
    Export YOLO model to TFLite with GPU delegate compatibility.

    Args:
        model_path: Path to YOLO .pt model
        input_size: Input resolution (e.g., 416, 512, 640)
        output_path: Output TFLite file path
        half: Use FP16 quantization (recommended for GPU)
    """
    print(f"Loading YOLO model from: {model_path}")
    model = YOLO(model_path)

    print(f"Exporting to ONNX...")
    onnx_path = model.export(
        format='onnx',
        imgsz=input_size,
        half=half,
        simplify=True,
        opset=12  # ONNX opset 12 is well-supported
    )

    print(f"Converting ONNX to TFLite with GPU optimizations...")
    # Import ONNX model
    import onnx
    onnx_model = onnx.load(onnx_path)

    # Convert to TensorFlow
    from onnx_tf.backend import prepare
    tf_rep = prepare(onnx_model, device='CPU', strict=False)
    tf_rep.export_graph(f"temp_tf_model_{input_size}")

    # Load TensorFlow model
    tf_model = tf.saved_model.load(f"temp_tf_model_{input_size}")

    # Convert to TFLite with GPU-compatible options
    converter = tf.lite.TFLiteConverter.from_saved_model(
        f"temp_tf_model_{input_size}"
    )

    # GPU delegate optimizations
    converter.optimizations = [tf.lite.Optimize.DEFAULT]
    converter.target_spec.supported_types = [tf.float16] if half else [tf.float32]
    
    # Enable experimental new converter (better GPU support)
    converter.experimental_new_converter = True
    converter.experimental_new_quantizer = True

    # Select operations that are GPU-compatible
    # This helps the converter avoid unsupported ops
    converter.allow_custom_ops = False

    # Convert
    print(f"Converting to TFLite...")
    tflite_model = converter.convert()

    # Save
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    
    with open(output_path, 'wb') as f:
        f.write(tflite_model)

    print(f"✅ Successfully exported GPU-compatible TFLite model to: {output_path}")
    print(f"   Model size: {len(tflite_model) / 1024 / 1024:.2f} MB")
    print(f"   Input size: {input_size}x{input_size}")
    print(f"   Precision: {'FP16' if half else 'FP32'}")

    # Cleanup
    import shutil
    Path(onnx_path).unlink(missing_ok=True)
    shutil.rmtree(f"temp_tf_model_{input_size}", ignore_errors=True)


def main():
    parser = argparse.ArgumentParser(
        description='Export YOLO model to GPU-compatible TFLite'
    )
    parser.add_argument(
        '--model-path',
        type=str,
        required=True,
        help='Path to YOLO .pt model'
    )
    parser.add_argument(
        '--input-size',
        type=int,
        default=416,
        help='Input resolution (default: 416)'
    )
    parser.add_argument(
        '--output-path',
        type=str,
        required=True,
        help='Output TFLite file path'
    )
    parser.add_argument(
        '--fp32',
        action='store_true',
        help='Use FP32 instead of FP16'
    )

    args = parser.parse_args()

    export_to_tflite_gpu_compatible(
        model_path=args.model_path,
        input_size=args.input_size,
        output_path=args.output_path,
        half=not args.fp32
    )


if __name__ == '__main__':
    main()
