import cv2
import numpy as np

# File di input
IMAGE = "frame_000085_android.jpg"
ANDROID_RGB = "frame_000085_android_rgb.rgb"
ANDROID_INPUT = "frame_000085_android_input.f32"

SIZE = 640

# Funzione letterbox identica a quella usata prima
def letterbox(rgb, size):
    h, w = rgb.shape[:2]
    scale = min(size / w, size / h)
    new_w = round(w * scale)
    new_h = round(h * scale)

    resized = cv2.resize(
        rgb,
        (new_w, new_h),
        interpolation=cv2.INTER_LINEAR
    )

    canvas = np.zeros((size, size, 3), dtype=np.float32)
    x = (size - new_w) // 2
    y = (size - new_h) // 2
    canvas[y:y + new_h, x:x + new_w] = resized.astype(np.float32)

    return canvas.reshape(-1).astype(np.float32)

# 1. Carica RGB decodificato da Android (jpeg-js)
android_rgb = np.fromfile(ANDROID_RGB, dtype=np.uint8)
android_rgb = android_rgb.reshape(576, 1024, 3)

# 2. Carica e decodifica JPEG con OpenCV
opencv_image = cv2.imread(IMAGE)
opencv_rgb = cv2.cvtColor(opencv_image, cv2.COLOR_BGR2RGB)

# 3. Applica letterbox OpenCV a entrambi
android_rgb_letterbox = letterbox(android_rgb, SIZE)
opencv_rgb_letterbox = letterbox(opencv_rgb, SIZE)

# 4. Carica tensore Android reale
android_input = np.fromfile(ANDROID_INPUT, dtype=np.float32)

print("\n--- CONFRONTO TENSORI DOPO LETTERBOX ---")
print("Dimensioni:", android_input.size)

# Confronto Android RGB + OpenCV letterbox vs Android reale
diff_android = np.abs(android_rgb_letterbox - android_input)
print("\nAndroid RGB (jpeg-js) + OpenCV letterbox vs Android reale:")
print("  Differenza media:", diff_android.mean())
print("  Differenza massima:", diff_android.max())
print("  Percentuale identici:", (diff_android == 0).sum() / diff_android.size * 100, "%")

# Confronto Python RGB (OpenCV) + OpenCV letterbox vs Android reale
diff_opencv = np.abs(opencv_rgb_letterbox - android_input)
print("\nPython RGB (OpenCV) + OpenCV letterbox vs Android reale:")
print("  Differenza media:", diff_opencv.mean())
print("  Differenza massima:", diff_opencv.max())
print("  Percentuale identici:", (diff_opencv == 0).sum() / diff_opencv.size * 100, "%")

# Confronto diretto tra i due tensori generati con OpenCV letterbox
diff_sources = np.abs(android_rgb_letterbox - opencv_rgb_letterbox)
print("\nAndroid RGB (jpeg-js) vs Python RGB (OpenCV) - entrambi con OpenCV letterbox:")
print("  Differenza media:", diff_sources.mean())
print("  Differenza massima:", diff_sources.max())
print("  Percentuale identici:", (diff_sources == 0).sum() / diff_sources.size * 100, "%")

print("\n--- ANALISI ---")
print("Se la differenza 'Android RGB + OpenCV letterbox vs Android reale' è piccola,")
print("allora la divergenza principale è nella decodifica JPEG (jpeg-js vs OpenCV).")
print("Se rimane grande, allora c'è anche una differenza nell'algoritmo di letterbox.")
