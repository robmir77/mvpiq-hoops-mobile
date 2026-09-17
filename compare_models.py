#!/usr/bin/env python3
"""
Confronto scientifico tra best_320_int8.tflite e best_512_int8.tflite
Per identificare la differenza che causa il fallimento del 512 con GPU delegate.
"""

import tensorflow as tf
import numpy as np

def analyze_model(model_path, model_name):
    """Analizza un modello TFLite e stampa dettagli completi."""
    print(f"\n{'='*70}")
    print(f"MODELLO: {model_name}")
    print(f"FILE: {model_path}")
    print(f"{'='*70}")
    
    try:
        # Carica il modello
        interpreter = tf.lite.Interpreter(model_path=model_path)
        interpreter.allocate_tensors()
        
        # Dettagli generali
        input_details = interpreter.get_input_details()
        output_details = interpreter.get_output_details()
        
        print(f"\nNUMERO TENSOR INPUT: {len(input_details)}")
        print(f"NUMERO TENSOR OUTPUT: {len(output_details)}")
        
        # Analisi INPUT
        print(f"\n--- INPUT DETAILS ---")
        for i, detail in enumerate(input_details):
            print(f"\nInput {i}:")
            print(f"  Name: {detail['name']}")
            print(f"  Shape: {detail['shape']}")
            print(f"  Dtype: {detail['dtype']}")
            print(f"  Quantization: {detail['quantization']}")
        
        # Analisi OUTPUT
        print(f"\n--- OUTPUT DETAILS ---")
        for i, detail in enumerate(output_details):
            print(f"\nOutput {i}:")
            print(f"  Name: {detail['name']}")
            print(f"  Shape: {detail['shape']}")
            print(f"  Dtype: {detail['dtype']}")
            print(f"  Quantization: {detail['quantization']}")
        
        # Informazioni sugli operatori
        print(f"\n--- OPERATORI ---")
        ops = interpreter._get_ops_details()
        print(f"Numero totale operatori: {len(ops)}")
        
        # Conta tipi di operatori
        op_types = {}
        for op in ops:
            op_type = op['op_name']
            op_types[op_type] = op_types.get(op_type, 0) + 1
        
        print(f"\nTipi di operatori:")
        for op_type, count in sorted(op_types.items(), key=lambda x: x[1], reverse=True):
            print(f"  {op_type}: {count}")
        
        return {
            'input_details': input_details,
            'output_details': output_details,
            'ops': ops,
            'op_types': op_types
        }
        
    except Exception as e:
        print(f"\nERRORE nell'analisi di {model_path}: {e}")
        import traceback
        traceback.print_exc()
        return None

def compare_models(model1_path, model1_name, model2_path, model2_name):
    """Confronta due modelli e stampa le differenze."""
    print(f"\n{'#'*70}")
    print(f"# CONFRONTO SCIENTIFICO TRA DUE MODELLI")
    print(f"{'#'*70}")
    
    # Analizza entrambi i modelli
    model1 = analyze_model(model1_path, model1_name)
    model2 = analyze_model(model2_path, model2_name)
    
    if not model1 or not model2:
        print("\nImpossibile confrontare - uno dei modelli non e' stato analizzato")
        return
    
    # Confronto INPUT
    print(f"\n{'='*70}")
    print(f"CONFRONTO INPUT")
    print(f"{'='*70}")
    
    in1 = model1['input_details'][0] if model1['input_details'] else None
    in2 = model2['input_details'][0] if model2['input_details'] else None
    
    if in1 and in2:
        print(f"\nShape:")
        print(f"  {model1_name}: {in1['shape']}")
        print(f"  {model2_name}: {in2['shape']}")
        print(f"  Differenza: {in1['shape'].tolist() != in2['shape'].tolist()}")
        
        print(f"\nDtype:")
        print(f"  {model1_name}: {in1['dtype']}")
        print(f"  {model2_name}: {in2['dtype']}")
        print(f"  Differenza: {in1['dtype'] != in2['dtype']}")
        
        print(f"\nQuantization:")
        print(f"  {model1_name}: {in1['quantization']}")
        print(f"  {model2_name}: {in2['quantization']}")
        print(f"  Differenza: {in1['quantization'] != in2['quantization']}")
    
    # Confronto OUTPUT
    print(f"\n{'='*70}")
    print(f"CONFRONTO OUTPUT")
    print(f"{'='*70}")
    
    out1 = model1['output_details'][0] if model1['output_details'] else None
    out2 = model2['output_details'][0] if model2['output_details'] else None
    
    if out1 and out2:
        print(f"\nShape:")
        print(f"  {model1_name}: {out1['shape']}")
        print(f"  {model2_name}: {out2['shape']}")
        print(f"  Differenza: {out1['shape'].tolist() != out2['shape'].tolist()}")
        
        print(f"\nDtype:")
        print(f"  {model1_name}: {out1['dtype']}")
        print(f"  {model2_name}: {out2['dtype']}")
        print(f"  Differenza: {out1['dtype'] != out2['dtype']}")
        
        print(f"\nQuantization:")
        print(f"  {model1_name}: {out1['quantization']}")
        print(f"  {model2_name}: {out2['quantization']}")
        print(f"  Differenza: {out1['quantization'] != out2['quantization']}")
    
    # Confronto OPERATORI
    print(f"\n{'='*70}")
    print(f"CONFRONTO OPERATORI")
    print(f"{'='*70}")
    
    print(f"\nNumero totale operatori:")
    print(f"  {model1_name}: {len(model1['ops'])}")
    print(f"  {model2_name}: {len(model2['ops'])}")
    print(f"  Differenza: {len(model1['ops']) != len(model2['ops'])}")
    
    print(f"\nTipi di operatori diversi:")
    all_op_types = set(model1['op_types'].keys()) | set(model2['op_types'].keys())
    for op_type in sorted(all_op_types):
        count1 = model1['op_types'].get(op_type, 0)
        count2 = model2['op_types'].get(op_type, 0)
        if count1 != count2:
            print(f"  {op_type}: {model1_name}={count1}, {model2_name}={count2}")
    
    # Riassunto differenze chiave
    print(f"\n{'='*70}")
    print(f"RIASSUNTO DIFFERENZE CHIAVE")
    print(f"{'='*70}")
    
    key_differences = []
    
    if in1 and in2:
        if in1['shape'].tolist() != in2['shape'].tolist():
            key_differences.append(f"INPUT SHAPE: {in1['shape']} vs {in2['shape']}")
        if in1['dtype'] != in2['dtype']:
            key_differences.append(f"INPUT DTYPE: {in1['dtype']} vs {in2['dtype']}")
    
    if out1 and out2:
        if out1['shape'].tolist() != out2['shape'].tolist():
            key_differences.append(f"OUTPUT SHAPE: {out1['shape']} vs {out2['shape']}")
        if out1['dtype'] != out2['dtype']:
            key_differences.append(f"OUTPUT DTYPE: {out1['dtype']} vs {out2['dtype']}")
    
    if len(model1['ops']) != len(model2['ops']):
        key_differences.append(f"NUMERO OPERATORI: {len(model1['ops'])} vs {len(model2['ops'])}")
    
    if key_differences:
        print("\nDifferenze rilevate:")
        for diff in key_differences:
            print(f"  - {diff}")
    else:
        print("\nNessuna differenza rilevata nei parametri principali")
        print("Il problema potrebbe essere nella struttura interna o nel supporto GPU")

if __name__ == "__main__":
    import os
    
    # Percorsi dei modelli
    model_320_path = "assets/models/best_320_int8.tflite"
    model_512_path = "assets/models/best_512_int8.tflite"
    
    # Verifica esistenza file
    if not os.path.exists(model_320_path):
        print(f"ERRORE: Modello 320 non trovato: {model_320_path}")
        exit(1)
    
    if not os.path.exists(model_512_path):
        print(f"ERRORE: Modello 512 non trovato: {model_512_path}")
        exit(1)
    
    # Dimensioni file
    size_320 = os.path.getsize(model_320_path)
    size_512 = os.path.getsize(model_512_path)
    
    print(f"\nDimensione file:")
    print(f"  best_320_int8.tflite: {size_320:,} bytes ({size_320/1024/1024:.2f} MB)")
    print(f"  best_512_int8.tflite: {size_512:,} bytes ({size_512/1024/1024:.2f} MB)")
    print(f"  Differenza: {size_512 - size_320:,} bytes ({(size_512 - size_320)/1024/1024:.2f} MB)")
    
    # Esegui confronto
    compare_models(
        model_320_path, 
        "best_320_int8 (FUNZIONA con GPU)",
        model_512_path,
        "best_512_int8 (FALLISCE con GPU)"
    )
