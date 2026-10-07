// src/features/workouts/components/ReactOverlay.tsx
//
// React overlay for badges, debug panels, and pose skeleton visualization
// Uses React state for UI elements that don't need Skia rendering

import React from 'react'
import { View, Text, StyleSheet, Dimensions } from 'react-native'
import { useAnimatedReaction, runOnJS } from 'react-native-reanimated'
import type { PoseKeypoints, TrackingState, CalibrationData, JointAngles } from '../types/workouts.types'
import { YOLO_CONFIG } from '@/config/appConfig'

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window')
const CAMERA_H = SCREEN_H * 0.52

// Worklet-compatible coordinate mapping function
// Maps normalized camera coordinates (0-1) to screen coordinates
const mapNormalizedToCameraView = (normX: number, normY: number, cameraResW: number, cameraResH: number) => {
    'worklet';
    
    // X: mapping on actual view width
    const screenX = normX * SCREEN_W;
    
    // Y: mapping on actual view height
    const screenY = normY * CAMERA_H;
    
    const result = {
        x: SCREEN_W - screenX,
        y: CAMERA_H - screenY,
    };

    return result;
};

const KP_COLORS: Record<keyof PoseKeypoints, { main: string; glow: string; label: string }> = {
    leftShoulder:  { main: '#ef4444', glow: 'rgba(239,68,68,0.25)', label: 'Spalla SX' },
    rightShoulder: { main: '#3b82f6', glow: 'rgba(59,130,246,0.25)', label: 'Spalla DX' },
    leftElbow:     { main: '#ef4444', glow: 'rgba(239,68,68,0.25)', label: 'Gomito SX' },
    rightElbow:    { main: '#3b82f6', glow: 'rgba(59,130,246,0.25)', label: 'Gomito DX' },
    leftWrist:     { main: '#ef4444', glow: 'rgba(239,68,68,0.25)', label: 'Polso SX' },
    rightWrist:    { main: '#3b82f6', glow: 'rgba(59,130,246,0.25)', label: 'Polso DX' },
    leftHip:       { main: '#22c55e', glow: 'rgba(34,197,94,0.25)', label: 'Anca SX' },
    rightHip:      { main: '#22c55e', glow: 'rgba(34,197,94,0.25)', label: 'Anca DX' },
    leftKnee:      { main: '#22c55e', glow: 'rgba(34,197,94,0.25)', label: 'Ginocchio SX' },
    rightKnee:     { main: '#22c55e', glow: 'rgba(34,197,94,0.25)', label: 'Ginocchio DX' },
    leftAnkle:     { main: '#22c55e', glow: 'rgba(34,197,94,0.25)', label: 'Caviglia SX' },
    rightAnkle:    { main: '#22c55e', glow: 'rgba(34,197,94,0.25)', label: 'Caviglia DX' },
}

const CONNECTION_COLORS: Record<string, string> = {
    'leftShoulder-rightShoulder': '#a855f7',
    'leftShoulder-leftElbow': '#ef4444',
    'leftElbow-leftWrist': '#ef4444',
    'rightShoulder-rightElbow': '#3b82f6',
    'rightElbow-rightWrist': '#3b82f6',
    'leftShoulder-leftHip': '#a855f7',
    'rightShoulder-rightHip': '#a855f7',
    'leftHip-rightHip': '#a855f7',
    'leftHip-leftKnee': '#22c55e',
    'leftKnee-leftAnkle': '#22c55e',
    'rightHip-rightKnee': '#22c55e',
    'rightKnee-rightAnkle': '#22c55e',
}

// Game-style effects
const calculatePlayerSize = (poseKeypoints: PoseKeypoints | null): number => {
    if (!poseKeypoints) return 0
    const leftShoulder = poseKeypoints.leftShoulder
    const rightShoulder = poseKeypoints.rightShoulder
    const leftHip = poseKeypoints.leftHip
    const rightHip = poseKeypoints.rightHip
    
    if (leftShoulder && rightShoulder && leftHip && rightHip) {
        const shoulderWidth = Math.sqrt(
            Math.pow(leftShoulder.x - rightShoulder.x, 2) +
            Math.pow(leftShoulder.y - rightShoulder.y, 2)
        )
        const hipWidth = Math.sqrt(
            Math.pow(leftHip.x - rightHip.x, 2) +
            Math.pow(leftHip.y - rightHip.y, 2)
        )
        // Average of shoulder and hip width, scaled for visual effect
        return ((shoulderWidth + hipWidth) / 2) * SCREEN_W * 0.8
    }
    return 0
}

const calculateShotPower = (velocity: { vx: number; vy: number } | null): number => {
    if (!velocity) return 0
    const speed = Math.sqrt(velocity.vx * velocity.vx + velocity.vy * velocity.vy)
    // Normalize to 0-100 range for display
    return Math.min(100, Math.round(speed * 20))
}

const getAngleColor = (angle: number): string => {
    if (angle >= 80 && angle <= 110) return '#22c55e' // Green: optimal
    if (angle >= 60 && angle <= 130) return '#f59e0b' // Yellow: acceptable
    return '#ef4444' // Red: poor
}

const getReleaseColor = (angle: number): string => {
    if (angle >= 45 && angle <= 55) return '#22c55e' // Green: optimal
    if (angle >= 35 && angle <= 65) return '#f59e0b' // Yellow: acceptable
    return '#ef4444' // Red: poor
}

interface ReactOverlayProps {
    trackingState: TrackingState | null
    poseKeypoints: PoseKeypoints | null
    jointAngles?: Partial<JointAngles>
    releaseAngle?: number
    arcHeight?: number
    calibration: CalibrationData | null
    sharedValues?: {
        confidence: any
        ballSizeCategory: any
        adaptiveThreshold: any
        inFlight: any
        shotResult: any
        ballX: any
        ballY: any
        ballXRaw: any
        ballYRaw: any
        ballWidth: any
        ballHeight: any
        hoopX: any
        hoopY: any
        hoopWidth: any
        hoopHeight: any
        showShotTrail: any
        playerX: any
        playerY: any
        playerWidth: any
        playerHeight: any
        playerConfidence: any
        ballRejectionReason: any
        rimRejectionReason: any
        ballTrackState: any
        ballTrackAge: any
        playerTrackState: any
        playerTrackAge: any
        rimTrackState: any
        rimTrackAge: any
    }
    fpsMetrics?: { yoloFps: number; moveNetFps: number }
    effectiveResolution: { width: number; height: number }
    showDebug?: boolean
    rimFromDetection?: { x: number; y: number; width: number; height: number; confidence: number } | null
    cameraMode?: string
}

// React Overlay (Badges, Debug, Pose Skeleton)
const ReactOverlay = React.memo(({
    trackingState, poseKeypoints, jointAngles, releaseAngle, arcHeight, calibration, sharedValues, fpsMetrics, effectiveResolution, showDebug, rimFromDetection, cameraMode,
}: ReactOverlayProps) => {
    const px = (x: number) => x * SCREEN_W
    const py = (y: number) => y * CAMERA_H

    const pxCam = (x: number, y: number = 0) => mapNormalizedToCameraView(x, y, effectiveResolution.width, effectiveResolution.height).x
    const pyCam = (x: number, y: number) => mapNormalizedToCameraView(x, y, effectiveResolution.width, effectiveResolution.height).y

    const playerSize = calculatePlayerSize(poseKeypoints)
    const shotPower = calculateShotPower(trackingState?.ballVelocity ?? null)

    const playerCenterX = poseKeypoints?.leftHip && poseKeypoints?.rightHip
        ? (poseKeypoints.leftHip.x + poseKeypoints.rightHip.x) / 2
        : null
    const playerCenterY = poseKeypoints?.leftHip && poseKeypoints?.rightHip
        ? (poseKeypoints.leftHip.y + poseKeypoints.rightHip.y) / 2
        : null

    const [ballLabelVisible, setBallLabelVisible] = React.useState(false)
    const [ballLabelPos, setBallLabelPos] = React.useState({ left: 0, top: 0 })
    const [ballLabelText, setBallLabelText] = React.useState('')
    const [hoopLabelVisible, setHoopLabelVisible] = React.useState(false)
    const [hoopLabelPos, setHoopLabelPos] = React.useState({ left: 0, top: 0 })
    const [hoopLabelText, setHoopLabelText] = React.useState('')
    const [playerLabelVisible, setPlayerLabelVisible] = React.useState(false)
    const [playerLabelPos, setPlayerLabelPos] = React.useState({ left: 0, top: 0 })
    const [playerLabelText, setPlayerLabelText] = React.useState('')
    const [powerBadgeVisible, setPowerBadgeVisible] = React.useState(false)
    const [angleBadgeVisible, setAngleBadgeVisible] = React.useState(false)
    const [inFlightBadgeVisible, setInFlightBadgeVisible] = React.useState(false)
    const [inFlightBadgeText, setInFlightBadgeText] = React.useState('')

    // Log for diagnostics - track when pose overlay renders with valid keypoints
    React.useEffect(() => {
        // Removed log - noise in profiling
        if (poseKeypoints) {
            const validKeypoints = Object.values(poseKeypoints).filter((kp: any) => kp && kp.score > 0).length
        }
    }, [poseKeypoints])

    const [debugYoloData, setDebugYoloData] = React.useState({
        x: 0, y: 0, w: 0, h: 0, conf: 0, rejected: false, rejectionReason: ''
    })
    const [debugHoopData, setDebugHoopData] = React.useState({
        x: 0, y: 0, w: 0, h: 0, conf: 0, rejected: false, rejectionReason: ''
    })
    const [debugPlayerData, setDebugPlayerData] = React.useState({
        x: 0, y: 0, w: 0, h: 0, conf: 0, rejected: false, rejectionReason: ''
    })
    const [debugMoveNetData, setDebugMoveNetData] = React.useState({
        keypointsCount: 0,
        validKeypoints: 0,
        avgConfidence: 0,
        sampleKeypoint: { name: '', x: 0, y: 0, score: 0 }
    })
    const lastDebugUpdate = React.useRef(0)
    const lastBadgeUpdate = React.useRef(0)

    const updateBadgeState = React.useCallback((data: {
        showLabel: boolean
        ballX: number
        ballY: number
        confidence: number
        inFlight: boolean
        shotResult: string | null
        showTrail: boolean
        ballSizeCategory?: string | null
        adaptiveThreshold?: number
        hoopX: number
        hoopY: number
        hoopConfidence: number
        playerX: number
        playerY: number
        playerConfidence: number
        ballTrackState?: string
        ballTrackAge?: number
        playerTrackState?: string
        playerTrackAge?: number
        rimTrackState?: string
        rimTrackAge?: number
    }) => {
        setBallLabelVisible(data.showLabel)
        const mappedPos = mapNormalizedToCameraView(data.ballX, data.ballY, effectiveResolution.width, effectiveResolution.height)
        setBallLabelPos({ left: mappedPos.x - 32, top: mappedPos.y - 44 })

        let sizeLabel = ''
        if (data.ballSizeCategory === 'small') {
            sizeLabel = '🔴 PICCOLA'
        } else if (data.ballSizeCategory === 'medium') {
            sizeLabel = '🟡 MEDIA'
        } else if (data.ballSizeCategory === 'large') {
            sizeLabel = '🟢 GRANDE'
        }

        // Add tracking state to ball label
        let trackLabel = ''
        if (data.ballTrackState) {
            const stateEmoji = data.ballTrackState === 'DETECTED' ? '🟠' : data.ballTrackState === 'PREDICTED' ? '🔴' : '🔴'
            const ageLabel = data.ballTrackState === 'PREDICTED' && data.ballTrackAge ? ` ${Math.round(data.ballTrackAge)}ms` : ''
            trackLabel = `${stateEmoji} ${data.ballTrackState}${ageLabel}`
        }

        const threshLabel = data.adaptiveThreshold ? `| Thresh: ${data.adaptiveThreshold.toFixed(3)}` : ''
        setBallLabelText(`🏀 ${Math.round(data.confidence * 100)}% ${sizeLabel} ${trackLabel} ${threshLabel}`)

        // Hoop label
        const showHoopLabel = data.hoopX > 0 && data.hoopY > 0
        setHoopLabelVisible(showHoopLabel)
        if (showHoopLabel) {
            const hoopPos = mapNormalizedToCameraView(data.hoopX, data.hoopY, effectiveResolution.width, effectiveResolution.height)
            setHoopLabelPos({ left: hoopPos.x - 32, top: hoopPos.y - 44 })

            // Add tracking state to hoop label
            let rimTrackLabel = ''
            if (data.rimTrackState) {
                const stateEmoji = data.rimTrackState === 'DETECTED' ? '🟠' : data.rimTrackState === 'PREDICTED' ? '🔴' : '🔴'
                rimTrackLabel = `${stateEmoji} ${data.rimTrackState}`
            }
            setHoopLabelText(`🏀 ${Math.round(data.hoopConfidence * 100)}% ${rimTrackLabel}`)
        }

        // Player label
        const showPlayerLabel = data.playerX > 0 && data.playerY > 0
        setPlayerLabelVisible(showPlayerLabel)
        if (showPlayerLabel) {
            const playerPos = mapNormalizedToCameraView(data.playerX, data.playerY, effectiveResolution.width, effectiveResolution.height)
            setPlayerLabelPos({ left: playerPos.x - 32, top: playerPos.y - 44 })

            // Add tracking state to player label
            let playerTrackLabel = ''
            if (data.playerTrackState) {
                const stateEmoji = data.playerTrackState === 'DETECTED' ? '🟠' : data.playerTrackState === 'PREDICTED' ? '🔴' : '🔴'
                const ageLabel = data.playerTrackState === 'PREDICTED' && data.playerTrackAge ? ` ${Math.round(data.playerTrackAge)}ms` : ''
                playerTrackLabel = `${stateEmoji} ${data.playerTrackState}${ageLabel}`
            }
            setPlayerLabelText(`👤 ${Math.round(data.playerConfidence * 100)}% ${playerTrackLabel}`)
        }
        
        setPowerBadgeVisible(data.inFlight && shotPower > 0)
        setAngleBadgeVisible(releaseAngle != null && data.inFlight)
        setInFlightBadgeVisible(data.showTrail)
        if (data.inFlight) {
            setInFlightBadgeText('✈ IN VOLO')
        } else if (data.shotResult === 'MADE') {
            setInFlightBadgeText('🟢 CANESTRO')
        } else if (data.shotResult) {
            setInFlightBadgeText('🔴 MANCATO')
        } else {
            setInFlightBadgeText('')
        }
    }, [shotPower, releaseAngle, effectiveResolution])

    useAnimatedReaction(
        () => (({
            showLabel: (sharedValues?.ballX.value ?? 0) > 0 && (sharedValues?.ballY.value ?? 0) > 0,
            ballX: sharedValues?.ballX.value ?? 0,
            ballY: sharedValues?.ballY.value ?? 0,
            confidence: sharedValues?.confidence.value ?? 0,
            inFlight: sharedValues?.inFlight.value ?? false,
            shotResult: sharedValues?.shotResult.value ?? null,
            showTrail: sharedValues?.showShotTrail.value ?? false,
            ballSizeCategory: sharedValues?.ballSizeCategory.value,
            adaptiveThreshold: sharedValues?.adaptiveThreshold.value,
            hoopX: sharedValues?.hoopX.value ?? 0,
            hoopY: sharedValues?.hoopY.value ?? 0,
            hoopConfidence: rimFromDetection?.confidence ?? 0,
            playerX: (sharedValues?.playerX.value ?? 0) || 0,
            playerY: (sharedValues?.playerY.value ?? 0) || 0,
            playerConfidence: sharedValues?.playerConfidence?.value ?? 0,
            ballTrackState: sharedValues?.ballTrackState?.value,
            ballTrackAge: sharedValues?.ballTrackAge?.value,
            playerTrackState: sharedValues?.playerTrackState?.value,
            playerTrackAge: sharedValues?.playerTrackAge?.value,
            rimTrackState: sharedValues?.rimTrackState?.value,
            rimTrackAge: sharedValues?.rimTrackAge?.value,
        })),
        (current) => {
            'worklet'
            const now = Date.now()
            if (now - lastBadgeUpdate.current > 100) {
                lastBadgeUpdate.current = now
                runOnJS(updateBadgeState)(current)
            }
        }
    )

    const updateDebugPanels = React.useCallback((data: {
        ballXRaw: number
        ballYRaw: number
        ballWidth: number
        ballHeight: number
        confidence: number
        hoopX: number
        hoopY: number
        hoopWidth: number
        hoopHeight: number
        playerX: number
        playerY: number
        playerWidth: number
        playerHeight: number
        playerConfidence: number
        ballRejectionReason: string
        rimRejectionReason: string
    }) => {
        setDebugYoloData({
            x: data.ballXRaw,
            y: data.ballYRaw,
            w: data.ballWidth,
            h: data.ballHeight,
            conf: data.confidence,
            rejected: data.ballRejectionReason !== '',
            rejectionReason: data.ballRejectionReason,
        })
        const hoopX = data.hoopX > 0 ? data.hoopX : (rimFromDetection?.x ?? 0)
        const hoopY = data.hoopY > 0 ? data.hoopY : (rimFromDetection?.y ?? 0)
        const hoopW = data.hoopWidth > 0 ? data.hoopWidth : (rimFromDetection?.width ?? 0)
        const hoopH = data.hoopHeight > 0 ? data.hoopHeight : (rimFromDetection?.height ?? 0)
        const hoopConf = data.hoopX > 0 ? data.confidence : (rimFromDetection?.confidence ?? 0)
        setDebugHoopData({
            x: hoopX,
            y: hoopY,
            w: hoopW,
            h: hoopH,
            conf: hoopConf,
            rejected: data.rimRejectionReason !== '',
            rejectionReason: data.rimRejectionReason,
        })
        setDebugPlayerData({
            x: data.playerX,
            y: data.playerY,
            w: data.playerWidth,
            h: data.playerHeight,
            conf: data.playerConfidence,
            rejected: data.playerConfidence < YOLO_CONFIG.PLAYER_CROP_MIN_CONFIDENCE,
            rejectionReason: data.playerConfidence < YOLO_CONFIG.PLAYER_CROP_MIN_CONFIDENCE ? 'conf' : '',
        })

        // Update MoveNet debug data
        if (poseKeypoints) {
            const validKeypoints = Object.values(poseKeypoints).filter((kp: any) => kp && kp.score > 0)
            const avgConfidence = validKeypoints.length > 0
                ? validKeypoints.reduce((sum: number, kp: any) => sum + kp.score, 0) / validKeypoints.length
                : 0

            // Find a sample valid keypoint (prefer shoulders)
            const sampleKp = poseKeypoints.leftShoulder || poseKeypoints.rightShoulder || poseKeypoints.leftHip || validKeypoints[0]

            setDebugMoveNetData({
                keypointsCount: Object.keys(poseKeypoints).length,
                validKeypoints: validKeypoints.length,
                avgConfidence,
                sampleKeypoint: sampleKp ? {
                    name: Object.keys(poseKeypoints).find((k: string) => poseKeypoints[k as keyof PoseKeypoints] === sampleKp) || 'unknown',
                    x: sampleKp.x,
                    y: sampleKp.y,
                    score: sampleKp.score
                } : { name: '', x: 0, y: 0, score: 0 }
            })
        }
    }, [rimFromDetection, poseKeypoints])

    React.useEffect(() => {
        if (!sharedValues && rimFromDetection) {
            setDebugHoopData({
                x: rimFromDetection.x,
                y: rimFromDetection.y,
                w: rimFromDetection.width,
                h: rimFromDetection.height,
                conf: rimFromDetection.confidence,
                rejected: false,
                rejectionReason: '',
            })
        }
    }, [sharedValues, rimFromDetection])

    useAnimatedReaction(
        () => (({
            ballXRaw: sharedValues?.ballXRaw.value ?? 0,
            ballYRaw: sharedValues?.ballYRaw.value ?? 0,
            ballWidth: sharedValues?.ballWidth.value ?? 0,
            ballHeight: sharedValues?.ballHeight.value ?? 0,
            confidence: sharedValues?.confidence.value ?? 0,
            hoopX: sharedValues?.hoopX.value ?? 0,
            hoopY: sharedValues?.hoopY.value ?? 0,
            hoopWidth: sharedValues?.hoopWidth.value ?? 0,
            hoopHeight: sharedValues?.hoopHeight.value ?? 0,
            playerX: (sharedValues?.playerX.value ?? 0) || 0,
            playerY: (sharedValues?.playerY.value ?? 0) || 0,
            playerWidth: (sharedValues?.playerWidth.value ?? 0) || 0,
            playerHeight: (sharedValues?.playerHeight.value ?? 0) || 0,
            playerConfidence: sharedValues?.playerConfidence?.value ?? 0,
            ballRejectionReason: sharedValues?.ballRejectionReason?.value ?? '',
            rimRejectionReason: sharedValues?.rimRejectionReason?.value ?? '',
        })),
        (current) => {
            'worklet'
            const now = Date.now()
            if (now - lastDebugUpdate.current > 500) {
                lastDebugUpdate.current = now
                runOnJS(updateDebugPanels)(current)
            }
        }
    )

    return (
        <>
            {ballLabelVisible && (
                <View
                    pointerEvents="none"
                    style={[ovStyles.ballLabelWrap, ballLabelPos]}
                >
                    <View style={ovStyles.ballLabelBox}>
                        <Text style={ovStyles.ballLabelText}>
                            {ballLabelText}
                        </Text>
                    </View>
                </View>
            )}

            {hoopLabelVisible && (
                <View
                    pointerEvents="none"
                    style={[ovStyles.ballLabelWrap, hoopLabelPos]}
                >
                    <View style={[ovStyles.ballLabelBox, { borderColor: 'rgba(74,222,128,0.6)' }]}>
                        <Text style={ovStyles.ballLabelText}>
                            {hoopLabelText}
                        </Text>
                    </View>
                </View>
            )}

            {playerLabelVisible && (
                <View
                    pointerEvents="none"
                    style={[ovStyles.ballLabelWrap, playerLabelPos]}
                >
                    <View style={[ovStyles.ballLabelBox, { borderColor: 'rgba(34,197,94,0.6)' }]}>
                        <Text style={ovStyles.ballLabelText}>
                            {playerLabelText}
                        </Text>
                    </View>
                </View>
            )}

            {powerBadgeVisible && (
                <View pointerEvents="none" style={ovStyles.powerBadge}>
                    <Text style={ovStyles.powerText}>
                        ⚡ {shotPower}%
                    </Text>
                </View>
            )}

            {inFlightBadgeVisible && (
                <View pointerEvents="none" style={ovStyles.inFlightBadge}>
                    <Text style={ovStyles.inFlightText}>
                        {inFlightBadgeText}
                    </Text>
                </View>
            )}

            {jointAngles && (
                <View pointerEvents="none" style={ovStyles.bioPanel}>
                    {releaseAngle != null && (
                        <Text style={ovStyles.bioText}>
                            🚀 Angolo {releaseAngle.toFixed(1)}°
                        </Text>
                    )}

                    {arcHeight != null && (
                        <Text style={ovStyles.bioText}>
                            📈 Arco {arcHeight.toFixed(2)}m
                        </Text>
                    )}

                    {jointAngles.elbowAngle != null && (
                        <Text style={ovStyles.bioText}>
                            📐 Gomito {jointAngles.elbowAngle.toFixed(0)}°
                        </Text>
                    )}

                    {jointAngles.shoulderAngle != null && (
                        <Text style={ovStyles.bioText}>
                            💪 Spalla {jointAngles.shoulderAngle.toFixed(0)}°
                        </Text>
                    )}

                    {jointAngles.kneeAngle != null && (
                        <Text style={ovStyles.bioText}>
                            🦵 Ginocchio {jointAngles.kneeAngle.toFixed(0)}°
                        </Text>
                    )}
                </View>
            )}

            {showDebug && (
                <View pointerEvents="none" style={ovStyles.combinedDebugPanel}>
                    {/* Palla Section */}
                    <View style={ovStyles.debugSection}>
                        <Text style={ovStyles.debugSectionTitle}>🏀 Palla</Text>
                        {debugYoloData.x === 0 && debugYoloData.y === 0 ? (
                            <Text style={ovStyles.debugText}>Nessun dato</Text>
                        ) : (
                            <>
                                {debugYoloData.rejected ? (
                                    <Text style={[ovStyles.debugText, { color: '#ef4444' }]}>
                                        Scartato: {debugYoloData.rejectionReason || 'conf'}
                                    </Text>
                                ) : null}
                                <Text style={[ovStyles.debugText, { color: debugYoloData.rejected ? '#ef4444' : (debugYoloData.conf >= 0.01 ? '#4ade80' : '#ef4444') }]}>
                                    Conf: {(debugYoloData.conf * 100).toFixed(1)}%
                                </Text>
                                <Text style={ovStyles.debugText}>X: {debugYoloData.x.toFixed(3)}</Text>
                                <Text style={ovStyles.debugText}>Y: {debugYoloData.y.toFixed(3)}</Text>
                                <Text style={ovStyles.debugText}>W: {debugYoloData.w.toFixed(3)}</Text>
                                <Text style={ovStyles.debugText}>H: {debugYoloData.h.toFixed(3)}</Text>
                            </>
                        )}
                    </View>

                    {/* Canestro Section */}
                    <View style={ovStyles.debugSection}>
                        <Text style={ovStyles.debugSectionTitle}>🏀 Canestro</Text>
                        {debugHoopData.x === 0 && debugHoopData.y === 0 ? (
                            <Text style={ovStyles.debugText}>Nessun dato</Text>
                        ) : (
                            <>
                                {debugHoopData.rejected ? (
                                    <Text style={[ovStyles.debugText, { color: '#ef4444' }]}>
                                        Scartato: {debugHoopData.rejectionReason || 'conf'}
                                    </Text>
                                ) : null}
                                <Text style={[ovStyles.debugText, { color: debugHoopData.rejected ? '#ef4444' : (debugHoopData.conf >= 0.01 ? '#4ade80' : '#ef4444') }]}>
                                    Conf: {(debugHoopData.conf * 100).toFixed(1)}%
                                </Text>
                                <Text style={ovStyles.debugText}>X: {debugHoopData.x.toFixed(3)}</Text>
                                <Text style={ovStyles.debugText}>Y: {debugHoopData.y.toFixed(3)}</Text>
                                <Text style={ovStyles.debugText}>W: {debugHoopData.w.toFixed(3)}</Text>
                                <Text style={ovStyles.debugText}>H: {debugHoopData.h.toFixed(3)}</Text>
                            </>
                        )}
                    </View>

                    {/* Player Section */}
                    <View style={ovStyles.debugSection}>
                        <Text style={ovStyles.debugSectionTitle}>👤 Player</Text>
                        {debugPlayerData.x === 0 && debugPlayerData.y === 0 ? (
                            <Text style={ovStyles.debugText}>Nessun dato</Text>
                        ) : (
                            <>
                                {debugPlayerData.rejected ? (
                                    <Text style={[ovStyles.debugText, { color: '#ef4444' }]}>
                                        Scartato: {debugPlayerData.rejectionReason || 'conf'}
                                    </Text>
                                ) : null}
                                <Text style={[ovStyles.debugText, { color: debugPlayerData.rejected ? '#ef4444' : '#4ade80' }]}>
                                    Conf: {(debugPlayerData.conf * 100).toFixed(1)}%
                                </Text>
                                <Text style={ovStyles.debugText}>X: {debugPlayerData.x.toFixed(3)}</Text>
                                <Text style={ovStyles.debugText}>Y: {debugPlayerData.y.toFixed(3)}</Text>
                                <Text style={ovStyles.debugText}>W: {debugPlayerData.w.toFixed(3)}</Text>
                                <Text style={ovStyles.debugText}>H: {debugPlayerData.h.toFixed(3)}</Text>
                            </>
                        )}
                    </View>

                    {/* Calibrazione Section */}
                    {calibration && (
                        <View style={ovStyles.debugSection}>
                            <Text style={ovStyles.debugSectionTitle}>🔍 CALIBRAZIONE — {cameraMode || 'Default'}</Text>
                            <Text style={ovStyles.debugText}>Hoop: ({calibration.hoopCenter.x.toFixed(3)}, {calibration.hoopCenter.y.toFixed(3)})</Text>
                            <Text style={ovStyles.debugText}>Homography: {calibration.homographyMatrix.length > 0 ? `${calibration.homographyMatrix.length} coeff.` : 'identità'}</Text>
                            {calibration.courtCorners && <Text style={ovStyles.debugText}>Campo: 4 angoli ✓</Text>}
                        </View>
                    )}

                    {/* MoveNet Section */}
                    <View style={ovStyles.debugSection}>
                        <Text style={ovStyles.debugSectionTitle}>🤖 MOVENET</Text>
                        {debugMoveNetData.keypointsCount === 0 ? (
                            <Text style={ovStyles.debugText}>Nessun dato</Text>
                        ) : (
                            <>
                                <Text style={ovStyles.debugText}>Keypoints: {debugMoveNetData.keypointsCount}</Text>
                                <Text style={ovStyles.debugText}>Validi: {debugMoveNetData.validKeypoints}</Text>
                                <Text style={ovStyles.debugText}>Avg Conf: {(debugMoveNetData.avgConfidence * 100).toFixed(1)}%</Text>
                                {debugMoveNetData.sampleKeypoint.name && (
                                    <>
                                        <Text style={ovStyles.debugText}>Sample: {debugMoveNetData.sampleKeypoint.name}</Text>
                                        <Text style={ovStyles.debugText}>  X: {debugMoveNetData.sampleKeypoint.x.toFixed(3)}</Text>
                                        <Text style={ovStyles.debugText}>  Y: {debugMoveNetData.sampleKeypoint.y.toFixed(3)}</Text>
                                        <Text style={ovStyles.debugText}>  Score: {debugMoveNetData.sampleKeypoint.score.toFixed(3)}</Text>
                                    </>
                                )}
                            </>
                        )}
                    </View>
                </View>
            )}
        </>
    )
})

// Overlay Styles
const ovStyles = StyleSheet.create({
    ballLabelWrap: {
        position: 'absolute',
        alignItems: 'center',
        justifyContent: 'center',
    },
    ballLabelBox: {
        backgroundColor: 'rgba(0,0,0,0.75)',
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: 'rgba(255,140,0,0.6)',
    },
    ballLabelText: {
        color: '#fff',
        fontSize: 11,
        fontWeight: '700',
        letterSpacing: 0.3,
    },
    powerBadge: {
        position: 'absolute',
        top: 120,
        right: 15,
        backgroundColor: 'rgba(234,179,8,0.85)',
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 8,
        borderWidth: 2,
        borderColor: '#fbbf24',
    },
    powerText: {
        color: '#000',
        fontSize: 13,
        fontWeight: '800',
    },
    inFlightBadge: {
        position: 'absolute',
        top: 160,
        right: 15,
        backgroundColor: 'rgba(34,197,94,0.85)',
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 8,
        borderWidth: 2,
        borderColor: '#4ade80',
    },
    inFlightText: {
        color: '#fff',
        fontSize: 12,
        fontWeight: '700',
    },
    fpsPanel: {
        position: 'absolute',
        top: 14,
        left: 14,
        backgroundColor: 'rgba(0,0,0,0.75)',
        borderRadius: 10,
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderWidth: 1,
        borderColor: 'rgba(59,130,246,0.5)',
    },
    fpsTitle: {
        color: '#3b82f6',
        fontSize: 10,
        fontWeight: '800',
        marginBottom: 4,
    },
    fpsText: {
        color: '#fff',
        fontSize: 10,
        fontWeight: '600',
        marginVertical: 1,
    },
    combinedDebugPanel: {
        position: 'absolute',
        bottom: 10,
        right: 10,
        backgroundColor: 'rgba(0,0,0,0.5)',
        borderRadius: 10,
        padding: 10,
        borderWidth: 1,
        borderColor: 'rgba(255,140,0,0.5)',
        minWidth: 180,
    },
    debugSection: {
        marginBottom: 8,
        paddingBottom: 8,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(255,140,0,0.3)',
    },
    debugSectionTitle: {
        color: '#ff8c00',
        fontSize: 9,
        fontWeight: '800',
        marginBottom: 4,
    },
    debugText: {
        color: '#fff',
        fontSize: 9,
        fontWeight: '500',
        marginVertical: 1,
    },
    bioPanel: {
        position: 'absolute',
        top: 14,
        right: 14,
        backgroundColor: 'rgba(0,0,0,0.5)',
        borderRadius: 12,
        paddingHorizontal: 10,
        paddingVertical: 8,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.15)',
    },
    bioText: {
        color: '#fff',
        fontSize: 11,
        fontWeight: '700',
        marginVertical: 1,
    },
})

export default ReactOverlay
