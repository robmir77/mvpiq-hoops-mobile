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
import { captureRef } from 'react-native-view-shot'
import * as MediaLibrary from 'expo-media-library/legacy'
import {
    Canvas, Path as SkiaPath, Circle as SkiaCircle,
    Group, Line as SkiaLine, vec, Skia,
} from '@shopify/react-native-skia'
import { useAnimatedReaction, useDerivedValue, runOnJS, useAnimatedStyle } from 'react-native-reanimated'
import { Camera, type CameraRef } from 'react-native-vision-camera'
import { AuthContext } from '@/features/auth/context/AuthContext'
import { useCustomAlert, CustomAlert } from '@/shared/components/CustomAlert'
import { useWorkoutWebSocket } from '../hooks/useWorkoutWebSocket'
import { useTrackingEngine } from '../hooks/useTrackingEngine'
import { useCameraPipeline } from '@/vision'
import { incrementTrackingUpdates, startPerfMonitor, stopPerfMonitor, recordPathBuildTime, getPerfMetrics } from '../hooks/usePerformanceMonitor'
import { telemetryLogger } from '@/vision/telemetry'
import {
    WorkoutSession, ShotResult,
    TrackingState, PoseKeypoints, CalibrationData, CameraMode,
} from '../types/workouts.types'
import {
    getWorkoutSession, addShotEvent,
    endWorkoutSession, pauseWorkoutSession, resumeWorkoutSession,
    saveFrameData, savePoseAnalysis,
} from '../api/workouts.api'
import apiClient from '@/shared/api/apiClient'
import type { BallDetection, PoseResult, ShotEvent, JointAngles } from '@/vision'
import { DEFAULT_MOVENET_MODEL_ID, DEFAULT_YOLO_MODEL_ID, getYoloModel, TelemetryOverlay } from '@/vision'

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window')
const CAMERA_H = SCREEN_H * 0.52
const DEFAULT_CAMERA_RESOLUTION = { width: 1280, height: 720 }
const DEFAULT_CAMERA_FPS = 30
const DEFAULT_POSE_RESOLUTION = 192 // Only 192 is currently available
const DEFAULT_CAMERA_ZOOM = 1
const COURT_WIDTH_M  = 15.24
const COURT_HEIGHT_M = 28.65
const HOOP_Y_M       = 1.575

const ToggleButton = ({ active, disabled, labelOn, labelOff, onPress }: any) => (
    <TouchableOpacity
        style={[
            styles.toggleBtn,
            active ? styles.toggleBtnOn : styles.toggleBtnOff,
            disabled && styles.btnDisabled
        ]}
        onPress={onPress}
        disabled={disabled}
    >
        <Text style={[styles.toggleBtnText, active ? styles.toggleBtnTextOn : styles.toggleBtnTextOff]}>
            {active ? labelOn : labelOff}
        </Text>
    </TouchableOpacity>
)

function toCourtMeters(
    normX: number, normY: number, calibration: CalibrationData | null
): { courtX: number; courtY: number; distanceFromHoop: number } {
    let courtX = normX * COURT_WIDTH_M
    let courtY = (1 - normY) * COURT_HEIGHT_M
    if (calibration?.homographyMatrix?.length === 9) {
        const H = calibration.homographyMatrix
        const wx = H[0]*normX + H[1]*normY + H[2]
        const wy = H[3]*normX + H[4]*normY + H[5]
        const wz = H[6]*normX + H[7]*normY + H[8]
        if (Math.abs(wz) > 1e-6) { courtX = wx/wz; courtY = wy/wz }
    }
    const dx = courtX - COURT_WIDTH_M/2
    const dy = courtY - HOOP_Y_M
    return {
        courtX:  Math.round(courtX*100)/100,
        courtY:  Math.round(courtY*100)/100,
        distanceFromHoop: Math.round(Math.sqrt(dx*dx+dy*dy)*100)/100,
    }
}

// Skia Overlay
const SKELETON_CONNECTIONS: Array<[keyof PoseKeypoints, keyof PoseKeypoints]> = [
    ['leftShoulder','rightShoulder'],
    ['leftShoulder','leftElbow'],   ['leftElbow','leftWrist'],
    ['rightShoulder','rightElbow'], ['rightElbow','rightWrist'],
    ['leftShoulder','leftHip'],     ['rightShoulder','rightHip'],
    ['leftHip','rightHip'],
    ['leftHip','leftKnee'],         ['leftKnee','leftAnkle'],
    ['rightHip','rightKnee'],       ['rightKnee','rightAnkle'],
]
const KP_THRESH = 0.35
const TRAIL_DELAY_POINTS = 5

// Worklet-compatible coordinate mapping function
// Maps normalized camera coordinates (0-1) to screen coordinates
const mapNormalizedToCameraView = (normX: number, normY: number, cameraResW: number, cameraResH: number) => {
    'worklet';
    const coverScale = Math.max(SCREEN_W / cameraResW, CAMERA_H / cameraResH);
    const displayedW = cameraResW * coverScale;
    const displayedH = cameraResH * coverScale;
    const cropX = (displayedW - SCREEN_W) / 2;
    const cropY = (displayedH - CAMERA_H) / 2;
    const displayedX = normX * displayedW;
    const displayedY = normY * displayedH;
    const screenX = displayedX - cropX;
    const screenY = displayedY - cropY;
    return {
        x: SCREEN_W - screenX,
        y: CAMERA_H - screenY,
    };
};

// Realtime Ball Overlay (Pure Skia, no React state)
const RealtimeBallOverlay = React.memo(({
    sharedValues,
    effectiveResolution,
}: {
    sharedValues?: {
        ballX: any
        ballY: any
        ballWidth: any
        ballHeight: any
        ballXRaw: any
        ballYRaw: any
        hoopX: any
        hoopY: any
        hoopWidth: any
        hoopHeight: any
        inFlight: any
        shotResult: any
        showShotTrail: any
        trajectoryPoints: any
        trajectoryPointCount: any
    }
    effectiveResolution: { width: number; height: number }
}) => {
    const shotTrailPathRef = React.useRef(Skia.Path.Make())

    const ballXPx = useDerivedValue(() => {
        const x = sharedValues?.ballX.value ?? 0
        const y = sharedValues?.ballY.value ?? 0
        const mapped = mapNormalizedToCameraView(x, y, effectiveResolution.width, effectiveResolution.height)
        return mapped.x
    })
    const ballYPx = useDerivedValue(() => {
        const x = sharedValues?.ballX.value ?? 0
        const y = sharedValues?.ballY.value ?? 0
        const mapped = mapNormalizedToCameraView(x, y, effectiveResolution.width, effectiveResolution.height)
        return mapped.y
    })
    const hoopXPx = useDerivedValue(() => {
        const x = sharedValues?.hoopX.value ?? 0
        const y = sharedValues?.hoopY.value ?? 0
        const mapped = mapNormalizedToCameraView(x, y, effectiveResolution.width, effectiveResolution.height)
        return mapped.x
    })
    const hoopYPx = useDerivedValue(() => {
        const x = sharedValues?.hoopX.value ?? 0
        const y = sharedValues?.hoopY.value ?? 0
        const mapped = mapNormalizedToCameraView(x, y, effectiveResolution.width, effectiveResolution.height)
        return mapped.y
    })

    const ballXRawVal = useDerivedValue(() => sharedValues?.ballXRaw.value ?? 0)
    const ballYRawVal = useDerivedValue(() => sharedValues?.ballYRaw.value ?? 0)
    const ballXPxRaw = useDerivedValue(() => {
        const x = ballXRawVal.value
        const y = ballYRawVal.value
        const mapped = mapNormalizedToCameraView(x, y, effectiveResolution.width, effectiveResolution.height)
        return mapped.x
    })
    const ballYPxRaw = useDerivedValue(() => {
        const x = ballXRawVal.value
        const y = ballYRawVal.value
        const mapped = mapNormalizedToCameraView(x, y, effectiveResolution.width, effectiveResolution.height)
        return mapped.y
    })

    const ballRadius = useDerivedValue(() => {
        const ballW = sharedValues?.ballWidth.value ?? 0
        const ballH = sharedValues?.ballHeight.value ?? 0
        const cameraResW = effectiveResolution.width
        const cameraResH = effectiveResolution.height
        const coverScale = Math.max(SCREEN_W / cameraResW, CAMERA_H / cameraResH)
        const avgSize = ((ballW * cameraResW) + (ballH * cameraResH)) / 2
        const scaledSize = avgSize * coverScale
        return Math.max(8, scaledSize / 2)
    })

    const ballRawOpacity = useDerivedValue(() => {
        const hasRaw = (sharedValues?.ballXRaw.value ?? 0) > 0 && (sharedValues?.ballYRaw.value ?? 0) > 0
        return hasRaw ? 1 : 0
    })
    const ballKalmanOpacity = useDerivedValue(() => {
        const hasKalman = (sharedValues?.ballX.value ?? 0) > 0 && (sharedValues?.ballY.value ?? 0) > 0
        return hasKalman ? 1 : 0
    })
    const isMadeOpacity = useDerivedValue(() => {
        return sharedValues?.shotResult.value === 'MADE' ? 1 : 0
    })

    const trailColor = useDerivedValue(() => {
        const inFlight = sharedValues?.inFlight.value ?? false
        const shotResult = sharedValues?.shotResult.value ?? null
        if (inFlight) return 'rgba(255,140,0,0.90)'
        if (shotResult === 'MADE') return 'rgba(34,197,94,0.90)'
        if (shotResult) return 'rgba(239,68,68,0.90)'
        return 'rgba(255,140,0,0.70)'
    })
    const trailGlowColor = useDerivedValue(() => {
        const inFlight = sharedValues?.inFlight.value ?? false
        const shotResult = sharedValues?.shotResult.value ?? null
        if (inFlight) return 'rgba(255,140,0,0.30)'
        if (shotResult === 'MADE') return 'rgba(34,197,94,0.30)'
        if (shotResult) return 'rgba(239,68,68,0.30)'
        return 'rgba(255,140,0,0.20)'
    })

    const hoopOvalPath = useDerivedValue(() => {
        const w = (sharedValues?.hoopWidth.value ?? 0) > 0 ? (sharedValues?.hoopWidth.value ?? 0) * SCREEN_W : 40
        const h = (sharedValues?.hoopHeight.value ?? 0) > 0 ? (sharedValues?.hoopHeight.value ?? 0) * CAMERA_H : 40
        const flattenedW = w * 1.3
        const flattenedH = h * 0.6
        
        const x = sharedValues?.hoopX.value ?? 0
        const y = sharedValues?.hoopY.value ?? 0
        const mapped = mapNormalizedToCameraView(x, y, effectiveResolution.width, effectiveResolution.height)
        const hoopXPxVal = mapped.x
        const hoopYPxVal = mapped.y
        
        const rect = Skia.XYWHRect(
            hoopXPxVal - flattenedW / 2,
            hoopYPxVal - flattenedH / 2,
            flattenedW,
            flattenedH
        )
        return Skia.Path.Oval(rect)
    }, [sharedValues, effectiveResolution])

    const trajectoryData = useDerivedValue(() => {
        const showTrail = sharedValues?.showShotTrail.value ?? false
        const isInFlight = sharedValues?.inFlight.value ?? false
        
        if (!showTrail) return null
        
        const trajPoints = sharedValues?.trajectoryPoints.value
        const trajCount = sharedValues?.trajectoryPointCount.value ?? 0
        
        if (!trajPoints || trajCount < 2) return null
        
        const points: Array<{x:number;y:number}> = []
        const delayPoints = isInFlight ? TRAIL_DELAY_POINTS : 0
        const effectiveCount = Math.max(0, trajCount - delayPoints)
        
        for (let i = 0; i < effectiveCount; i++) {
            points.push({
                x: trajPoints[i * 2],
                y: trajPoints[i * 2 + 1]
            })
        }
        
        if (points.length < 2) return null
        
        return { points }
    })

    const shotTrailPath = useDerivedValue(() => {
        const data = trajectoryData.value
        if (!data) return shotTrailPathRef.current

        const { points } = data
        if (points.length < 2) return null

        const transformPoint = (x: number, y: number) => {
            return mapNormalizedToCameraView(x, y, effectiveResolution.width, effectiveResolution.height)
        }

        const p0 = transformPoint(points[0].x, points[0].y)
        const p = Skia.Path.Make()
        p.moveTo(p0.x, p0.y)

        if (points.length === 2) {
            const p1 = transformPoint(points[1].x, points[1].y)
            p.lineTo(p1.x, p1.y)
        } else {
            for (let i = 0; i < points.length - 1; i++) {
                const pt0 = points[Math.max(0, i - 1)]
                const pt1 = points[i]
                const pt2 = points[i + 1]
                const pt3 = points[Math.min(points.length - 1, i + 2)]
                
                const t0 = transformPoint(pt0.x, pt0.y)
                const t1 = transformPoint(pt1.x, pt1.y)
                const t2 = transformPoint(pt2.x, pt2.y)
                const t3 = transformPoint(pt3.x, pt3.y)
                
                const cp1x = t1.x + (t2.x - t0.x) / 6
                const cp1y = t1.y + (t2.y - t0.y) / 6
                const cp2x = t2.x - (t3.x - t1.x) / 6
                const cp2y = t2.y - (t3.y - t1.y) / 6
                p.cubicTo(cp1x, cp1y, cp2x, cp2y, t2.x, t2.y)
            }
        }

        shotTrailPathRef.current = p
        return p
    }, [trajectoryData])

    return (
        <Canvas style={[StyleSheet.absoluteFill, { width: SCREEN_W, height: CAMERA_H }]}>
            <Group clip={Skia.Path.Make().addRect(Skia.XYWHRect(0, 0, SCREEN_W, CAMERA_H))}>
                <Group>
                    <SkiaPath
                        path={shotTrailPath as any}
                        color={trailGlowColor}
                        style="stroke"
                        strokeWidth={8}
                        strokeJoin="round"
                        strokeCap="round"
                    />
                    <SkiaPath
                        path={shotTrailPath as any}
                        color={trailColor}
                        style="stroke"
                        strokeWidth={3.5}
                        strokeJoin="round"
                        strokeCap="round"
                    />
                </Group>

                <Group opacity={ballRawOpacity}>
                    <SkiaCircle
                        cx={ballXPxRaw}
                        cy={ballYPxRaw}
                        r={ballRadius}
                        color="rgba(255,140,0,0.22)"
                    />
                    <SkiaCircle
                        cx={ballXPxRaw}
                        cy={ballYPxRaw}
                        r={ballRadius}
                        color="#ff8c00" style="stroke" strokeWidth={2.5}
                    />
                </Group>

                <Group opacity={ballKalmanOpacity}>
                    <SkiaCircle
                        cx={ballXPx}
                        cy={ballYPx}
                        r={8}
                        color="#ff0000"
                    />
                </Group>

                <Group opacity={isMadeOpacity}>
                    <SkiaCircle
                        cx={hoopXPx}
                        cy={hoopYPx}
                        r={45}
                        color="rgba(34,197,94,0.4)"
                    />
                    <SkiaCircle
                        cx={hoopXPx}
                        cy={hoopYPx}
                        r={35}
                        color="rgba(34,197,94,0.25)"
                    />
                </Group>

                <Group>
                    <SkiaPath
                        path={hoopOvalPath}
                        color="rgba(74,222,128,0.18)"
                    />
                    <SkiaPath
                        path={hoopOvalPath}
                        color="#4ade80" style="stroke" strokeWidth={2.5}
                    />
                </Group>
            </Group>
        </Canvas>
    )
})

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

// React Overlay (Badges, Debug, Pose Skeleton)
const ReactOverlay = React.memo(({
    trackingState, poseKeypoints, jointAngles, releaseAngle, arcHeight, calibration, sharedValues, fpsMetrics, effectiveResolution, showDebug, rimFromDetection,
}: {
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
    }
    fpsMetrics?: { yoloFps: number; moveNetFps: number }
    effectiveResolution: { width: number; height: number }
    showDebug?: boolean
    rimFromDetection?: { x: number; y: number; width: number; height: number; confidence: number } | null
}) => {
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
    const [powerBadgeVisible, setPowerBadgeVisible] = React.useState(false)
    const [angleBadgeVisible, setAngleBadgeVisible] = React.useState(false)
    const [inFlightBadgeVisible, setInFlightBadgeVisible] = React.useState(false)
    const [inFlightBadgeText, setInFlightBadgeText] = React.useState('')

    const [debugYoloData, setDebugYoloData] = React.useState({
        x: 0, y: 0, w: 0, h: 0, conf: 0
    })
    const [debugHoopData, setDebugHoopData] = React.useState({
        x: 0, y: 0, w: 0, h: 0, conf: 0
    })
    const lastDebugUpdate = React.useRef(0)

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
        
        const threshLabel = data.adaptiveThreshold ? `| Thresh: ${data.adaptiveThreshold.toFixed(3)}` : ''
        setBallLabelText(`🏀 ${Math.round(data.confidence * 100)}% ${sizeLabel} ${threshLabel}`)
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

    const showBallLabel = useDerivedValue(
        () => (sharedValues?.ballX.value ?? 0) > 0 && (sharedValues?.ballY.value ?? 0) > 0
    )
    const ballDataX = useDerivedValue(() => sharedValues?.ballX.value ?? 0)
    const ballDataY = useDerivedValue(() => sharedValues?.ballY.value ?? 0)
    const ballDataConfidence = useDerivedValue(() => sharedValues?.confidence.value ?? 0)
    const inFlight = useDerivedValue(() => sharedValues?.inFlight.value ?? false)
    const shotResult = useDerivedValue(() => sharedValues?.shotResult.value ?? null)
    const showShotTrail = useDerivedValue(() => sharedValues?.showShotTrail.value ?? false)

    useAnimatedReaction(
        () => ({
            showLabel: showBallLabel.value,
            ballX: ballDataX.value,
            ballY: ballDataY.value,
            confidence: ballDataConfidence.value,
            inFlight: inFlight.value,
            shotResult: shotResult.value,
            showTrail: showShotTrail.value,
            ballSizeCategory: sharedValues?.ballSizeCategory.value,
            adaptiveThreshold: sharedValues?.adaptiveThreshold.value,
        }),
        (current) => {
            runOnJS(updateBadgeState)(current)
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
    }) => {
        setDebugYoloData({
            x: data.ballXRaw,
            y: data.ballYRaw,
            w: data.ballWidth,
            h: data.ballHeight,
            conf: data.confidence,
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
        })
    }, [rimFromDetection])

    const ballXRawVal = useDerivedValue(() => sharedValues?.ballXRaw.value ?? 0)
    const ballYRawVal = useDerivedValue(() => sharedValues?.ballYRaw.value ?? 0)

    React.useEffect(() => {
        if (!sharedValues && rimFromDetection) {
            setDebugHoopData({
                x: rimFromDetection.x,
                y: rimFromDetection.y,
                w: rimFromDetection.width,
                h: rimFromDetection.height,
                conf: rimFromDetection.confidence,
            })
        }
    }, [sharedValues, rimFromDetection])

    useAnimatedReaction(
        () => ({
            ballXRaw: sharedValues?.ballXRaw.value ?? 0,
            ballYRaw: sharedValues?.ballYRaw.value ?? 0,
            ballWidth: sharedValues?.ballWidth.value ?? 0,
            ballHeight: sharedValues?.ballHeight.value ?? 0,
            confidence: sharedValues?.confidence.value ?? 0,
            hoopX: sharedValues?.hoopX.value ?? 0,
            hoopY: sharedValues?.hoopY.value ?? 0,
            hoopWidth: sharedValues?.hoopWidth.value ?? 0,
            hoopHeight: sharedValues?.hoopHeight.value ?? 0,
        }),
        (current) => {
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

            {fpsMetrics && (
                <View pointerEvents="none" style={ovStyles.fpsPanel}>
                    <Text style={ovStyles.fpsTitle}>📊 FPS</Text>
                    <Text style={ovStyles.fpsText}>
                        YOLO: {fpsMetrics?.yoloFps ?? 0}
                    </Text>
                    <Text style={ovStyles.fpsText}>
                        MoveNet: {fpsMetrics?.moveNetFps ?? 0}
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
                    {/* YOLO Raw Section */}
                    <View style={ovStyles.debugSection}>
                        <Text style={ovStyles.debugSectionTitle}>🔍 YOLO Raw</Text>
                        {debugYoloData.x === 0 && debugYoloData.y === 0 ? (
                            <Text style={ovStyles.debugText}>Nessun dato</Text>
                        ) : (
                            <>
                                <Text style={ovStyles.debugText}>X: {debugYoloData.x.toFixed(3)}</Text>
                                <Text style={ovStyles.debugText}>Y: {debugYoloData.y.toFixed(3)}</Text>
                                <Text style={ovStyles.debugText}>W: {debugYoloData.w.toFixed(3)}</Text>
                                <Text style={ovStyles.debugText}>H: {debugYoloData.h.toFixed(3)}</Text>
                                <Text style={ovStyles.debugText}>Conf: {(debugYoloData.conf * 100).toFixed(1)}%</Text>
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
                                <Text style={ovStyles.debugText}>X: {debugHoopData.x.toFixed(3)}</Text>
                                <Text style={ovStyles.debugText}>Y: {debugHoopData.y.toFixed(3)}</Text>
                                <Text style={ovStyles.debugText}>W: {debugHoopData.w.toFixed(3)}</Text>
                                <Text style={ovStyles.debugText}>H: {debugHoopData.h.toFixed(3)}</Text>
                                <Text style={ovStyles.debugText}>Conf: {debugHoopData.conf.toFixed(3)}</Text>
                            </>
                        )}
                    </View>

                    {/* Calibrazione Section */}
                    {calibration && (
                        <View style={ovStyles.debugSection}>
                            <Text style={ovStyles.debugSectionTitle}>🔍 CALIBRAZIONE</Text>
                            <Text style={ovStyles.debugText}>Hoop: ({calibration.hoopCenter.x.toFixed(3)}, {calibration.hoopCenter.y.toFixed(3)})</Text>
                            <Text style={ovStyles.debugText}>Homography: {calibration.homographyMatrix.length > 0 ? `${calibration.homographyMatrix.length} coeff.` : 'identità'}</Text>
                            {calibration.courtCorners && <Text style={ovStyles.debugText}>Campo: 4 angoli ✓</Text>}
                        </View>
                    )}
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
        bottom: 80,
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

const StatBox = ({ label, value, highlight }: { label: string; value: any; highlight?: boolean }) => (
    <View style={styles.statBox}>
        <Text style={[styles.statValue, highlight && styles.statValueHL]}>{value}</Text>
        <Text style={styles.statLabel}>{label}</Text>
    </View>
)

export default function WorkoutSessionScreen({ navigation, route }: any) {
    const { sessionId, cameraMode, zoom, selectedResolution, selectedFps, selectedPoseResolution, yoloDelegate, poseDelegate, yoloModelId, moveNetModelId } = route.params || {}
    const { user } = useContext(AuthContext) || {}

    const [session, setSession]             = useState<WorkoutSession | null>(null)
    const [calibration, setCalibration]     = useState<CalibrationData | null>(null)

    // Resume-safe camera/model defaults. Priority: route.params > calibration > default
    const effectiveResolution = React.useMemo(
        () => selectedResolution ?? calibration?.cameraResolution ?? DEFAULT_CAMERA_RESOLUTION,
        [selectedResolution, calibration?.cameraResolution]
    )
    const effectiveFps = selectedFps ?? DEFAULT_CAMERA_FPS
    const effectivePoseResolution = selectedPoseResolution ?? DEFAULT_POSE_RESOLUTION
    const effectiveYoloModelId = yoloModelId ?? DEFAULT_YOLO_MODEL_ID
    const effectiveMoveNetModelId = moveNetModelId ?? DEFAULT_MOVENET_MODEL_ID
    const effectiveZoom = zoom ?? DEFAULT_CAMERA_ZOOM

    const constraints = React.useMemo(
        () => [{ fps: effectiveFps }],
        [effectiveFps]
    )

    const [isEnding, setIsEnding]           = useState(false)
    const [isRecording, setIsRecording]     = useState(false)
    const isRecordingRef = useRef(false)
    const [isVideoRecording, setIsVideoRecording] = useState(false)
    const [videoDuration, setVideoDuration]         = useState(0)
    const isVideoRecordingRef                       = useRef(false)
    const videoTimerRef                             = useRef<ReturnType<typeof setInterval> | null>(null)
    const [shotCount, setShotCount]         = useState({ total: 0, made: 0 })
    const [trackingState, setTrackingState] = useState<TrackingState | null>(null)
    const [poseKeypoints, setPoseKeypoints] = useState<PoseKeypoints | null>(null)
    const [jointAngles, setJointAngles]     = useState<Partial<JointAngles>>({})
    const [lastShotResult, setLastShotResult] = useState<ShotResult | null>(null)
    const [modelsReady, setModelsReady]     = useState(false)
    const [rimFromDetection, setRimFromDetection] = useState<{ x: number; y: number; width: number; height: number; confidence: number } | null>(null)
    const [poseEnabled, setPoseEnabled] = useState(true)
    const [ballEnabled, setBallEnabled] = useState(true)
    const [rimDetectionEnabled, setRimDetectionEnabled] = useState(true)
    const [fpsMetrics, setFpsMetrics] = useState({ yoloFps: 0, moveNetFps: 0 })
    const [showTelemetry, setShowTelemetry] = useState(true)
    const [debugMode, setDebugMode] = useState(false)
    const cameraViewRef = useRef<View>(null)
    const shotCounter = useRef(0)
    const pendingScreenshotUri = useRef<string | null>(null)

    const { alert, showError, showWarning, showSuccess } = useCustomAlert()
    const { stats: wsStats, status: wsStatus } = useWorkoutWebSocket(sessionId ?? null, user?.id ?? null)
    const tracking = useTrackingEngine()
    const { sharedValues } = tracking
    const feedbackOpacity = useRef(new Animated.Value(0)).current
    const isActiveRef     = useRef(true)
    const resetShotTrackingRef = useRef<(() => void) | null>(null)
    
    // Get YOLO model name for loading messages
    const selectedYoloModel = getYoloModel(effectiveYoloModelId)
    const yoloModelName = selectedYoloModel?.label || yoloModelId || 'YOLO'
    
    // Derived values per tracking badge
    const trackingBallX = useDerivedValue(() => sharedValues?.ballX.value ?? 0, [sharedValues])
    const trackingConfidence = useDerivedValue(() => sharedValues?.confidence.value ?? 0, [sharedValues])
    const trackingIsActive = useDerivedValue(() => (trackingBallX.value > 0), [trackingBallX])
    
    const [trackingBadgeText, setTrackingBadgeText] = React.useState('Cerca palla...')
    const [trackingDotActive, setTrackingDotActive] = React.useState(false)
    
    const updateTrackingBadge = React.useCallback((isActive: boolean, confidence: number) => {
        if (isActive) {
            setTrackingBadgeText(`🏀 ${Math.round(confidence * 100)}%`)
            setTrackingDotActive(true)
        } else {
            setTrackingBadgeText(modelsReady ? 'Cerca palla...' : `Caricamento ${yoloModelName}...`)
            setTrackingDotActive(false)
        }
    }, [modelsReady, yoloModelName])
    
    useAnimatedReaction(
        () => ({
            isActive: trackingIsActive.value,
            confidence: trackingConfidence.value,
        }),
        (current) => {
            runOnJS(updateTrackingBadge)(current.isActive, current.confidence)
        }
    )
    
    const [autoStatusText, setAutoStatusText] = React.useState('In attesa della palla…')
    const [autoDotActive, setAutoDotActive] = React.useState(false)
    
    const updateAutoStatus = React.useCallback((ballX: number, inFlight: boolean) => {
        const isActive = ballX > 0
        setAutoDotActive(isActive)
        if (!modelsReady) {
            setAutoStatusText(`Caricamento ${yoloModelName}...`)
        } else if (inFlight) {
            setAutoStatusText('✈ Tiro rilevato — scia attiva')
        } else if (isActive) {
            setAutoStatusText('Rilevamento automatico attivo')
        } else {
            setAutoStatusText('In attesa della palla…')
        }
    }, [modelsReady, yoloModelName])
    
    useAnimatedReaction(
        () => ({
            ballX: sharedValues?.ballX.value ?? 0,
            inFlight: sharedValues?.inFlight.value ?? false,
        }),
        (current) => {
            runOnJS(updateAutoStatus)(current.ballX, current.inFlight)
        }
    )
    // Sync isRecordingRef con lo state (per evitare stale closure)
    useEffect(() => { isRecordingRef.current = isRecording }, [isRecording])

    // Gestione timer durata registrazione video
    useEffect(() => {
        isVideoRecordingRef.current = isVideoRecording
        if (isVideoRecording) {
            setVideoDuration(0)
            videoTimerRef.current = setInterval(() => {
                setVideoDuration(prev => prev + 1)
            }, 1000)
        } else {
            if (videoTimerRef.current) {
                clearInterval(videoTimerRef.current)
                videoTimerRef.current = null
            }
        }
        return () => {
            if (videoTimerRef.current) {
                clearInterval(videoTimerRef.current)
                videoTimerRef.current = null
            }
        }
    }, [isVideoRecording])

    const formatVideoDuration = useCallback((seconds: number) => {
        const mins = Math.floor(seconds / 60)
        const secs = seconds % 60
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
    }, [])
    const frameBatch      = useRef<any[]>([])
    const batchTimer      = useRef<ReturnType<typeof setInterval> | null>(null)
    const cameraRef       = useRef<CameraRef>(null)

    // Performance monitoring (YOLO/MoveNet FPS from worker SharedValues)
    useEffect(() => {
        startPerfMonitor()
        return () => stopPerfMonitor()
    }, [])

    // Pose callback
    const handlePoseResult = useCallback((result: PoseResult) => {
        setPoseKeypoints(result.keypoints)
        setJointAngles(result.angles)
    }, [])

    // Rim detection callback (replaces calibrated rim if confidence high)
    const handleRimDetection = useCallback((rim: { x: number; y: number; width: number; height: number; confidence: number }) => {
        console.log('[WorkoutSession] Rim detected with high confidence - replacing calibrated rim')
        setRimFromDetection(rim)
        // Update tracking engine to update overlay shared values
        tracking.setHoopFromCalibration(rim.x, rim.y, rim.width, rim.height)
    }, [tracking])

    // Ball detection callback (trackingState for events only, visual data via SharedValue/Skia)
    const handleBallDetection = useCallback((detection: BallDetection) => {
        const ball = detection.ball
        const rim = detection.rim
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

        const oldState = tracking.getState()
        const newState = tracking.processFrame(
            ball ? { x: ball.x, y: ball.y, width: ball.width, height: ball.height, confidence: ball.confidence } : null,
            rimForTracking ? { x: rimForTracking.x, y: rimForTracking.y, width: rimForTracking.width, height: rimForTracking.height, confidence: rimForTracking.confidence } : null,
            detection.timestamp,
            poseKeypoints,
            detection.ballSizeCategory,
            detection.adaptiveThreshold
        )
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
            setTrackingState({ ...newState })
        }
        
        if (ball || rimForTracking) {
            frameBatch.current.push({
                frameTimestamp:   detection.timestamp,
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
            })
        }
    }, [tracking, calibration, rimFromDetection])

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
            const shot = await addShotEvent(sessionId, user.id, {
                timestampMs: Date.now(), shotResult: result, ...coords,
                releaseAngle:        metrics.releaseAngle,
                detectionConfidence: state.confidence,
                trackingData: JSON.stringify({
                    autoDetected: true,
                    arcHeight:    metrics.arcHeight,
                    smoothness:   metrics.smoothness,
                }),
            })
            if (Object.keys(jointAngles).length > 0) {
                await savePoseAnalysis(sessionId, user.id, {
                    shotEventId:   shot.id,
                    ...jointAngles,
                    releaseAngle:  metrics.releaseAngle,
                    releaseHeight: metrics.arcHeight,
                    shotSmoothness: metrics.smoothness,
                })
            }
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

    // Screenshot capture function
    const captureShotScreenshot = useCallback(async (shotNumber: number) => {
        if (!cameraViewRef.current) return
        try {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
            const uri = await captureRef(cameraViewRef, {
                format: 'jpg',
                quality: 0.9,
                result: 'tmpfile',
            })
            const asset = await MediaLibrary.createAssetAsync(uri)
            console.log('[WorkoutSession] Screenshot captured:', asset.uri)
            return { asset, timestamp, shotNumber }
        } catch (error) {
            console.error('[WorkoutSession] Failed to capture screenshot:', error)
            return null
        }
    }, [])

    // Save screenshot with final result name
    const saveScreenshotWithResult = useCallback(async (screenshotData: any, result: ShotResult) => {
        try {
            const resultLabel = result === 'MADE' ? `CANESTRO_${screenshotData.shotNumber}` : 'FAIL'
            const filename = `MVPiQ_Shot_${resultLabel}_${screenshotData.timestamp}.jpg`
            let album = await MediaLibrary.getAlbumAsync('MVPiQ Hoops')
            if (!album) {
                album = await MediaLibrary.createAlbumAsync('MVPiQ Hoops', screenshotData.asset, false)
            } else {
                await MediaLibrary.addAssetsToAlbumAsync([screenshotData.asset], album, false)
            }
            console.log('[WorkoutSession] Screenshot saved to album:', filename)
        } catch (error) {
            console.error('[WorkoutSession] Failed to save screenshot to album:', error)
        }
    }, [])

    // Shot event callback
    const handleShotEvent = useCallback(async (event: ShotEvent) => {
        console.log('[WorkoutSession] Shot event:', event)
        if (event.shotReleased) {
            shotCounter.current += 1
            const screenshotData = await captureShotScreenshot(shotCounter.current)
            if (screenshotData) {
                pendingScreenshotUri.current = JSON.stringify(screenshotData)
            }
        } else if (event.shotMade) {
            void handleAutoShotDetected('MADE')
            if (pendingScreenshotUri.current) {
                const data = JSON.parse(pendingScreenshotUri.current)
                void saveScreenshotWithResult(data, 'MADE')
                pendingScreenshotUri.current = null
            }
        } else if (event.shotMiss) {
            void handleAutoShotDetected('MISS')
            if (pendingScreenshotUri.current) {
                const data = JSON.parse(pendingScreenshotUri.current)
                void saveScreenshotWithResult(data, 'MISS')
                pendingScreenshotUri.current = null
            }
        }
    }, [handleAutoShotDetected, captureShotScreenshot, saveScreenshotWithResult])

    // Session Video Recording Functions (v5 API migration needed)
    const startSessionVideoRecording = useCallback(async () => {
        console.warn('[WorkoutSession] Video recording not yet migrated to v5 API')
        showError('Funzione non disponibile', 'La registrazione video richiede migrazione all\'API v5.')
    }, [showError])

    const stopSessionVideoRecording = useCallback(async () => {
        console.warn('[WorkoutSession] Video recording not yet migrated to v5 API')
        setIsVideoRecording(false)
        isVideoRecordingRef.current = false
    }, [])

    const toggleSessionVideoRecording = useCallback(() => {
        if (isVideoRecording) {
            void stopSessionVideoRecording()
        } else {
            void startSessionVideoRecording()
        }
    }, [isVideoRecording, startSessionVideoRecording, stopSessionVideoRecording])

    // useCameraPipeline integration
    const rimFromCalibration = React.useMemo(() =>
        calibration?.hoopCenter
            ? { x: calibration.hoopCenter.x, y: calibration.hoopCenter.y, width: 0.05, height: 0.05 }
            : null
    , [calibration?.hoopCenter?.x, calibration?.hoopCenter?.y])

    // Use detected rim if available, otherwise use calibrated rim
    const effectiveRim = rimFromDetection || rimFromCalibration

    // Kalman filtered ball data from tracking state
    const kalmanFilteredBall = React.useMemo(() => {
        if (trackingState && trackingState.ballPosition && trackingState.ballVelocity) {
            return {
                x: trackingState.ballPosition.x,
                y: trackingState.ballPosition.y,
                vx: trackingState.ballVelocity.vx,
                vy: trackingState.ballVelocity.vy,
            }
        }
        return null
    }, [trackingState?.ballPosition, trackingState?.ballVelocity])

    // useCameraPipeline integration
    const {
        device,
        hasPermission,
        isActive,
        requestPermission,
        setIsActive,
        frameOutput,
        isModelReady,
        resetShotTracking,
        yoloFps,
        moveNetFps,
    } = useCameraPipeline(
        handleBallDetection,
        handlePoseResult,
        handleShotEvent,
        rimDetectionEnabled ? handleRimDetection : undefined,
        effectiveRim,
        kalmanFilteredBall,
        true, // enabled
        poseEnabled,
        ballEnabled,
        rimDetectionEnabled,
        yoloDelegate,
        poseDelegate,
        effectiveYoloModelId,
        effectiveResolution,
        effectiveFps,
        effectivePoseResolution,
        effectiveMoveNetModelId
    )

    // Store resetShotTracking in ref for use in callbacks defined before useCameraPipeline
    resetShotTrackingRef.current = resetShotTracking

    // Update FPS metrics every second from worker SharedValues
    useEffect(() => {
        const fpsInterval = setInterval(() => {
            setFpsMetrics({
                yoloFps: Math.round(yoloFps?.value ?? 0),
                moveNetFps: Math.round(moveNetFps?.value ?? 0),
            })
        }, 1000)
        return () => clearInterval(fpsInterval)
    }, [yoloFps, moveNetFps])

    // Request media library permissions for screenshots
    useEffect(() => {
        void (async () => {
            const { status } = await MediaLibrary.requestPermissionsAsync()
            if (status !== 'granted') {
                console.warn('[WorkoutSession] Media library permission not granted')
            }
        })()
    }, [])

    // Lifecycle
    useEffect(() => {
        void loadSession()
        batchTimer.current = setInterval(flushFrameBatch, 2000)

        return () => {
            isActiveRef.current = false
            setIsActive(false)
            if (batchTimer.current) clearInterval(batchTimer.current)
        }
    }, [])

    // Avvio: quando il modello è pronto
    useEffect(() => {
        console.log('[WorkoutSession] isModelReady:', isModelReady)
        setModelsReady(isModelReady)
    }, [isModelReady])

    const loadSession = async () => {
        if (!user?.id || !sessionId) return
        try {
            const s = await getWorkoutSession(sessionId, user.id)
            setSession(s)
            setIsActive(true) // Activate camera when session loads
            setShotCount({ total: s.totalShots, made: s.madeShots })
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
        } catch (e: any) { showError('Errore', e.message) }
    }

    // Usiamo una ref per sessionId/userId per evitare stale closures nel timer
    const sessionIdRef = useRef(sessionId)
    const userIdRef    = useRef(user?.id)
    useEffect(() => { sessionIdRef.current = sessionId }, [sessionId])
    useEffect(() => { userIdRef.current    = user?.id  }, [user?.id])

    const flushFrameBatch = useCallback(async () => {
        const sid = sessionIdRef.current
        const uid = userIdRef.current
        if (!uid || !sid || frameBatch.current.length === 0) return
        const batch = [...frameBatch.current]
        frameBatch.current = []
        // Send all frames in the batch to preserve data granularity
        for (const frame of batch) {
            try { await saveFrameData(sid, uid, frame) } catch (_) {}
        }
    }, [])

    const handleManualShot = async (result: ShotResult) => {
        if (!user?.id || !sessionId || isRecording) return
        setIsRecording(true)
        try {
            const state  = tracking.getState()
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
            console.log('[Manual Shot] Payload:', payload)
            await addShotEvent(sessionId, user.id, payload)
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
        } catch (e: any) {
            console.error('[Manual Shot] Error:', e)
            console.error('[Manual Shot] Error response:', e.response?.data)
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
                    await stopSessionVideoRecording()
                }
                await flushFrameBatch()
                
                // Log telemetry summary before ending session
                telemetryLogger.logTestSummary(yoloFps?.value ?? 0, moveNetFps?.value ?? 0)
                
                // Export telemetry summary for saving with session
                const telemetrySummary = telemetryLogger.exportTestSummary(yoloFps?.value ?? 0, moveNetFps?.value ?? 0)
                console.log('[WorkoutSession] Telemetry Summary:', telemetrySummary)
                
                await endWorkoutSession(sessionId, user!.id)
                navigation.replace('ShotChart', { sessionId, fromSession: true })
            } catch (e: any) { showError('Errore', e.message) }
            finally { setIsEnding(false) }
        })
    }

    const handlePauseResume = async () => {
        if (!user?.id || !sessionId || !session) return
        try {
            if (session.status === 'ACTIVE') {
                await pauseWorkoutSession(sessionId, user.id)
                setSession({ ...session, status: 'PAUSED' })
                setIsActive(false)
            } else {
                await resumeWorkoutSession(sessionId, user.id)
                setSession({ ...session, status: 'ACTIVE' })
                setIsActive(true)
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

    const isPaused    = session?.status === 'PAUSED'
    const fgPct       = shotCount.total > 0 ? ((shotCount.made/shotCount.total)*100).toFixed(0) : '0'
    const streak      = wsStats?.shotStreak ?? 0
    const elbowAngle  = jointAngles.elbowAngle != null ? `${jointAngles.elbowAngle.toFixed(0)}°` : '—'

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <View style={styles.headerTop}>
                    <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerBtn}>
                        <Text style={styles.headerBtnText}>←</Text>
                    </TouchableOpacity>
                    <View style={styles.headerCenter}>
                        <View style={[styles.statusDot, isPaused && styles.statusDotPaused]} />
                        <Text style={styles.headerTitle}>{isPaused ? 'In Pausa' : 'Sessione Attiva'}</Text>
                        {!modelsReady && <Text style={styles.loadingBadge}>⏳ AI...</Text>}
                    </View>
                    <View style={styles.headerRightGroup}>
                        <TouchableOpacity
                            onPress={toggleSessionVideoRecording}
                            style={[
                                styles.recordHeaderBtn,
                                isVideoRecording && styles.recordHeaderBtnActive,
                                (isPaused || isEnding) && styles.btnDisabled,
                            ]}
                            disabled={isPaused || isEnding}
                        >
                            <View style={[styles.recHeaderDot, isVideoRecording && styles.recHeaderDotActive]} />
                            <Text style={[styles.recordHeaderBtnText, isVideoRecording && styles.recordHeaderBtnTextActive]}>
                                {isVideoRecording ? formatVideoDuration(videoDuration) : 'REC'}
                            </Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={handlePauseResume} style={styles.headerBtn}>
                            <Text style={styles.headerBtnText}>{isPaused ? '▶' : '⏸'}</Text>
                        </TouchableOpacity>
                    </View>
                </View>
                <View style={styles.statsRow}>
                    <StatBox label="Tiri"    value={shotCount.total} />
                    <StatBox label="Segnati" value={shotCount.made} highlight />
                    <StatBox label="FG%"     value={`${fgPct}%`} highlight />
                    <StatBox label="Streak"  value={streak > 0 ? `${streak}🔥` : streak} />
                    <StatBox label="Gomito"  value={elbowAngle} />
                </View>
                <View style={styles.wsRow}>
                    <View style={[styles.wsDot, wsStatus==='connected' ? styles.wsDotOn : styles.wsDotOff]} />
                    <Text style={styles.wsText}>{wsStatus==='connected' ? 'Live' : 'Offline'}</Text>
                    <TouchableOpacity
                        onPress={() => {
                            console.log('[Telemetry] Button pressed, current state:', showTelemetry)
                            setShowTelemetry(v => {
                                const newState = !v
                                console.log('[Telemetry] Setting new state:', newState)
                                return newState
                            })
                        }}
                        style={[styles.calDebugBtn, showTelemetry && styles.calDebugBtnOn]}
                    >
                        <Text style={[styles.calBadge, showTelemetry && { color: '#fff' }]}>
                            📊 Tel {showTelemetry ? 'ON' : 'OFF'}
                        </Text>
                    </TouchableOpacity>
                    <View style={[styles.wsDot, modelsReady ? styles.wsDotOn : styles.wsDotOff, {marginLeft:8}]} />
                    <Text style={styles.wsText}>{modelsReady ? 'AI On' : 'AI Off'}</Text>
                </View>
            </View>

            <View style={{ height: CAMERA_H, position: 'relative' }} ref={cameraViewRef} collapsable={false}>
                <Camera
                    ref={cameraRef}
                    style={StyleSheet.absoluteFill}
                    device={device}
                    isActive={isActive && !isPaused}
                    outputs={[frameOutput]}
                    zoom={isActive && !isPaused ? effectiveZoom : undefined}
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
                />

                {/* Telemetry overlay */}
                <TelemetryOverlay
                    visible={showTelemetry}
                    onClose={() => setShowTelemetry(false)}
                    yoloFps={fpsMetrics.yoloFps}
                    moveNetFps={fpsMetrics.moveNetFps}
                    debugMode={debugMode}
                />

                <View style={styles.guideH} pointerEvents="none" />
                <View style={styles.guideV} pointerEvents="none" />

                <View style={styles.trackingBadge} pointerEvents="none">
                    <>
                        <View style={[styles.trackingDot, trackingDotActive && styles.trackingDotActive]} />
                        <Text style={styles.trackingText}>
                            {trackingBadgeText}
                        </Text>
                    </>
                </View>

                {lastShotResult && (
                    <Animated.View style={[styles.shotFeedback, {opacity: feedbackOpacity}]} pointerEvents="none">
                        <Text style={[styles.shotFeedbackText, lastShotResult==='MADE' ? styles.shotMadeText : styles.shotMissText]}>
                            {lastShotResult==='MADE' ? '🏀 CANESTRO!' : '❌ MANCATO'}
                        </Text>
                    </Animated.View>
                )}
            </View>

            <View style={styles.controls}>
                {isPaused && <Text style={styles.pausedLabel}>⏸ Sessione in pausa</Text>}
                <View style={styles.autoRow}>
                    <View style={styles.autoStatus}>
                        <View style={[styles.autoDot, autoDotActive && styles.autoDotActive]} />
                        <Text style={styles.autoLabel}>
                            {autoStatusText}
                        </Text>
                    </View>
                    <TouchableOpacity
                        style={[
                            styles.recControlBtn,
                            isVideoRecording ? styles.recControlBtnActive : styles.recControlBtnIdle,
                            (isPaused || isEnding) && styles.btnDisabled,
                        ]}
                        onPress={toggleSessionVideoRecording}
                        disabled={isPaused || isEnding}
                    >
                        <Text style={styles.recControlBtnText}>
                            {isVideoRecording ? `⏹ Stop REC (${formatVideoDuration(videoDuration)})` : '🔴 Record'}
                        </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={[styles.endBtn, isEnding && styles.endBtnDisabled]}
                        onPress={handleEndSession}
                        disabled={isEnding}
                    >
                        <Text style={styles.endBtnText}>{isEnding ? '...' : '⏹ Fine'}</Text>
                    </TouchableOpacity>
                </View>
                <View style={styles.toggleRow}>
                    <ToggleButton
                        active={ballEnabled}
                        disabled={isPaused || isEnding}
                        labelOn="🏀 Palla"
                        labelOff="🏀 Palla"
                        onPress={() => setBallEnabled(!ballEnabled)}
                    />
                    <ToggleButton
                        active={poseEnabled}
                        disabled={isPaused || isEnding}
                        labelOn="🧍 Pose"
                        labelOff="🧍 Pose"
                        onPress={() => setPoseEnabled(!poseEnabled)}
                    />
                    <ToggleButton
                        active={rimDetectionEnabled}
                        disabled={isPaused || isEnding}
                        labelOn="🏀 Canestro"
                        labelOff="🏀 Canestro"
                        onPress={() => setRimDetectionEnabled(!rimDetectionEnabled)}
                    />
                    <ToggleButton
                        active={debugMode}
                        disabled={isPaused || isEnding}
                        labelOn="🔍 Debug"
                        labelOff="🔍 Debug"
                        onPress={() => setDebugMode(!debugMode)}
                    />
                </View>
                <View style={styles.manualRow}>
                    <Text style={styles.manualLabel}>Correzione:</Text>
                    <TouchableOpacity
                        style={[styles.manualMadeBtn, (isRecording||isPaused) && styles.btnDisabled]}
                        onPress={() => handleManualShot('MADE')}
                        disabled={isRecording||isPaused}
                    >
                        <Text style={styles.manualMadeBtnText}>🏀 Canestro</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={[styles.manualMissBtn, (isRecording||isPaused) && styles.btnDisabled]}
                        onPress={() => handleManualShot('MISS')}
                        disabled={isRecording||isPaused}
                    >
                        <Text style={styles.manualMissBtnText}>❌ Mancato</Text>
                    </TouchableOpacity>
                </View>
            </View>
            <CustomAlert {...alert} />
        </View>
    )
}

const styles = StyleSheet.create({
    container:         { flex: 1, backgroundColor: '#0b0f1a' },
    center:            { justifyContent: 'center', alignItems: 'center', padding: 24 },
    header:            { backgroundColor: '#121826', borderBottomWidth: 1, borderBottomColor: '#2a2a2a',
                         paddingHorizontal: 14, paddingTop: Platform.OS==='ios' ? 44 : 12, paddingBottom: 10 },
    headerTop:         { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
    headerBtn:         { width: 36, height: 36, justifyContent: 'center' },
    headerBtnText:     { fontSize: 20, color: '#fff', fontWeight: 'bold' },
    headerCenter:      { flexDirection: 'row', alignItems: 'center', gap: 6 },
    headerTitle:       { fontSize: 14, fontWeight: '700', color: '#fff' },
    headerRightGroup:  { flexDirection: 'row', alignItems: 'center', gap: 6 },
    recordHeaderBtn:   { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(239,68,68,0.15)',
                         borderWidth: 1, borderColor: '#ef4444', borderRadius: 8, paddingHorizontal: 7, paddingVertical: 4 },
    recordHeaderBtnActive: { backgroundColor: '#ef4444' },
    recHeaderDot:      { width: 6, height: 6, borderRadius: 3, backgroundColor: '#ef4444' },
    recHeaderDotActive:{ backgroundColor: '#fff' },
    recordHeaderBtnText: { color: '#ef4444', fontSize: 11, fontWeight: '800' },
    recordHeaderBtnTextActive: { color: '#fff' },
    loadingBadge:      { fontSize: 10, color: '#fbbf24', marginLeft: 6 },
    statusDot:         { width: 8, height: 8, borderRadius: 4, backgroundColor: '#ef4444' },
    statusDotPaused:   { backgroundColor: '#fbbf24' },
    statsRow:          { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 6 },
    statBox:           { alignItems: 'center' },
    statValue:         { fontSize: 20, fontWeight: '800', color: '#fff' },
    statValueHL:       { color: '#ff8c00' },
    statLabel:         { fontSize: 10, color: '#888', marginTop: 1 },
    wsRow:             { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-end' },
    wsDot:             { width: 6, height: 6, borderRadius: 3 },
    wsDotOn:           { backgroundColor: '#4ade80' },
    wsDotOff:          { backgroundColor: '#555' },
    wsText:            { fontSize: 10, color: '#555' },
    calBadge:          { fontSize: 10, color: '#ff8c00', fontWeight: '700' },
    calDebugBtn:       { marginLeft: 6, borderWidth: 1, borderColor: 'rgba(255,140,0,0.4)',
                         borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, backgroundColor: 'transparent' },
    calDebugBtnOn:     { backgroundColor: '#ff8c00' },
    recBanner:         { position: 'absolute', top: 12, right: 12, flexDirection: 'row', alignItems: 'center',
                         backgroundColor: 'rgba(0,0,0,0.85)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20,
                         borderWidth: 1.5, borderColor: '#ef4444' },
    recDotPulsing:     { width: 8, height: 8, borderRadius: 4, backgroundColor: '#ef4444', marginRight: 6 },
    recBannerText:     { color: '#ef4444', fontSize: 11, fontWeight: '900', letterSpacing: 0.5 },
    guideH:            { position: 'absolute', left: 0, right: 0, top: '50%', height: 1, backgroundColor: 'rgba(255,140,0,0.12)' },
    guideV:            { position: 'absolute', top: 0, bottom: 0, left: '50%', width: 1, backgroundColor: 'rgba(255,140,0,0.12)' },
    trackingBadge:     { position: 'absolute', top: 12, left: 12, flexDirection: 'row', alignItems: 'center',
                         backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
    trackingDot:       { width: 7, height: 7, borderRadius: 3.5, backgroundColor: '#555', marginRight: 6 },
    trackingDotActive: { backgroundColor: '#4ade80' },
    trackingText:      { color: '#fff', fontSize: 11, fontWeight: '600' },
    shotFeedback:      { position: 'absolute', top: '28%', left: 0, right: 0, alignItems: 'center' },
    shotFeedbackText:  { fontSize: 32, fontWeight: '900', textShadowColor: 'rgba(0,0,0,0.8)',
                         textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 6 },
    shotMadeText:      { color: '#4ade80' },
    shotMissText:      { color: '#f87171' },
    controls:          { backgroundColor: '#121826', borderTopWidth: 1, borderTopColor: '#2a2a2a', padding: 14 },
    pausedLabel:       { fontSize: 12, color: '#fbbf24', textAlign: 'center', marginBottom: 8, fontWeight: '600' },
    autoRow:           { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
    autoStatus:        { flexDirection: 'row', alignItems: 'center', gap: 7, flex: 1 },
    toggleRow:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', marginBottom: 10 },
    autoDot:           { width: 9, height: 9, borderRadius: 4.5 },
    autoDotActive:     { backgroundColor: '#4ade80' },
    autoDotIdle:       { backgroundColor: '#555' },
    autoLabel:         { fontSize: 12, color: '#aaa', fontWeight: '500' },
    toggleBtn:         { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8, marginRight: 4 },
    toggleBtnOn:       { backgroundColor: 'rgba(34, 197, 94, 0.2)', borderWidth: 1, borderColor: '#22c55e' },
    toggleBtnOff:      { backgroundColor: 'rgba(100, 100, 100, 0.2)', borderWidth: 1, borderColor: '#666' },
    toggleBtnText:     { fontSize: 11, fontWeight: '700' },
    toggleBtnTextOn:   { color: '#22c55e' },
    toggleBtnTextOff:  { color: '#888' },
    recControlBtn:     { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, alignItems: 'center', marginRight: 6 },
    recControlBtnIdle: { backgroundColor: '#2a1515', borderWidth: 1, borderColor: '#ef4444' },
    recControlBtnActive:{ backgroundColor: '#ef4444', borderWidth: 1, borderColor: '#fca5a5' },
    recControlBtnText: { color: '#fff', fontWeight: '800', fontSize: 12 },
    manualRow:         { flexDirection: 'row', alignItems: 'center', gap: 8,
                         borderTopWidth: 1, borderTopColor: '#1e2433', paddingTop: 10 },
    manualLabel:       { fontSize: 11, color: '#555', fontWeight: '600' },
    manualMadeBtn:     { flex: 1, paddingVertical: 9, borderRadius: 10,
                         backgroundColor: '#14301a', borderWidth: 1, borderColor: '#22c55e', alignItems: 'center' },
    manualMadeBtnText: { color: '#22c55e', fontWeight: '700', fontSize: 12 },
    manualMissBtn:     { flex: 1, paddingVertical: 9, borderRadius: 10,
                         backgroundColor: '#2a1414', borderWidth: 1, borderColor: '#ef4444', alignItems: 'center' },
    manualMissBtnText: { color: '#ef4444', fontWeight: '700', fontSize: 12 },
    btnDisabled:       { opacity: 0.4 },
    endBtn:            { backgroundColor: '#1e2433', borderWidth: 1, borderColor: '#555',
                         borderRadius: 10, paddingVertical: 8, paddingHorizontal: 14, alignItems: 'center' },
    endBtnDisabled:    { opacity: 0.5 },
    endBtnText:        { color: '#888', fontWeight: '600', fontSize: 13 },
    permTitle:         { fontSize: 22, fontWeight: '800', color: '#fff', marginBottom: 12 },
    permDesc:          { fontSize: 14, color: '#888', textAlign: 'center', marginBottom: 24, lineHeight: 20 },
    permBtn:           { backgroundColor: '#ff8c00', paddingHorizontal: 28, paddingVertical: 14, borderRadius: 12 },
    permBtnText:       { color: '#fff', fontWeight: '700', fontSize: 16 },
})
