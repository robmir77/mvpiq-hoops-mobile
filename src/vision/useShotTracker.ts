// src/vision/useShotTracker.ts
//
// Orchestrates ball detection, pose detection, and shot analysis.
// Both YOLO and MoveNet run entirely in the Frame Processor Worklet.
// Only processed results (BallDetection, PoseResult, ShotEvent) cross to JS.

import { useRef, useCallback, useEffect } from 'react'
import { useSharedValue } from 'react-native-worklets-core'
import { useFrameProcessor as useVisionCameraFrameProcessor } from 'react-native-vision-camera'
import { useResizePlugin } from 'vision-camera-resize-plugin'
import { Worklets } from 'react-native-worklets-core'
import { useTensorflowModel } from 'react-native-fast-tflite'
import type { Frame } from 'react-native-vision-camera'
import { parseYoloOutput } from './yoloParser'
import { parseMoveNetOutput } from './poseParser'
import { computeJointAngles } from './biomechanics'
import { ShotDetector } from './shotDetector'
import type { BallDetection, PoseResult, ShotEvent, PoseKeypoints, JointAngles } from './types'
import { incrementYoloFps, incrementMoveNetFps } from '@/features/workouts/hooks/usePerformanceMonitor'

// ── Model input sizes ──────────────────────────────────────────────────────────
const YOLO_INPUT_SIZE = 320   // yolo-football-ball-detection exported at imgsz=320
const POSE_INPUT_SIZE = 192   // MoveNet Lightning

// ── Pose throttle: run at most once every 2 s, only when ball is visible ───────
const POSE_INTERVAL_MS = 2000

export const useShotTracker = (
  onBallDetection: (detection: BallDetection) => void,
  onPoseResult:   (result: PoseResult) => void,
  onShotEvent:    (event: ShotEvent) => void,
  onRimDetection?: (rim: { x: number; y: number; width: number; height: number; confidence: number }) => void,
  rimFromCalibration?: { x: number; y: number; width: number; height: number } | null,
) => {
  const shotDetector = useRef(new ShotDetector())
  const lastBallRef  = useRef<{ x: number; y: number; t: number } | null>(null)
  const lastPoseTs   = useSharedValue(0)
  const RIM_CONFIDENCE_THRESHOLD = 0.5 // Soglia confidence per sostituire rim calibrato (ridotta da 0.7)

  // ── Adaptive confidence threshold ─────────────────────────────────────────────
  const adaptiveThreshold = useSharedValue(0.05)
  const detectionHistory = useRef<Array<{ confidence: number; timestamp: number }>>([])
  const TARGET_DETECTION_RATE = 0.3  // Target: 30% of frames should have detections
  const ADAPTATION_WINDOW_MS = 2000  // Adjust threshold every 2 seconds

  // ── Model loading ────────────────────────────────────────────────────────────
  // Single-class football/basketball detector (320×320, float16, NHWC TFLite)
  const yoloModel = useTensorflowModel(
    require('../../assets/models/ball_rimV8_float16.tflite'),
    'nnapi',
  )
  const poseModel = useTensorflowModel(
    require('../../assets/models/movenet_lightning_int8.tflite'),
    'nnapi',
  )

  // ── Callback refs ────────────────────────────────────────────────────────────
  const onPoseResultRef = useRef(onPoseResult)
  const onRimDetectionRef = useRef(onRimDetection)
  useEffect(() => { onPoseResultRef.current = onPoseResult }, [onPoseResult])
  useEffect(() => { onRimDetectionRef.current = onRimDetection }, [onRimDetection])

  // ── Adaptive threshold adjustment (JS thread) ───────────────────────────────
  const lastAdjustmentTs = useRef(0)
  const updateAdaptiveThreshold = useCallback((ball: { confidence: number } | null | undefined) => {
    const now = Date.now()
    detectionHistory.current.push({ confidence: ball?.confidence ?? 0, timestamp: now })

    // Remove old entries outside adaptation window
    detectionHistory.current = detectionHistory.current.filter(
      d => now - d.timestamp < ADAPTATION_WINDOW_MS
    )

    // Adjust threshold every ADAPTATION_WINDOW_MS
    if (now - lastAdjustmentTs.current > ADAPTATION_WINDOW_MS && detectionHistory.current.length > 10) {
      lastAdjustmentTs.current = now
      const totalFrames = detectionHistory.current.length
      const detectedFrames = detectionHistory.current.filter(d => d.confidence > 0).length
      const detectionRate = detectedFrames / totalFrames

      // Increase threshold if too many detections (false positives)
      // Decrease threshold if too few detections (false negatives)
      const adjustment = 0.01
      if (detectionRate > TARGET_DETECTION_RATE * 1.5) {
        adaptiveThreshold.value = Math.min(0.3, adaptiveThreshold.value + adjustment)
      } else if (detectionRate < TARGET_DETECTION_RATE * 0.5) {
        adaptiveThreshold.value = Math.max(0.02, adaptiveThreshold.value - adjustment)
      }

      // Log the current detection rate and adaptive threshold for monitoring
      console.log('[AdaptiveThreshold] Rate:', detectionRate.toFixed(2), 'Threshold:', adaptiveThreshold.value.toFixed(3))
    }
  }, [])

  // ── Shot detection (JS thread) ───────────────────────────────────────────────
  const handleBallDetectionForShotTracking = useCallback((detection: BallDetection) => {
    const { ball } = detection

    // Update adaptive threshold
    updateAdaptiveThreshold(ball)

    if (!ball) {
      // Reset trajectory if ball disappears for >300 ms
      const now = Date.now()
      if (lastBallRef.current && now - lastBallRef.current.t > 300) {
        shotDetector.current.reset()
        lastBallRef.current = null
      }
      return
    }

    shotDetector.current.updateTrajectory(ball)

    const prev = lastBallRef.current
    if (prev) {
      const dt = (detection.timestamp - prev.t) / 1000
      if (dt > 0) {
        // velocity available inside ShotDetector via trajectory
      }
    }

    lastBallRef.current = {
      x: ball.x + ball.width  / 2,
      y: ball.y + ball.height / 2,
      t: detection.timestamp,
    }

    if (shotDetector.current.detectShotStart(ball))    console.log('[ShotTracker] Shot started')
    if (shotDetector.current.detectShotRelease()) {
      // Log when shot release is detected
      console.log('[ShotTracker] Shot released')
      const ev = shotDetector.current.getShotEvent()
      if (ev) onShotEvent(ev)
    }
    if (shotDetector.current.detectShotMade(rimFromCalibration || null)) {
      // Log when shot is detected as made
      console.log('[ShotTracker] Shot made!')
      const ev = shotDetector.current.getShotEvent()
      if (ev) onShotEvent(ev)
      shotDetector.current.reset()
    }
  }, [onShotEvent, rimFromCalibration])

  const wrappedOnBallDetection = useCallback((detection: BallDetection) => {
    onBallDetection(detection)
    handleBallDetectionForShotTracking(detection)

    // Handle rim detection - replace calibrated rim if confidence is high
    if (detection.rim && detection.rim.confidence > RIM_CONFIDENCE_THRESHOLD) {
      console.log('[ShotTracker] Rim detected with high confidence:', detection.rim.confidence.toFixed(3))
      if (onRimDetectionRef.current) {
        onRimDetectionRef.current(detection.rim)
      }
    }
  }, [onBallDetection, handleBallDetectionForShotTracking])

  const wrappedOnBallDetectionRef = useRef(wrappedOnBallDetection)
  useEffect(() => { wrappedOnBallDetectionRef.current = wrappedOnBallDetection }, [wrappedOnBallDetection])

  // ── runOnJS bridges (created once) ──────────────────────────────────────────
  const onBallDetectionJS = useRef(
    (Worklets.createRunOnJS as any)((detection: BallDetection) => {
      incrementYoloFps()
      wrappedOnBallDetectionRef.current(detection)
    }),
  ).current

  const onPoseResultJS = useRef(
    (Worklets.createRunOnJS as any)((result: PoseResult) => {
      incrementMoveNetFps()
      onPoseResultRef.current(result)
    }),
  ).current

  const { resize } = useResizePlugin()

  // ── Frame Processor (worklet) ────────────────────────────────────────────────
  const frameProcessor = useVisionCameraFrameProcessor((frame: Frame) => {
    'worklet'

    const yoloReady = yoloModel.state === 'loaded' && yoloModel.model != null
    if (!yoloReady) return

    // ── 1. YOLO ──────────────────────────────────────────────────────────────
    // Resize camera frame → 320×320 RGB float32 (HWC, range 0-1).
    // The model is a TFLite export (NHWC) — NO HWC→CHW conversion needed.
    const yoloResized = resize(frame, {
      scale:       { width: YOLO_INPUT_SIZE, height: YOLO_INPUT_SIZE },
      pixelFormat: 'rgb',
      dataType:    'float32',  // produces float32 HWC in 0-1 range
    })

    const yoloOutputs = yoloModel.model!.runSync([yoloResized])
    const yoloOutput  = yoloOutputs[0] as Float32Array

    const { ball, rim } = parseYoloOutput(yoloOutput, adaptiveThreshold.value)

    onBallDetectionJS({
      ball: ball ?? undefined,
      rim: rim ?? undefined,
      timestamp: Date.now(),
    })

    // ── 2. MoveNet — only when ball detected, throttled ──────────────────────
    if (!ball) return

    const poseReady = poseModel.state === 'loaded' && poseModel.model != null
    if (!poseReady) return

    const now = Date.now()
    if (now - lastPoseTs.value < POSE_INTERVAL_MS) return
    lastPoseTs.value = now

    const poseResized = resize(frame, {
      scale:       { width: POSE_INPUT_SIZE, height: POSE_INPUT_SIZE },
      pixelFormat: 'rgb',
      dataType:    'uint8',   // MoveNet INT8 expects uint8 HWC
    })

    const poseOutputs = poseModel.model!.runSync([poseResized])
    const poseOutput  = poseOutputs[0] as Float32Array

    const keypoints = parseMoveNetOutput(poseOutput)
    const angles    = computeJointAngles(keypoints as PoseKeypoints)

    onPoseResultJS({ keypoints: keypoints as PoseKeypoints, angles, timestamp: now })

  }, [yoloModel.state, yoloModel.model, poseModel.state, poseModel.model, resize, onBallDetectionJS, onPoseResultJS])

  const resetShotTracking = useCallback(() => {
    shotDetector.current.reset()
    lastBallRef.current = null
  }, [])

  const isModelReady =
    yoloModel.state === 'loaded' && yoloModel.model != null &&
    poseModel.state === 'loaded' && poseModel.model != null

  return { frameProcessor, isModelReady, resetShotTracking }
}
