// src/vision/useShotTracker.ts
//
// Orchestrates ball detection, pose detection, and shot analysis.
// Both YOLO and MoveNet run entirely in the Frame Processor Worklet.
// Only processed results (BallDetection, PoseResult, ShotEvent) cross to JS.

import { useRef, useCallback, useEffect, useMemo } from 'react'
import { Platform } from 'react-native'
import { useFrameOutput } from 'react-native-vision-camera'
import type { Frame } from 'react-native-vision-camera'
import { useResizer } from 'react-native-vision-camera-resizer'
import { Worklets, useSharedValue } from 'react-native-worklets-core'
import { useTensorflowModel } from 'react-native-fast-tflite'
import { parseYoloOutput } from './yoloParser'
import { parseMoveNetOutput } from './poseParser'
import { computeJointAngles } from './biomechanics'
import { ShotDetector } from './shotDetector'
import type { BallDetection, PoseResult, ShotEvent } from './types'
import { incrementYoloFps, incrementMoveNetFps } from '@/features/workouts/hooks/usePerformanceMonitor'

// ── Model input sizes ────────────────────────────────────────────────────────
// NB: il modello originale (ball_rimV8_float16.tflite) veniva alimentato a 320x320
// nella pipeline precedente. Qui è impostato a 416 — verifica allo startup i log
// "[ShotTracker] YOLO Inputs: ..." per confermare che la shape attesa dal modello
// corrisponda davvero a 416x416 e non a 320x320, altrimenti l'inferenza gira ma
// produce output spazzatura senza errori a runtime.
const YOLO_INPUT_SIZE = 416
const POSE_INPUT_SIZE = 192 // MoveNet Lightning (deve restare 192)

// ── AI inference throttling ───────────────────────────────────────────────
const YOLO_FRAME_SKIP = 3 // ~10 FPS a 30 FPS camera
const POSE_FRAME_SKIP = 9 // ~3.3 FPS a 30 FPS camera

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
  const frameCounter = useSharedValue(0)
  const lastBallDetected = useSharedValue(false)
  const enabledShared = useSharedValue(enabled)
  const poseEnabledShared = useSharedValue(poseEnabled)
  const ballEnabledShared = useSharedValue(ballEnabled)
  const RIM_CONFIDENCE_THRESHOLD = 0.15

  // ── Adaptive confidence threshold ─────────────────────────────────────────
  const adaptiveThreshold = useSharedValue(0.25)
  const detectionHistory = useRef<Array<{ confidence: number; timestamp: number }>>([])
  const TARGET_DETECTION_RATE = 0.15
  const ADAPTATION_WINDOW_MS = 2000

  // ── Model loading ─────────────────────────────────────────────────────────
  // IMPORTANTE: questi array devono avere identità stabile tra i render.
  // useTensorflowModel usa il riferimento del delegate array per decidere se
  // ricaricare il modello — un array ricreato inline ad ogni render (come
  // `Platform.OS === 'android' ? [] : [...]` scritto direttamente qui sotto)
  // causa un reload continuo del modello ad ogni render del componente,
  // il frame processor viene ricreato in continuazione e non gira mai
  // abbastanza a lungo da processare un frame (fps sempre a 0).
  const yoloDelegates = useMemo(
    () => (Platform.OS === 'android' ? ['android-gpu'] : Platform.OS === 'ios' ? ['core-ml'] : []),
    []
  )
  const poseDelegates = useMemo(
    () => (Platform.OS === 'android' ? ['nnapi'] : Platform.OS === 'ios' ? ['core-ml'] : []),
    []
  )
  const yoloModel = useTensorflowModel(
    require('../../assets/models/ball_rimV8_float16.tflite'),
    yoloDelegates as any,
  )
  const poseModel = useTensorflowModel(
    require('../../assets/models/movenet_lightning_int8.tflite'),
    poseDelegates as any,
  )

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

  useEffect(() => { enabledShared.value = enabled }, [enabled])
  useEffect(() => { poseEnabledShared.value = poseEnabled }, [poseEnabled])
  useEffect(() => { ballEnabledShared.value = ballEnabled }, [ballEnabled])

  // ── Adaptive threshold adjustment (JS thread) ─────────────────────────────
  const lastAdjustmentTs = useRef(0)
  const updateAdaptiveThreshold = useCallback((ball: { confidence: number } | null | undefined) => {
    const now = Date.now()
    detectionHistory.current.push({ confidence: ball?.confidence ?? 0, timestamp: now })
    detectionHistory.current = detectionHistory.current.filter(
      d => now - d.timestamp < ADAPTATION_WINDOW_MS
    )

    if (now - lastAdjustmentTs.current > ADAPTATION_WINDOW_MS && detectionHistory.current.length > 10) {
      lastAdjustmentTs.current = now
      const totalFrames = detectionHistory.current.length
      const detectedFrames = detectionHistory.current.filter(d => d.confidence > 0).length
      const detectionRate = detectedFrames / totalFrames

      const adjustment = 0.005
      if (detectionRate > TARGET_DETECTION_RATE * 1.5) {
        adaptiveThreshold.value = Math.min(0.15, adaptiveThreshold.value + adjustment)
      } else if (detectionRate < TARGET_DETECTION_RATE * 0.5) {
        adaptiveThreshold.value = Math.max(0.015, adaptiveThreshold.value - adjustment)
      }

      console.log('[AdaptiveThreshold] Rate:', detectionRate.toFixed(2), 'Threshold:', adaptiveThreshold.value.toFixed(3))
    }
  }, [])

  // ── Shot detection (JS thread) ────────────────────────────────────────────
  const handleBallDetectionForShotTracking = useCallback((detection: BallDetection) => {
    const { ball } = detection
    updateAdaptiveThreshold(ball)

    if (!ball) {
      const now = Date.now()
      if (lastBallRef.current && now - lastBallRef.current.t > 300) {
        shotDetector.current.reset()
        lastBallRef.current = null
      }
      return
    }

    const ballForTracking = kalmanFilteredBall ? {
      x: kalmanFilteredBall.x,
      y: kalmanFilteredBall.y,
      width: ball.width,
      height: ball.height,
      confidence: ball.confidence,
    } : ball

    shotDetector.current.updateTrajectory(ballForTracking)

    lastBallRef.current = {
      x: ballForTracking.x + ballForTracking.width  / 2,
      y: ballForTracking.y + ballForTracking.height / 2,
      t: detection.timestamp,
    }

    if (detection.rim && detection.rim.confidence > RIM_CONFIDENCE_THRESHOLD) {
      onRimDetectionRef.current?.(detection.rim)
    }

    if (!enabledShared.value) return

    if (shotDetector.current.detectShotStart(ballForTracking)) console.log('[ShotTracker] Shot started')
    if (shotDetector.current.detectShotRelease()) {
      console.log('[ShotTracker] Shot released')
      const ev = shotDetector.current.getShotEvent()
      if (ev) onShotEvent(ev)
    }
    const effectiveRim = detection.rim || rimFromCalibration || null
    if (shotDetector.current.detectShotMade(effectiveRim)) {
      console.log('[ShotTracker] Shot made!')
      const ev = shotDetector.current.getShotEvent()
      if (ev) onShotEvent(ev)
      shotDetector.current.reset()
    }
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


  // ── Resize plugin (stateless per-call, come nell'architettura originale) ──
  const { resizer: yoloResizer } = useResizer({
    width: YOLO_INPUT_SIZE,
    height: YOLO_INPUT_SIZE,
    channelOrder: 'rgb',
    dataType: 'float32',
    pixelLayout: 'planar',
    scaleMode: 'contain',
  })
  const { resizer: poseResizer } = useResizer({
    width: POSE_INPUT_SIZE,
    height: POSE_INPUT_SIZE,
    channelOrder: 'rgb',
    dataType: 'uint8',
    pixelLayout: 'interleaved',
    scaleMode: 'contain',
  })

  // ── Bridge JS thread (react-native-worklets-core, il runtime worklet usato
  //    davvero dai Frame Processor di VisionCamera — NON scheduleOnRN di
  //    react-native-worklets, che è il bridge di Reanimated e vive su un
  //    runtime worklet diverso e incompatibile con questo contesto) ────────
  const jsBridge = useMemo(() => ({
    emitBallDetection: (Worklets.createRunOnJS as any)(emitBallDetection),
    emitPoseResult: (Worklets.createRunOnJS as any)(emitPoseResult),
  }), [emitBallDetection, emitPoseResult])

  // ── Frame Output (worklet) ───────────────────────────────────────────────
  const frameOutput = useFrameOutput({
    pixelFormat: 'rgb',
    onFrame: (frame: Frame) => {
      'worklet'

      try {
        if (!enabledShared.value) return

        const yoloReady = yoloModel.state === 'loaded' && yoloModel.model != null
        const poseReady = poseModel.state === 'loaded' && poseModel.model != null

        if (!yoloReady && !poseReady) {
          frame.dispose()
          return
        }

        const frameWidth = frame.width
        const frameHeight = frame.height

        // Run YOLO detection (throttled)
        if (yoloReady && ballEnabledShared.value) {
          frameCounter.value += 1
          if (frameCounter.value % YOLO_FRAME_SKIP === 0) {
            const yoloResized = yoloResizer?.resize(frame)
            if (yoloResized) {
              const arrayBuffer = yoloResized.getPixelBuffer()
              const buffer = new Float32Array(arrayBuffer)
              yoloResized.dispose()

              const outputs = yoloModel.model.runSync([buffer])
              const output = outputs[0] as Float32Array

              const { ball, rim } = parseYoloOutput(output, adaptiveThreshold.value, frameWidth, frameHeight)

              jsBridge.emitBallDetection({
                ball: ball ? {
                  x: ball.x,
                  y: ball.y,
                  width: ball.width,
                  height: ball.height,
                  confidence: ball.confidence,
                } : undefined,
                rim: rim ? {
                  x: rim.x,
                  y: rim.y,
                  width: rim.width,
                  height: rim.height,
                  confidence: rim.confidence,
                } : undefined,
                timestamp: Date.now(),
              })
            }
          }
        }

        // Run Pose detection (throttled)
        if (poseReady && poseEnabledShared.value) {
          if (frameCounter.value % POSE_FRAME_SKIP === 0) {
            const poseResized = poseResizer?.resize(frame)
            if (poseResized) {
              const arrayBuffer = poseResized.getPixelBuffer()
              const buffer = new Uint8Array(arrayBuffer)
              poseResized.dispose()

              const outputs = poseModel.model.runSync([buffer])
              const output = outputs[0] as Float32Array

              const pose = parseMoveNetOutput(output, frameWidth, frameHeight)
              const angles = computeJointAngles(pose)

              jsBridge.emitPoseResult({
                pose,
                angles,
                timestamp: Date.now(),
              })
            }
          }
        }
      } catch (error) {
        // Error in worklet - silent fail to avoid crash
      } finally {
        frame.dispose()
      }
    },
  })

  const resetShotTracking = useCallback(() => {
    shotDetector.current.reset()
    lastBallRef.current = null
  }, [])

  const isModelReady =
    yoloModel.state === 'loaded' && yoloModel.model != null &&
    poseModel.state === 'loaded' && poseModel.model != null

  return { frameOutput, isModelReady, resetShotTracking }
}
