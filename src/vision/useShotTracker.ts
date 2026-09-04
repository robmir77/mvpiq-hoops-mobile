// src/vision/useShotTracker.ts
//
// Orchestrates ball detection, pose detection, and shot analysis.
// Both YOLO and MoveNet run entirely in the Frame Processor Worklet.
// Only processed results (BallDetection, PoseResult, ShotEvent) cross to JS.

import { useRef, useCallback, useEffect } from 'react'
import { Platform } from 'react-native'
import { useSharedValue } from 'react-native-reanimated'
import { useFrameOutput } from 'react-native-vision-camera'
import { useResizer } from 'react-native-vision-camera-resizer'
import { scheduleOnRN } from 'react-native-worklets'
import { useTensorflowModel } from 'react-native-fast-tflite'
import type { Frame } from 'react-native-vision-camera'
import { parseYoloOutput, setCropParameters } from './yoloParser'
import { parseMoveNetOutput } from './poseParser'
import { computeJointAngles } from './biomechanics'
import { ShotDetector } from './shotDetector'
import type { BallDetection, PoseResult, ShotEvent, PoseKeypoints } from './types'
import { incrementYoloFps, incrementMoveNetFps } from '@/features/workouts/hooks/usePerformanceMonitor'

// ── Model input sizes ────────────────────────────────────────────────────────
const YOLO_INPUT_SIZE = 416   // YOLOv8/v11 ball & rim model resized to 416
const POSE_INPUT_SIZE = 192   // MoveNet Lightning (must remain 192)

// ── AI inference throttling ───────────────────────────────────────────────
// Run YOLO every 3 frames (10 FPS at 30 FPS camera) - balance speed/accuracy
const YOLO_FRAME_SKIP = 3
// Run MoveNet every 9 frames (3.3 FPS at 30 FPS camera)
const POSE_FRAME_SKIP = 9

export const useShotTracker = (
  onBallDetection: (detection: BallDetection) => void,
  onPoseResult:   (result: PoseResult) => void,
  onShotEvent:    (event: ShotEvent) => void,
  onRimDetection?: (rim: { x: number; y: number; width: number; height: number; confidence: number }) => void,
  rimFromCalibration?: { x: number; y: number; width: number; height: number } | null,
  kalmanFilteredBall?: { x: number; y: number; vx: number; vy: number } | null,
  enabled: boolean = true,
  poseEnabled: boolean = true,
  ballEnabled: boolean = true
) => {
  const shotDetector = useRef(new ShotDetector())
  const lastBallRef  = useRef<{ x: number; y: number; t: number } | null>(null)
  const frameCounter = useSharedValue(0) // Frame counter for AI inference throttling
  const lastBallDetected = useSharedValue(false) // Track if ball was detected in last YOLO frame
  const enabledShared = useSharedValue(enabled) // Shared value for enabled state
  const poseEnabledShared = useSharedValue(poseEnabled) // Shared value for pose enabled state
  const ballEnabledShared = useSharedValue(ballEnabled) // Shared value for ball enabled state
  const RIM_CONFIDENCE_THRESHOLD = 0.15 // Soglia confidence per sostituire rim calibrato

  // ── Adaptive confidence threshold ─────────────────────────────────────────
  const adaptiveThreshold = useSharedValue(0.02)  // Lowered from 0.03 for distant objects
  const detectionHistory = useRef<Array<{ confidence: number; timestamp: number }>>([])
  const TARGET_DETECTION_RATE = 0.15  // Lowered from 0.2 for distant objects
  const ADAPTATION_WINDOW_MS = 2000  // Adjust threshold every 2 seconds

  // ── Model loading ─────────────────────────────────────────────────────────
  // Platform-specific delegate selection for optimal performance
  // Android: NNAPI (GPU delegate has bug in v3.0.1 that causes hang)
  // iOS: CoreML (optimized for Apple hardware)
  const yoloDelegates = Platform.OS === 'android' ? ['nnapi'] : Platform.OS === 'ios' ? ['core-ml'] : []
  const poseDelegates = Platform.OS === 'android' ? ['nnapi'] : Platform.OS === 'ios' ? ['core-ml'] : []
  const yoloModel = useTensorflowModel(
    require('../../assets/models/ball_rimV8_float16.tflite'),
    yoloDelegates as any,
  )
  const poseModel = useTensorflowModel(
    require('../../assets/models/movenet_lightning_int8.tflite'),
    poseDelegates as any,
  )

  // Log model input and output metadata when loaded
  useEffect(() => {
    console.log('[ShotTracker] YOLO Model state changed:', yoloModel.state)
    if (yoloModel.state === 'loaded' && yoloModel.model) {
      console.log('[ShotTracker] YOLO Model loaded successfully!')
      console.log('[ShotTracker] YOLO Inputs:', JSON.stringify(yoloModel.model.inputs))
      console.log('[ShotTracker] YOLO Outputs:', JSON.stringify(yoloModel.model.outputs))
    } else if (yoloModel.state === 'error') {
      console.error('[ShotTracker] YOLO Model load error:', (yoloModel as any).error)
    }
  }, [yoloModel.state])

  useEffect(() => {
    console.log('[ShotTracker] Pose Model state changed:', poseModel.state)
    if (poseModel.state === 'loaded' && poseModel.model) {
      console.log('[ShotTracker] Pose Model loaded successfully!')
      console.log('[ShotTracker] Pose Inputs:', JSON.stringify(poseModel.model.inputs))
      console.log('[ShotTracker] Pose Outputs:', JSON.stringify(poseModel.model.outputs))
    } else if (poseModel.state === 'error') {
      console.error('[ShotTracker] Pose Model load error:', (poseModel as any).error)
    }
  }, [poseModel.state])

  // ── Callback refs ─────────────────────────────────────────────────────────
  const onPoseResultRef = useRef(onPoseResult)
  const onRimDetectionRef = useRef(onRimDetection)
  useEffect(() => { onPoseResultRef.current = onPoseResult }, [onPoseResult])
  useEffect(() => { onRimDetectionRef.current = onRimDetection }, [onRimDetection])

  // Sync enabled state with shared value
  useEffect(() => { enabledShared.value = enabled }, [enabled])
  // Sync pose enabled state with shared value
  useEffect(() => { poseEnabledShared.value = poseEnabled }, [poseEnabled])
  // Sync ball enabled state with shared value
  useEffect(() => { ballEnabledShared.value = ballEnabled }, [ballEnabled])

  // ── Adaptive threshold adjustment (JS thread) ─────────────────────────────
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

      const adjustment = 0.005  // Smaller adjustment for finer control
      if (detectionRate > TARGET_DETECTION_RATE * 1.5) {
        adaptiveThreshold.value = Math.min(0.06, adaptiveThreshold.value + adjustment)
      } else if (detectionRate < TARGET_DETECTION_RATE * 0.5) {
        adaptiveThreshold.value = Math.max(0.01, adaptiveThreshold.value - adjustment)
      }

      console.log('[AdaptiveThreshold] Rate:', detectionRate.toFixed(2), 'Threshold:', adaptiveThreshold.value.toFixed(3))
    }
  }, [])

  // ── Shot detection (JS thread) ────────────────────────────────────────────
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

    // Use Kalman filtered position if available, otherwise use raw detection
    const ballForTracking = kalmanFilteredBall ? {
      x: kalmanFilteredBall.x,
      y: kalmanFilteredBall.y,
      width: ball.width,
      height: ball.height,
      confidence: ball.confidence,
    } : ball

    shotDetector.current.updateTrajectory(ballForTracking)

    const prev = lastBallRef.current
    if (prev) {
      const dt = (detection.timestamp - prev.t) / 1000
      if (dt > 0) {
        // velocity available inside ShotDetector via trajectory
      }
    }

    lastBallRef.current = {
      x: ballForTracking.x + ballForTracking.width  / 2,
      y: ballForTracking.y + ballForTracking.height / 2,
      t: detection.timestamp,
    }

    // Always update rim detection (independent of shot detection toggle)
    if (detection.rim && detection.rim.confidence > RIM_CONFIDENCE_THRESHOLD) {
      if (onRimDetectionRef.current) {
        onRimDetectionRef.current(detection.rim)
      }
    }

    // Only detect shots if enabled
    if (!enabledShared.value) return

    if (shotDetector.current.detectShotStart(ballForTracking))    console.log('[ShotTracker] Shot started')
    if (shotDetector.current.detectShotRelease()) {
      console.log('[ShotTracker] Shot released')
      const ev = shotDetector.current.getShotEvent()
      if (ev) onShotEvent(ev)
    }
    // Use detected rim if available, otherwise fall back to calibrated rim
    const effectiveRim = detection.rim || rimFromCalibration || null
    if (shotDetector.current.detectShotMade(effectiveRim)) {
      console.log('[ShotTracker] Shot made!')
      const ev = shotDetector.current.getShotEvent()
      if (ev) onShotEvent(ev)
      shotDetector.current.reset()
    }
    // Check for shot miss (timeout after release)
    if (shotDetector.current.detectShotMiss()) {
      console.log('[ShotTracker] Shot missed!')
      const ev = shotDetector.current.getShotEvent()
      if (ev) onShotEvent(ev)
      shotDetector.current.reset()
    }
  }, [onShotEvent, rimFromCalibration, kalmanFilteredBall])

  const wrappedOnBallDetection = useCallback((detection: BallDetection) => {
    onBallDetection(detection)
    handleBallDetectionForShotTracking(detection)
  }, [onBallDetection, handleBallDetectionForShotTracking])

  const wrappedOnBallDetectionRef = useRef(wrappedOnBallDetection)
  useEffect(() => { wrappedOnBallDetectionRef.current = wrappedOnBallDetection }, [wrappedOnBallDetection])

  // ── JS thread bridges (created once) ──────────────────────────────────────
  const emitBallDetection = useCallback((detection: BallDetection) => {
    incrementYoloFps()
    wrappedOnBallDetectionRef.current(detection)
  }, [])

  const emitPoseResult = useCallback((result: PoseResult) => {
    incrementMoveNetFps()
    onPoseResultRef.current(result)
  }, [])

  const logFirstFrame = useCallback((width: number, height: number) => {
    console.log('[ShotTracker] First frame received:', width, 'x', height)
  }, [])

  const logModelNotReady = useCallback(() => {
    console.log('[ShotTracker] YOLO model not ready, skipping frame')
  }, [])

  const logResizerNotReady = useCallback(() => {
    console.log('[ShotTracker] Resizer not ready, skipping frame')
  }, [])

  const logInvalidFrame = useCallback((width: number, height: number) => {
    console.log('[ShotTracker] Invalid frame dimensions:', width, height)
  }, [])

  const logBallDetected = useCallback((confidence: number, x: number, y: number) => {
    console.log('[ShotTracker] Ball detected! conf:', confidence.toFixed(2), 'x:', x.toFixed(2), 'y:', y.toFixed(2))
  }, [])

  const logYoloError = useCallback((error: string) => {
    console.log('[ShotTracker] YOLO inference error:', error)
  }, [])

  const logFrameError = useCallback((error: string) => {
    console.log('[ShotTracker] Frame processing error:', error)
  }, [])

  // ── Resizer setup ─────────────────────────────────────────────────────────
  const { resizer } = useResizer({
    width: YOLO_INPUT_SIZE,
    height: YOLO_INPUT_SIZE,
    channelOrder: 'rgb',
    dataType: 'float32',
    scaleMode: 'cover',
    pixelLayout: 'interleaved',
  })

  console.log('[ShotTracker] Resizer initialized:', resizer ? 'OK' : 'NULL')

  // ── Frame Processor (worklet) ─────────────────────────────────────────────
  const frameProcessor = useFrameOutput({
    pixelFormat: 'rgb',
    onFrame: (frame: Frame) => {
      'worklet'; // eslint-disable-line

      try {
        // Increment frame counter
        frameCounter.value = frameCounter.value + 1
        const frameId = frameCounter.value

        // Log first frame arrival
        if (frameId === 1) {
          scheduleOnRN(logFirstFrame, frame.width, frame.height)
        }

        const yoloReady = yoloModel.state === 'loaded' && yoloModel.model != null
        if (!yoloReady) {
          if (frameId <= 3) {
            scheduleOnRN(logModelNotReady)
          }
          return
        }

        // Skip YOLO if ball detection is disabled
        if (!ballEnabledShared.value) {
          return
        }

        // Check if resizer is ready
        if (resizer == null) {
          if (frameId <= 5) {
            scheduleOnRN(logResizerNotReady)
          }
          return
        }

        // Validate frame dimensions
        if (!frame.width || !frame.height || frame.width <= 0 || frame.height <= 0) {
          scheduleOnRN(logInvalidFrame, frame.width, frame.height)
          return
        }

        // Calculate 1:1 square center crop to preserve aspect ratio without squashing small basketballs
        const cropDim = Math.min(frame.width, frame.height)
        const cropX = Math.floor((frame.width - cropDim) / 2)
        const cropY = Math.floor((frame.height - cropDim) / 2)

        // Set crop parameters for YOLO coordinate mapping
        setCropParameters(cropX, cropY, cropDim)

        // ── 1. YOLO — accelerate to every frame (skip = 1) when ball is actively detected ──
        const activeYoloSkip = lastBallDetected.value ? 1 : YOLO_FRAME_SKIP
        const ranYolo = frameId % activeYoloSkip === 0
        if (ranYolo) {
          try {
            // Resize camera frame → 416×416 RGB float32 with 1:1 square crop to keep ball round
            const yoloResized = resizer.resize(frame)
            let yoloOutputs: ArrayBuffer[] | null = null

            try {
              const yoloBuffer = yoloResized.getPixelBuffer()
              // Execute inference synchronously while yoloResized GPU buffer is still active
              yoloOutputs = yoloModel.model!.runSync([yoloBuffer as ArrayBuffer])
            } finally {
              // Dispose GPU buffer AFTER runSync finishes to prevent dangling pointer memory crash
              try {
                yoloResized?.dispose()
              } catch (disposeError) {
                // Ignore dispose errors - object may already be disposed
              }
            }

            if (yoloOutputs && yoloOutputs.length > 0) {
              const yoloOutput = new Float32Array(yoloOutputs[0] as ArrayBuffer)

              // Parse detections and map crop coordinates to full frame dimensions
              const { ball, rim } = parseYoloOutput(
                yoloOutput,
                adaptiveThreshold.value,
                frame.width,
                frame.height
              )

              // Track if ball was detected for MoveNet throttling and YOLO acceleration
              lastBallDetected.value = ball !== null

              if (ball && frameId % 10 === 0) {
                scheduleOnRN(logBallDetected, ball.confidence, ball.x, ball.y)
              }

              scheduleOnRN(emitBallDetection, {
                ball: ball ?? undefined,
                rim: rim ?? undefined,
                timestamp: Date.now(),
              })
            }
          } catch (error) {
            scheduleOnRN(logYoloError, String(error))
          }
        }

        // ── 2. MoveNet ──────────────────────────────────────────────────────
        if (!poseEnabledShared.value) {
          return
        }
        if (frameId % POSE_FRAME_SKIP !== 0) {
          return
        }

        const poseReady = poseModel.state === 'loaded' && poseModel.model != null
        if (!poseReady) {
          return
        }

      } catch (error) {
        scheduleOnRN(logFrameError, String(error))
      } finally {
        // Always dispose frame to prevent memory leaks
        frame.dispose()
      }
    },
  })

  console.log('[ShotTracker] Frame processor initialized:', frameProcessor ? 'OK' : 'NULL')

  const resetShotTracking = useCallback(() => {
    shotDetector.current.reset()
    lastBallRef.current = null
  }, [])

  const isModelReady =
    yoloModel.state === 'loaded' && yoloModel.model != null &&
    poseModel.state === 'loaded' && poseModel.model != null


  return { frameProcessor, isModelReady, resetShotTracking }
}
