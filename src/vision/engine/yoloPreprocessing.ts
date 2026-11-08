// YOLO input preprocessing shared by the static benchmark and live camera path.
// The recorded Python reference run feeds RGB float32 values in the 0..255 range.
// VisionCamera Resizer float32 output is normalized to 0..1, so the live path
// scales it to reproduce that reference input range before invoking TFLite.

export function resizerFloat32ToYoloInput(source: Float32Array): Float32Array {
  const input = new Float32Array(source.length)
  for (let i = 0; i < source.length; i++) {
    input[i] = source[i] * 255
  }
  return input
}

// RGB input is interleaved and contains unnormalized channel values in 0..255.
// Uses half-pixel bilinear sampling, matching OpenCV INTER_LINEAR's resize
// coordinate convention, followed by centered contain/letterbox padding.
export function letterboxRgbToYoloInput(
  source: Float32Array,
  sourceWidth: number,
  sourceHeight: number,
  targetSize: number,
): Float32Array {
  if (!Number.isInteger(sourceWidth) || sourceWidth <= 0 ||
      !Number.isInteger(sourceHeight) || sourceHeight <= 0 ||
      !Number.isInteger(targetSize) || targetSize <= 0 ||
      source.length !== sourceWidth * sourceHeight * 3) {
    throw new Error('Invalid RGB image dimensions or buffer length for YOLO preprocessing')
  }

  const scale = Math.min(targetSize / sourceWidth, targetSize / sourceHeight)
  const resizedWidth = Math.max(1, Math.round(sourceWidth * scale))
  const resizedHeight = Math.max(1, Math.round(sourceHeight * scale))
  const offsetX = Math.floor((targetSize - resizedWidth) / 2)
  const offsetY = Math.floor((targetSize - resizedHeight) / 2)
  const output = new Float32Array(targetSize * targetSize * 3)

  for (let y = 0; y < resizedHeight; y++) {
    const sourceY = Math.max(0, Math.min(sourceHeight - 1,
      (y + 0.5) * sourceHeight / resizedHeight - 0.5))
    const y0 = Math.floor(sourceY)
    const y1 = Math.min(sourceHeight - 1, y0 + 1)
    const fy = sourceY - y0

    for (let x = 0; x < resizedWidth; x++) {
      const sourceX = Math.max(0, Math.min(sourceWidth - 1,
        (x + 0.5) * sourceWidth / resizedWidth - 0.5))
      const x0 = Math.floor(sourceX)
      const x1 = Math.min(sourceWidth - 1, x0 + 1)
      const fx = sourceX - x0
      const destination = ((y + offsetY) * targetSize + x + offsetX) * 3
      const topLeft = (y0 * sourceWidth + x0) * 3
      const topRight = (y0 * sourceWidth + x1) * 3
      const bottomLeft = (y1 * sourceWidth + x0) * 3
      const bottomRight = (y1 * sourceWidth + x1) * 3

      for (let channel = 0; channel < 3; channel++) {
        const top = source[topLeft + channel] * (1 - fx) + source[topRight + channel] * fx
        const bottom = source[bottomLeft + channel] * (1 - fx) + source[bottomRight + channel] * fx
        output[destination + channel] = top * (1 - fy) + bottom * fy
      }
    }
  }

  return output
}
