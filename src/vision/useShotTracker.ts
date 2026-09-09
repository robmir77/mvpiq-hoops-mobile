// src/vision/useShotTracker.ts
//
// Orchestrates ball detection, pose detection, and shot analysis.
// Both YOLO and MoveNet run entirely in the Frame Processor Worklet.
// Only processed results (BallDetection, PoseResult, ShotEvent) cross to JS.

import { useRef, useCallback, useEffect, useMemo } from 'react'
import { useSharedValue } from 'react-native-reanimated'
import { useFrameOutput } from 'react-native-vision-camera'
import { useResizer } from 'react-native-vision-camera-resizer'
import { useTensorflowModel } from 'react-native-fast-tflite'
import type { Frame } from 'react-native-vision-camera'
import { parseYoloOutput } from './yoloParser'
import { parseMoveNetOutput } from './poseParser'
import { computeJointAngles } from './biomechanics'
import { ShotDetector } from './shotDetector'
import type { BallDetection, PoseResult, ShotEvent, PoseKeypoints } from './types'
import { incrementYoloFps, incrementMoveNetFps } from '@/features/workouts/hooks/usePerformanceMonitor'

// ── Model input sizes ──────────────────────────────────────────────────────────
const YOLO_INPUT_SIZE = 640   // YOLOv8/v11 ball & rim model resized to 640
const POSE_INPUT_SIZE = 192   // MoveNet Lightning (must remain 192)

// ── AI inference throttling ───────────────────────────────────────────────────
// Run YOLO every 2 frames (15 FPS at 30 FPS camera)
const YOLO_FRAME_SKIP = 2
// Run MoveNet every 3 frames (10 FPS at 30 FPS camera)
const POSE_FRAME_SKIP = 3

export const useShotTracker = (
  onBallDetection: (detection: BallDetection) => void,
  onPoseResult:   (result: PoseResult) => void,
  onShotEvent:    (event: ShotEvent) => void,
  onRimDetection?: (rim: { x: number; y: number; width: number; height: number; confidence: number }) => void,
  rimFromCalibration?: { x: number; y: number; width: number; height: number } | null,
  kalmanFilteredBall?: { x: number; y: number; vx: number; vy: number } | null,
  enabled: boolean = true,
  poseEnabled: boolean = true,
  ballEnabled: boolean = true,
  rimEnabled: boolean = false,
  yoloDelegate?: string,
  poseDelegate?: string,
) => {
  const shotDetector = useRef(new ShotDetector())
  const lastBallRef  = useRef<{ x: number; y: number; t: number } | null>(null)
  const frameCounter = useSharedValue(0) // Frame counter for AI inference throttling
  const lastBallDetected = useSharedValue(false) // Track if ball was detected in last YOLO frame
  const inFlight = useSharedValue(false) // Track if callback is currently executing (for re-entry detection)

  // ── SharedValues for passing data from worklet to JS ─────────────────────────
  const ballDetectionShared = useSharedValue<BallDetection | null>(null)
  const poseResultShared = useSharedValue<PoseResult | null>(null)

  // ── Diagnostic performance counters (WORKLET) ────────────────────────────────
  // Aggregated every ~1s to avoid flooding Metro/Logcat and perturbing timing.
  const perfLastLogTs = useSharedValue(0)
  const perfFrames = useSharedValue(0)
  const perfYoloRuns = useSharedValue(0)
  const perfPoseRuns = useSharedValue(0)
  const perfYoloResizeMs = useSharedValue(0)
  const perfYoloRunMs = useSharedValue(0)
  const perfPoseResizeMs = useSharedValue(0)
  const perfPoseRunMs = useSharedValue(0)
  const perfYoloCallbacks = useSharedValue(0)
  const perfPoseCallbacks = useSharedValue(0)
  const RIM_CONFIDENCE_THRESHOLD = 0.15 // Soglia confidence per sostituire rim calibrato

  // ── Instance ID for debugging duplicate frames ─────────────────────────────────
  const instanceIdRef = useRef(Math.random().toString(36).substr(2, 9))
  const instanceId = instanceIdRef.current

  useEffect(() => {
    console.log('[ShotTracker][INSTANCE ' + instanceId + '] CREATED')
    return () => {
      console.log('[ShotTracker][INSTANCE ' + instanceId + '] CLEANUP')
    }
  }, [instanceId])

  // ── Adaptive threshold adjustment ───────────────────────────────────────────────
  const adaptiveThreshold = useSharedValue(0.04)
  const detectionHistory = useRef<Array<{ confidence: number; timestamp: number }>>([])
  const TARGET_DETECTION_RATE = 0.2
  const ADAPTATION_WINDOW_MS = 2000

  // ── Model loading ────────────────────────────────────────────────────────────
  // Single-class football/basketball detector (640×640, float16, NHWC TFLite)
  const yoloDelegates = (yoloDelegate ? [yoloDelegate] : ['android-gpu']) as any
  console.log('[ShotTracker] Loading YOLO model with delegates:', JSON.stringify(yoloDelegates))
  const yoloModel = useTensorflowModel(
    require('../../assets/models/ball_rimV8_640_float16.tflite'),
    yoloDelegates,
  )
  const poseDelegates = (poseDelegate ? [poseDelegate] : ['android-gpu']) as any
  console.log('[ShotTracker] Loading MoveNet model with delegates:', JSON.stringify(poseDelegates))
  const poseModel = useTensorflowModel(
    require('../../assets/models/movenet_lightning_int8.tflite'),
    poseDelegates,
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
    detectionHistory.current = detectionHistory.current.filter(d => now - d.timestamp < ADAPTATION_WINDOW_MS)
    if (now - lastAdjustmentTs.current > ADAPTATION_WINDOW_MS && detectionHistory.current.length > 10) {
      lastAdjustmentTs.current = now
      const totalFrames = detectionHistory.current.length
      const detectedFrames = detectionHistory.current.filter(d => d.confidence > 0).length
      const detectionRate = detectedFrames / totalFrames

      // Increase threshold if too many detections (false positives)
      // Decrease threshold if too few detections (false negatives)
      // Cap at 0.04 max so small/fast balls with lower confidence (1%-5%) are never discarded
      const adjustment = 0.005  // Smaller adjustment for finer control
      if (detectionRate > TARGET_DETECTION_RATE * 1.5) {
        adaptiveThreshold.value = Math.min(0.04, adaptiveThreshold.value + adjustment)
      } else if (detectionRate < TARGET_DETECTION_RATE * 0.5) {
        adaptiveThreshold.value = Math.max(0.005, adaptiveThreshold.value - adjustment)
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

    if (shotDetector.current.detectShotStart(ballForTracking))    console.log('[ShotTracker] Shot started')
    if (shotDetector.current.detectShotRelease()) {
      // Log when shot release is detected
      console.log('[ShotTracker] Shot released')
      const ev = shotDetector.current.getShotEvent()
      if (ev) onShotEvent(ev)
    }
    // Use detected rim if available, otherwise fall back to calibrated rim
    const effectiveRim = detection.rim || rimFromCalibration || null
    if (shotDetector.current.detectShotMade(effectiveRim)) {
      // Log when shot is detected as made
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

  // ── Listen to SharedValue changes and call callbacks ────────────────────────
  useEffect(() => {
    const interval = setInterval(() => {
      const ballDetection = ballDetectionShared.value
      if (ballDetection) {
        incrementYoloFps()
        wrappedOnBallDetectionRef.current(ballDetection)
        ballDetectionShared.value = null // Clear after processing
      }

      const poseResult = poseResultShared.value
      if (poseResult) {
        incrementMoveNetFps()
        onPoseResultRef.current(poseResult)
        poseResultShared.value = null // Clear after processing
      }
    }, 16) // Check every ~16ms (60fps)

    return () => clearInterval(interval)
  }, [])

  // ── Resizer configurations ──────────────────────────────────────────────────────
  const yoloResizerConfig = useMemo(() => ({
    width: YOLO_INPUT_SIZE,
    height: YOLO_INPUT_SIZE,
    channelOrder: 'rgb' as const,
    dataType: 'float32' as const,
    pixelLayout: 'interleaved' as const,
    scaleMode: 'cover' as const,  // Use 'cover' to fill entire 640x640 without letterboxing
  }), [])

  const poseResizerConfig = useMemo(() => ({
    width: POSE_INPUT_SIZE,
    height: POSE_INPUT_SIZE,
    channelOrder: 'rgb' as const,
    dataType: 'uint8' as const,
    pixelLayout: 'interleaved' as const,
    scaleMode: 'cover' as const,
  }), [])

  const { resizer: yoloResizer } = useResizer(yoloResizerConfig)
  const { resizer: poseResizer } = useResizer(poseResizerConfig)

  // ── Frame Processor (worklet) ────────────────────────────────────────────────
  const frameProcessorOptions = useMemo(() => ({
    onFrame(frame: Frame) {
      'worklet'; // eslint-disable-line

      // Re-entry detection - BLOCK to prevent duplicate work
      const entryTs = Date.now()
      if (inFlight.value) {
        console.log('[ShotTracker][INSTANCE ' + instanceId + '] RE-ENTRY BLOCKED inFlight=true at ' + entryTs)
        frame.dispose()
        return
      }
      inFlight.value = true

      try {
        // Log frameCounter value BEFORE increment to detect race condition
        const counterBefore = frameCounter.value
        console.log('[ShotTracker][INSTANCE ' + instanceId + '] COUNTER_BEFORE=' + counterBefore + ' ts=' + entryTs)

        // Increment frame counter
        frameCounter.value = frameCounter.value + 1
        const frameId = frameCounter.value
        perfFrames.value = perfFrames.value + 1

        console.log('[ShotTracker][INSTANCE ' + instanceId + '] COUNTER_AFTER=' + frameId + ' ts=' + entryTs)

        const yoloReady = yoloModel.state === 'loaded' && yoloModel.model != null
      if (!yoloReady) {
        if (frameId <= 5) console.log('[ShotTracker][INSTANCE ' + instanceId + '][FRAME] #' + frameId + ' models not ready')
        return
      }

      if (frameId <= 5 || frameId % 30 === 0) {
        console.log('[ShotTracker][INSTANCE ' + instanceId + '][FRAME] #' + frameId + ' START ' + frame.width + 'x' + frame.height)
      }

      // ── 1. YOLO — accelerate to every frame (skip = 1) when ball is actively detected ──
      const activeYoloSkip = lastBallDetected.value ? 1 : YOLO_FRAME_SKIP
      const ranYolo = frameId % activeYoloSkip === 0
      if (ranYolo && enabled && ballEnabled) {
        perfYoloRuns.value = perfYoloRuns.value + 1
        const yoloStartTs = Date.now()

        const yoloResized = yoloResizer?.resize(frame)
        if (yoloResized) {
          try {
            const yoloResizeMs = Date.now() - yoloStartTs
            perfYoloResizeMs.value = perfYoloResizeMs.value + yoloResizeMs

            if (frameId <= 10 || frameId % 30 === 0) {
              console.log('[ShotTracker][INSTANCE ' + instanceId + '][YOLO] #' + frameId + ' AFTER resize ' + yoloResizeMs + 'ms BEFORE runSync')
            }

            const pixelBufferRaw = yoloResized.getPixelBuffer()
            const yoloRunStart = Date.now()
            const yoloOutputs = yoloModel.model!.runSync([pixelBufferRaw])
            const yoloRunMs = Date.now() - yoloRunStart
            perfYoloRunMs.value = perfYoloRunMs.value + yoloRunMs

            if (frameId <= 10 || frameId % 30 === 0) {
              console.log('[ShotTracker][INSTANCE ' + instanceId + '][YOLO] #' + frameId + ' AFTER runSync ' + yoloRunMs + 'ms outputs=' + yoloOutputs.length)
            }

            const yoloOutput = new Float32Array(yoloOutputs[0]!)
            const { ball, rim } = parseYoloOutput(yoloOutput, adaptiveThreshold.value)

            // Track if ball was detected for MoveNet throttling and YOLO acceleration
            lastBallDetected.value = ball !== null

            ballDetectionShared.value = {
              ball: ball ?? undefined,
              rim: rimEnabled ? rim ?? undefined : undefined,
              timestamp: Date.now(),
            }

            perfYoloCallbacks.value = perfYoloCallbacks.value + 1
          } finally {
            yoloResized.dispose()
          }
        }
      }

      // ── 2. MoveNet — throttled to every POSE_FRAME_SKIP frames (10 FPS) ────────
      // Run independently of YOLO - no return after YOLO block
      if (frameId % POSE_FRAME_SKIP !== 1) return

      if (!enabled || !poseEnabled) return

      const poseReady = poseModel.state === 'loaded' && poseModel.model != null
      if (!poseReady) return

      const poseResizeStartTs = Date.now()
      const poseResized = poseResizer?.resize(frame)

      if (poseResized) {
        try {
          perfPoseRuns.value = perfPoseRuns.value + 1
          const poseResizeMs = Date.now() - poseResizeStartTs
          perfPoseResizeMs.value = perfPoseResizeMs.value + poseResizeMs

          if (frameId <= 10 || frameId % 30 === 0) {
            console.log('[ShotTracker][INSTANCE ' + instanceId + '][POSE] #' + frameId + ' AFTER resize ' + poseResizeMs + 'ms BEFORE runSync')
          }

          const pixelBuffer = poseResized.getPixelBuffer()
          const poseRunStart = Date.now()
          const poseOutputs = poseModel.model!.runSync([pixelBuffer])
          const poseRunMs = Date.now() - poseRunStart
          perfPoseRunMs.value = perfPoseRunMs.value + poseRunMs

          if (frameId <= 10 || frameId % 30 === 0) {
            console.log('[ShotTracker][INSTANCE ' + instanceId + '][POSE] #' + frameId + ' AFTER runSync ' + poseRunMs + 'ms outputs=' + poseOutputs.length)
          }

          const poseOutput = new Float32Array(poseOutputs[0]!)
          const keypoints = parseMoveNetOutput(poseOutput)
          const angles = computeJointAngles(keypoints as PoseKeypoints)

          poseResultShared.value = { keypoints: keypoints as PoseKeypoints, angles, timestamp: Date.now() }

          perfPoseCallbacks.value = perfPoseCallbacks.value + 1
        } finally {
          poseResized.dispose()
        }
      }

      // ── 1-second diagnostic heartbeat ──────────────────────────────────────
      const nowTs = Date.now()
      if (perfLastLogTs.value === 0) {
        perfLastLogTs.value = nowTs
      } else if (nowTs - perfLastLogTs.value >= 1000) {
        const elapsedSec = (nowTs - perfLastLogTs.value) / 1000
        console.log(
          '[PERF][WORKLET][INSTANCE ' + instanceId + '] ' +
          'Frame=' + (perfFrames.value / elapsedSec).toFixed(1) + 'fps | ' +
          'YOLO=' + (perfYoloRuns.value / elapsedSec).toFixed(1) + 'fps | ' +
          'MoveNet=' + (perfPoseRuns.value / elapsedSec).toFixed(1) + 'fps | ' +
          'YOLO resize=' + (perfYoloRuns.value ? (perfYoloResizeMs.value / perfYoloRuns.value).toFixed(1) : '0') + 'ms | ' +
          'YOLO run=' + (perfYoloRuns.value ? (perfYoloRunMs.value / perfYoloRuns.value).toFixed(1) : '0') + 'ms | ' +
          'Pose resize=' + (perfPoseRuns.value ? (perfPoseResizeMs.value / perfPoseRuns.value).toFixed(1) : '0') + 'ms | ' +
          'Pose run=' + (perfPoseRuns.value ? (perfPoseRunMs.value / perfPoseRuns.value).toFixed(1) : '0') + 'ms | ' +
          'JS YOLO=' + (perfYoloCallbacks.value / elapsedSec).toFixed(1) + '/s | ' +
          'JS Pose=' + (perfPoseCallbacks.value / elapsedSec).toFixed(1) + '/s'
        )

        perfFrames.value = 0
        perfYoloRuns.value = 0
        perfPoseRuns.value = 0
        perfYoloResizeMs.value = 0
        perfYoloRunMs.value = 0
        perfPoseResizeMs.value = 0
        perfPoseRunMs.value = 0
        perfYoloCallbacks.value = 0
        perfPoseCallbacks.value = 0
        perfLastLogTs.value = nowTs
      }

      const exitTs = Date.now()
      console.log('[ShotTracker][INSTANCE ' + instanceId + '] EXIT frameId=' + frameId + ' ts=' + exitTs + ' duration=' + (exitTs - entryTs) + 'ms')
      } finally {
        // Clear inFlight flag and dispose frame
        inFlight.value = false
        frame.dispose()
      }
    }
  }), [yoloModel, poseModel, enabled, ballEnabled, poseEnabled, rimEnabled])

  const frameProcessor = useFrameOutput(frameProcessorOptions)

  const resetShotTracking = useCallback(() => {
    shotDetector.current.reset()
    lastBallRef.current = null
  }, [])

  const isModelReady =
    yoloModel.state === 'loaded' && yoloModel.model != null &&
    poseModel.state === 'loaded' && poseModel.model != null

  // Log model state changes
  useEffect(() => {
    if (yoloModel.state === 'loaded') {
      console.log('[ShotTracker] YOLO model loaded successfully with state:', yoloModel.state)
    } else if (yoloModel.state === 'error') {
      console.log('[ShotTracker] YOLO model failed to load with state:', yoloModel.state)
    }
  }, [yoloModel.state])

  useEffect(() => {
    if (poseModel.state === 'loaded') {
      console.log('[ShotTracker] MoveNet model loaded successfully with state:', poseModel.state)
    } else if (poseModel.state === 'error') {
      console.log('[ShotTracker] MoveNet model failed to load with state:', poseModel.state)
    }
  }, [poseModel.state])

  return { frameProcessor, isModelReady, resetShotTracking }
}
