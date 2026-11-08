import { letterboxRgbToYoloInput, resizerFloat32ToYoloInput } from '../engine/yoloPreprocessing'

describe('YOLO preprocessing', () => {
  it('converts VisionCamera normalized float32 RGB values to the model 0..255 range', () => {
    const source = new Float32Array([0, 0.5, 1, 0.25, 0.75, 0.1])
    expect(Array.from(resizerFloat32ToYoloInput(source))).toEqual([0, 127.5, 255, 63.75, 191.25, 25.5])
    // Scaling must not mutate the Resizer-owned source buffer.
    expect(Array.from(source.slice(0, 5))).toEqual([0, 0.5, 1, 0.25, 0.75])
    expect(source[5]).toBeCloseTo(0.1, 7)
  })

  it('keeps RGB channel order and source values when no resize is needed', () => {
    const source = new Float32Array([255, 0, 0, 0, 128, 0, 0, 0, 255])
    const result = letterboxRgbToYoloInput(source, 3, 1, 3)
    // The 3x1 image is vertically centered in the 3x3 target (row 1).
    expect(Array.from(result.slice(9, 18))).toEqual(Array.from(source))
  })

  it('uses bilinear interpolation and zero letterbox padding', () => {
    const source = new Float32Array([
      0, 0, 0, 100, 100, 100,
      200, 200, 200, 255, 255, 255,
    ])
    const result = letterboxRgbToYoloInput(source, 2, 2, 1)
    expect(result[0]).toBeCloseTo(138.75, 5)
    expect(result[1]).toBeCloseTo(138.75, 5)
    expect(result[2]).toBeCloseTo(138.75, 5)
  })

  it('rejects inconsistent image dimensions', () => {
    expect(() => letterboxRgbToYoloInput(new Float32Array(3), 2, 2, 640)).toThrow()
  })
})
