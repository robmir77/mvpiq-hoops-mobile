// Shot detection: MADE requires descending ball + hoop proximity, MISS requires trajectory past peak
// Dribble filter: risingFrames + MIN_ARC_HEIGHT to exclude ground bounces

import { useRef, useCallback } from 'react'
import { useSharedValue } from 'react-native-reanimated'
import { TrackingState, VisionTrackState } from '../types/workouts.types'

interface KalmanState {
    x: number; y: number
    vx: number; vy: number
    px: number; py: number
    mx: number; my: number
}

const INITIAL_KALMAN: KalmanState = {
    x: 0, y: 0, vx: 0, vy: 0,
    px: 1.5, py: 1.5,  // Increased to trust predictive model less
    mx: 0.3, my: 0.3,  // Reduced to trust current measurements more
}

// Shot detection thresholds
const SHOT_LAUNCH_THRESHOLD  = 1.5  // Min vertical velocity (normalized/s)
const HOOP_RADIUS_MADE       = 0.10  // Dynamic radius for MADE detection
const DESCENDING_VY_THRESHOLD = 0.3  // Descending threshold (vy > 0 = falling)
const MIN_TRAJECTORY_FRAMES  = 4  // Min frames before shot detection
const SHOT_COOLDOWN_MS       = 600  // Cooldown between shots
const BALL_TRACK_TTL_MS      = 500  // Time-based TTL for ball tracking validity

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
    const kalman     = useRef<KalmanState>({ ...INITIAL_KALMAN })
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

    // Ball tracking state for TTL
    const ballLastSeenAt = useRef<number>(0)
    const ballTrackingValid = useRef<boolean>(false)
    const lastBallWasDetected = useRef<boolean>(false)

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

    const kalmanUpdate = useCallback((measX: number, measY: number, frameTs: number): { x: number; y: number } => {
        const k  = kalman.current
        const dt = Math.max(0.01, Math.min(0.1, (frameTs - lastFrameTs.current) / 1000))

        const predX = k.x + k.vx * dt
        const predY = k.y + k.vy * dt

        const gx = k.px / (k.px + k.mx)
        const gy = k.py / (k.py + k.my)

        k.x  = predX + gx * (measX - predX)
        k.y  = predY + gy * (measY - predY)
        k.vx = (k.x - predX) / dt
        k.vy = (k.y - predY) / dt
        k.px = (1 - gx) * k.px
        k.py = (1 - gy) * k.py

        return { x: k.x, y: k.y }
    }, [])

    const kalmanPredict = useCallback((frameTs: number): { x: number; y: number } | null => {
        const k  = kalman.current
        const dt = Math.max(0.01, Math.min(0.1, (frameTs - lastFrameTs.current) / 1000))
        
        // Check TTL - if expired, return null
        const ageMs = frameTs - ballLastSeenAt.current
        if (ageMs > BALL_TRACK_TTL_MS) {
            ballTrackingValid.current = false
            if (lastBallWasDetected.current) {
                callbacks?.onBallTrackingExpired?.()
                lastBallWasDetected.current = false
            }
            return null
        }
        
        // Predict position from last velocity
        const predX = k.x + k.vx * dt
        const predY = k.y + k.vy * dt
        
        return { x: predX, y: predY }
    }, [callbacks])

    const predictFrame = useCallback((frameTs: number): boolean => {
        const current = state.current
        
        // Only predict if we have a valid ball position and tracking is valid
        if (!current.ballPosition || !ballTrackingValid.current) {
            return false
        }
        
        const prediction = kalmanPredict(frameTs)
        if (!prediction) {
            // TTL expired - invalidate tracking
            current.ballPosition = null
            current.ballVelocity = null
            current.ballPositionRaw = null
            current.confidence = 0
            
            // Reset Shared Values
            ballX.value = 0
            ballY.value = 0
            ballXRaw.value = 0
            ballYRaw.value = 0
            confidence.value = 0
            return false
        }
        
        // Update state with prediction
        current.ballPosition = prediction
        current.ballVelocity = { vx: kalman.current.vx, vy: kalman.current.vy }
        
        // Call telemetry callback for prediction
        const ageMs = frameTs - ballLastSeenAt.current
        callbacks?.onBallPrediction?.(ageMs)
        
        // Update Shared Values with prediction
        ballX.value = prediction.x
        ballY.value = prediction.y
        
        // Add predicted point to trajectory
        trajectoryBuffer.current[trajectoryHead.current] = { x: prediction.x, y: prediction.y, t: frameTs }
        trajectoryHead.current = (trajectoryHead.current + 1) % MAX_POINTS
        if (trajectoryCount.current < MAX_POINTS) trajectoryCount.current++
        
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
        
        // Copy trajectory for UI every 5 frames when inFlight
        if (inFlightRef.current && trajectoryCount.current % 5 === 0) {
            current.trajectory = getTrajectory()
        }
        
        // Update peak with prediction
        if (prediction.y < peakY.current) {
            peakY.current = prediction.y
            apexPoint.current = { x: prediction.x, y: prediction.y }
        }
        
        lastFrameTs.current = frameTs
        return true
    }, [kalmanPredict, getTrajectory, ballX, ballY, ballXRaw, ballYRaw, confidence, trajectoryPoints, trajectoryPointCount, MAX_POINTS])

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

        // Calculate player center from pose keypoints
        let playerCenter: { x: number; y: number } | null = null
        if (poseKeypoints) {
            const leftHip = poseKeypoints.leftHip
            const rightHip = poseKeypoints.rightHip
            if (leftHip && rightHip) {
                playerCenter = {
                    x: (leftHip.x + rightHip.x) / 2,
                    y: (leftHip.y + rightHip.y) / 2
                }
            }
        }

        // Spatial constraint: ball should be near player when not shooting
        const MAX_PLAYER_BALL_DISTANCE = 0.35
        if (ballDetection && playerCenter && !current.inFlight) {
            const dx = ballDetection.x - playerCenter.x
            const dy = ballDetection.y - playerCenter.y
            const distance = Math.sqrt(dx * dx + dy * dy)
            if (distance > MAX_PLAYER_BALL_DISTANCE) {
                ballDetection = null  // Too far from player when not shooting
            }
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
            const smoothed = kalmanUpdate(ballDetection.x, ballDetection.y, frameTs)
            current.ballPosition = smoothed
            current.ballPositionRaw = { x: ballDetection.x, y: ballDetection.y }
            current.ballVelocity = { vx: kalman.current.vx, vy: kalman.current.vy }
            current.confidence   = ballDetection.confidence
            current.ballWidth    = ballDetection.width
            current.ballHeight   = ballDetection.height

            // Update ball tracking TTL state
            ballLastSeenAt.current = frameTs
            ballTrackingValid.current = true
            lastBallWasDetected.current = true

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

            if (__DEV__) {
              console.log('[TrackingEngine] Shared Values updated:', {
                ballX: ballDetection.x.toFixed(3),
                ballY: ballDetection.y.toFixed(3),
                ballWidth: (ballDetection.width || 0).toFixed(3),
                ballHeight: (ballDetection.height || 0).toFixed(3),
                confidence: ballDetection.confidence.toFixed(3)
              })
            }

            // Ring buffer insert (O(1))
            trajectoryBuffer.current[trajectoryHead.current] = { x: smoothed.x, y: smoothed.y, t: frameTs }
            trajectoryHead.current = (trajectoryHead.current + 1) % MAX_POINTS
            if (trajectoryCount.current < MAX_POINTS) trajectoryCount.current++

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
            if (smoothed.y < peakY.current) {
                peakY.current = smoothed.y
                apexPoint.current = { x: smoothed.x, y: smoothed.y }
            }
        } else if (current.ballPosition && lastFrameTs.current > 0) {
            // Prediction step when ball not detected
            const k = kalman.current
            const dt = Math.max(0.01, Math.min(0.1, (frameTs - lastFrameTs.current) / 1000))
            
            // Check TTL - if expired, invalidate tracking
            const ageMs = frameTs - ballLastSeenAt.current
            if (ageMs > BALL_TRACK_TTL_MS) {
                ballTrackingValid.current = false
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
                // Predict position from last velocity
                const predX = k.x + k.vx * dt
                const predY = k.y + k.vy * dt

                current.ballPosition = { x: predX, y: predY }
                current.ballVelocity = { vx: k.vx, vy: k.vy }

                // Update visual tracking state to PREDICTED
                ballTrackState.value = 'PREDICTED'
                ballTrackAge.value = ageMs

                // Call telemetry callback for prediction
                callbacks?.onBallPrediction?.(ageMs)

                // Update Shared Values with prediction
                ballX.value = predX
                ballY.value = predY
                
                // Add predicted point to trajectory
                trajectoryBuffer.current[trajectoryHead.current] = { x: predX, y: predY, t: frameTs }
                trajectoryHead.current = (trajectoryHead.current + 1) % MAX_POINTS
                if (trajectoryCount.current < MAX_POINTS) trajectoryCount.current++
                
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
                if (predY < peakY.current) {
                    peakY.current = predY
                    apexPoint.current = { x: predX, y: predY }
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

        // Shot detection (MADE / MISS / AIRBALL)
        const hoop       = current.hoopPosition
        const cooldownOk = (frameTs - lastShotTs.current) > SHOT_COOLDOWN_MS

        if (vel && hoop && ball && cooldownOk && !current.shotDetected) {
            const descending = vel.vy > DESCENDING_VY_THRESHOLD
            const dynamicHoopRadius = getDynamicHoopRadius(hoop)

            if (inFlightRef.current && descending) {
                const dx   = ball.x - hoop.x
                const dy   = ball.y - hoop.y
                const dist = Math.sqrt(dx * dx + dy * dy)

                const descendingTowardHoop = dy > 0 && dist < dynamicHoopRadius * 2

                if (descendingTowardHoop && dist < dynamicHoopRadius) {
                    current.shotDetected = true
                    current.shotResult   = 'MADE'
                    shotDetected.value = true
                    shotResult.value = 'MADE'
                    lastShotTs.current   = frameTs
                    // Calculate shot quality
                    const metrics = trajectoryMetrics || computeTrajectoryMetrics()
                    current.shotQuality = calculateShotQuality(metrics, current.releaseAngle)
                } else if (descendingTowardHoop && dist >= dynamicHoopRadius) {
                    current.shotDetected = true
                    current.shotResult   = 'MISS'
                    shotDetected.value = true
                    shotResult.value = 'MISS'
                    lastShotTs.current   = frameTs
                    // Calculate shot quality
                    const metrics = trajectoryMetrics || computeTrajectoryMetrics()
                    current.shotQuality = calculateShotQuality(metrics, current.releaseAngle)
                } else if (descending && vel.vy > SHOT_LAUNCH_THRESHOLD * 2) {
                    current.shotDetected = true
                    current.shotResult   = dist < 0.25 ? 'MISS' : 'AIRBALL'
                    shotDetected.value = true
                    shotResult.value = dist < 0.25 ? 'MISS' : 'AIRBALL'
                    lastShotTs.current   = frameTs
                    // Calculate shot quality
                    const metrics = trajectoryMetrics || computeTrajectoryMetrics()
                    current.shotQuality = calculateShotQuality(metrics, current.releaseAngle)
                }
            }
        }

        lastFrameTs.current = frameTs
        return { ...current }
    }, [kalmanUpdate])

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
        // Reset ball tracking TTL state
        ballLastSeenAt.current = 0
        ballTrackingValid.current = false
        lastBallWasDetected.current = false
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
        kalman.current      = { ...INITIAL_KALMAN }
        resetTrajectoryBuffer()
        peakY.current       = Infinity
        apexPoint.current  = null
        inFlightRef.current    = false
        risingFrames.current = 0
        flightStartY.current = 1.0
        lastShotTs.current  = 0
        // Reset ball tracking TTL state
        ballLastSeenAt.current = 0
        ballTrackingValid.current = false
        lastBallWasDetected.current = false
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
        predictFrame,
        kalmanPredict,
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
