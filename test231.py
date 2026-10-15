"""
test231.py

Test offline per verificare l'output Float32 del modello best_320_int8.tflite

Obiettivo:
1. Verificare che l'output sia Float32 (non INT8)
2. Verificare i 7 valori per candidato
3. Testare con immagine solo palla → alta confidenza ball, bassa human/rim
"""

import numpy as np
import tensorflow as tf
from PIL import Image
import os

# Percorso del modello
MODEL_PATH = "./assets/models/best_320_int8.tflite"

# Immagine di test (solo palla, senza giocatore/canestro)
TEST_IMAGE_PATH = "./test_ball_only.jpg"

def test_model_output():
    """Testa il modello e verifica l'output Float32"""
    
    print("=" * 70)
    print("TEST 231: Verifica output Float32 modello best_320_int8.tflite")
    print("=" * 70)
    
    # Carica il modello TFLite
    if not os.path.exists(MODEL_PATH):
        print(f"ERRORE: Modello non trovato: {MODEL_PATH}")
        return
    
    print(f"\nCaricamento modello: {MODEL_PATH}")
    interpreter = tf.lite.Interpreter(model_path=MODEL_PATH)
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
    if output_dtype == np.float32:
        print("\n[OK] OUTPUT IS FLOAT32 (correct)")
    else:
        print(f"\n[ERROR] OUTPUT IS {output_dtype} (should be float32)")
    
    # Carica e prepara immagine di test
    if os.path.exists(TEST_IMAGE_PATH):
        print(f"\nCaricamento immagine test: {TEST_IMAGE_PATH}")
        img = Image.open(TEST_IMAGE_PATH)
        img = img.resize((320, 320))
        img_array = np.array(img, dtype=np.float32) / 255.0
        img_array = np.expand_dims(img_array, axis=0)
        
        # Esegui inference
        interpreter.set_tensor(input_details[0]['index'], img_array)
        interpreter.invoke()
        output = interpreter.get_tensor(output_details[0]['index'])
        
        print(f"\nOutput shape: {output.shape}")
        print(f"Output dtype: {output.dtype}")
        print(f"Output range: [{output.min():.6f}, {output.max():.6f}]")
        
        # Analizza i 7 valori per candidato
        # Output shape: [1, 7, 2100]
        # 7 valori: cx, cy, w, h, ball, human, rim
        output_reshaped = output[0]  # [7, 2100]
        
        cx = output_reshaped[0]
        cy = output_reshaped[1]
        w = output_reshaped[2]
        h = output_reshaped[3]
        ball = output_reshaped[4]
        human = output_reshaped[5]
        rim = output_reshaped[6]
        
        print("\nAnalisi dei 7 canali:")
        print(f"  cx:    min={cx.min():.6f}, max={cx.max():.6f}, mean={cx.mean():.6f}")
        print(f"  cy:    min={cy.min():.6f}, max={cy.max():.6f}, mean={cy.mean():.6f}")
        print(f"  w:     min={w.min():.6f}, max={w.max():.6f}, mean={w.mean():.6f}")
        print(f"  h:     min={h.min():.6f}, max={h.max():.6f}, mean={h.mean():.6f}")
        print(f"  ball:  min={ball.min():.6f}, max={ball.max():.6f}, mean={ball.mean():.6f}")
        print(f"  human: min={human.min():.6f}, max={human.max():.6f}, mean={human.mean():.6f}")
        print(f"  rim:   min={rim.min():.6f}, max={rim.max():.6f}, mean={rim.mean():.6f}")
        
        # Trova il miglior candidato per palla
        best_ball_idx = np.argmax(ball)
        print(f"\nMiglior candidato palla (indice {best_ball_idx}):")
        print(f"  cx:    {cx[best_ball_idx]:.6f}")
        print(f"  cy:    {cy[best_ball_idx]:.6f}")
        print(f"  w:     {w[best_ball_idx]:.6f}")
        print(f"  h:     {h[best_ball_idx]:.6f}")
        print(f"  ball:  {ball[best_ball_idx]:.6f}")
        print(f"  human: {human[best_ball_idx]:.6f}")
        print(f"  rim:   {rim[best_ball_idx]:.6f}")
        
        # Verifica aspettative per immagine solo palla
        print("\nVerifica aspettative (immagine solo palla):")
        if ball[best_ball_idx] > 0.5:
            print(f"  [OK] Ball confidence alta: {ball[best_ball_idx]:.3f}")
        else:
            print(f"  [FAIL] Ball confidence bassa: {ball[best_ball_idx]:.3f}")
        
        if human[best_ball_idx] < 0.1:
            print(f"  [OK] Human confidence bassa: {human[best_ball_idx]:.3f}")
        else:
            print(f"  [FAIL] Human confidence alta: {human[best_ball_idx]:.3f}")
        
        if rim[best_ball_idx] < 0.1:
            print(f"  [OK] Rim confidence bassa: {rim[best_ball_idx]:.3f}")
        else:
            print(f"  [FAIL] Rim confidence alta: {rim[best_ball_idx]:.3f}")
        
        # Mostra top 5 candidati per palla
        top5_ball_indices = np.argsort(ball)[-5:][::-1]
        print("\nTop 5 candidati palla:")
        for i, idx in enumerate(top5_ball_indices):
            print(f"  {i+1}. idx={idx:4d} | ball={ball[idx]:.6f} | human={human[idx]:.6f} | rim={rim[idx]:.6f} | cx={cx[idx]:.6f} cy={cy[idx]:.6f}")
        
    else:
        print(f"\nAVVISO: Immagine test non trovata: {TEST_IMAGE_PATH}")
        print("Crea un'immagine test con solo la palla per verificare il comportamento del modello")
    
    print("\n" + "=" * 70)
    print("TEST COMPLETATO")
    print("=" * 70)

if __name__ == "__main__":
    test_model_output()
