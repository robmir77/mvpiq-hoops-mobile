"""
Inspect best.pt model structure and TFLite output shape
This script will help us understand the model's internal structure
and verify TFLite export consistency.
"""

from ultralytics import YOLO
import numpy as np
import tensorflow as tf

# Path to the original .pt model
MODEL_PATH = "C:\\Users\\Roberto\\best.pt"
TFLITE_PATH = "C:\\mvpq-960\\mvpiq-hoops-mobile\\assets\\models\\best_640_float16.tflite"

def inspect_tflite():
    """Inspect the TFLite model structure"""
    
    print("\n" + "=" * 60)
    print("INSPECTING TFLITE MODEL")
    print("=" * 60)
    
    try:
        interpreter = tf.lite.Interpreter(model_path=TFLITE_PATH)
        interpreter.allocate_tensors()
        
        print(f"\nInput details:")
        for i, detail in enumerate(interpreter.get_input_details()):
            print(f"  Input {i}: {detail}")
        
        print(f"\nOutput details:")
        for i, detail in enumerate(interpreter.get_output_details()):
            print(f"  Output {i}: {detail}")
            
    except Exception as e:
        print(f"Error inspecting TFLite: {e}")

def inspect_model():
    """Inspect the ballRim.pt model structure"""
    
    print("=" * 60)
    print("INSPECTING ballRim.pt MODEL")
    print("=" * 60)
    
    # Load the model
    print(f"\nLoading model from {MODEL_PATH}...")
    model = YOLO(MODEL_PATH)
    
    # Print model information
    print("\n" + "=" * 60)
    print("MODEL INFORMATION")
    print("=" * 60)
    print(f"Task: {model.task}")
    print(f"Names: {model.names}")
    print(f"Number of classes: {len(model.names)}")
    print(f"Class order: {list(model.names.values())}")
    
    # Get model info
    print("\n" + "=" * 60)
    print("MODEL DETAILS")
    print("=" * 60)
    info = model.info()
    print(f"Model info: {info}")
    
    # Check the model architecture
    print("\n" + "=" * 60)
    print("MODEL ARCHITECTURE")
    print("=" * 60)
    print(f"Model type: {type(model.model)}")
    
    # Try to get the output shape
    print("\n" + "=" * 60)
    print("EXPECTED INPUT/OUTPUT")
    print("=" * 60)
    print(f"Default input size: {model.args.get('imgsz', '640')}")
    
    # Print the model summary
    print("\n" + "=" * 60)
    print("MODEL SUMMARY")
    print("=" * 60)
    try:
        model.summary()
    except Exception as e:
        print(f"Could not print summary: {e}")
    
    print("\n" + "=" * 60)
    print("CLASS MAPPING")
    print("=" * 60)
    for idx, name in model.names.items():
        print(f"  Class {idx}: {name}")
    
    return model

def test_detection(model, image_path=None):
    """Run a test detection with the model"""
    
    print("\n" + "=" * 60)
    print("TEST DETECTION")
    print("=" * 60)
    
    if image_path:
        print(f"Running detection on: {image_path}")
        results = model(image_path)
    else:
        print("Running detection on a dummy test (no image provided)")
        print("To test with a real image, provide the image path as argument")
        return
    
    print("\n" + "=" * 60)
    print("DETECTION RESULTS")
    print("=" * 60)
    
    for result in results:
        print(f"\nImage shape: {result.orig_shape}")
        print(f"Number of detections: {len(result.boxes)}")
        
        if len(result.boxes) > 0:
            print("\nBoxes:")
            for i, box in enumerate(result.boxes):
                print(f"\n  Detection {i+1}:")
                print(f"    Class: {box.cls}")
                print(f"    Class name: {model.names[int(box.cls)]}")
                print(f"    Confidence: {box.conf}")
                print(f"    Bbox (xyxy): {box.xyxy}")
                print(f"    Bbox (xywh): {box.xywh}")
                print(f"    Center (cx, cy): ({box.xywh[0][0] + box.xywh[0][2]/2:.2f}, {box.xywh[0][1] + box.xywh[0][3]/2:.2f})")
        else:
            print("No detections found")

def test_tflite_detection(image_path):
    """Test TFLite model detection on the same image"""
    
    print("\n" + "=" * 60)
    print("TEST TFLITE DETECTION")
    print("=" * 60)
    
    try:
        tflite_model = YOLO(TFLITE_PATH)
        results = tflite_model(image_path)
        
        print(f"\nImage shape: {results[0].orig_shape}")
        print(f"Number of detections: {len(results[0].boxes)}")
        
        if len(results[0].boxes) > 0:
            print("\nTFLite Boxes:")
            for i, box in enumerate(results[0].boxes):
                print(f"\n  Detection {i+1}:")
                print(f"    Class: {box.cls}")
                print(f"    Class name: {tflite_model.names[int(box.cls)]}")
                print(f"    Confidence: {box.conf}")
                print(f"    Bbox (xyxy): {box.xyxy}")
                print(f"    Bbox (xywh): {box.xywh}")
        else:
            print("No detections found")
            
    except Exception as e:
        print(f"Error testing TFLite: {e}")

if __name__ == "__main__":
    import sys
    
    # Inspect the PyTorch model
    model = inspect_model()
    
    # Inspect the TFLite model
    inspect_tflite()
    
    # Optionally run a test detection if an image path is provided
    if len(sys.argv) > 1:
        test_detection(model, sys.argv[1])
        test_tflite_detection(sys.argv[1])
    else:
        print("\n" + "=" * 60)
        print("NOTE: To run a test detection, provide an image path:")
        print("  python inspect_model.py path/to/test_image.jpg")
        print("=" * 60)
