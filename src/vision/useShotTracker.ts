// src/vision/useShotTracker.ts
//
// Orchestrates ball detection, pose detection, and shot analysis
// Both YOLO and MoveNet run entirely in Frame Processor Worklet
// Only processed data (BallDetection, PoseResult, ShotEvent) crosses to JS
// No snapshot mechanism - pose detection runs continuously with throttling

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

const YOLO_INPUT_SIZE = 320
const POSE_INPUT_SIZE = 192
const POSE_INTERVAL_MS = 2000 // Run every 2 seconds
const SHOT_CANDIDATE_THRESHOLD_Y = 0.3 // Ball above 30% of frame height
const SHOT_CANDIDATE_VELOCITY_Y = -50 // Ball moving upward

export const useShotTracker = (
  onBallDetection: (detection: BallDetection) => void,
  onPoseResult: (result: PoseResult) => void,
  onShotEvent: (event: ShotEvent) => void,
  rimFromCalibration?: { x: number; y: number; width: number; height: number } | null
) => {
  const shotDetector = useRef(new ShotDetector())
  const lastBallRef = useRef<{ x: number; y: number; t: number } | null>(null)
  const lastPoseTs = useSharedValue(0)

  // Load YOLO model
  const yoloModel = useTensorflowModel(
    require('../../assets/models/ball_rimV8_float16.tflite'),
    'nnapi'
  )

  // Load MoveNet model
  const poseModel = useTensorflowModel(
    require('../../assets/models/movenet_lightning_int8.tflite'),
    'nnapi'
  )

  // Callback refs
  const onPoseResultRef = useRef(onPoseResult)

  useEffect(() => {
    onPoseResultRef.current = onPoseResult
  }, [onPoseResult])

  // Shot detection callback - runs on JS thread after ball detection
  const handleBallDetectionForShotTracking = useCallback((detection: BallDetection) => {
    const { ball } = detection

    if (ball) {
      // Update trajectory
      shotDetector.current.updateTrajectory(ball)

      // Calculate velocity
      const prev = lastBallRef.current
      let velocity = { vx: 0, vy: 0 }
      if (prev) {
        const dt = (detection.timestamp - prev.t) / 1000
        if (dt > 0) {
          const centerX = ball.x + ball.width / 2
          const centerY = ball.y + ball.height / 2
          velocity = {
            vx: (centerX - prev.x) / dt,
            vy: (centerY - prev.y) / dt,
          }
        }
      }

      lastBallRef.current = {
        x: ball.x + ball.width / 2,
        y: ball.y + ball.height / 2,
        t: detection.timestamp,
      }

      // Detect shot events
      if (shotDetector.current.detectShotStart(ball)) {
        console.log('[ShotTracker] Shot started')
      }

      if (shotDetector.current.detectShotRelease()) {
        console.log('[ShotTracker] Shot released')
        const shotEvent = shotDetector.current.getShotEvent()
        if (shotEvent) onShotEvent(shotEvent)
      }

      if (shotDetector.current.detectShotMade(rimFromCalibration || null)) {
        console.log('[ShotTracker] Shot made!')
        const shotEvent = shotDetector.current.getShotEvent()
        if (shotEvent) onShotEvent(shotEvent)
        shotDetector.current.reset()
      }
    }
  }, [onShotEvent, rimFromCalibration])

  // Wrap the original onBallDetection to include shot tracking
  const wrappedOnBallDetection = useCallback((detection: BallDetection) => {
    onBallDetection(detection)
    handleBallDetectionForShotTracking(detection)
  }, [onBallDetection, handleBallDetectionForShotTracking])

  // Refs for runOnJS callbacks to avoid stale closures
  const wrappedOnBallDetectionRef = useRef(wrappedOnBallDetection)
  useEffect(() => {
    wrappedOnBallDetectionRef.current = wrappedOnBallDetection
  }, [wrappedOnBallDetection])

  // Create runOnJS callbacks
  const onBallDetectionJS = useRef(
    (Worklets.createRunOnJS as any)((detection: BallDetection) => {
      incrementYoloFps()
      wrappedOnBallDetectionRef.current(detection)
    })
  ).current

  const onPoseResultJS = useRef(
    (Worklets.createRunOnJS as any)((result: PoseResult) => {
      incrementMoveNetFps()
      onPoseResultRef.current(result)
    })
  ).current

  const { resize } = useResizePlugin()

  // Combined frame processor - runs both YOLO and MoveNet in worklet
  const frameProcessor = useVisionCameraFrameProcessor((frame: Frame) => {
    'worklet'

    const yoloReady = yoloModel.state === 'loaded' && yoloModel.model != null
    const poseReady = poseModel.state === 'loaded' && poseModel.model != null

    if (!yoloReady) return

    // === YOLO Detection (runs every frame) ===
    const yoloModelInstance = yoloModel.model

    // Resize frame to 320x320 RGB float32 using native plugin
    const yoloResized = resize(frame, {
      scale: { width: YOLO_INPUT_SIZE, height: YOLO_INPUT_SIZE },
      pixelFormat: 'rgb',
      dataType: 'float32',
    })

    // Convert HWC to CHW for YOLO
    const plane = YOLO_INPUT_SIZE * YOLO_INPUT_SIZE
    const chw = new Float32Array(3 * plane)
    for (let i = 0; i < plane; i++) {
      chw[i] = yoloResized[i * 3]
      chw[plane + i] = yoloResized[i * 3 + 1]
      chw[plane * 2 + i] = yoloResized[i * 3 + 2]
    }

    console.log('[YOLO Input] Sample values:', chw[0].toFixed(2), chw[1].toFixed(2), chw[2].toFixed(2), 'min:', Math.min(...chw.slice(0, 100)).toFixed(2), 'max:', Math.max(...chw.slice(0, 100)).toFixed(2))

    // Run YOLO inference
    const yoloOutputs = yoloModelInstance.runSync([chw])
    const yoloOutput = yoloOutputs[0] as Float32Array | Uint8Array | Int8Array

    // Parse YOLO output
    const { ball } = parseYoloOutput(yoloOutput)

    // Log sport ball detection
    if (ball) {
      console.log('[YOLO] Sport ball detected:', {
        x: ball.x.toFixed(2),
        y: ball.y.toFixed(2),
        width: ball.width.toFixed(2),
        height: ball.height.toFixed(2),
        confidence: ball.confidence.toFixed(3),
      })
    }

    // Send ball detection to JS
    const timestamp = Date.now()
    onBallDetectionJS({
      ball: ball ? {
        x: ball.x,
        y: ball.y,
        width: ball.width,
        height: ball.height,
        confidence: ball.confidence,
      } : undefined,
      timestamp,
    })

    // === MoveNet Pose Detection (throttled) ===
    if (!poseReady) return
    
    // Only run pose detection if ball is detected
    if (!ball) return

    const now = Date.now()
    if (now - lastPoseTs.value < POSE_INTERVAL_MS) return
    lastPoseTs.value = now

    const poseModelInstance = poseModel.model

    // Resize frame to 192x192 RGB uint8 using native plugin
    const poseResized = resize(frame, {
      scale: { width: POSE_INPUT_SIZE, height: POSE_INPUT_SIZE },
      pixelFormat: 'rgb',
      dataType: 'uint8',
    })

    // Run MoveNet inference
    const poseOutputs = poseModelInstance.runSync([poseResized])
    const poseOutputData = poseOutputs[0] as Float32Array

    // Parse output to keypoints
    const keypoints = parseMoveNetOutput(poseOutputData)
    const angles = computeJointAngles(keypoints as PoseKeypoints)

    // Send pose result to JS
    onPoseResultJS({
      keypoints: keypoints as PoseKeypoints,
      angles,
      timestamp: now,
    })
  }, [yoloModel.state, yoloModel.model, poseModel.state, poseModel.model, resize, onBallDetectionJS, onPoseResultJS])

  const resetShotTracking = useCallback(() => {
    shotDetector.current.reset()
    lastBallRef.current = null
  }, [])

  const isModelReady = yoloModel.state === 'loaded' && yoloModel.model != null && poseModel.state === 'loaded' && poseModel.model != null

  return {
    frameProcessor,
    isModelReady,
    resetShotTracking,
  }
}
