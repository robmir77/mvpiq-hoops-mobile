// Shot detection: MADE requires descending ball + hoop proximity, MISS requires trajectory past peak
// Dribble filter: risingFrames + MIN_ARC_HEIGHT to exclude ground bounces
// Phase 4.2: BallTrackingEngine is now authoritative - legacy Kalman removed

import { useRef, useCallback } from 'react'
import { useSharedValue } from 'react-native-reanimated'
import { TrackingState, VisionTrackState } from '../types/workouts.types'
import { BallTrackingEngine } from '../tracking/BallTrackingEngine'
import { PlayerTrackingEngine } from '../tracking/PlayerTrackingEngine'
import { ShotDetectionEngine } from '../tracking/ShotDetectionEngine'
import { TrackingCoordinator } from '../tracking/TrackingCoordinator'

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
}

export const useTrackingEngine = (callbacks?: BallTrackingCallbacks) => {
    // Phase 4.2: Instantiate BallTrackingEngine for progressive integration
    const ballTrackingEngine = useRef<BallTrackingEngine>(
        new BallTrackingEngine(callbacks)
    )

    // Phase 4.2: Instantiate PlayerTrackingEngine for progressive integration
    const playerTrackingEngine = useRef<PlayerTrackingEngine>(
        new PlayerTrackingEngine()
    )

    // Phase 4.2: Instantiate ShotDetectionEngine for progressive integration
    const shotDetectionEngine = useRef<ShotDetectionEngine>(
        new ShotDetectionEngine()
    )

    // Phase 4.2: Instantiate TrackingCoordinator for spatial constraints
    const trackingCoordinator = useRef<TrackingCoordinator>(
        new TrackingCoordinator()
    )

    // Ring buffer for trajectory (O(1) insert, no reallocation)
    const MAX_POINTS = 90
    const trajectoryBuffer = useRef<Array<{ x: number; y: number; t: number } | null>>(new Array(MAX_POINTS).fill(null))
    const trajectoryHead = useRef<number>(0)
    const trajectoryCount = useRef<number>(0)

    const state      = useRef<TrackingState>({
        ballPosition: null,
        ballPositionRaw: null,
        ballVelocity: null,
        hoopPosition: null,
        shotDetected: false,
        shotResult: null,
        trajectory: [],
        confidence: 0,
        inFlight: false,
        releasePoint: undefined,
        apexPoint: undefined,
        releaseAngle: undefined,
        shotQuality: undefined,
    })

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

    const lastFrameTs  = useRef<number>(0)
    const lastShotTs   = useRef<number>(0)
    const peakY        = useRef<number>(Infinity)   // min y = highest point
    const apexPoint    = useRef<{ x: number; y: number } | null>(null)
    const inFlightRef  = useRef<boolean>(false)

    // Dribble filter state
    const risingFrames  = useRef<number>(0)  // Consecutive rising frames
    const flightStartY  = useRef<number>(1.0)  // Y at first rising frame

    // Get trajectory as ordered array from ring buffer
    const getTrajectory = useCallback((): Array<{ x: number; y: number; t: number }> => {
        const result: Array<{ x: number; y: number; t: number }> = []
        const count = trajectoryCount.current
        const head = trajectoryHead.current
        const buffer = trajectoryBuffer.current

        for (let i = 0; i < count; i++) {
            const idx = (head - count + i + MAX_POINTS) % MAX_POINTS
            const point = buffer[idx]
            if (point) result.push(point)
        }
        return result
    }, [MAX_POINTS])

    const processFrame = useCallback((
        ballDetection: { x: number; y: number; width?: number; height?: number; confidence: number } | null,
        hoopDetection: { x: number; y: number; width?: number; height?: number; confidence: number } | null,
        frameTs: number,
        poseKeypoints?: any,
        sizeCategory?: 'small' | 'medium' | 'large' | null,
        adaptThreshold?: number,
        rejectedBall?: { x: number; y: number; width?: number; height?: number; confidence: number } | null
    ): TrackingState => {
        const current = state.current

        // Phase 4.3.1: PlayerTrackingEngine is now authoritative for player center calculation
        let playerCenter: { x: number; y: number } | null = null
        if (poseKeypoints) {
            playerCenter = playerTrackingEngine.current.updateFromPose(poseKeypoints)
        }

        // Phase 4.2: Use TrackingCoordinator for spatial constraints
        if (!trackingCoordinator.current.shouldAcceptBallDetection(ballDetection, playerCenter, current.inFlight)) {
            ballDetection = null
            ballRejectionReason.value = trackingCoordinator.current.getRejectionReason(ballDetection, playerCenter, current.inFlight)
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

        if (ballDetection) {
            // Phase 4.2: BallTrackingEngine is now authoritative
            const engineResult = ballTrackingEngine.current.update(ballDetection.x, ballDetection.y, frameTs)
            const engineState = ballTrackingEngine.current.getState()

            // Set raw detection data
            ballTrackingEngine.current.setRawDetection(
                ballDetection.x,
                ballDetection.y,
                ballDetection.width || 0,
                ballDetection.height || 0,
                ballDetection.confidence
            )

            // Use engine output as authoritative
            current.ballPosition = { x: engineResult.x, y: engineResult.y }
            current.ballPositionRaw = { x: ballDetection.x, y: ballDetection.y }
            current.ballVelocity = engineState.ballVelocity
            current.confidence = ballDetection.confidence
            current.ballWidth = ballDetection.width
            current.ballHeight = ballDetection.height

            // Update visual tracking state
            ballTrackState.value = 'DETECTED'
            ballTrackAge.value = 0

            // Call telemetry callback for detection
            callbacks?.onBallDetected?.()

            // Update Shared Values for Skia
            ballX.value = ballDetection.x
            ballY.value = ballDetection.y
            ballXRaw.value = ballDetection.x
            ballYRaw.value = ballDetection.y
            ballWidth.value = ballDetection.width || 0
            ballHeight.value = ballDetection.height || 0
            confidence.value = ballDetection.confidence || 0
            ballSizeCategory.value = sizeCategory ?? null
            adaptiveThreshold.value = adaptThreshold ?? 0

            // PERFORMANCE TEST: disabled logging to reduce bridge overhead
            // if (__DEV__) {
            //   console.log('[TrackingEngine] Shared Values updated:', {
            //     ballX: ballDetection.x.toFixed(3),
            //     ballY: ballDetection.y.toFixed(3),
            //     ballWidth: (ballDetection.width || 0).toFixed(3),
            //     ballHeight: (ballDetection.height || 0).toFixed(3),
            //     confidence: ballDetection.confidence.toFixed(3)
            //   })
            // }

            // Ring buffer insert (O(1))
            trajectoryBuffer.current[trajectoryHead.current] = { x: engineResult.x, y: engineResult.y, t: frameTs }
            trajectoryHead.current = (trajectoryHead.current + 1) % MAX_POINTS
            if (trajectoryCount.current < MAX_POINTS) trajectoryCount.current++

            // Phase 4.2: Update trajectory in ShotDetectionEngine for comparison
            shotDetectionEngine.current.addTrajectoryPoint(engineResult.x, engineResult.y, frameTs)

            // Update trajectory SharedValues when inFlight
            if (inFlightRef.current) {
                const traj = getTrajectory()
                const points = trajectoryPoints.value
                for (let i = 0; i < Math.min(traj.length, MAX_POINTS); i++) {
                    points[i * 2] = traj[i].x
                    points[i * 2 + 1] = traj[i].y
                }
                trajectoryPoints.value = points
                trajectoryPointCount.value = traj.length
            }

            // Copy trajectory for UI every 5 frames when inFlight (reduces copies ~95%)
            if (inFlightRef.current && trajectoryCount.current % 5 === 0) {
                current.trajectory = getTrajectory()
            }

            // Update peak (min y = highest point)
            if (engineResult.y < peakY.current) {
                peakY.current = engineResult.y
                apexPoint.current = { x: engineResult.x, y: engineResult.y }
            }
        } else if (current.ballPosition && lastFrameTs.current > 0) {
            // Phase 4.2: BallTrackingEngine predict is now authoritative
            const enginePrediction = ballTrackingEngine.current.predict(frameTs)
            const engineState = ballTrackingEngine.current.getState()

            if (enginePrediction === null) {
                // TTL expired - invalidate tracking
                current.ballPosition = null
                current.ballVelocity = null
                current.ballPositionRaw = null
                current.confidence = 0

                // Update visual tracking state to LOST
                ballTrackState.value = 'LOST'
                ballTrackAge.value = 0

                // Reset Shared Values
                ballX.value = 0
                ballY.value = 0
                ballXRaw.value = 0
                ballYRaw.value = 0
                confidence.value = 0
            } else {
                // Use engine prediction as authoritative
                current.ballPosition = { x: enginePrediction.x, y: enginePrediction.y }
                current.ballVelocity = engineState.ballVelocity

                // Update visual tracking state to PREDICTED
                ballTrackState.value = 'PREDICTED'
                ballTrackAge.value = engineState.trackAge

                // Call telemetry callback for prediction
                callbacks?.onBallPrediction?.(engineState.trackAge)

                // Update Shared Values with prediction
                ballX.value = enginePrediction.x
                ballY.value = enginePrediction.y

                // Add predicted point to trajectory
                trajectoryBuffer.current[trajectoryHead.current] = { x: enginePrediction.x, y: enginePrediction.y, t: frameTs }
                trajectoryHead.current = (trajectoryHead.current + 1) % MAX_POINTS
                if (trajectoryCount.current < MAX_POINTS) trajectoryCount.current++

                // Phase 4.2: Update trajectory in ShotDetectionEngine for comparison
                shotDetectionEngine.current.addTrajectoryPoint(enginePrediction.x, enginePrediction.y, frameTs)
                
                // Update trajectory SharedValues
                if (inFlightRef.current) {
                    const traj = getTrajectory()
                    const points = trajectoryPoints.value
                    for (let i = 0; i < Math.min(traj.length, MAX_POINTS); i++) {
                        points[i * 2] = traj[i].x
                        points[i * 2 + 1] = traj[i].y
                    }
                    trajectoryPoints.value = points
                    trajectoryPointCount.value = traj.length
                }
                
                // Copy trajectory for UI every 5 frames when inFlight
                if (inFlightRef.current && trajectoryCount.current % 5 === 0) {
                    current.trajectory = getTrajectory()
                }
                
                // Update peak with prediction
                if (enginePrediction.y < peakY.current) {
                    peakY.current = enginePrediction.y
                    apexPoint.current = { x: enginePrediction.x, y: enginePrediction.y }
                }
            }
        }

        if (hoopDetection && hoopDetection.confidence > 0.15) {
            current.hoopPosition = {
                x: hoopDetection.x,
                y: hoopDetection.y,
                width: hoopDetection.width,
                height: hoopDetection.height,
                confidence: hoopDetection.confidence,
            }

            // Update Shared Values for Skia
            hoopX.value = hoopDetection.x
            hoopY.value = hoopDetection.y
            hoopWidth.value = hoopDetection.width || 0
            hoopHeight.value = hoopDetection.height || 0
        }

        // Dribble filter: count rising frames
        const vel  = current.ballVelocity
        const ball = current.ballPosition

        if (vel && ball) {
            const isRising = vel.vy < -SHOT_LAUNCH_THRESHOLD

            if (isRising) {
                risingFrames.current++
                // Record Y at first rising frame
                if (risingFrames.current === 1) {
                    flightStartY.current = ball.y
                }
            } else {
                // Not rising anymore → reset counter
                risingFrames.current = 0
            }

            // Set inFlight if: rising for MIN_RISING_FRAMES + arc high enough + enough trajectory frames
            if (!inFlightRef.current && risingFrames.current >= MIN_RISING_FRAMES) {
                const arcSoFar = flightStartY.current - ball.y  // positivo = salita
                if (arcSoFar >= MIN_ARC_HEIGHT && trajectoryCount.current >= MIN_TRAJECTORY_FRAMES) {
                    inFlightRef.current = true
                    inFlight.value = true
                    showShotTrail.value = true
                    // Save release point
                    current.releasePoint = { x: ball.x, y: ball.y }
                    releasePointX.value = ball.x
                    releasePointY.value = ball.y
                }
            }
        }

        current.inFlight = inFlightRef.current

        // Calculate trajectory metrics every 5 frames when inFlight
        let trajectoryMetrics = null
        if (inFlightRef.current && trajectoryCount.current >= MIN_TRAJECTORY_FRAMES && trajectoryCount.current % 5 === 0) {
            trajectoryMetrics = computeTrajectoryMetrics()
            current.releaseAngle = trajectoryMetrics.releaseAngle
        }

        // Use cached apex point
        if (inFlightRef.current && apexPoint.current) {
            current.apexPoint = apexPoint.current
        }

        // Phase 4.3.2: ShotDetectionEngine is now authoritative for shot detection
        const engineShotResult = shotDetectionEngine.current.processFrame(
            current.ballPosition,
            current.ballVelocity,
            current.hoopPosition ? {
                x: current.hoopPosition.x,
                y: current.hoopPosition.y,
                width: current.hoopPosition.width,
                height: current.hoopPosition.height,
                confidence: current.hoopPosition.confidence ?? 0,
            } : null,
            frameTs
        )

        // Apply engine shot detection results
        if (engineShotResult.shotDetected && !current.shotDetected) {
            current.shotDetected = engineShotResult.shotDetected
            current.shotResult = engineShotResult.shotResult
            shotDetected.value = engineShotResult.shotDetected
            shotResult.value = engineShotResult.shotResult ?? null
            lastShotTs.current = frameTs
            // Calculate shot quality
            const metrics = trajectoryMetrics || computeTrajectoryMetrics()
            current.shotQuality = calculateShotQuality(metrics, current.releaseAngle)
        }

        // Update inFlight from engine
        inFlightRef.current = engineShotResult.inFlight
        current.inFlight = engineShotResult.inFlight

        lastFrameTs.current = frameTs
        return { ...current }
    }, [])

    // Reset ring buffer
    const resetTrajectoryBuffer = useCallback(() => {
        trajectoryHead.current = 0
        trajectoryCount.current = 0
        trajectoryBuffer.current.fill(null)
    }, [])

    const resetShot = useCallback(() => {
        state.current.shotDetected = false
        state.current.shotResult   = null
        state.current.inFlight     = false
        state.current.releasePoint = undefined
        state.current.apexPoint    = undefined
        state.current.releaseAngle = undefined
        state.current.shotQuality = undefined
        state.current.ballPositionRaw = null
        resetTrajectoryBuffer()
        peakY.current              = Infinity
        apexPoint.current          = null
        inFlightRef.current       = false
        risingFrames.current       = 0
        flightStartY.current       = 1.0
        // Phase 4.2: Reset tracking engines
        ballTrackingEngine.current.reset()
        playerTrackingEngine.current.reset()
        shotDetectionEngine.current.resetShot()
        // Reset visual tracking state
        ballTrackState.value = 'LOST'
        ballTrackAge.value = 0
        // Reset Shared Values
        inFlight.value = false
        showShotTrail.value = false
        shotDetected.value = false
        shotResult.value = null
        // Phase 4: Reset trajectory SharedValues
        trajectoryPoints.value = new Float32Array(MAX_POINTS * 2).fill(0)
        trajectoryPointCount.value = 0
    }, [resetTrajectoryBuffer, inFlight, showShotTrail, shotDetected, shotResult, trajectoryPoints, trajectoryPointCount, MAX_POINTS])

    const resetAll = useCallback(() => {
        resetTrajectoryBuffer()
        peakY.current       = Infinity
        apexPoint.current  = null
        inFlightRef.current    = false
        risingFrames.current = 0
        flightStartY.current = 1.0
        lastShotTs.current  = 0
        // Phase 4.2: Reset tracking engines
        ballTrackingEngine.current.reset()
        playerTrackingEngine.current.reset()
        shotDetectionEngine.current.resetAll()
        // Reset visual tracking state
        ballTrackState.value = 'LOST'
        ballTrackAge.value = 0
        state.current       = {
            ballPosition: null, ballPositionRaw: null, ballVelocity: null, hoopPosition: null,
            shotDetected: false, shotResult: null, trajectory: [], confidence: 0,
            inFlight: false,
            releasePoint: undefined,
            apexPoint: undefined,
            releaseAngle: undefined,
            shotQuality: undefined,
        }

        // Reset Shared Values (keep hoop values for last positive detection)
        ballX.value = 0
        ballY.value = 0
        ballWidth.value = 0
        ballHeight.value = 0
        ballXRaw.value = 0
        ballYRaw.value = 0
        confidence.value = 0
        ballSizeCategory.value = null
        adaptiveThreshold.value = 0
        // Don't reset hoop values (keep last positive detection)
        inFlight.value = false
        showShotTrail.value = false
        shotDetected.value = false
        shotResult.value = null
        // Phase 4: Reset trajectory SharedValues
        trajectoryPoints.value = new Float32Array(MAX_POINTS * 2).fill(0)
        trajectoryPointCount.value = 0
    }, [resetTrajectoryBuffer, ballX, ballY, ballWidth, ballHeight, ballXRaw, ballYRaw, hoopX, hoopY, hoopWidth, hoopHeight, confidence, ballSizeCategory, adaptiveThreshold, inFlight, showShotTrail, shotDetected, shotResult, trajectoryPoints, trajectoryPointCount, MAX_POINTS])

    const setHoopFromCalibration = useCallback((x: number, y: number, width?: number, height?: number) => {
        state.current.hoopPosition = { x, y, width, height }
        // Update Shared Values
        hoopX.value = x
        hoopY.value = y
        if (width !== undefined) hoopWidth.value = width
        if (height !== undefined) hoopHeight.value = height
    }, [])

    const setPlayerFromYolo = useCallback((x: number, y: number, width: number, height: number) => {
        playerX.value = x
        playerY.value = y
        playerWidth.value = width
        playerHeight.value = height
    }, [playerX, playerY, playerWidth, playerHeight])

    const updatePlayerFromPipeline = useCallback((pipelineSharedValues: any) => {
        if (pipelineSharedValues?.playerX !== undefined) {
            const px = pipelineSharedValues.playerX.value
            const py = pipelineSharedValues.playerY.value
            const pw = pipelineSharedValues.playerWidth.value
            const ph = pipelineSharedValues.playerHeight.value
            const pconf = pipelineSharedValues.playerConfidence?.value ?? 0

            if (px > 0 && py > 0) {
                console.log('[TrackingEngine] Player data from pipeline:', { px, py, pw, ph, pconf })
            }

            playerX.value = px
            playerY.value = py
            playerWidth.value = pw
            playerHeight.value = ph
            playerConfidence.value = pconf
        }
        // Copy visual tracking states from pipeline
        if (pipelineSharedValues?.playerTrackState !== undefined) {
            const pState = pipelineSharedValues.playerTrackState.value
            const pAge = pipelineSharedValues.playerTrackAge?.value ?? 0
            console.log('[TrackingEngine] Player track state from pipeline:', { pState, pAge })
            playerTrackState.value = pState
            playerTrackAge.value = pAge
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
        const traj = getTrajectory()
        if (traj.length < MIN_TRAJECTORY_FRAMES) return { arcHeight: 0, releaseAngle: 0, smoothness: 0 }

        // Use loop instead of map() for better performance
        let minY = Infinity
        for (const p of traj) {
            if (p.y < minY) minY = p.y
        }
        const startY     = traj[0].y
        const arcHeight  = Math.max(0, startY - minY)

        const n    = Math.max(2, Math.floor(traj.length * 0.3))
        const dx   = traj[n].x - traj[0].x
        const dy   = traj[n].y - traj[0].y
        const releaseAngle = Math.abs(Math.atan2(-dy, Math.abs(dx)) * (180 / Math.PI))

        let smoothness = 1.0
        if (traj.length >= 3) {
            const accels: number[] = []
            for (let i = 1; i < traj.length - 1; i++) {
                const ax = traj[i + 1].x - 2 * traj[i].x + traj[i - 1].x
                const ay = traj[i + 1].y - 2 * traj[i].y + traj[i - 1].y
                accels.push(Math.sqrt(ax * ax + ay * ay))
            }
            const mean     = accels.reduce((a, b) => a + b, 0) / accels.length
            const variance = accels.reduce((s, a) => s + (a - mean) ** 2, 0) / accels.length
            smoothness     = Math.max(0, Math.min(1, 1 - variance / 10))
        }

        return { arcHeight, releaseAngle, smoothness }
    }, [])

    // Shot quality calculation
    const calculateShotQuality = useCallback((
        metrics: { arcHeight: number; releaseAngle: number; smoothness: number },
        releaseAngle: number | undefined
    ): number => {
        const releaseAngleScore = releaseAngle
            ? (releaseAngle >= 45 && releaseAngle <= 55) ? 100
            : (releaseAngle >= 35 && releaseAngle <= 65) ? 70 : 30
            : 50
        const arcScore = Math.min(100, (metrics.arcHeight / 0.3) * 100)
        const smoothnessScore = metrics.smoothness * 100
        return releaseAngleScore * 0.4 + arcScore * 0.3 + smoothnessScore * 0.3
    }, [])

    // Return fresh copy with updated inFlight
    const getState = useCallback((): TrackingState => ({
        ...state.current,
        inFlight: inFlightRef.current,
    }), [])

    return {
        processFrame,
        resetShot,
        resetAll,
        setHoopFromCalibration,
        setPlayerFromYolo,
        updatePlayerFromPipeline,
        computeTrajectoryMetrics,
        calculateShotQuality,
        getState,
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
