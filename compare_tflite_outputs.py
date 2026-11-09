import tensorflow as tf
import numpy as np

# File di input/output
ANDROID_INPUT = "frame_000085_android_input.f32"
ANDROID_OUTPUT = "frame_000085_android_output.f32"
MODEL_PATH = "assets/models/best_640_float16.tflite"
PYTHON_OUTPUT = "frame_000085_python_output.f32"

# Carica il modello TFLite
interpreter = tf.lite.Interpreter(model_path=MODEL_PATH)
interpreter.allocate_tensors()

# Ottieni dettagli input/output
input_details = interpreter.get_input_details()
output_details = interpreter.get_output_details()

print("\n--- MODELLO TFLITE ---")
print("Input details:", input_details[0])
print("Output details:", output_details[0])

# Carica tensore Android
android_input = np.fromfile(ANDROID_INPUT, dtype=np.float32)
android_input = android_input.reshape(input_details[0]['shape'])

print("\n--- INPUT ANDROID ---")
print("Shape:", android_input.shape)
print("Dtype:", android_input.dtype)
print("Min:", android_input.min())
print("Max:", android_input.max())
print("Mean:", android_input.mean())

# Esegui inferenza con lo stesso input
interpreter.set_tensor(input_details[0]['index'], android_input)
interpreter.invoke()

# Ottieni output Python
python_output = interpreter.get_tensor(output_details[0]['index'])

# Salva output Python
python_output.tofile(PYTHON_OUTPUT)

print("\n--- OUTPUT PYTHON ---")
print("Shape:", python_output.shape)
print("Dtype:", python_output.dtype)
print("Min:", python_output.min())
print("Max:", python_output.max())
print("Mean:", python_output.mean())

# Carica output Android
android_output = np.fromfile(ANDROID_OUTPUT, dtype=np.float32)
android_output = android_output.reshape(output_details[0]['shape'])

print("\n--- OUTPUT ANDROID ---")
print("Shape:", android_output.shape)
print("Dtype:", android_output.dtype)
print("Min:", android_output.min())
print("Max:", android_output.max())
print("Mean:", android_output.mean())

# Confronto
diff = np.abs(android_output - python_output)

print("\n--- CONFRONTO OUTPUT TFLITE ---")
print("Elementi:", android_output.size)
print("Differenza media:", diff.mean())
print("Differenza massima:", diff.max())
print("Valori identici:", np.allclose(android_output, python_output))
print("Percentuale identici:", (diff == 0).sum() / diff.size * 100, "%")

print("\n--- ANALISI ---")
print("Se gli output coincidono (differenza ~0), allora:")
print("  - La differenza nelle rilevazioni è causata SOLO dalla decodifica JPEG")
print("  - I runtime TFLite (Android GPU vs Python) sono equivalenti")
print("\nSe gli output differiscono, allora:")
print("  - C'è anche una differenza tra i runtime TFLite")
print("  - Dovremo investigare ulteriormente (delegati, quantizzazione, ecc.)")
