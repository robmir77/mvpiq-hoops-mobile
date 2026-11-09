# YOLO Model Benchmark Results

**Date:** 2026-11-08  
**Environment:** Offline CPU benchmark (TensorFlow Lite, Python)  
**Decoder Mode:** app-compatible (ports YoloDetector.ts + BallDetectionProcessor.ts logic)

## Configuration

- **Preprocessing:** RGB, OpenCV linear resize, contain/letterbox, centered padding
- **Input Scale:** 1/255 (normalization 0-1)
- **Pad Value:** 0.0
- **Sampling:** Every 5 frames
- **Warmup:** 5 inferences per model (discarded)
- **Threads:** 2 CPU threads

## Models Compared

| Model | Input Size | Output Anchors | File Size |
|-------|-----------|----------------|-----------|
| best_384_float16.tflite | 384x384 | 3024 | 5.3 MB |
| best_640_float16.tflite | 640x640 | 8400 | 5.4 MB |

## Latency Results

### best_384_float16.tflite

- **Measured Inferences:** 77
- **Mean:** 40.4 ms
- **Median:** 30.2 ms
- **P95:** 88.6 ms
- **Min:** 14.8 ms
- **Max:** 99.0 ms

### best_640_float16.tflite

- **Measured Inferences:** 77
- **Mean:** 53.1 ms
- **Median:** 51.0 ms
- **P95:** 70.9 ms
- **Min:** 44.7 ms
- **Max:** 78.5 ms

## Performance Comparison

| Metric | 384 Model | 640 Model | Difference |
|--------|-----------|-----------|------------|
| Median Latency | 30.2 ms | 51.0 ms | +69% slower |
| P95 Latency | 88.6 ms | 70.9 ms | -20% more consistent |
| Mean Latency | 40.4 ms | 53.1 ms | +31% slower |

**Analysis:**
- The 384 model is significantly faster in median latency (~40% faster)
- The 640 model is more consistent (lower P95 variance)
- The 640 model has higher minimum latency but lower maximum latency

## Test Videos

| Video | Resolution | FPS | Duration | Frames Sampled |
|-------|-----------|-----|----------|----------------|
| Tiro Libero.mp4 | 1024x576 | 29.8 | 4.4s | 27 |
| Tiro da 3.mp4 | 1024x576 | 29.7 | 3.7s | 22 |
| Tirp a centrocampo.mp4 | 1024x576 | 29.8 | 5.5s | 33 |

## Visual Verification

Bounding boxes rendered on sampled frames are available for visual inspection:

### 384 Model Frames
- [Tiro Libero](./frames-384/Tiro Libero/) - 22 frames
- [Tiro da 3](./frames-384/Tiro da 3/) - 22 frames
- [Tirp a centrocampo](./frames-384/Tirp a centrocampo/) - 33 frames

### 640 Model Frames
- [Tiro Libero](./frames-640/Tiro Libero/) - 22 frames
- [Tiro da 3](./frames-640/Tiro da 3/) - 22 frames
- [Tirp a centrocampo](./frames-640/Tirp a centrocampo/) - 33 frames

**Bounding Box Colors:**
- 🟢 Green: ball (palla)
- 🔵 Blue: player (giocatore)
- 🔴 Red: rim (canestro)

Each bounding box includes the confidence score.

### Detection Quality Analysis (82 frames, 3 videos)

**Player:**
- Single blue box always on the player
- Confidence scores: 0.79 - 0.92
- No false positives on trees, poles, or graffiti

**Ball:**
- Green box follows the ball in hand, in flight (arc toward rim), and on ground after shot
- Even when ball is small and distant, box is on the ball, not other objects
- Accurate tracking throughout shot sequence

**Rim:**
- No rim detections in any frame (verified in CSV)
- Model appears silent on rim detection for these clips

**Conclusion:**
With correct input scaling (0-1), the model performs well on these test videos. The false positives observed in earlier benchmarks were artifacts of incorrect input scaling (0-255), not model defects. With scores of 0.8-0.9 on player and ball, the original reasonable thresholds (ball ~0.25, player ~0.35) are sufficient. Temporary thresholds and geometric filters are not needed to correct the model, though they can remain as protection.

## Device Investigation Recommendations

The offline benchmark shows the model works correctly, but on-device behavior differs (player scores ~0.002, ball gives high scores on wide/flat boxes with aspect ~2.5:1). The difference is in the device pipeline, not the model itself.

### Verification Steps (in order)

1. **Frame Orientation:**
   - Check if camera delivers rotated frames (sensor landscape with phone portrait)
   - Wide/flat boxes and zero player scores are typical symptoms
   - Verify how the resizer handles orientation

2. **Delegate:**
   - Try CPU delegate instead of android-gpu
   - GPU delegate with float16 models can produce different outputs

3. **Direct Comparison:**
   - Display "Tiro Libero" video in front of camera, or pass a single fixed frame to pipeline
   - Compare [YOLO RAW] logs with offline results for the same frame
   - If they match, model and preprocessing are correct, problem is scene or camera

4. **Camera Resolution:**
   - Use moderate resolution (1280×720) instead of 4000×2252

5. **Keep [YOLO RAW] logs:**
   - Useful for these comparisons
   - Can be removed once device scores match offline scores

## Detection Thresholds

- **Ball:** 0.05 (adaptive)
- **Player:** 0.01 (adaptive)
- **Rim:** 0.10 (adaptive)

The app-compatible decoder implements adaptive confidence thresholds that adjust based on detection history and confidence levels.

## Data Files

- [best_384_float16_detections.csv](./best_384_float16_detections.csv) - Raw detection data
- [best_640_float16_detections.csv](./best_640_float16_detections.csv) - Raw detection data
- [manifest.json](./manifest.json) - Full benchmark metadata

## Limitations

This is an offline CPU benchmark and does not represent on-device performance:
- OpenCV preprocessing differs from native react-native-vision-camera-resizer
- Python runtime differs from React Native environment
- No GPU/accelerator delegate testing
- No ground-truth precision/recall metrics (requires manual annotation)

For production performance, run on-device tests with the actual app.
