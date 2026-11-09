#!/usr/bin/env python3
"""
Confronta i raw scores YOLO tra Python e Android per identificare differenze.
"""

import numpy as np
import sys

# Percorsi
PYTHON_OUTPUT = "frame_000085_python_output.f32"
ANDROID_OUTPUT = "frame_000085_android_output.f32"


def main():
    print("=== CONFRONTO RAW SCORES PYTHON VS ANDROID ===\n")
    
    # 1. Carica output Python
    print(f"Caricamento output Python da {PYTHON_OUTPUT}")
    python_output = np.fromfile(PYTHON_OUTPUT, dtype=np.float32)
    python_output = python_output.reshape(1, 7, 8400)
    python_transposed = python_output.squeeze().T  # (8400, 7)
    
    print(f"Shape: {python_transposed.shape}")
    print(f"Min: {python_transposed.min():.6f}")
    print(f"Max: {python_transposed.max():.6f}")
    print(f"Mean: {python_transposed.mean():.6f}")
    
    # 2. Carica output Android
    print(f"\nCaricamento output Android da {ANDROID_OUTPUT}")
    android_output = np.fromfile(ANDROID_OUTPUT, dtype=np.float32)
    android_output = android_output.reshape(1, 7, 8400)
    android_transposed = android_output.squeeze().T  # (8400, 7)
    
    print(f"Shape: {android_transposed.shape}")
    print(f"Min: {android_transposed.min():.6f}")
    print(f"Max: {android_transposed.max():.6f}")
    print(f"Mean: {android_transposed.mean():.6f}")
    
    # 3. Confronta per canale
    print("\n--- CONFRONTO PER CANALE ---")
    channels = ["cx", "cy", "w", "h", "ball", "player", "rim"]
    
    for i, channel_name in enumerate(channels):
        python_channel = python_transposed[:, i]
        android_channel = android_transposed[:, i]
        
        diff = np.abs(python_channel - android_channel)
        
        print(f"\n{channel_name.upper()}:")
        print(f"  Python: min={python_channel.min():.6f}, max={python_channel.max():.6f}, mean={python_channel.mean():.6f}")
        print(f"  Android: min={android_channel.min():.6f}, max={android_channel.max():.6f}, mean={android_channel.mean():.6f}")
        print(f"  Diff: mean={diff.mean():.10f}, max={diff.max():.10f}")
        print(f"  Identici: {np.array_equal(python_channel, android_channel)}")
        
        # Per i canali di confidence, conta quanti sono 1.0
        if i >= 4:
            python_ones = (python_channel == 1.0).sum()
            android_ones = (android_channel == 1.0).sum()
            print(f"  Python score=1.0: {python_ones}/{len(python_channel)}")
            print(f"  Android score=1.0: {android_ones}/{len(android_channel)}")
    
    # 4. Confronto globale
    print("\n--- CONFRONTO GLOBALE ---")
    diff = np.abs(python_transposed - android_transposed)
    print(f"Differenza media: {diff.mean():.10f}")
    print(f"Differenza massima: {diff.max():.10f}")
    print(f"Valori identici: {np.array_equal(python_transposed, android_transposed)}")
    print(f"Percentuale identici: {(diff == 0).sum() / diff.size * 100:.2f}%")
    
    return 0


if __name__ == "__main__":
    sys.exit(main())
