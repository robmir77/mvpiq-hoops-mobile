// src/vision/usePoseDetector.ts
//
// MoveNet Pose Detection - runs on JS thread
// Triggered separately via camera snapshot mechanism
// Does NOT receive frame data directly - uses camera.takeSnapshot()
// Only PoseResult (keypoints + angles) crosses to JS

import { useEffect, useRef, useCallback, useState } from 'react'
import { useTensorflowModel } from 'react-native-fast-tflite'
import { parseMoveNetOutput } from './poseParser'
import { computeJointAngles } from './biomechanics'
import type { PoseKeypoints, JointAngles, PoseResult } from './types'

const INPUT_SIZE = 192
const POSE_INTERVAL_MS = 500 // Max 2fps - MoveNet is lower priority than YOLO

// Preprocessing: Convert snapshot to 192x192 HWC Uint8
function preprocessSnapshot(
  snapshot: Uint8Array,
  srcWidth: number,
  srcHeight: number,
  out: Uint8Array // Pre-allocated: 192*192*3
): void {
  const scaleX = srcWidth / INPUT_SIZE
  const scaleY = srcHeight / INPUT_SIZE

  for (let y = 0; y < INPUT_SIZE; y++) {
    const srcY = Math.min((y * scaleY) | 0, srcHeight - 1)
    for (let x = 0; x < INPUT_SIZE; x++) {
      const srcX = Math.min((x * scaleX) | 0, srcWidth - 1)
      const outIdx = (y * INPUT_SIZE + x) * 3
      const srcIdx = (srcY * srcWidth + srcX) * 3
      // Assume RGB format
      out[outIdx] = snapshot[srcIdx] // R
      out[outIdx + 1] = snapshot[srcIdx + 1] // G
      out[outIdx + 2] = snapshot[srcIdx + 2] // B
    }
  }
}

export const usePoseDetector = (
  onPose: (result: PoseResult) => void
) => {
  const lastPoseTs = useRef(0)
  const [isReady, setIsReady] = useState(false)

  // Pre-allocated buffer - avoids GC per inference
  const poseInputBuffer = useRef(new Uint8Array(INPUT_SIZE * INPUT_SIZE * 3))

  // Load MoveNet model
  const tfModel = useTensorflowModel(
    require('../../assets/models/movenet_lightning_int8.tflite'),
    'nnapi'
  )

  // Keep model reference
  const modelRef = useRef<any>(null)
  useEffect(() => {
    if (tfModel.state === 'loaded' && tfModel.model != null) {
      modelRef.current = tfModel.model
      setIsReady(true)
    } else {
      modelRef.current = null
    }
  }, [tfModel.state])

  const onPoseRef = useRef(onPose)
  useEffect(() => {
    onPoseRef.current = onPose
  }, [onPose])

  // Run pose detection from camera snapshot
  // Caller should use camera.takeSnapshot() to get the image
  const runPoseFromSnapshot = useCallback((
    snapshot: Uint8Array,
    width: number,
    height: number
  ) => {
    console.log('[PoseDetector] runPoseFromSnapshot called')
    const model = modelRef.current
    if (model == null) {
      console.log('[PoseDetector] Model not ready')
      return
    }

    const now = Date.now()
    if (now - lastPoseTs.current < POSE_INTERVAL_MS) {
      console.log('[PoseDetector] Throttled - last pose was', now - lastPoseTs.current, 'ms ago')
      return
    }
    lastPoseTs.current = now

    try {
      console.log('[PoseDetector] Running inference on snapshot', width, 'x', height)
      // Convert snapshot to 192x192 HWC Uint8 in pre-allocated buffer
      preprocessSnapshot(snapshot, width, height, poseInputBuffer.current)

      // Run MoveNet inference - JSI direct, no await
      const outputs = model.runSync([poseInputBuffer.current])
      const outputData = outputs[0] as Float32Array

      // Parse output to keypoints
      const keypoints = parseMoveNetOutput(outputData)
      console.log('[PoseDetector] Keypoints detected:', Object.keys(keypoints).length)
      const angles = computeJointAngles(keypoints as PoseKeypoints)

      // Send result to callback
      onPoseRef.current({
        keypoints: keypoints as PoseKeypoints,
        angles,
        timestamp: now,
      })
    } catch (e) {
      console.error('[PoseDetector] Inference error:', e)
    }
  }, [])

  return { runPoseFromSnapshot, isReady }
}
