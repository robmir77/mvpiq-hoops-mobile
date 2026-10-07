// Shot detection: MADE requires descending ball + hoop proximity, MISS requires trajectory past peak
// Dribble filter: risingFrames + MIN_ARC_HEIGHT to exclude ground bounces
// Phase 4.5: useTrackingEngine now delegates to pure TrackingEngine class for Runtime integration

import { useRef, useCallback, useEffect } from 'react'
import { useSharedValue } from 'react-native-reanimated'
import { TrackingState, VisionTrackState } from '../types/workouts.types'
import { TrackingEngine } from '../tracking/TrackingEngine'

// Shot detection thresholds
const SHOT_LAUNCH_THRESHOLD  = 1.5  // Min vertical velocity (normalized/s)
const HOOP_RADIUS_MADE       = 0.10  // Dynamic radius for MADE detection
const DESCENDING_VY_THRESHOLD = 0.3  // Descending threshold (vy > 0 = falling)
const MIN_TRAJECTORY_FRAMES  = 4  // Min frames before shot detection
const SHOT_COOLDOWN_MS       = 600  // Cooldown between shots

// Dynamic hoop radius from detected dimensions
const getDynamicHoopRadius = (hoop: { width?: number; height?: number } | null): number => {
    if (!hoop || !hoop.width || !hoop.height) return HOOP_RADIUS_MADE
    return Math.max(hoop.width, hoop.height) / 2 * 1.2  // Max dimension / 2 with margin
}

// Dribble filter thresholds
const MIN_RISING_FRAMES = 3  // Consecutive rising frames required
const MIN_ARC_HEIGHT = 0.08  // Min arc height (dribbles bounce ~5-8%, shots rise 12-15%)

interface BallTrackingCallbacks {
    onBallDetected?: () => void
    onBallPrediction?: (ageMs: number) => void
    onBallTrackingExpired?: () => void
    onPlayerDetected?: () => void
}

export const useTrackingEngine = (callbacks?: BallTrackingCallbacks) => {
    // Phase 4.5: Instantiate pure TrackingEngine class (Runtime-compatible)
    const trackingEngine = useRef<TrackingEngine>(
        new TrackingEngine(callbacks)
    )

    // Ring buffer for trajectory (O(1) insert, no reallocation)
    const MAX_POINTS = 90

    // Shared Values for Skia overlay (no React bridge)
    const ballX = useSharedValue(0)
    const ballY = useSharedValue(0)
    const ballWidth = useSharedValue(0)
    const ballHeight = useSharedValue(0)
    const ballXRaw = useSharedValue(0)
    const ballYRaw = useSharedValue(0)
    const hoopX = useSharedValue(0)
    const hoopY = useSharedValue(0)
    const hoopWidth = useSharedValue(0)
    const hoopHeight = useSharedValue(0)
    const confidence = useSharedValue(0)
    // Player bbox from YOLO (for direct display in overlay)
    const playerX = useSharedValue(0)
    const playerY = useSharedValue(0)
    const playerWidth = useSharedValue(0)
    const playerHeight = useSharedValue(0)
    const playerConfidence = useSharedValue(0)
    const ballRejectionReason = useSharedValue('')
    const rimRejectionReason = useSharedValue('')
    const inFlight = useSharedValue(false)
    const shotDetected = useSharedValue(false)
    const showShotTrail = useSharedValue(false)
    const shotResult = useSharedValue<string | null>(null)
    const releasePointX = useSharedValue(0)
    const releasePointY = useSharedValue(0)
    const apexPointX = useSharedValue(0)
    const apexPointY = useSharedValue(0)

    // Visual tracking state for debugging
    const ballTrackState = useSharedValue<VisionTrackState>('LOST')
    const playerTrackState = useSharedValue<VisionTrackState>('LOST')
    const rimTrackState = useSharedValue<VisionTrackState>('LOST')
    const ballTrackAge = useSharedValue(0) // Age in ms when predicted
    const playerTrackAge = useSharedValue(0) // Age in ms when predicted
    const rimTrackAge = useSharedValue(0) // Age in ms when predicted

    // Rejected detection positions for visualization
    const rejectedBallX = useSharedValue(0)
    const rejectedBallY = useSharedValue(0)
    const rejectedBallConfidence = useSharedValue(0)

    // Trajectory SharedValues (flat array: [x1, y1, x2, y2, ...])
    const trajectoryPoints = useSharedValue(new Float32Array(MAX_POINTS * 2).fill(0))
    const trajectoryPointCount = useSharedValue(0)

    // Ball size category and adaptive threshold
    const ballSizeCategory = useSharedValue<string | null>(null)
    const adaptiveThreshold = useSharedValue(0)

    const processFrame = useCallback((
        ballDetection: { x: number; y: number; width?: number; height?: number; confidence: number } | null,
        hoopDetection: { x: number; y: number; width?: number; height?: number; confidence: number } | null,
        frameTs: number,
        poseKeypoints?: any,
        sizeCategory?: 'small' | 'medium' | 'large' | null,
        adaptThreshold?: number,
        rejectedBall?: { x: number; y: number; width?: number; height?: number; confidence: number } | null
    ): TrackingState => {
        // Phase 4.5: Delegate to pure TrackingEngine class
        const engineState = trackingEngine.current.processFrame(
            ballDetection,
            hoopDetection,
            frameTs,
            poseKeypoints,
            sizeCategory,
            adaptThreshold,
            rejectedBall
        )

        // Update ball SharedValues
        if (engineState.ballPosition) {
            ballX.value = engineState.ballPosition.x
            ballY.value = engineState.ballPosition.y
        } else {
            ballX.value = 0
            ballY.value = 0
        }

        if (engineState.ballPositionRaw) {
            ballXRaw.value = engineState.ballPositionRaw.x
            ballYRaw.value = engineState.ballPositionRaw.y
        } else {
            ballXRaw.value = 0
            ballYRaw.value = 0
        }

        ballWidth.value = engineState.ballWidth || 0
        ballHeight.value = engineState.ballHeight || 0
        confidence.value = engineState.confidence || 0
        ballSizeCategory.value = sizeCategory ?? null
        adaptiveThreshold.value = adaptThreshold ?? 0

        // Update hoop SharedValues
        if (engineState.hoopPosition) {
            hoopX.value = engineState.hoopPosition.x
            hoopY.value = engineState.hoopPosition.y
            hoopWidth.value = engineState.hoopPosition.width || 0
            hoopHeight.value = engineState.hoopPosition.height || 0
        }

        // Update shot SharedValues
        inFlight.value = engineState.inFlight
        shotDetected.value = engineState.shotDetected
        shotResult.value = engineState.shotResult ?? null

        if (engineState.releasePoint) {
            releasePointX.value = engineState.releasePoint.x
            releasePointY.value = engineState.releasePoint.y
        }

        if (engineState.apexPoint) {
            apexPointX.value = engineState.apexPoint.x
            apexPointY.value = engineState.apexPoint.y
        }

        // Update trajectory SharedValues when inFlight
        if (engineState.inFlight && engineState.trajectory.length > 0) {
            const points = trajectoryPoints.value
            for (let i = 0; i < Math.min(engineState.trajectory.length, MAX_POINTS); i++) {
                points[i * 2] = engineState.trajectory[i].x
                points[i * 2 + 1] = engineState.trajectory[i].y
            }
            trajectoryPoints.value = points
            trajectoryPointCount.value = engineState.trajectory.length
        }

        // Handle rejected detections for visualization
        if (rejectedBall) {
            rejectedBallX.value = rejectedBall.x
            rejectedBallY.value = rejectedBall.y
            rejectedBallConfidence.value = rejectedBall.confidence
            ballTrackState.value = 'REJECTED'
        } else {
            rejectedBallX.value = 0
            rejectedBallY.value = 0
            rejectedBallConfidence.value = 0
        }

        // Update visual tracking state based on ball position
        if (engineState.ballPosition) {
            ballTrackState.value = 'DETECTED'
            ballTrackAge.value = 0
        } else {
            ballTrackState.value = 'LOST'
            ballTrackAge.value = 0
        }

        return engineState
    }, [MAX_POINTS, ballX, ballY, ballXRaw, ballYRaw, ballWidth, ballHeight, confidence, hoopX, hoopY, hoopWidth, hoopHeight, ballSizeCategory, adaptiveThreshold, inFlight, shotDetected, shotResult, releasePointX, releasePointY, apexPointX, apexPointY, trajectoryPoints, trajectoryPointCount, rejectedBallX, rejectedBallY, rejectedBallConfidence, ballTrackState, ballTrackAge])

    // Phase 4: Update SharedValues from external tracking state (Runtime.processFrame())
    const updateSharedValuesFromState = useCallback((engineState: TrackingState) => {
        // Update ball SharedValues
        if (engineState.ballPosition) {
            ballX.value = engineState.ballPosition.x
            ballY.value = engineState.ballPosition.y
        } else {
            ballX.value = 0
            ballY.value = 0
        }

        if (engineState.ballPositionRaw) {
            ballXRaw.value = engineState.ballPositionRaw.x
            ballYRaw.value = engineState.ballPositionRaw.y
        } else {
            ballXRaw.value = 0
            ballYRaw.value = 0
        }

        ballWidth.value = engineState.ballWidth || 0
        ballHeight.value = engineState.ballHeight || 0
        confidence.value = engineState.confidence || 0

        // Update hoop SharedValues
        if (engineState.hoopPosition) {
            hoopX.value = engineState.hoopPosition.x
            hoopY.value = engineState.hoopPosition.y
            hoopWidth.value = engineState.hoopPosition.width || 0
            hoopHeight.value = engineState.hoopPosition.height || 0
        }

        // Update shot SharedValues
        inFlight.value = engineState.inFlight
        shotDetected.value = engineState.shotDetected
        shotResult.value = engineState.shotResult ?? null

        if (engineState.releasePoint) {
            releasePointX.value = engineState.releasePoint.x
            releasePointY.value = engineState.releasePoint.y
        }

        if (engineState.apexPoint) {
            apexPointX.value = engineState.apexPoint.x
            apexPointY.value = engineState.apexPoint.y
        }

        // Update trajectory SharedValues when inFlight
        if (engineState.inFlight && engineState.trajectory.length > 0) {
            const points = trajectoryPoints.value
            for (let i = 0; i < Math.min(engineState.trajectory.length, MAX_POINTS); i++) {
                points[i * 2] = engineState.trajectory[i].x
                points[i * 2 + 1] = engineState.trajectory[i].y
            }
            trajectoryPoints.value = points
            trajectoryPointCount.value = engineState.trajectory.length
        }

        // Update visual tracking state based on ball position
        if (engineState.ballPosition) {
            ballTrackState.value = 'DETECTED'
            ballTrackAge.value = 0
        } else {
            ballTrackState.value = 'LOST'
            ballTrackAge.value = 0
        }
    }, [ballX, ballY, ballXRaw, ballYRaw, ballWidth, ballHeight, confidence, hoopX, hoopY, hoopWidth, hoopHeight, inFlight, shotDetected, shotResult, releasePointX, releasePointY, apexPointX, apexPointY, trajectoryPoints, trajectoryPointCount, ballTrackState, ballTrackAge, MAX_POINTS])

    const resetShot = useCallback(() => {
        // Phase 4.5: Delegate to TrackingEngine
        trackingEngine.current.resetShot()

        // Reset SharedValues
        inFlight.value = false
        showShotTrail.value = false
        shotDetected.value = false
        shotResult.value = null
        trajectoryPoints.value = new Float32Array(MAX_POINTS * 2).fill(0)
        trajectoryPointCount.value = 0
        ballTrackState.value = 'LOST'
        ballTrackAge.value = 0
    }, [inFlight, showShotTrail, shotDetected, shotResult, trajectoryPoints, trajectoryPointCount, MAX_POINTS, ballTrackState, ballTrackAge])

    const resetAll = useCallback(() => {
        // Phase 4.5: Delegate to TrackingEngine
        trackingEngine.current.resetAll()

        // Reset SharedValues (keep hoop values for last positive detection)
        ballX.value = 0
        ballY.value = 0
        ballWidth.value = 0
        ballHeight.value = 0
        ballXRaw.value = 0
        ballYRaw.value = 0
        confidence.value = 0
        ballSizeCategory.value = null
        adaptiveThreshold.value = 0
        inFlight.value = false
        showShotTrail.value = false
        shotDetected.value = false
        shotResult.value = null
        trajectoryPoints.value = new Float32Array(MAX_POINTS * 2).fill(0)
        trajectoryPointCount.value = 0
        ballTrackState.value = 'LOST'
        ballTrackAge.value = 0
    }, [ballX, ballY, ballWidth, ballHeight, ballXRaw, ballYRaw, confidence, ballSizeCategory, adaptiveThreshold, inFlight, showShotTrail, shotDetected, shotResult, trajectoryPoints, trajectoryPointCount, MAX_POINTS, ballTrackState, ballTrackAge])

    const setHoopFromCalibration = useCallback((x: number, y: number, width?: number, height?: number) => {
        // Phase 4.5: Delegate to TrackingEngine
        trackingEngine.current.setHoopFromCalibration(x, y, width, height)
        // Update Shared Values
        hoopX.value = x
        hoopY.value = y
        if (width !== undefined) hoopWidth.value = width
        if (height !== undefined) hoopHeight.value = height
    }, [hoopX, hoopY, hoopWidth, hoopHeight])

    const updatePlayerFromPipeline = useCallback((pipelineSharedValues: any) => {
        if (pipelineSharedValues?.playerX !== undefined) {
            playerX.value = pipelineSharedValues.playerX.value
            playerY.value = pipelineSharedValues.playerY.value
            playerWidth.value = pipelineSharedValues.playerWidth.value
            playerHeight.value = pipelineSharedValues.playerHeight.value
            playerConfidence.value = pipelineSharedValues.playerConfidence?.value ?? 0
        }
        // Copy visual tracking states from pipeline
        if (pipelineSharedValues?.playerTrackState !== undefined) {
            playerTrackState.value = pipelineSharedValues.playerTrackState.value
            playerTrackAge.value = pipelineSharedValues.playerTrackAge?.value ?? 0
        }
        if (pipelineSharedValues?.rimTrackState !== undefined) {
            rimTrackState.value = pipelineSharedValues.rimTrackState.value
            rimTrackAge.value = pipelineSharedValues.rimTrackAge?.value ?? 0
        }
        // Note: ballTrackState is managed by TrackingEngine, not pipeline
    }, [playerX, playerY, playerWidth, playerHeight, playerConfidence, playerTrackState, playerTrackAge, rimTrackState, rimTrackAge])

    const computeTrajectoryMetrics = useCallback((): {
        arcHeight: number; releaseAngle: number; smoothness: number
    } => {
        // Phase 4.5: Get trajectory from TrackingEngine state
        const engineState = trackingEngine.current.getState()
        const traj = engineState.trajectory
        if (traj.length < MIN_TRAJECTORY_FRAMES) return { arcHeight: 0, releaseAngle: 0, smoothness: 0 }

        // Use loop instead of map() for better performance
        let minY = Infinity
        for (const p of traj) {
            if (p.y < minY) minY = p.y
        }
        const startY = traj[0].y
        const arcHeight = Math.max(0, startY - minY)

        const n = Math.max(2, Math.floor(traj.length * 0.3))
        const dx = traj[n].x - traj[0].x
        const dy = traj[n].y - traj[0].y
        const releaseAngle = Math.abs(Math.atan2(-dy, Math.abs(dx)) * (180 / Math.PI))

        let smoothness = 1.0
        if (traj.length >= 3) {
            const accels: number[] = []
            for (let i = 1; i < traj.length - 1; i++) {
                const ax = traj[i + 1].x - 2 * traj[i].x + traj[i - 1].x
                const ay = traj[i + 1].y - 2 * traj[i].y + traj[i - 1].y
                accels.push(Math.sqrt(ax * ax + ay * ay))
            }
            const mean = accels.reduce((a, b) => a + b, 0) / accels.length
            const variance = accels.reduce((s, a) => s + (a - mean) ** 2, 0) / accels.length
            smoothness = Math.max(0, Math.min(1, 1 - variance / 10))
        }

        return { arcHeight, releaseAngle, smoothness }
    }, [])

    // Shot quality calculation
    const calculateShotQuality = useCallback((
        metrics: { arcHeight: number; releaseAngle: number; smoothness: number },
        releaseAngle: number | undefined
    ): number => {
        const releaseAngleScore = releaseAngle
            ? releaseAngle >= 45 && releaseAngle <= 55 ? 100
            : releaseAngle >= 35 && releaseAngle <= 65 ? 70 : 30
            : 50
        const arcScore = Math.min(100, (metrics.arcHeight / 0.3) * 100)
        const smoothnessScore = metrics.smoothness * 100
        return releaseAngleScore * 0.4 + arcScore * 0.3 + smoothnessScore * 0.3
    }, [])

    // Return fresh copy from TrackingEngine
    const getState = useCallback((): TrackingState => {
        return trackingEngine.current.getState()
    }, [])

    // Expose the pure TrackingEngine instance for Runtime integration
    const getTrackingEngine = useCallback((): TrackingEngine => {
        return trackingEngine.current
    }, [])

    return {
        processFrame,
        resetShot,
        resetAll,
        setHoopFromCalibration,
        updatePlayerFromPipeline,
        updateSharedValuesFromState, // Phase 4: Update SharedValues from Runtime.processFrame()
        computeTrajectoryMetrics,
        calculateShotQuality,
        getState,
        getTrackingEngine, // Phase 4.5: Expose for Runtime integration
        // Shared Values for Skia overlay
        sharedValues: {
            ballX,
            ballY,
            ballWidth,
            ballHeight,
            ballXRaw,
            ballYRaw,
            hoopX,
            hoopY,
            hoopWidth,
            hoopHeight,
            confidence,
            ballSizeCategory,
            playerX,
            playerY,
            playerWidth,
            playerHeight,
            playerConfidence,
            ballRejectionReason,
            rimRejectionReason,
            adaptiveThreshold,
            inFlight,
            shotDetected,
            showShotTrail,
            shotResult,
            // Trajectory SharedValues
            trajectoryPoints,
            trajectoryPointCount,
            // Visual tracking state for debugging
            ballTrackState,
            playerTrackState,
            rimTrackState,
            ballTrackAge,
            playerTrackAge,
            rimTrackAge,
            // Rejected detection positions
            rejectedBallX,
            rejectedBallY,
            rejectedBallConfidence,
        },
    }
}
