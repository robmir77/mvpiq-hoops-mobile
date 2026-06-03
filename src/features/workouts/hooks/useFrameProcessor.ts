// src/features/workouts/hooks/useFrameProcessor.ts
//
// Frame Processor per VisionCamera che processa YUV frames direttamente
// senza passare da JPEG/Base64/jpeg-js.
// Pipeline: YUV → RGB → Resize 320x320 → ONNX
//
// Questo elimina il collo di bottiglia del decode JPEG (1600-1700ms → 20-50ms)

import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useFrameProcessor as useVisionCameraFrameProcessor } from 'react-native-vision-camera'
import { useResizePlugin } from 'vision-camera-resize-plugin'
import { useSharedValue } from 'react-native-reanimated'
import { Worklets } from 'react-native-worklets-core'
import { InferenceSession, Tensor } from 'onnxruntime-react-native'
import { DetectionResult } from '../types/workouts.types'
import type { Frame } from 'react-native-vision-camera'

const INPUT_SIZE = 320
const NMS_IOU_THRESHOLD = 0.4
const CONF_THRESHOLD_BALL = 0.01
const COCO_SPORTS_BALL = 32

// ─────────────────────────────────────────────────────────────
// IOU + NMS (copied from useBallDetection for use in JS thread)
// ─────────────────────────────────────────────────────────────

function iou(a: number[], b: number[]): number {
    const ix1 = Math.max(a[0], b[0]);  const iy1 = Math.max(a[1], b[1])
    const ix2 = Math.min(a[2], b[2]);  const iy2 = Math.min(a[3], b[3])
    const inter = Math.max(0, ix2 - ix1) * Math.max(0, iy2 - iy1)
    return inter / ((a[2]-a[0])*(a[3]-a[1]) + (b[2]-b[0])*(b[3]-b[1]) - inter + 1e-6)
}

function nms(dets: number[][], thr: number): number[][] {
    const s = [...dets].sort((a, b) => b[4] - a[4])
    const kept: number[][] = []
    const skip = new Set<number>()
    for (let i = 0; i < s.length; i++) {
        if (skip.has(i)) continue
        kept.push(s[i])
        for (let j = i + 1; j < s.length; j++) {
            if (iou(s[i], s[j]) > thr) skip.add(j)
        }
    }
    return kept
}

// ─────────────────────────────────────────────────────────────
// YOLO PARSER
// ─────────────────────────────────────────────────────────────

function parseYoloOutput(
    output: Float32Array,
    dims: readonly number[],
    imgW: number,
    imgH: number
): DetectionResult[] {
    const N   = dims[2]
    const col = (4 + COCO_SPORTS_BALL) * N

    const raw: number[][] = []
    const threshold = CONF_THRESHOLD_BALL

    for (let i = 0; i < N; i++) {
        const score = output[col + i]
        if (score < threshold) continue

        const cx = output[i]
        const cy = output[N + i]
        const w  = output[N * 2 + i]
        const h  = output[N * 3 + i]

        raw.push([
            (cx - w * 0.5) / INPUT_SIZE,
            (cy - h * 0.5) / INPUT_SIZE,
            (cx + w * 0.5) / INPUT_SIZE,
            (cy + h * 0.5) / INPUT_SIZE,
            score,
            COCO_SPORTS_BALL
        ])
    }

    return nms(raw, NMS_IOU_THRESHOLD)
        .map(([x1, y1, x2, y2, conf]) => ({
            class: 'basketball',
            confidence: conf,
            bbox: {
                x:      x1 * imgW,
                y:      y1 * imgH,
                width:  (x2 - x1) * imgW,
                height: (y2 - y1) * imgH,
            },
            centerX: (x1 + x2) / 2,
            centerY: (y1 + y2) / 2,
        }))
}

// ─────────────────────────────────────────────────────────────
// PREPROCESS — RGB packed -> Float32 CHW [1,3,INPUT_SIZE,INPUT_SIZE]
// ─────────────────────────────────────────────────────────────

function preprocessFrame(
    src: Uint8Array | number[],
    srcWidth: number,
    srcHeight: number,
    out: Float32Array
): void {
    const invW      = srcWidth  / INPUT_SIZE
    const invH      = srcHeight / INPUT_SIZE
    const plane     = INPUT_SIZE * INPUT_SIZE
    const inv255    = 1 / 255.0

    for (let y = 0; y < INPUT_SIZE; y++) {
        const srcY = Math.min((y * invH) | 0, srcHeight - 1)
        const rowBase = srcY * srcWidth
        const outRowR = y * INPUT_SIZE
        for (let x = 0; x < INPUT_SIZE; x++) {
            const srcX   = Math.min((x * invW) | 0, srcWidth - 1)
            const srcIdx = (rowBase + srcX) * 3
            const outIdx = outRowR + x
            out[outIdx]          = src[srcIdx]     * inv255   // R plane
            out[plane + outIdx]  = src[srcIdx + 1] * inv255   // G plane
            out[plane * 2 + outIdx] = src[srcIdx + 2] * inv255 // B plane
        }
    }
}

// ─────────────────────────────────────────────────────────────
// HOOK
// ─────────────────────────────────────────────────────────────

export interface FrameProcessorResult {
    ball: DetectionResult | null
    frameTimestamp: number
}

export const useFrameProcessor = (
    sessionRef: React.RefObject<InferenceSession | null>,
    onDetection: (result: FrameProcessorResult) => void,
    enabled: boolean = true
) => {
    const isProcessing = useRef(false)
    const onDetectionRef = useRef(onDetection)
    const sessionRefCopy = useRef(sessionRef)
    const lastProcessTime = useRef(0)

    // Reuse tensor buffer to avoid GC pressure (1.2 MB allocation per frame)
    const inputBufferRef = useRef(new Float32Array(3 * INPUT_SIZE * INPUT_SIZE))

    // Use native resize plugin
    const { resize } = useResizePlugin()

    // Update refs when values change
    useEffect(() => {
        onDetectionRef.current = onDetection
        sessionRefCopy.current = sessionRef
    }, [onDetection, sessionRef])

    // SharedValue for lock (works across worklet/JS boundary)
    const isProcessingShared = useSharedValue(0)

    // Create runOnJS function using createRunOnJS - with SharedValue lock and timing
    const processFrameDataJS = useMemo(() => {
        return Worklets.createRunOnJS(async (rgbArray: number[]) => {
            if (isProcessingShared.value === 1) {
                return
            }

            isProcessingShared.value = 1

            preprocessFrame(rgbArray, INPUT_SIZE, INPUT_SIZE, inputBufferRef.current)

            const tensor = new Tensor('float32', inputBufferRef.current, [1, 3, INPUT_SIZE, INPUT_SIZE])

            const currentSession = sessionRefCopy.current
            if (!currentSession?.current) {
                isProcessingShared.value = 0
                return
            }

            const outputs = await currentSession.current.run({ images: tensor })

            const output = outputs[Object.keys(outputs)[0]]
            if (!output) {
                isProcessingShared.value = 0
                return
            }

            const detections = parseYoloOutput(
                output.data as Float32Array,
                output.dims,
                INPUT_SIZE,
                INPUT_SIZE
            )

            const ballDet = detections.find(d => d.class === 'basketball') ?? null

            onDetectionRef.current({
                ball: ballDet,
                frameTimestamp: Date.now()
            })

            isProcessingShared.value = 0
        })
    }, [])

    // Frame processor worklet
    const frameProcessor = useVisionCameraFrameProcessor((frame: Frame) => {
        'worklet'

        if (!enabled) return

        // Use native resize from vision-camera-resize-plugin
        const resized = resize(frame, {
            scale: { width: INPUT_SIZE, height: INPUT_SIZE },
            pixelFormat: 'rgb',
            dataType: 'uint8'
        })

        processFrameDataJS(Array.from(resized))
    }, [enabled, resize, processFrameDataJS])

    // SharedValue for throttling
    const lastProcessTimeShared = useSharedValue(0)

    return frameProcessor
}
