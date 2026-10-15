"""
test512.py

Test offline per verificare l'output del modello best_512_int8.tflite
Confronta con best_320_int8.tflite
"""

import numpy as np
import tensorflow as tf
from PIL import Image
import os

# Percorsi dei modelli
MODEL_320_PATH = "./assets/models/best_320_int8.tflite"
MODEL_512_PATH = "./assets/models/best_512_int8.tflite"

# Immagine di test
TEST_IMAGE_PATH = "./test_ball_only.jpg"

def test_model(model_path, model_name):
    """Testa un singolo modello"""
    print("=" * 70)
    print(f"TEST: {model_name}")
    print("=" * 70)
    
    if not os.path.exists(model_path):
        print(f"ERRORE: Modello non trovato: {model_path}")
        return None
    
    print(f"\nCaricamento modello: {model_path}")
    interpreter = tf.lite.Interpreter(model_path=model_path)
    interpreter.allocate_tensors()
    
    # Ottieni dettagli input/output
    input_details = interpreter.get_input_details()
    output_details = interpreter.get_output_details()
    
    print("\nINPUT:")
    print(f"  Shape: {input_details[0]['shape']}")
    print(f"  Dtype: {input_details[0]['dtype']}")
    print(f"  Quantization: {input_details[0]['quantization']}")
    
    print("\nOUTPUT:")
    print(f"  Shape: {output_details[0]['shape']}")
    print(f"  Dtype: {output_details[0]['dtype']}")
    print(f"  Quantization: {output_details[0]['quantization']}")
    
    # Verifica che l'output sia Float32
    output_dtype = output_details[0]['dtype']
    output_shape = output_details[0]['shape']
    
    if output_dtype == np.float32:
        print(f"\n[OK] OUTPUT IS FLOAT32")
    else:
        print(f"\n[ERROR] OUTPUT IS {output_dtype} (should be float32)")
    
    # Calcola numero di detections
    if len(output_shape) == 3:
        n_detections = output_shape[2]  # [1, 7, n_detections]
        print(f"\nNumber of detections (anchors): {n_detections}")
        
        # Verifica dimensione input
        input_shape = input_details[0]['shape']
        input_size = input_shape[1] if len(input_shape) >= 2 else 0
        print(f"Input size: {input_size}x{input_size}")
    
    return {
        'dtype': str(output_dtype),
        'shape': list(output_shape),
        'n_detections': n_detections if len(output_shape) == 3 else 0,
        'input_size': input_size
    }

def main():
    print("=" * 70)
    print("CONFRONTO MODELLI: 320 vs 512 int8")
    print("=" * 70)
    
    result_320 = test_model(MODEL_320_PATH, "best_320_int8.tflite")
    result_512 = test_model(MODEL_512_PATH, "best_512_int8.tflite")
    
    if result_320 and result_512:
        print("\n" + "=" * 70)
        print("CONFRONTO")
        print("=" * 70)
        print(f"\n320 int8:")
        print(f"  Dtype: {result_320['dtype']}")
        print(f"  Shape: {result_320['shape']}")
        print(f"  Detections: {result_320['n_detections']}")
        print(f"  Input size: {result_320['input_size']}")
        
        print(f"\n512 int8:")
        print(f"  Dtype: {result_512['dtype']}")
        print(f"  Shape: {result_512['shape']}")
        print(f"  Detections: {result_512['n_detections']}")
        print(f"  Input size: {result_512['input_size']}")
        
        print(f"\nConclusione:")
        if result_320['dtype'] == result_512['dtype']:
            print(f"  [OK] Stesso dtype: {result_320['dtype']}")
        else:
            print(f"  [WARN] Dtype diverso!")
        
        if result_320['n_detections'] != result_512['n_detections']:
            print(f"  [INFO] Numero detections diverso: {result_320['n_detections']} vs {result_512['n_detections']}")
    
    print("\n" + "=" * 70)
    print("TEST COMPLETATO")
    print("=" * 70)

if __name__ == "__main__":
    main()
