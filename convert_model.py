"""
Convert YOLOv8 model to standard TFLite format with GPU support
Usage: python convert_model.py
"""

from ultralytics import YOLO
import os

# Path to the original .pt model from GitHub
MODEL_PATH = "ball_rimV8.pt"
OUTPUT_DIR = "./tflite_models"

def convert_to_tflite():
    """Convert YOLOv8 model to TFLite format"""
    
    # Load the model
    print(f"Loading model from {MODEL_PATH}...")
    model = YOLO(MODEL_PATH)
    
    # Create output directory
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    
    # Export to TFLite with standard settings
    print("Exporting to TFLite format...")
    model.export(
        format='tflite',
        imgsz=640,  # Standard input size
        half=False,  # Use FP32 for better compatibility
        int8=False,  # Don't use INT8 quantization initially
        nms=False,   # Don't include NMS in the model
        simplify=True,  # Simplify the model
        opset=12,  # Use standard opset
        workspace=4,  # Workspace size in GB
    )
    
    print(f"Model exported successfully to {OUTPUT_DIR}/")
    print("\nTo test the model, you can use:")
    print("  python -c \"from ultralytics import YOLO; model = YOLO('best_float32.tflite'); results = model('test.jpg')\"")

if __name__ == "__main__":
    convert_to_tflite()
