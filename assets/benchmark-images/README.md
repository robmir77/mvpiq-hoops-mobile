# Benchmark Images

This directory contains frame images extracted from benchmark videos for in-app TFLite testing.

## Extraction

To extract frames from the benchmark videos:

```bash
python scripts/extract_frames_from_videos.py \
  --videos "src/vision/__tests__/media/Tiro Libero.mp4" \
          "src/vision/__tests__/media/Tiro da 3.mp4" \
          "src/vision/__tests__/media/Tiro a centrocampo.mp4" \
  --every-n-frames 5 \
  --output-dir assets/benchmark-images
```

This creates subdirectories for each video with JPEG frames extracted at the specified interval.

## Structure

```
assets/benchmark-images/
├── manifest.json          # Metadata about extracted frames
├── Tiro Libero/          # Frames from first video
│   ├── frame_000000.jpg
│   ├── frame_000005.jpg
│   └── ...
├── Tiro da 3/            # Frames from second video
└── Tiro a centrocampo/  # Frames from third video
```

## Purpose

These images are used by the in-app benchmark to compare TFLite inference results between:
- Python benchmark (scripts/benchmark_yolo_videos.py)
- React Native app (using react-native-fast-tflite)

This allows verifying that the model produces identical outputs when run with the same preprocessing and inference engine.

## Notes

- Frames are saved as JPEG (not PNG) because the app uses jpeg-js for decoding
- JPEG quality is set to 95 for good balance between size and quality
- The app uses nearest-neighbor resize for simplicity in the benchmark - for production use react-native-vision-camera-resizer
