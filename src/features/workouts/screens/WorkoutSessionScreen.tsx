// src/features/workouts/screens/WorkoutSessionScreen.tsx
//
// Vision camera integration with YOLO ball/hoop detection, MoveNet pose detection,
// Skia overlay, Kalman tracking, and automatic shot detection.

import React, {
    useState, useContext, useEffect, useCallback, useRef,
} from 'react'
import {
    View, Text, StyleSheet, TouchableOpacity,
    Dimensions, Animated, Easing, Platform,
} from 'react-native'
import { GestureHandlerRootView, PinchGestureHandler, State } from 'react-native-gesture-handler'
import { captureRef } from 'react-native-view-shot'
import * as MediaLibrary from 'expo-media-library/legacy'
import {
    Canvas, Path as SkiaPath, Circle as SkiaCircle,
    Group, Line as SkiaLine, vec, Skia,
} from '@shopify/react-native-skia'
import { useAnimatedReaction, useDerivedValue, useAnimatedStyle, useSharedValue, runOnJS } from 'react-native-reanimated'
import { Camera, type CameraRef } from 'react-native-vision-camera'
import { AuthContext } from '@/features/auth/context/AuthContext'
import { useCustomAlert, CustomAlert } from '@/shared/components/CustomAlert'
import { useWorkoutWebSocket } from '../hooks/useWorkoutWebSocket'
import { useTrackingEngine } from '../hooks/useTrackingEngine'
import { useWorkoutVisionPipeline } from '../vision/useWorkoutVisionPipeline'
import { VisionEngineAdapter } from '@/vision/VisionEngineAdapter'
import { incrementTrackingUpdates, startPerfMonitor, stopPerfMonitor, recordPathBuildTime, getPerfMetrics } from '../hooks/usePerformanceMonitor'
import { telemetryLogger } from '@/vision/telemetry'
import {
    WorkoutSession, ShotResult,
    TrackingState, PoseKeypoints, CalibrationData, CameraMode,
} from '../types/workouts.types'
import {
    getWorkoutSession,
    endWorkoutSession, pauseWorkoutSession, resumeWorkoutSession,
} from '../api/workouts.api'
import { createWorkoutQueue, type FrameDataPayload, type CriticalPayload } from '../services/workoutAsyncQueue'
import { TelemetrySampler } from '../services/telemetrySampler'
import apiClient from '@/shared/api/apiClient'
import type { BallDetection, PoseResult, ShotEvent, JointAngles } from '@/vision'
import { DEFAULT_MOVENET_MODEL_ID, DEFAULT_YOLO_MODEL_ID, getYoloModel, TelemetryOverlay } from '@/vision'
import { YOLO_CONFIG, CAMERA_CONFIG, COURT_CONFIG, TEST_CONFIG } from '@/config/appConfig'
import RealtimeBallOverlay from '../components/RealtimeBallOverlay'
import ReactOverlay from '../components/ReactOverlay'
import { WorkoutControls } from '../components/WorkoutControls'
import { WorkoutHeader } from '../components/WorkoutHeader'
import { ShotFeedback } from '../components/ShotFeedback'
import { useScreenshotCapture } from '../hooks/useScreenshotCapture'
import { useVideoRecording } from '../hooks/useVideoRecording'
import { useTrackingStatus } from '../hooks/useTrackingStatus'
import { useVisionConfig } from '../hooks/useVisionConfig'
import { WorkoutSessionRuntime } from '../runtime/WorkoutSessionRuntime'

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window')
const CAMERA_H = SCREEN_H * 0.52

function toCourtMeters(
    normX: number, normY: number, calibration: CalibrationData | null
): { courtX: number; courtY: number; distanceFromHoop: number } {
    let courtX = normX * COURT_CONFIG.WIDTH_M
    let courtY = (1 - normY) * COURT_CONFIG.HEIGHT_M
    if (calibration?.homographyMatrix?.length === 9) {
        const H = calibration.homographyMatrix
        const wx = H[0]*normX + H[1]*normY + H[2]
        const wy = H[3]*normX + H[4]*normY + H[5]
        const wz = H[6]*normX + H[7]*normY + H[8]
        if (Math.abs(wz) > 1e-6) { courtX = wx/wz; courtY = wy/wz }
    }
    const dx = courtX - COURT_CONFIG.WIDTH_M/2
    const dy = courtY - COURT_CONFIG.HOOP_Y_M
    return {
        courtX:  Math.round(courtX*100)/100,
        courtY:  Math.round(courtY*100)/100,
        distanceFromHoop: Math.round(Math.sqrt(dx*dx+dy*dy)*100)/100,
    }
}


export default function WorkoutSessionScreen({ navigation, route }: any) {
    const { sessionId, cameraMode, selectedResolution, selectedFps, selectedPoseResolution, yoloDelegate, poseDelegate, yoloModelId, moveNetModelId } = route.params || {}
    // TEMP: Commented to reduce log noise during performance investigation
    // console.log('[WorkoutSession] Received params from route.params:', {
    //     sessionId,
    //     cameraMode,
    //     selectedResolution,
    //     selectedFps,
    //     selectedPoseResolution,
    //     yoloDelegate,
    //     poseDelegate,
    //     yoloModelId,
    //     moveNetModelId,
    // })
    const { user } = useContext(AuthContext) || {}

    const [session, setSession]             = useState<WorkoutSession | null>(null)
    const [calibration, setCalibration]     = useState<CalibrationData | null>(null)

    // Stabilize effectiveResolution to prevent remount when calibration loads
    const effectiveResolutionRef = useRef<{ width: number; height: number }>(
        selectedResolution ?? (calibration?.cameraResolution ?? CAMERA_CONFIG.DEFAULT_RESOLUTION)
    )
    const effectiveResolution = effectiveResolutionRef.current
    const [effectiveFps, setEffectiveFps] = useState(selectedFps ?? CAMERA_CONFIG.DEFAULT_FPS)
    const effectivePoseResolution = (selectedPoseResolution ?? CAMERA_CONFIG.DEFAULT_POSE_RESOLUTION) as number
    const [effectiveYoloModelId, setEffectiveYoloModelId] = useState(yoloModelId ?? DEFAULT_YOLO_MODEL_ID)
    const effectiveMoveNetModelId = moveNetModelId ?? DEFAULT_MOVENET_MODEL_ID

    const constraints = React.useMemo(
        () => [{ fps: effectiveFps }],
        [effectiveFps]
    )

    // Log constraints to verify FPS is being set
    useEffect(() => {
        console.log('[WorkoutSession] Camera constraints:', constraints)
    }, [constraints])

    const [isEnding, setIsEnding] = useState(false)
    const [isRecording, setIsRecording] = useState(false)
    const isRecordingRef = useRef(false)
    const cameraViewRef = useRef<View>(null)

    // Video recording hook
    const {
        isVideoRecording,
        videoDuration,
        isVideoRecordingRef,
        toggleRecording: toggleSessionVideoRecording,
        formatVideoDuration,
    } = useVideoRecording()

    // Screenshot capture hook
    const { captureShotScreenshot, saveScreenshotWithResult } = useScreenshotCapture(cameraViewRef)
    const [shotCount, setShotCount]         = useState({ total: 0, made: 0 })
    const [trackingState, setTrackingState] = useState<TrackingState | null>(null)
    const [poseKeypoints, setPoseKeypoints] = useState<PoseKeypoints | null>(null)
    const [jointAngles, setJointAngles]     = useState<Partial<JointAngles>>({})
    const [lastShotResult, setLastShotResult] = useState<ShotResult | null>(null)
    const [modelsReady, setModelsReady]     = useState(false)
    const [rimFromDetection, setRimFromDetection] = useState<{ x: number; y: number; width: number; height: number; confidence: number } | null>(null)
    const [poseEnabled, setPoseEnabled] = useState<boolean>(TEST_CONFIG.ENABLE_MOVENET)
    const [ballEnabled, setBallEnabled] = useState<boolean>(TEST_CONFIG.ENABLE_YOLO)
    const [rimDetectionEnabled, setRimDetectionEnabled] = useState(true)
    const [fpsMetrics, setFpsMetrics] = useState({ yoloFps: 0, moveNetFps: 0 })
    const [cameraFps, setCameraFps] = useState(0)
    const [showTelemetry, setShowTelemetry] = useState<boolean>(TEST_CONFIG.ENABLE_TELEMETRY_OVERLAY)
    const [debugMode, setDebugMode] = useState<boolean>(TEST_CONFIG.ENABLE_DEBUG_OVERLAY)
    const [usageMinutes, setUsageMinutes] = useState(0)
    const [usageSeconds, setUsageSeconds] = useState(0)
    const sessionStartTimeRef = useRef<number | null>(null)
    const sessionStartTimeGlobal = useRef<number | null>(null)

    // Zoom state for pinch-to-zoom
    const [zoom, setZoom] = useState(1)
    const [baseZoom, setBaseZoom] = useState(1)
    const [isZooming, setIsZooming] = useState(false)

    const onPinchGestureEvent = (event: any) => {
        if (event.nativeEvent.scale !== undefined) {
            const minZoom = device?.minZoom ?? 1
            const maxZoom = device?.maxZoom ?? 5
            const newZoom = Math.max(minZoom, Math.min(maxZoom, baseZoom * event.nativeEvent.scale))
            setZoom(newZoom)
        }
    }

    const onPinchHandlerStateChange = (event: any) => {
        if (event.nativeEvent.state === State.BEGAN) {
            setBaseZoom(zoom)
            setIsZooming(true)
        } else if (event.nativeEvent.state === State.END) {
            setBaseZoom(zoom)
            setIsZooming(false)
        }
    }


    // Lifecycle diagnostic: if ShotTracker reports UNMOUNT during an active
    // session, this tells us whether the whole WorkoutSessionScreen also
    // unmounted. A real screen unmount should always produce both logs.
    const screenInstanceIdRef = useRef(Math.random().toString(36).slice(2, 8))
    useEffect(() => {
        console.log('[WorkoutSession][INSTANCE] MOUNT', screenInstanceIdRef.current)
        return () => {
            console.log('[WorkoutSession][INSTANCE] UNMOUNT', screenInstanceIdRef.current)
        }
    }, [])

    const shotCounter = useRef(0)
    const pendingScreenshotUri = useRef<string | null>(null)

    const { alert, showError, showWarning, showSuccess } = useCustomAlert()
    const { stats: wsStats, status: wsStatus } = useWorkoutWebSocket(sessionId ?? null, user?.id ?? null)
    const tracking = useTrackingEngine({
        onBallDetected: () => telemetryLogger.recordBallDetected(),
        onBallPrediction: (ageMs: number) => telemetryLogger.recordBallPrediction(ageMs),
        onBallTrackingExpired: () => telemetryLogger.recordBallTrackingExpired(),
        // Player detection telemetry is now recorded in useShotTracker (YOLO callback scope)
        // onPlayerDetected: () => telemetryLogger.recordPlayerYoloDetection(),
    })
    const { sharedValues } = tracking
    const feedbackOpacity = useRef(new Animated.Value(0)).current
    const isActiveRef     = useRef(true)
    const resetShotTrackingRef = useRef<(() => void) | null>(null)

    // Initialize WorkoutSessionRuntime (Phase 4.4.2)
    const runtimeRef = useRef<WorkoutSessionRuntime | null>(null)
    const visionEngineAdapterRef = useRef<VisionEngineAdapter | null>(null)
    const [trackingConnected, setTrackingConnected] = useState(false)
    const trackingConnectedRef = useRef(false) // Track if already connected to avoid repeated connections
    const visionEngineConnectedRef = useRef(false) // Track if VisionEngine is connected to Runtime
    const useRuntimeProcessingRef = useRef(false) // Phase 4: Toggle Runtime.processFrame() vs legacy tracking
    const lastRuntimeProcessTimestampRef = useRef(0) // Track last timestamp to avoid duplicate processFrame() calls
    const RUNTIME_PROCESS_DEBOUNCE_MS = 50 // Debounce to avoid duplicate calls for same logical frame
    
    // Get YOLO model name for loading messages
    const selectedYoloModel = getYoloModel(effectiveYoloModelId)
    const yoloModelName = selectedYoloModel?.label || yoloModelId || 'YOLO'

    // Tracking status hook
    const {
        trackingBadgeText,
        trackingDotActive,
        trackingDotColor,
        autoStatusText,
        autoDotActive,
    } = useTrackingStatus({
        sharedValues,
        modelsReady,
        yoloModelName,
    })
    // Sync isRecordingRef con lo state (per evitare stale closure)
    useEffect(() => { isRecordingRef.current = isRecording }, [isRecording])
    const cameraRef       = useRef<CameraRef>(null)
    const lastBackendFrameTimestamp = useRef<number>(0)
    const workoutQueueRef = useRef<Awaited<ReturnType<typeof createWorkoutQueue>> | null>(null)
    const telemetrySamplerRef = useRef<TelemetrySampler | null>(null)

    // Performance monitoring (YOLO/MoveNet FPS from worker SharedValues)
    useEffect(() => {
        startPerfMonitor()
        return () => stopPerfMonitor()
    }, [])

    // Pose callback
    const handlePoseResult = useCallback((result: PoseResult) => {
        const tStart = performance.now()

        // Single pass optimization: calculate validKeypoints, keypointsArray, and avgConfidence
        let validKeypoints = 0
        let confidenceSum = 0
        const keypointsArray = Object.values(result.keypoints).map(kp => {
            if (kp && kp.score > 0) {
                validKeypoints++
                confidenceSum += kp.score
            }
            return {
                x: kp.x,
                y: kp.y,
                confidence: kp.score,
            }
        })
        const avgConfidence = validKeypoints > 0 ? confidenceSum / validKeypoints : 0

        // TEMP: Commented to reduce log noise during performance investigation
        // console.log('[POSE RESULT] keypoints=', Object.keys(result.keypoints).length, 'valid=', validKeypoints)
        setPoseKeypoints(result.keypoints)
        setJointAngles(result.angles)

        // Update VisionEngineAdapter with parsed pose result (Phase 3)
        // Convert from vision/types to VisionEngine.types format

        visionEngineAdapterRef.current?.updateParsedResults(
            undefined, // ball
            undefined, // player
            undefined, // rim
            {
                keypoints: keypointsArray,
                confidence: avgConfidence,
            }, // pose (VisionEngine.types format)
            Date.now()
        )

        // Phase 4: Call Runtime.processFrame() with VisionEngine data (debounced)
        const runtime = runtimeRef.current
        const now = Date.now()
        if (runtime && runtime.getState() === 'ACTIVE' && useRuntimeProcessingRef.current) {
            if (now - lastRuntimeProcessTimestampRef.current >= RUNTIME_PROCESS_DEBOUNCE_MS) {
                lastRuntimeProcessTimestampRef.current = now
                const resolution = effectiveResolutionRef.current
                runtime.processFrame({
                    width: resolution.width,
                    height: resolution.height,
                    timestamp: now,
                })
            }
        }

        const tEnd = performance.now()
        const duration = tEnd - tStart
        if (duration > 5) {
            console.log('[POSE CALLBACK] slow:', duration.toFixed(1) + 'ms')
        }
        // console.log('[POSE STATE] setPoseKeypoints called')
    }, [])

    // Rim detection callback (replaces calibrated rim if confidence high)
    const lastRimDetectionLogRef = useRef(0)
    const handleRimDetection = useCallback((rim: { x: number; y: number; width: number; height: number; confidence: number }) => {
        const now = Date.now()
        // Log only once per session to reduce noise (already throttled to 1s, but still noisy)
        if (lastRimDetectionLogRef.current === 0) {
            console.log('[WorkoutSession] Rim detected with high confidence - replacing calibrated rim')
            lastRimDetectionLogRef.current = now
        }
        setRimFromDetection(rim)
        // Update tracking engine to update overlay shared values
        tracking.setHoopFromCalibration(rim.x, rim.y, rim.width, rim.height)

        // Update VisionEngineAdapter with parsed rim result (Phase 3)
        visionEngineAdapterRef.current?.updateParsedResults(
            undefined, // ball
            undefined, // player
            rim, // rim
            undefined, // pose
            Date.now()
        )
    }, [tracking])

    // Player detection callback (for VisionEngine integration)
    const handlePlayerDetection = useCallback((player: { x: number; y: number; width: number; height: number; confidence: number }) => {
        // Update VisionEngineAdapter with parsed player result
        visionEngineAdapterRef.current?.updateParsedResults(
            undefined, // ball
            player, // player
            undefined, // rim
            undefined, // pose
            Date.now()
        )
    }, [])

    // Ball detection callback (trackingState for events only, visual data via SharedValue/Skia)
    const lastTrackingProcessAt = useRef<number>(0)
    const TRACKING_THROTTLE_MS = 100  // Process tracking at most every 100ms

    const handleBallDetection = useCallback((detection: BallDetection) => {
        const tStart = performance.now()
        const ball = detection.ball
        const rim = detection.rim
        const now = Date.now()

        // PASS 5J-A: Ball callback profiling
        const tAdapterStart = performance.now()
        // Update VisionEngineAdapter with parsed ball/rim results (Phase 3)
        // Convert from vision/types to VisionEngine.types format
        visionEngineAdapterRef.current?.updateParsedResults(
            ball || null, // BallDetection (flat)
            undefined, // player (not in BallDetection type)
            rim || null, // RimDetection
            undefined, // pose (updated separately)
            now
        )
        const tAdapterEnd = performance.now()

        // Phase 4: Call Runtime.processFrame() with VisionEngine data (debounced)
        const runtime = runtimeRef.current
        let tRuntimeMs = 0
        if (runtime && runtime.getState() === 'ACTIVE' && useRuntimeProcessingRef.current) {
            if (now - lastRuntimeProcessTimestampRef.current >= RUNTIME_PROCESS_DEBOUNCE_MS) {
                lastRuntimeProcessTimestampRef.current = now
                const resolution = effectiveResolutionRef.current
                const tRuntimeStart = performance.now()
                runtime.processFrame({
                    width: resolution.width,
                    height: resolution.height,
                    timestamp: now,
                })
                tRuntimeMs = performance.now() - tRuntimeStart
            }
            // Skip legacy tracking path when Runtime.processFrame() is active
            // Runtime.processFrame() already calls TrackingEngine internally
            const tEnd = performance.now()
            const duration = tEnd - tStart
            if (duration > 5) {
                console.log('[BALL CALLBACK] slow:', duration.toFixed(1) + 'ms', {
                    adapter: (tAdapterEnd - tAdapterStart).toFixed(2) + 'ms',
                    runtime: tRuntimeMs.toFixed(2) + 'ms',
                    other: (duration - (tAdapterEnd - tAdapterStart) - tRuntimeMs).toFixed(2) + 'ms'
                })
            }
            return
        }

        const rimForTracking = rimFromDetection ? {
            x: rimFromDetection.x,
            y: rimFromDetection.y,
            width: rimFromDetection.width,
            height: rimFromDetection.height,
            confidence: rimFromDetection.confidence,
        } : calibration?.hoopCenter ? {
            x: calibration.hoopCenter.x,
            y: calibration.hoopCenter.y,
            width: 0.05,
            height: 0.05,
            confidence: 1.0,
        } : null

        const shouldProcess = now - lastTrackingProcessAt.current >= TRACKING_THROTTLE_MS

        let tTrackingMs = 0
        let tStateUpdateMs = 0
        let tTelemetryMs = 0

        if (shouldProcess) {
            lastTrackingProcessAt.current = now
            const oldState = tracking.getState()
            const tTrackingStart = performance.now()
            const newState: TrackingState = tracking.processFrame(
                ball ? { x: ball.x, y: ball.y, width: ball.width, height: ball.height, confidence: ball.confidence } : null,
                rimForTracking ? { x: rimForTracking.x, y: rimForTracking.y, width: rimForTracking.width, height: rimForTracking.height, confidence: rimForTracking.confidence } : null,
                now,  // Use Date.now() for consistent timestamp domain with ballLastSeenAt
                poseKeypoints,
                detection.ballSizeCategory,
                detection.adaptiveThreshold
            )
            tTrackingMs = performance.now() - tTrackingStart
            incrementTrackingUpdates()

            // Update trackingState ONLY when analytics/event data changes (not visual data)
            // This eliminates ~15 React renders/sec during tracking
            if (
                oldState.shotDetected !== newState.shotDetected ||
                oldState.shotResult !== newState.shotResult ||
                oldState.releasePoint !== newState.releasePoint ||
                oldState.apexPoint !== newState.apexPoint ||
                oldState.shotQuality !== newState.shotQuality ||
                oldState.releaseAngle !== newState.releaseAngle
            ) {
                const tStateStart = performance.now()
                setTrackingState({ ...newState })
                tStateUpdateMs = performance.now() - tStateStart
            }

            // Backend sampling: 2 Hz (max 2 POST-worthy samples/sec)
            if (ball || rimForTracking) {
                const sampler = telemetrySamplerRef.current
                const runtimeForTelemetry = runtimeRef.current as WorkoutSessionRuntime | null
                if (sampler && sampler.shouldSample(now) && runtimeForTelemetry) {
                    const tTelemetryStart = performance.now()
                    runtimeForTelemetry.enqueueTelemetry({
                        frameTimestamp:   now,
                        ballX:            ball ? ball.x : undefined,
                        ballY:            ball ? ball.y : undefined,
                        ballWidth:        ball ? ball.width : undefined,
                        ballHeight:       ball ? ball.height : undefined,
                        ballConfidence:   ball?.confidence,
                        hoopX:            rimForTracking ? rimForTracking.x : undefined,
                        hoopY:            rimForTracking ? rimForTracking.y : undefined,
                        hoopConfidence:   rimForTracking?.confidence,
                        ballVelocityX:    newState.ballVelocity?.vx,
                        ballVelocityY:    newState.ballVelocity?.vy,
                        shotDetected:     newState.shotDetected,
                        trajectoryData:   { points: newState.trajectory.slice(-10) },
                    } as FrameDataPayload)
                    tTelemetryMs = performance.now() - tTelemetryStart
                }
            }
        }

        const tEnd = performance.now()
        const duration = tEnd - tStart
        if (duration > 5) {
            console.log('[BALL CALLBACK] slow:', duration.toFixed(1) + 'ms', {
                adapter: (tAdapterEnd - tAdapterStart).toFixed(2) + 'ms',
                tracking: tTrackingMs.toFixed(2) + 'ms',
                stateUpdate: tStateUpdateMs.toFixed(2) + 'ms',
                telemetry: tTelemetryMs.toFixed(2) + 'ms',
                other: (duration - (tAdapterEnd - tAdapterStart) - tTrackingMs - tStateUpdateMs - tTelemetryMs).toFixed(2) + 'ms'
            })
        }
    }, [tracking, calibration, rimFromDetection, poseKeypoints])

    // Auto shot detection handler
    const handleAutoShotDetected = useCallback(async (result: ShotResult) => {
        if (!user?.id || !sessionId || isRecordingRef.current) return
        isRecordingRef.current = true
        setIsRecording(true)
        try {
            const state   = tracking.getState()
            const metrics = tracking.computeTrajectoryMetrics()
            const coords  = toCourtMeters(
                state.ballPosition?.x ?? 0.5,
                state.ballPosition?.y ?? 0.5,
                calibration
            )

            // Enqueue to critical queue via Runtime - non-blocking with error logging
            const runtimeForAutoShot = runtimeRef.current as WorkoutSessionRuntime | null
            if (!runtimeForAutoShot) return

            runtimeForAutoShot.enqueueCritical({
                type: 'SHOT',
                sessionId,
                userId: user.id,
                payload: {
                    timestampMs: Date.now(), shotResult: result, ...coords,
                    releaseAngle:        metrics.releaseAngle,
                    detectionConfidence: state.confidence,
                    trackingData: JSON.stringify({
                        autoDetected: true,
                        arcHeight:    metrics.arcHeight,
                        smoothness:   metrics.smoothness,
                    }),
                }
            } as CriticalPayload).catch((error) => {
                console.error('[Auto Shot] Failed to persist shot event:', error)
                // UI already updated, but data may be lost
            })
            
            // Update UI immediately
            setLastShotResult(result)
            setShotCount(prev => ({
                total: prev.total + 1,
                made:  result === 'MADE' ? prev.made + 1 : prev.made,
            }))
            feedbackOpacity.setValue(1)
            Animated.timing(feedbackOpacity, {
                toValue: 0, duration: 1400,
                easing: Easing.out(Easing.ease), useNativeDriver: true,
            }).start()
            tracking.resetShot()
            resetShotTrackingRef.current?.()
        } catch (e: any) { showError('Errore tiro', e.message) }
        finally { isRecordingRef.current = false; setIsRecording(false) }
    }, [user?.id, sessionId, tracking, calibration, jointAngles])


    // Shot event callback removed - shot detection now handled by Runtime → TrackingEngine → ShotDetectionEngine → onShotDetected callback

    // Vision configuration hook
    const { visionConfig, effectiveRim } = useVisionConfig({
        poseEnabled,
        ballEnabled,
        rimDetectionEnabled,
        yoloDelegate,
        poseDelegate,
        effectiveYoloModelId,
        effectiveMoveNetModelId,
        effectiveResolution,
        effectiveFps,
        effectivePoseResolution,
        calibration,
        rimFromDetection,
        trackingState,
    })

    const {
        device,
        hasPermission,
        isActive,
        requestPermission,
        setIsActive,
        frameOutput,
        isModelReady,
        resetShotTracking,
        fpsMetrics: pipelineFpsMetrics,
        sharedValues: pipelineSharedValues,
    } = useWorkoutVisionPipeline(
        visionConfig,
        handleBallDetection,
        handlePoseResult,
        rimDetectionEnabled ? handleRimDetection : undefined,
        handlePlayerDetection,
        false // runtimeActive: Decision 29 reverted - not used in frame processor
    )

    // Create VisionEngineAdapter for Runtime (Phase 3)
    useEffect(() => {
        const visionEngineAdapter = new VisionEngineAdapter(
            YOLO_CONFIG.BALL_CONF_THRESHOLD,
            YOLO_CONFIG.RIM_CONF_THRESHOLD,
            0.03 // pose score threshold
        )
        visionEngineAdapterRef.current = visionEngineAdapter

        return () => {
            visionEngineAdapterRef.current = null
        }
    }, [])

    // Store resetShotTracking in ref for use in callbacks defined before useCameraPipeline
    resetShotTrackingRef.current = resetShotTracking

    // Update player bbox from pipeline shared values (throttled to reduce overhead)
    const lastUpdateRef = useRef(0)
    useEffect(() => {
        if (pipelineSharedValues) {
            const now = Date.now()
            // Throttle to max 30 updates per second
            if (now - lastUpdateRef.current > 33) {
                lastUpdateRef.current = now
                tracking.updatePlayerFromPipeline(pipelineSharedValues)
            }
        }
    }, [pipelineSharedValues, tracking])

    // Update FPS metrics from pipeline using useAnimatedReaction
    const lastFpsUpdate = React.useRef(0)
    const updateFpsMetrics = React.useCallback((yoloFps: number, moveNetFps: number, cameraFps: number) => {
        const now = Date.now()
        if (now - lastFpsUpdate.current > 1000) {
            lastFpsUpdate.current = now
            // Removed duplicate log - FPS metrics are already in [PERF 1s] telemetry
            // if (__DEV__) {
            //     console.log('[WorkoutSession] FPS update:', { yoloFps, moveNetFps })
            // }
            setFpsMetrics({
                yoloFps: Math.round(yoloFps),
                moveNetFps: Math.round(moveNetFps),
            })
            setCameraFps(Math.round(cameraFps))
        }
    }, [])

    useAnimatedReaction(
        () => ({
            yoloFps: pipelineFpsMetrics.yoloFps?.value ?? 0,
            moveNetFps: pipelineFpsMetrics.moveNetFps?.value ?? 0,
            cameraFps: pipelineFpsMetrics.actualCameraFps?.value ?? 0,
        }),
        (current) => {
            'worklet'
            runOnJS(updateFpsMetrics)(current.yoloFps, current.moveNetFps, current.cameraFps)
        }
    )

    // Request media library permissions for screenshots
    useEffect(() => {
        void (async () => {
            const { status } = await MediaLibrary.requestPermissionsAsync()
            if (status !== 'granted') {
                console.warn('[WorkoutSession] Media library permission not granted')
            }
        })()
    }, [])

    // Track usage minutes when session is active
    useEffect(() => {
        // Removed log - noise during normal operation
        if (isActive && isModelReady) {
            if (!sessionStartTimeGlobal.current) {
                sessionStartTimeGlobal.current = Date.now()
                console.log('[WorkoutSession] Set session start time:', sessionStartTimeGlobal.current)
            }
            const interval = setInterval(() => {
                if (sessionStartTimeGlobal.current) {
                    const elapsedMs = Date.now() - sessionStartTimeGlobal.current
                    const minutes = Math.floor(elapsedMs / 60000)
                    const seconds = Math.floor((elapsedMs % 60000) / 1000)
                    // Removed hot-path log to reduce JS thread contention
                    // console.log('[WorkoutSession] Usage update:', { elapsedMs, minutes, seconds })
                    setUsageMinutes(minutes)
                    setUsageSeconds(seconds)
                }
            }, 1000) // Update every second
            return () => clearInterval(interval)
        }
    }, [isActive, isModelReady])

    // Lifecycle
    useEffect(() => {
        void loadSession()

        return () => {
            isActiveRef.current = false
            setIsActive(false)
            // Cleanup on unmount: stop runtime if active
            if (runtimeRef.current && runtimeRef.current.getState() === 'ACTIVE') {
                runtimeRef.current.stop().catch((error) => {
                    console.error('[WorkoutSession] Error stopping runtime on unmount:', error)
                })
            }
            runtimeRef.current = null
        }
    }, [])

    // Avvio: quando il modello è pronto
    useEffect(() => {
        // Removed log - noise during startup/debug
        setModelsReady(isModelReady)
    }, [isModelReady])

    // Phase 4.5: Connect TrackingEngine to Runtime after both are initialized
    useEffect(() => {
        if (trackingConnectedRef.current) return // Already connected

        const trackingEngine = tracking.getTrackingEngine()
        if (trackingEngine && runtimeRef.current) {
            runtimeRef.current.setTrackingEngine(trackingEngine)
            console.log('[WorkoutSession] TrackingEngine connected to runtime')

            // Connect internal ShotDetectionEngine to avoid double ownership
            const shotDetectionEngine = trackingEngine.getShotDetectionEngine()
            if (shotDetectionEngine) {
                runtimeRef.current.setShotDetectionEngine(shotDetectionEngine)
                console.log('[WorkoutSession] ShotDetectionEngine connected to runtime')
            }

            trackingConnectedRef.current = true
            setTrackingConnected(true)
        }
    }, [tracking])

    // Phase 3: Connect VisionEngineAdapter to Runtime (VisionEngine integration)
    useEffect(() => {
        if (visionEngineConnectedRef.current) return // Already connected

        if (visionEngineAdapterRef.current && runtimeRef.current) {
            runtimeRef.current.setVisionEngine(visionEngineAdapterRef.current)
            console.log('[WorkoutSession] VisionEngineAdapter connected to runtime')
            visionEngineAdapterRef.current.start()
            visionEngineConnectedRef.current = true
            // Phase 4: Enable Runtime.processFrame() path
            useRuntimeProcessingRef.current = true
            console.log('[WorkoutSession] Runtime.processFrame() path ENABLED')
        }
    }, [visionEngineAdapterRef.current, runtimeRef.current])

    // Phase 4.5: Start runtime after both TrackingEngine and VisionEngineAdapter are connected
    useEffect(() => {
        if (trackingConnected && visionEngineConnectedRef.current && runtimeRef.current) {
            const runtime = runtimeRef.current
            // Only start if still in IDLE state (not already started)
            if (runtime.getState() === 'IDLE') {
                runtime.start().then(() => {
                    console.log('[WorkoutSession] Runtime session started')
                }).catch((error) => {
                    console.error('[WorkoutSession] Failed to start runtime:', error)
                })
            }
        }
    }, [trackingConnected])

    const loadSession = async () => {
        if (!user?.id || !sessionId) return
        try {
            const s = await getWorkoutSession(sessionId, user.id)
            setSession(s)
            setShotCount({ total: s.totalShots, made: s.madeShots })

            // Create session-scoped queue FIRST (async initialization with global recovery)
            workoutQueueRef.current = await createWorkoutQueue({ sessionId, userId: user.id })
            console.log('[WorkoutSession] Queue initialized')

            // Create telemetry sampler (2 Hz = 500ms)
            telemetrySamplerRef.current = new TelemetrySampler({ sampleIntervalMs: 500 })
            console.log('[WorkoutSession] Telemetry sampler initialized')

            // Initialize WorkoutSessionRuntime (Phase 4.4.2)
            const runtime = new WorkoutSessionRuntime(
                {
                    sessionId,
                    userId: user.id,
                },
                {
                    onSessionStateChanged: (newState) => {
                        console.log('[WorkoutSession] Runtime state changed:', newState)
                    },
                    onShotDetected: async (result) => {
                        setLastShotResult(result)
                        setShotCount(prev => ({
                            total: prev.total + 1,
                            made: result === 'MADE' ? prev.made + 1 : prev.made,
                        }))
                        feedbackOpacity.setValue(1)
                        Animated.timing(feedbackOpacity, {
                            toValue: 0, duration: 1400,
                            easing: Easing.out(Easing.ease), useNativeDriver: true,
                        }).start()

                        // Handle screenshot capture and persistence (moved from legacy handleShotEvent)
                        shotCounter.current += 1
                        const screenshotData = await captureShotScreenshot(shotCounter.current)
                        if (screenshotData) {
                            pendingScreenshotUri.current = JSON.stringify(screenshotData)
                        }

                        // Save screenshot with result
                        if (pendingScreenshotUri.current) {
                            const data = JSON.parse(pendingScreenshotUri.current)
                            void saveScreenshotWithResult(data, result)
                            pendingScreenshotUri.current = null
                        }
                    },
                    onTelemetryUpdate: (metrics) => {
                        // Disabled - FPS metrics are already available via fpsMetrics from useShotTracker
                        // console.log('[WorkoutSession] Telemetry update:', metrics)
                    },
                    onError: (error) => {
                        showError('Errore Runtime', error.message)
                    },
                    onTrackingStateUpdate: (trackingState) => {
                        // Phase 4: Update tracking state from Runtime.processFrame()
                        setTrackingState(trackingState)
                        // Update SharedValues for Skia overlay
                        tracking.updateSharedValuesFromState(trackingState)
                    },
                }
            )
            runtimeRef.current = runtime
            console.log('[WorkoutSession] Runtime initialized')

            // Connect subsystems to runtime (Phase 4.5)
            if (telemetrySamplerRef.current) {
                runtime.setTelemetrySampler(telemetrySamplerRef.current)
                console.log('[WorkoutSession] Telemetry sampler connected to runtime')
            }

            if (workoutQueueRef.current) {
                runtime.setWorkoutQueue(workoutQueueRef.current)
                console.log('[WorkoutSession] WorkoutQueue connected to runtime')
            }

            // Note: TrackingEngine and VisionPipelineAdapter will be connected via useEffect
            // after the component renders. Runtime.start() will be called after both are connected.

            // Load calibration
            try {
                const r   = await apiClient.get(`/workouts/sessions/${sessionId}/calibration?userId=${user.id}`)
                const cal: CalibrationData = {
                    homographyMatrix: r.data.homographyMatrix ?? [],
                    hoopCenter:       { x: r.data.hoopCenterX ?? 0.5, y: r.data.hoopCenterY ?? 0.3 },
                    cameraResolution: r.data.cameraResolutionWidth && r.data.cameraResolutionHeight
                        ? { width: r.data.cameraResolutionWidth, height: r.data.cameraResolutionHeight }
                        : undefined,
                    courtCorners:     r.data.courtCorners,
                }
                console.log('[WorkoutSession] Calibration loaded', cal.hoopCenter)
                setCalibration(cal)
                tracking.setHoopFromCalibration(cal.hoopCenter.x, cal.hoopCenter.y, 0.05, 0.05)
            } catch (e) {
                console.log('[WorkoutSession] Calibration not loaded', e)
                /* calibrazione opzionale */
            }

            // Activate camera ONLY after queue, telemetry, and calibration are ready
            setIsActive(true)
            console.log('[WorkoutSession] Camera activated - runtime ready')
        } catch (e: any) { showError('Errore', e.message) }
    }

    // Usiamo una ref per sessionId/userId per evitare stale closures nel timer
    const sessionIdRef = useRef(sessionId)
    const userIdRef    = useRef(user?.id)
    useEffect(() => { sessionIdRef.current = sessionId }, [sessionId])
    useEffect(() => { userIdRef.current    = user?.id  }, [user?.id])


    const handleManualShot = async (result: ShotResult) => {
        if (!user?.id || !sessionId || isRecording) return
        setIsRecording(true)
        try {
            // Use runtime to register manual shot (Phase 4.4.2)
            // Note: Runtime only accepts "MADE" | "MISS", convert AIRBALL to MISS
            const runtimeResult = result === 'AIRBALL' ? 'MISS' : result
            const runtimeForManual = runtimeRef.current as WorkoutSessionRuntime | null
            if (runtimeForManual) {
                await runtimeForManual.registerManualShot(runtimeResult as 'MADE' | 'MISS')
            } else {
                // Fallback to direct queue if runtime not available
                const state = tracking.getState()
                const coords = toCourtMeters(
                    state.ballPosition?.x ?? 0.5,
                    state.ballPosition?.y ?? 0.5,
                    calibration
                )
                const payload = {
                    timestampMs: Date.now(),
                    shotResult: result,
                    ...coords,
                    detectionConfidence: 1.0,
                    trackingData: JSON.stringify({ manualEntry: true }),
                }

                const runtimeFallback = runtimeRef.current as WorkoutSessionRuntime | null
                if (runtimeFallback) {
                    await runtimeFallback.enqueueCritical({
                        type: 'SHOT',
                        sessionId,
                        userId: user.id,
                        payload
                    })
                }

                // Update UI immediately
                setLastShotResult(result)
                setShotCount(prev => ({
                    total: prev.total + 1,
                    made: result === 'MADE' ? prev.made + 1 : prev.made,
                }))
                feedbackOpacity.setValue(1)
                Animated.timing(feedbackOpacity, {
                    toValue: 0, duration: 1400,
                    easing: Easing.out(Easing.ease), useNativeDriver: true,
                }).start()
            }

            tracking.resetShot()
            resetShotTrackingRef.current?.()
        } catch (e: any) {
            console.error('[Manual Shot] Error:', e)
            showError('Errore', e.response?.data?.message || e.message || 'Errore sconosciuto')
        }
        finally { setIsRecording(false) }
    }

    const handleEndSession = () => {
        showWarning('Termina Sessione', 'Sei sicuro di voler terminare?', async () => {
            setIsEnding(true)
            try {
                // Stop video recording if active before ending session
                if (isVideoRecordingRef.current) {
                    // Video recording not yet migrated to v5 API
                    // Note: setIsVideoRecording is not available from hook, recording state managed internally
                    isVideoRecordingRef.current = false
                }

                // Enqueue SESSION_END as critical event before shutdown via Runtime
                const runtimeForEnd = runtimeRef.current as WorkoutSessionRuntime | null
                if (runtimeForEnd) {
                    const persisted = await runtimeForEnd.enqueueCritical({
                        type: 'SESSION_END',
                        sessionId,
                        userId: user!.id,
                    })
                    if (persisted === false) {
                        throw new Error('Unable to persist SESSION_END')
                    }
                    console.log('[WorkoutSession] SESSION_END enqueued to critical queue via Runtime')
                }

                // Log telemetry summary before ending session
                telemetryLogger.logTestSummary(pipelineFpsMetrics.yoloFps?.value ?? 0, pipelineFpsMetrics.moveNetFps?.value ?? 0)

                // Export telemetry summary for saving with session
                const telemetrySummary = telemetryLogger.exportTestSummary(pipelineFpsMetrics.yoloFps?.value ?? 0, pipelineFpsMetrics.moveNetFps?.value ?? 0)
                console.log('[WorkoutSession] Telemetry Summary:', telemetrySummary)

                // Stop runtime session (includes queue shutdown via Runtime.stop())
                if (runtimeForEnd) {
                    await runtimeForEnd.stop()
                    console.log('[WorkoutSession] Runtime stopped')
                }

                workoutQueueRef.current = null
                telemetrySamplerRef.current = null
                navigation.replace('ShotChart', { sessionId, fromSession: true })
            } catch (e: any) { showError('Errore', e.message) }
            finally { setIsEnding(false) }
        })
    }

    const handlePauseResume = async () => {
        if (!user?.id || !sessionId || !session) return
        const runtime = runtimeRef.current
        if (!runtime) {
            showError('Errore', 'Runtime non disponibile')
            return
        }

        try {
            if (session.status === 'ACTIVE') {
                // Pause via Runtime
                await runtime.pause()
                await pauseWorkoutSession(sessionId, user.id)
                setSession({ ...session, status: 'PAUSED' })
                setIsActive(false)
                console.log('[WorkoutSession] Session paused via Runtime')
            } else {
                // Resume via Runtime
                await runtime.resume()
                await resumeWorkoutSession(sessionId, user.id)
                setSession({ ...session, status: 'ACTIVE' })
                setIsActive(true)
                console.log('[WorkoutSession] Session resumed via Runtime')
            }
        } catch (e: any) { showError('Errore', e.message) }
    }

    if (!hasPermission) return (
        <View style={[styles.container, styles.center]}>
            <Text style={styles.permTitle}>📷 Permesso Camera</Text>
            <Text style={styles.permDesc}>Necessario per il tracking AI dei tiri</Text>
            <TouchableOpacity style={styles.permBtn} onPress={requestPermission}>
                <Text style={styles.permBtnText}>Concedi Permesso</Text>
            </TouchableOpacity>
        </View>
    )

    if (!device) return (
        <View style={[styles.container, styles.center]}>
            <Text style={styles.permDesc}>Nessuna camera disponibile</Text>
        </View>
    )

    const isPaused = session?.status === 'PAUSED'

    return (
        <GestureHandlerRootView style={styles.container}>
            <WorkoutHeader
                session={session}
                shotCount={shotCount}
                wsStatus={wsStatus}
                wsStats={wsStats}
                jointAngles={jointAngles}
                modelsReady={modelsReady}
                showTelemetry={showTelemetry}
                isVideoRecording={isVideoRecording}
                videoDuration={videoDuration}
                isPaused={isPaused}
                isEnding={isEnding}
                onGoBack={() => navigation.goBack()}
                onPauseResume={handlePauseResume}
                onToggleVideoRecording={toggleSessionVideoRecording}
                onToggleTelemetry={() => setShowTelemetry(v => !v)}
            />

            <View style={{ height: CAMERA_H, position: 'relative' }} ref={cameraViewRef} collapsable={false}>
                <PinchGestureHandler
                    onGestureEvent={onPinchGestureEvent}
                    onHandlerStateChange={onPinchHandlerStateChange}
                >
                    <View style={{ flex: 1 }}>
                        <Camera
                            ref={cameraRef}
                            style={StyleSheet.absoluteFill}
                            device={device}
                            isActive={isActive && !isPaused}
                            outputs={[frameOutput]}
                            zoom={isActive && !isPaused ? zoom : undefined}
                            resizeMode="cover"
                            constraints={constraints}
                            onError={(error: any) => {
                                if (error.code === 'session/invalid-output-configuration') {
                                    console.log('[WorkoutSession] Camera session error - remounting')
                                    setIsActive(false)
                                    setTimeout(() => setIsActive(true), 500)
                                }
                            }}
                        />

                        {/* Visual indicator for active video session recording */}
                        {isVideoRecording && (
                            <View style={styles.recBanner} pointerEvents="none">
                                <View style={styles.recDotPulsing} />
                                <Text style={styles.recBannerText}>🔴 REC {formatVideoDuration(videoDuration)}</Text>
                            </View>
                        )}

                        {/* Realtime Ball Overlay (pure Skia, 30/60 FPS) */}
                        <RealtimeBallOverlay
                            sharedValues={sharedValues}
                            effectiveResolution={effectiveResolution}
                            poseKeypoints={poseKeypoints}
                        />

                        {/* React Overlay (badges, debug, 2-5 Hz) */}
                        <ReactOverlay
                            trackingState={trackingState}
                            poseKeypoints={poseKeypoints}
                            jointAngles={jointAngles}
                            releaseAngle={trackingState?.releaseAngle}
                            arcHeight={trackingState?.releasePoint && trackingState?.apexPoint
                                ? trackingState.releasePoint.y - trackingState.apexPoint.y
                                : undefined}
                            calibration={calibration}
                            sharedValues={sharedValues}
                            fpsMetrics={fpsMetrics}
                            effectiveResolution={effectiveResolution}
                            showDebug={debugMode}
                            rimFromDetection={rimFromDetection}
                            cameraMode={cameraMode}
                        />

                        {/* Adaptive FPS overlay - hidden when telemetry is visible */}
                        {fpsMetrics && !showTelemetry && (
                            <View pointerEvents="none" style={{
                                position: 'absolute',
                                top: 10,
                                right: 10,
                                backgroundColor: 'rgba(0,0,0,0.7)',
                                padding: 8,
                                borderRadius: 8,
                            }}>
                                <Text style={{ color: '#fff', fontSize: 12, fontWeight: 'bold' }}>📊 FPS</Text>
                                <Text style={{ color: '#fff', fontSize: 10 }}>Camera: {cameraFps}</Text>
                                <Text style={{ color: '#fff', fontSize: 10 }}>YOLO: {fpsMetrics?.yoloFps ?? 0}</Text>
                                <Text style={{ color: '#fff', fontSize: 10 }}>MoveNet: {fpsMetrics?.moveNetFps ?? 0}</Text>
                            </View>
                        )}

                        {/* Telemetry overlay - re-enabled for PASS 5C test */}
                        <TelemetryOverlay
                            visible={showTelemetry}
                            onClose={() => setShowTelemetry(false)}
                            yoloFps={fpsMetrics.yoloFps}
                            moveNetFps={fpsMetrics.moveNetFps}
                            actualCameraFps={cameraFps}
                            debugMode={debugMode}
                            cameraConfig={{
                                resolution: effectiveResolution,
                                fps: effectiveFps,
                            }}
                            modelConfig={{
                                yoloModel: effectiveYoloModelId,
                                moveNetModel: effectiveMoveNetModelId,
                                moveNetResolution: effectivePoseResolution,
                                fpsMin: getYoloModel(effectiveYoloModelId)?.fpsMin,
                                fpsMax: getYoloModel(effectiveYoloModelId)?.fpsMax,
                                epochs: getYoloModel(effectiveYoloModelId)?.epochs,
                                usageMinutes: usageMinutes,
                                usageSeconds: usageSeconds,
                            }}
                        />

                        <View style={styles.guideH} pointerEvents="none" />
                        <View style={styles.guideV} pointerEvents="none" />

                        {/* Zoom indicator overlay */}
                        {isZooming && (
                            <View style={styles.zoomIndicator} pointerEvents="none">
                                <Text style={styles.zoomIndicatorText}>{Math.round(zoom * 100)}%</Text>
                            </View>
                        )}
                    </View>
                </PinchGestureHandler>

                <ShotFeedback
                    lastShotResult={lastShotResult}
                    feedbackOpacity={feedbackOpacity}
                    trackingBadgeText={trackingBadgeText}
                    trackingDotActive={trackingDotActive}
                    trackingDotColor={trackingDotColor}
                />
            </View>

            <WorkoutControls
                isPaused={isPaused}
                isEnding={isEnding}
                isRecording={isRecording}
                isVideoRecording={isVideoRecording}
                videoDuration={videoDuration}
                ballEnabled={ballEnabled}
                poseEnabled={poseEnabled}
                rimDetectionEnabled={rimDetectionEnabled}
                debugMode={debugMode}
                autoStatusText={autoStatusText}
                autoDotActive={autoDotActive}
                onToggleBall={() => setBallEnabled(!ballEnabled)}
                onTogglePose={() => {
                    const newValue = !poseEnabled
                    console.log('[WorkoutSession] Pose toggle:', { from: poseEnabled, to: newValue })
                    setPoseEnabled(newValue)
                }}
                onToggleRim={() => setRimDetectionEnabled(!rimDetectionEnabled)}
                onToggleDebug={() => setDebugMode(!debugMode)}
                onManualShot={handleManualShot}
                onToggleVideoRecording={toggleSessionVideoRecording}
                onEndSession={handleEndSession}
            />
            <CustomAlert {...alert} />
        </GestureHandlerRootView>
    )
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#0b0f1a' },
    center: { justifyContent: 'center', alignItems: 'center', padding: 24 },
    recBanner: {
        position: 'absolute',
        top: 12,
        right: 12,
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(0,0,0,0.85)',
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 20,
        borderWidth: 1.5,
        borderColor: '#ef4444',
    },
    recDotPulsing: {
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: '#ef4444',
        marginRight: 6,
    },
    recBannerText: {
        color: '#ef4444',
        fontSize: 11,
        fontWeight: '900',
        letterSpacing: 0.5,
    },
    guideH: {
        position: 'absolute',
        left: 0,
        right: 0,
        top: '50%',
        height: 1,
        backgroundColor: 'rgba(255,140,0,0.12)',
    },
    guideV: {
        position: 'absolute',
        top: 0,
        bottom: 0,
        left: '50%',
        width: 1,
        backgroundColor: 'rgba(255,140,0,0.12)',
    },
    zoomIndicator: {
        position: 'absolute',
        top: 20,
        left: 20,
        backgroundColor: 'rgba(0,0,0,0.75)',
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.3)',
    },
    zoomIndicatorText: {
        color: '#fff',
        fontSize: 18,
        fontWeight: '700',
    },
    permTitle: {
        fontSize: 22,
        fontWeight: '800',
        color: '#fff',
        marginBottom: 12,
    },
    permDesc: {
        fontSize: 14,
        color: '#888',
        textAlign: 'center',
        marginBottom: 24,
        lineHeight: 20,
    },
    permBtn: {
        backgroundColor: '#ff8c00',
        paddingHorizontal: 28,
        paddingVertical: 14,
        borderRadius: 12,
    },
    permBtnText: {
        color: '#fff',
        fontWeight: '700',
        fontSize: 16,
    },
})
