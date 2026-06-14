// src/features/workouts/screens/WorkoutSessionScreen.tsx
//
// Integrazione completa Opzione A:
//  - react-native-vision-camera v4 (rimpiazza expo-camera)
//  - YOLO11 ball/hoop detection on-device (useBallDetection)
//  - MoveNet pose detection on-device (usePoseDetection)
//  - React Native Skia overlay GPU-accelerated (rimpiazza SVG)
//  - useTrackingEngine Kalman + shot detection automatica
//  - Bottoni manuali come fallback / correzione
//
// Overlay completo:
//  - 🏀 Label "BALL XX%" sopra la palla rilevata
//  - Scia della parabola (appare solo quando inFlight=true, con ritardo N punti)
//  - Skeleton + punti pose del player (MoveNet keypoints)

import React, {
    useState, useContext, useEffect, useCallback, useRef,
} from 'react'
import {
    View, Text, StyleSheet, TouchableOpacity,
    Dimensions, Animated, Easing, Platform,
} from 'react-native'
import {
    Canvas, Path as SkiaPath, Circle as SkiaCircle,
    Group, Line as SkiaLine, vec, Skia,
} from '@shopify/react-native-skia'
import { useDerivedValue } from 'react-native-reanimated'
import { Camera } from 'react-native-vision-camera'
import { AuthContext } from '@/features/auth/context/AuthContext'
import { useCustomAlert, CustomAlert } from '@/shared/components/CustomAlert'
import { useWorkoutWebSocket } from '../hooks/useWorkoutWebSocket'
import { useTrackingEngine } from '../hooks/useTrackingEngine'
import { useCameraPipeline } from '@/vision'
import type { Camera as CameraType } from 'react-native-vision-camera'
import { incrementTrackingUpdates, startPerfMonitor, stopPerfMonitor, incrementOverlayRenders, recordPathBuildTime } from '../hooks/usePerformanceMonitor'
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

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window')
const CAMERA_H = SCREEN_H * 0.52
const COURT_WIDTH_M  = 15.24
const COURT_HEIGHT_M = 28.65
const HOOP_Y_M       = 1.575

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

// ─── Debug overlay calibrazione ───────────────────────────────────────────────
const MODE_LABELS: Record<string, string> = {
    ANGLE_45: '↗ 45°',
    LATERAL:  '→ Lat.',
    FRONTAL:  '↑ Front.',
}

const SessionCalibDebug = ({
    calibration, cameraMode, hoopPosition,
}: {
    calibration: CalibrationData
    cameraMode: CameraMode | undefined
    hoopPosition: { x: number; y: number } | null
}) => (
    <View style={sdbg.panel} pointerEvents="none">
        <Text style={sdbg.title}>
            🔍 CALIBRAZIONE  {cameraMode ? MODE_LABELS[cameraMode] ?? cameraMode : '—'}
        </Text>
        <View style={sdbg.row}>
            <Text style={sdbg.key}>Hoop salvato</Text>
            <Text style={sdbg.val}>
                ({calibration.hoopCenter.x.toFixed(3)}, {calibration.hoopCenter.y.toFixed(3)})
            </Text>
        </View>
        {hoopPosition && (
            <View style={sdbg.row}>
                <Text style={sdbg.key}>Hoop YOLO</Text>
                <Text style={[sdbg.val, { color: '#4ade80' }]}>
                    ({hoopPosition.x.toFixed(3)}, {hoopPosition.y.toFixed(3)})
                </Text>
            </View>
        )}
        <View style={sdbg.row}>
            <Text style={sdbg.key}>Homography</Text>
            <Text style={sdbg.val}>
                {calibration.homographyMatrix.length > 0
                    ? `${calibration.homographyMatrix.length} coeff.`
                    : 'identità'}
            </Text>
        </View>
        {calibration.courtCorners && (
            <View style={sdbg.row}>
                <Text style={sdbg.key}>Campo</Text>
                <Text style={sdbg.val}>4 angoli ✓</Text>
            </View>
        )}
        {hoopPosition && (
            <View style={sdbg.row}>
                <Text style={sdbg.key}>Δ hoop</Text>
                <Text style={[sdbg.val, {
                    color: Math.abs(hoopPosition.x - calibration.hoopCenter.x) < 0.05
                        && Math.abs(hoopPosition.y - calibration.hoopCenter.y) < 0.05
                        ? '#4ade80' : '#fbbf24'
                }]}>
                    dx={Math.abs(hoopPosition.x - calibration.hoopCenter.x).toFixed(3)}
                    {'  '}
                    dy={Math.abs(hoopPosition.y - calibration.hoopCenter.y).toFixed(3)}
                </Text>
            </View>
        )}
    </View>
)

const sdbg = StyleSheet.create({
    panel: {
        position: 'absolute', top: 10, right: 10,
        backgroundColor: 'rgba(0,0,0,0.78)',
        borderRadius: 10, padding: 10,
        borderWidth: 1, borderColor: 'rgba(255,140,0,0.45)',
        minWidth: 180,
    },
    title: { fontSize: 9, fontWeight: '800', color: '#ff8c00',
        letterSpacing: 0.8, marginBottom: 6 },
    row: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 3, gap: 6 },
    key: { fontSize: 9, color: '#888', fontWeight: '600', minWidth: 62 },
    val: { fontSize: 9, color: '#fff', fontWeight: '500', flex: 1 },
})

// ─── Skia Overlay ─────────────────────────────────────────────────────────────
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

// Color map per differenziare gli arti
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

// Color map per le linee del skeleton
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
// Punti di ritardo scia: salta gli ultimi N punti della traiettoria
// per creare l'effetto "cometa — la scia segue la palla con un ritardo visivo"
const TRAIL_DELAY_POINTS = 5

// ── Game-style effects ───────────────────────────────────────────────────────
// Calculate player size from pose keypoints for dynamic circle
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

// Calculate shot power from velocity
const calculateShotPower = (velocity: { vx: number; vy: number } | null): number => {
    if (!velocity) return 0
    const speed = Math.sqrt(velocity.vx * velocity.vx + velocity.vy * velocity.vy)
    // Normalize to 0-100 range for display
    return Math.min(100, Math.round(speed * 20))
}

// Helper function for biomechanical angle coloring
const getAngleColor = (angle: number): string => {
    if (angle >= 80 && angle <= 110) return '#22c55e' // Green: optimal
    if (angle >= 60 && angle <= 130) return '#f59e0b' // Yellow: acceptable
    return '#ef4444' // Red: poor
}

// Helper function for release angle color coding
const getReleaseColor = (angle: number): string => {
    if (angle >= 45 && angle <= 55) return '#22c55e' // Green: optimal
    if (angle >= 35 && angle <= 65) return '#f59e0b' // Yellow: acceptable
    return '#ef4444' // Red: poor
}

const TrackingOverlay = React.memo(({
    trackingState, poseKeypoints, jointAngles, releaseAngle, arcHeight, calibration, sharedValues,
}: {
    trackingState: TrackingState | null
    poseKeypoints: PoseKeypoints | null
    jointAngles?: Partial<JointAngles>
    releaseAngle?: number
    arcHeight?: number
    calibration: CalibrationData | null
    sharedValues?: {
        ballX: any
        ballY: any
        ballWidth: any
        ballHeight: any
        hoopX: any
        hoopY: any
        hoopWidth: any
        hoopHeight: any
        confidence: any
        inFlight: any
        shotDetected: any
    }
}) => {
    incrementOverlayRenders()

    const px = (x: number) => x * SCREEN_W
    const py = (y: number) => y * CAMERA_H

    // Calculate dynamic player size
    const playerSize = calculatePlayerSize(poseKeypoints)
    const shotPower = calculateShotPower(trackingState?.ballVelocity ?? null)

    // Calculate player center position (average of hips)
    const playerCenterX = poseKeypoints?.leftHip && poseKeypoints?.rightHip
        ? (poseKeypoints.leftHip.x + poseKeypoints.rightHip.x) / 2
        : null
    const playerCenterY = poseKeypoints?.leftHip && poseKeypoints?.rightHip
        ? (poseKeypoints.leftHip.y + poseKeypoints.rightHip.y) / 2
        : null

    // Memoize Skia path objects to avoid continuous allocations
    const shotTrailPathRef = React.useRef(Skia.Path.Make())
    const hoopPathRef = React.useRef(Skia.Path.Make())

    // Derived values per Skia (leggono direttamente dai Shared Values - no React bridge)
    const ballX = useDerivedValue(() => sharedValues?.ballX.value ?? 0, [sharedValues])
    const ballY = useDerivedValue(() => sharedValues?.ballY.value ?? 0, [sharedValues])
    const ballWidth = useDerivedValue(() => sharedValues?.ballWidth.value ?? 0, [sharedValues])
    const hoopX = useDerivedValue(() => sharedValues?.hoopX.value ?? 0, [sharedValues])
    const hoopY = useDerivedValue(() => sharedValues?.hoopY.value ?? 0, [sharedValues])
    const hoopWidth = useDerivedValue(() => sharedValues?.hoopWidth.value ?? 0, [sharedValues])
    const hoopHeight = useDerivedValue(() => sharedValues?.hoopHeight.value ?? 0, [sharedValues])

    // Derived values per coordinate pixel
    const ballXPx = useDerivedValue(() => ballX.value * SCREEN_W, [ballX])
    const ballYPx = useDerivedValue(() => ballY.value * CAMERA_H, [ballY])
    const hoopXPx = useDerivedValue(() => hoopX.value * SCREEN_W, [hoopX])
    const hoopYPx = useDerivedValue(() => hoopY.value * CAMERA_H, [hoopY])

    // Scia del tiro:
    //  - durante inFlight: segue la palla con ritardo TRAIL_DELAY_POINTS
    //  - dopo il tiro: mostra l'ultima traiettoria completa per 2.5s
    //  - curva Bezier cubica per avere una parabola liscia invece di segmenti
    const shotTrailPath = React.useMemo(() => {
        const t0 = performance.now()
        const ts = trackingState as any
        if (!ts?.showShotTrail) return null
        const traj   = (ts?.shotTrajectory ?? ts?.trajectory ?? []) as Array<{x:number;y:number}>
        const points = ts?.inFlight
            ? traj.slice(0, Math.max(0, traj.length - TRAIL_DELAY_POINTS))
            : traj
        if (points.length < 2) return null

        // Reuse memoized path instead of creating new one
        const p = shotTrailPathRef.current
        p.reset()
        p.moveTo(px(points[0].x), py(points[0].y))

        if (points.length === 2) {
            // Solo 2 punti: linea retta
            p.lineTo(px(points[1].x), py(points[1].y))
        } else {
            // 3+ punti: curva smooth con cubic Bezier catmull-rom
            for (let i = 0; i < points.length - 1; i++) {
                const p0 = points[Math.max(0, i - 1)]
                const p1 = points[i]
                const p2 = points[i + 1]
                const p3 = points[Math.min(points.length - 1, i + 2)]
                // Tangenti Catmull-Rom → control points Bezier
                const cp1x = px(p1.x) + (px(p2.x) - px(p0.x)) / 6
                const cp1y = py(p1.y) + (py(p2.y) - py(p0.y)) / 6
                const cp2x = px(p2.x) - (px(p3.x) - px(p1.x)) / 6
                const cp2y = py(p2.y) - (py(p3.y) - py(p1.y)) / 6
                p.cubicTo(cp1x, cp1y, cp2x, cp2y, px(p2.x), py(p2.y))
            }
        }
        const t1 = performance.now()
        recordPathBuildTime(t1 - t0)
        return p
    }, [(trackingState as any)?.showShotTrail, (trackingState as any)?.shotTrajectory,
        trackingState?.inFlight, trackingState?.trajectory])

    // Posizione palla in pixel schermo
    const ballSX = trackingState?.ballPosition != null ? px(trackingState.ballPosition.x) : null
    const ballSY = trackingState?.ballPosition != null ? py(trackingState.ballPosition.y) : null

    return (
        <>
            {/* ── Canvas Skia: forme GPU (scia, cerchi, skeleton) ── */}
            <Canvas style={[StyleSheet.absoluteFill, { width: SCREEN_W, height: CAMERA_H }]}>

                {/* ── Dynamic Player Circle (game-style, scales with pose) ── */}
                {playerCenterX !== null && playerCenterY !== null && playerSize > 0 && (
                    <Group>
                        {/* Outer glow ring */}
                        <SkiaCircle
                            cx={px(playerCenterX)}
                            cy={py(playerCenterY) + playerSize * 0.6}
                            r={playerSize * 0.4}
                            color="rgba(59,130,246,0.15)"
                        />
                        {/* Main circle */}
                        <SkiaCircle
                            cx={px(playerCenterX)}
                            cy={py(playerCenterY) + playerSize * 0.6}
                            r={playerSize * 0.3}
                            color="rgba(59,130,246,0.3)"
                        />
                        {/* Inner ring */}
                        <SkiaCircle
                            cx={px(playerCenterX)}
                            cy={py(playerCenterY) + playerSize * 0.6}
                            r={playerSize * 0.3}
                            color="#3b82f6"
                            style="stroke"
                            strokeWidth={2}
                        />
                    </Group>
                )}

                {/* ── Enhanced Ball Trail (game-style with glow) ── */}
                {shotTrailPath && (() => {
                    const ts = trackingState as any
                    const color = ts?.inFlight
                        ? 'rgba(255,140,0,0.90)'
                        : ts?.shotResult === 'MADE'
                            ? 'rgba(34,197,94,0.90)'
                            : ts?.shotResult
                                ? 'rgba(239,68,68,0.90)'
                                : 'rgba(255,140,0,0.70)'
                    const glowColor = ts?.inFlight
                        ? 'rgba(255,140,0,0.30)'
                        : ts?.shotResult === 'MADE'
                            ? 'rgba(34,197,94,0.30)'
                            : ts?.shotResult
                                ? 'rgba(239,68,68,0.30)'
                                : 'rgba(255,140,0,0.20)'
                    return (
                        <Group>
                            {/* Glow effect */}
                            <SkiaPath
                                path={shotTrailPath}
                                color={glowColor}
                                style="stroke"
                                strokeWidth={8}
                                strokeJoin="round"
                                strokeCap="round"
                            />
                            {/* Main trail */}
                            <SkiaPath
                                path={shotTrailPath}
                                color={color}
                                style="stroke"
                                strokeWidth={3.5}
                                strokeJoin="round"
                                strokeCap="round"
                            />
                        </Group>
                    )
                })()}

                {/* Cerchio palla smoothed (Kalman) - arancione - usa Shared Values */}
                {sharedValues && (
                    <Group>
                        <SkiaCircle
                            cx={ballXPx}
                            cy={ballYPx}
                            r={useDerivedValue(() => ballWidth.value > 0 ? (ballWidth.value * SCREEN_W) / 2 : 16, [ballWidth])}
                            color="rgba(255,140,0,0.22)"
                        />
                        <SkiaCircle
                            cx={ballXPx}
                            cy={ballYPx}
                            r={useDerivedValue(() => ballWidth.value > 0 ? (ballWidth.value * SCREEN_W) / 2 : 16, [ballWidth])}
                            color="#ff8c00" style="stroke" strokeWidth={2.5}
                        />
                    </Group>
                )}

                {/* Punto raw YOLO (senza Kalman) - rosso per debug */}
                {trackingState?.ballPositionRaw && (
                    <SkiaCircle
                        cx={px(trackingState.ballPositionRaw.x)}
                        cy={py(trackingState.ballPositionRaw.y)}
                        r={8}
                        color="#ff0000"
                    />
                )}

                {/* ── Hoop with Illumination Effect (game-style) ── */}
                {sharedValues && (
                    <Group>
                        {/* Illumination effect when basket is made */}
                        {(trackingState as any)?.shotResult === 'MADE' && (
                            <Group>
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
                        )}
                        {/* Dynamic hoop circle based on detected dimensions (like ball) */}
                        <SkiaCircle
                            cx={hoopXPx}
                            cy={hoopYPx}
                            r={useDerivedValue(() => hoopWidth.value > 0 ? (hoopWidth.value * SCREEN_W) / 2 : 20, [hoopWidth])}
                            color="rgba(74,222,128,0.18)"
                        />
                        <SkiaCircle
                            cx={hoopXPx}
                            cy={hoopYPx}
                            r={useDerivedValue(() => hoopWidth.value > 0 ? (hoopWidth.value * SCREEN_W) / 2 : 20, [hoopWidth])}
                            color="#4ade80" style="stroke" strokeWidth={2.5}
                        />
                    </Group>
                )}

                {/* Righe del campo dalla calibrazione */}
                {calibration?.courtLines && calibration.courtLines.length > 0 && (
                    <Group>
                        {calibration.courtLines.map((line: { start: { x: number; y: number }; end: { x: number; y: number } }, i: number) => {
                            const start = line.start
                            const end = line.end
                            return (
                                <SkiaLine
                                    key={i}
                                    p1={vec(px(start.x), py(start.y))}
                                    p2={vec(px(end.x), py(end.y))}
                                    color="rgba(255,255,255,0.4)"
                                    strokeWidth={2}
                                    strokeCap="round"
                                />
                            )
                        })}
                    </Group>
                )}

                {/* Release Point */}
                {trackingState?.releasePoint && (
                    <Group>
                        <SkiaCircle
                            cx={px(trackingState.releasePoint.x)}
                            cy={py(trackingState.releasePoint.y)}
                            r={14} color="rgba(250,204,21,0.22)"
                        />
                        <SkiaCircle
                            cx={px(trackingState.releasePoint.x)}
                            cy={py(trackingState.releasePoint.y)}
                            r={14} color="#facc15" style="stroke" strokeWidth={2}
                        />
                    </Group>
                )}

                {/* Apex Point */}
                {trackingState?.apexPoint && (
                    <Group>
                        <SkiaCircle
                            cx={px(trackingState.apexPoint.x)}
                            cy={py(trackingState.apexPoint.y)}
                            r={10} color="#22c55e"
                        />
                    </Group>
                )}

                {/* Skeleton pose + punti keypoints */}
                {poseKeypoints && (
                    <Group>
                        {SKELETON_CONNECTIONS.map(([a, b], i) => {
                            const kpA = poseKeypoints[a]
                            const kpB = poseKeypoints[b]
                            if (!kpA || !kpB || kpA.score < KP_THRESH || kpB.score < KP_THRESH) return null
                            const connectionKey = `${a}-${b}`
                            const lineColor = CONNECTION_COLORS[connectionKey] || 'rgba(96,165,250,0.80)'
                            return (
                                <SkiaLine
                                    key={i}
                                    p1={vec(px(kpA.x), py(kpA.y))}
                                    p2={vec(px(kpB.x), py(kpB.y))}
                                    color={lineColor}
                                    strokeWidth={2.5}
                                />
                            )
                        })}
                        {(Object.entries(poseKeypoints) as Array<[keyof PoseKeypoints, {x:number;y:number;score:number}]>)
                            .filter(([_, kp]) => kp?.score >= KP_THRESH)
                            .map(([key, kp]) => {
                                const colors = KP_COLORS[key]
                                if (!colors) return null
                                return (
                                    <Group key={key}>
                                        <SkiaCircle
                                            cx={px(kp.x)} cy={py(kp.y)}
                                            r={7} color={colors.glow}
                                        />
                                        <SkiaCircle
                                            cx={px(kp.x)} cy={py(kp.y)}
                                            r={4.5} color={colors.main}
                                        />
                                        <SkiaCircle
                                            cx={px(kp.x)} cy={py(kp.y)}
                                            r={4.5} color="rgba(255,255,255,0.6)"
                                            style="stroke" strokeWidth={1.2}
                                        />
                                    </Group>
                                )
                            })
                        }
                    </Group>
                )}
            </Canvas>

            {/* ── Label BALL (React Native Text, sopra il canvas) ── */}
            {trackingState?.ballPosition && ballSX !== null && ballSY !== null && (
                <View
                    pointerEvents="none"
                    style={[ovStyles.ballLabelWrap, {
                        left: ballSX - 32,
                        top:  ballSY - 44,
                    }]}
                >
                    <View style={ovStyles.ballLabelBox}>
                        <Text style={ovStyles.ballLabelText}>
                            🏀 {Math.round((trackingState.confidence ?? 0) * 100)}%
                        </Text>
                    </View>
                </View>
            )}

            {/* ── Game-style Shot Power Badge ── */}
            {(trackingState as any)?.inFlight && shotPower > 0 && (
                <View pointerEvents="none" style={ovStyles.powerBadge}>
                    <Text style={ovStyles.powerText}>
                        ⚡ {shotPower}%
                    </Text>
                </View>
            )}

            {/* ── Game-style Parabola Angle Badge ── */}
            {releaseAngle != null && (trackingState as any)?.inFlight && (
                <View pointerEvents="none" style={ovStyles.angleBadge}>
                    <Text style={{
                        color: getReleaseColor(releaseAngle),
                        fontWeight: '900',
                        fontSize: 12,
                    }}>
                        📐 {Math.round(releaseAngle)}°
                    </Text>
                </View>
            )}

            {/* ── Badge IN VOLO / TIRO RILEVATO ── */}
            {((trackingState as any)?.showShotTrail) && (
                <View pointerEvents="none" style={ovStyles.inFlightBadge}>
                    <Text style={ovStyles.inFlightText}>
                        {(trackingState as any)?.inFlight ? '✈ IN VOLO' : trackingState?.shotResult === 'MADE' ? '🟢 CANESTRO' : '🔴 MANCATO'}
                    </Text>
                </View>
            )}

            {/* ── BIOMECHANICS PANEL ── */}
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

            {/* ── Release Angle Badge ── */}
            {trackingState?.releaseAngle != null && (
                <View pointerEvents="none" style={ovStyles.releaseAngleBadge}>
                    <Text style={{
                        color: getReleaseColor(trackingState.releaseAngle),
                        fontWeight: '900'
                    }}>
                        ↗ {Math.round(trackingState.releaseAngle)}°
                    </Text>
                </View>
            )}

            {/* ── Shot Quality Score ── */}
            {trackingState?.shotQuality != null && (
                <View pointerEvents="none" style={ovStyles.qualityBadge}>
                    <Text style={ovStyles.qualityText}>
                        🎯 {Math.round(trackingState.shotQuality)}
                    </Text>
                </View>
            )}

            {/* ── Shot Analytics Card ── */}
            {trackingState?.shotResult && (
                <View pointerEvents="none" style={ovStyles.analyticsCard}>
                    <Text style={ovStyles.analyticsTitle}>🏀 SHOT ANALYSIS</Text>

                    {releaseAngle != null && (
                        <View style={ovStyles.analyticsRow}>
                            <Text style={ovStyles.analyticsLabel}>Release Angle</Text>
                            <Text style={ovStyles.analyticsValue}>{releaseAngle.toFixed(0)}°</Text>
                        </View>
                    )}

                    {arcHeight != null && (
                        <View style={ovStyles.analyticsRow}>
                            <Text style={ovStyles.analyticsLabel}>Arc Height</Text>
                            <Text style={ovStyles.analyticsValue}>{arcHeight.toFixed(2)}m</Text>
                        </View>
                    )}

                    {jointAngles?.elbowAngle != null && (
                        <View style={ovStyles.analyticsRow}>
                            <Text style={ovStyles.analyticsLabel}>Elbow</Text>
                            <Text style={ovStyles.analyticsValue}>{jointAngles.elbowAngle.toFixed(0)}°</Text>
                        </View>
                    )}

                    {jointAngles?.kneeAngle != null && (
                        <View style={ovStyles.analyticsRow}>
                            <Text style={ovStyles.analyticsLabel}>Knee</Text>
                            <Text style={ovStyles.analyticsValue}>{jointAngles.kneeAngle.toFixed(0)}°</Text>
                        </View>
                    )}

                    {releaseAngle != null && releaseAngle >= 45 && releaseAngle <= 55 && (
                        <Text style={ovStyles.analyticsFeedback}>✓ Ottimo rilascio</Text>
                    )}
                </View>
            )}

            {/* ── Label HOOP ── */}
            {trackingState?.hoopPosition && (
                <View
                    pointerEvents="none"
                    style={[ovStyles.hoopLabelWrap, {
                        left: px(trackingState.hoopPosition.x) - 22,
                        top:  py(trackingState.hoopPosition.y) + 24,
                    }]}
                >
                    <Text style={ovStyles.hoopLabelText}>🏀 CANESTRO</Text>
                </View>
            )}

            {/* ── Label RELEASE POINT ── */}
            {trackingState?.releasePoint && (
                <View
                    pointerEvents="none"
                    style={[
                        ovStyles.markerLabel,
                        {
                            left: px(trackingState.releasePoint.x) + 16,
                            top: py(trackingState.releasePoint.y) - 12,
                        },
                    ]}
                >
                    <Text style={ovStyles.releaseLabel}>🚀 RELEASE</Text>
                </View>
            )}

            {/* ── Label APEX POINT ── */}
            {trackingState?.apexPoint && (
                <View
                    pointerEvents="none"
                    style={[
                        ovStyles.markerLabel,
                        {
                            left: px(trackingState.apexPoint.x) + 16,
                            top: py(trackingState.apexPoint.y) - 12,
                        },
                    ]}
                >
                    <Text style={ovStyles.apexLabel}>⬆ APEX</Text>
                </View>
            )}

            {/* ── Elbow Angle Live ── */}
            {(() => {
                const elbow = poseKeypoints?.rightElbow ?? poseKeypoints?.leftElbow
                if (elbow && jointAngles?.elbowAngle != null) {
                    return (
                        <View
                            pointerEvents="none"
                            style={{
                                position: 'absolute',
                                left: px(elbow.x) + 10,
                                top: py(elbow.y) - 10,
                            }}
                        >
                            <Text style={{
                                color: getAngleColor(jointAngles.elbowAngle),
                                fontWeight: '900',
                                fontSize: 11,
                            }}>
                                {Math.round(jointAngles.elbowAngle)}°
                            </Text>
                        </View>
                    )
                }
                return null
            })()}

            {/* ── Label POSE KEYPOINTS ── */}
            {poseKeypoints && (Object.entries(poseKeypoints) as Array<[keyof PoseKeypoints, {x:number;y:number;score:number}]>)
                .filter(([_, kp]) => kp?.score >= KP_THRESH)
                .map(([key, kp]) => {
                    const colors = KP_COLORS[key]
                    if (!colors) return null
                    return (
                        <View
                            key={key}
                            pointerEvents="none"
                            style={[ovStyles.kpLabelWrap, {
                                left: px(kp.x) + 12,
                                top:  py(kp.y) - 8,
                            }]}
                        >
                            <Text style={[ovStyles.kpLabelText, { color: colors.main }]}>
                                {colors.label}
                            </Text>
                        </View>
                    )
                })
            }
        </>
    )
})

const ovStyles = StyleSheet.create({
    // Label BALL
    ballLabelWrap: {
        position: 'absolute',
        alignItems: 'center',
        minWidth: 64,
    },
    ballLabelBox: {
        backgroundColor: 'rgba(0,0,0,0.72)',
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 10,
        borderWidth: 1.5,
        borderColor: '#ff8c00',
    },
    ballLabelText: {
        color: '#ff8c00',
        fontSize: 11,
        fontWeight: '800',
        letterSpacing: 0.3,
    },
    // Badge IN VOLO
    inFlightBadge: {
        position: 'absolute',
        bottom: 14,
        left: 14,
        backgroundColor: 'rgba(255,140,0,0.12)',
        paddingHorizontal: 12,
        paddingVertical: 5,
        borderRadius: 12,
        borderWidth: 1.5,
        borderColor: 'rgba(255,140,0,0.70)',
    },
    inFlightText: {
        color: '#ff8c00',
        fontSize: 11,
        fontWeight: '900',
        letterSpacing: 1,
    },
    // Shot Power Badge
    powerBadge: {
        position: 'absolute',
        bottom: 60,
        left: 14,
        backgroundColor: 'rgba(0,0,0,0.75)',
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 10,
        borderWidth: 1.5,
        borderColor: 'rgba(255,165,0,0.8)',
    },
    powerText: {
        color: '#ffa500',
        fontSize: 12,
        fontWeight: '900',
        letterSpacing: 0.5,
    },
    // Parabola Angle Badge
    angleBadge: {
        position: 'absolute',
        bottom: 60,
        left: 80,
        backgroundColor: 'rgba(0,0,0,0.75)',
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 10,
        borderWidth: 1.5,
        borderColor: 'rgba(147,51,234,0.8)',
    },
    // Biomechanics Panel
    bioPanel: {
        position: 'absolute',
        top: 14,
        right: 14,
        backgroundColor: 'rgba(0,0,0,0.72)',
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
    // Release Angle Badge
    releaseAngleBadge: {
        position: 'absolute',
        bottom: 14,
        left: 14,
        backgroundColor: 'rgba(0,0,0,0.75)',
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 10,
    },
    // Shot Quality Badge
    qualityBadge: {
        position: 'absolute',
        top: 14,
        left: 14,
        backgroundColor: 'rgba(0,0,0,0.80)',
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 10,
    },
    qualityText: {
        color: '#22c55e',
        fontSize: 13,
        fontWeight: '800',
    },
    // Shot Analytics Card
    analyticsCard: {
        position: 'absolute',
        top: 80,
        left: 14,
        backgroundColor: 'rgba(0,0,0,0.85)',
        borderRadius: 16,
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.15)',
        minWidth: 180,
    },
    analyticsTitle: {
        color: '#fff',
        fontSize: 12,
        fontWeight: '800',
        marginBottom: 8,
    },
    analyticsRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginVertical: 2,
    },
    analyticsLabel: {
        color: 'rgba(255,255,255,0.7)',
        fontSize: 10,
        fontWeight: '600',
    },
    analyticsValue: {
        color: '#fff',
        fontSize: 10,
        fontWeight: '700',
    },
    analyticsFeedback: {
        color: '#22c55e',
        fontSize: 10,
        fontWeight: '700',
        marginTop: 6,
    },
    // Label HOOP
    hoopLabelWrap: {
        position: 'absolute',
    },
    hoopLabelText: {
        color: '#4ade80',
        fontSize: 9,
        fontWeight: '700',
        letterSpacing: 0.4,
        backgroundColor: 'rgba(0,0,0,0.55)',
        paddingHorizontal: 5,
        paddingVertical: 2,
        borderRadius: 6,
    },
    // Marker Label
    markerLabel: {
        position: 'absolute',
    },
    // Label RELEASE POINT
    releaseLabel: {
        color: '#facc15',
        fontSize: 10,
        fontWeight: '900',
    },
    // Label APEX POINT
    apexLabel: {
        color: '#22c55e',
        fontSize: 10,
        fontWeight: '900',
    },
    // Label POSE KEYPOINTS
    kpLabelWrap: {
        position: 'absolute',
    },
    kpLabelText: {
        fontSize: 8,
        fontWeight: '700',
        letterSpacing: 0.2,
        backgroundColor: 'rgba(0,0,0,0.65)',
        paddingHorizontal: 4,
        paddingVertical: 2,
        borderRadius: 4,
    },
})

// ─── StatBox ──────────────────────────────────────────────────────────────────
const StatBox = ({ label, value, highlight }: { label: string; value: any; highlight?: boolean }) => (
    <View style={styles.statBox}>
        <Text style={[styles.statValue, highlight && styles.statValueHL]}>{value}</Text>
        <Text style={styles.statLabel}>{label}</Text>
    </View>
)

// ─── Schermata ────────────────────────────────────────────────────────────────
export default function WorkoutSessionScreen({ navigation, route }: any) {
    const { sessionId, cameraMode } = route.params || {}
    const { user } = useContext(AuthContext) || {}

    const [session, setSession]             = useState<WorkoutSession | null>(null)
    const [calibration, setCalibration]     = useState<CalibrationData | null>(null)
    const [isEnding, setIsEnding]           = useState(false)
    const [isRecording, setIsRecording]     = useState(false)
    const isRecordingRef = useRef(false)
    const [shotCount, setShotCount]         = useState({ total: 0, made: 0 })
    const [trackingState, setTrackingState] = useState<TrackingState | null>(null)
    const [poseKeypoints, setPoseKeypoints] = useState<PoseKeypoints | null>(null)
    const [jointAngles, setJointAngles]     = useState<Partial<JointAngles>>({})
    const [lastShotResult, setLastShotResult] = useState<ShotResult | null>(null)
    const [modelsReady, setModelsReady]     = useState(false)
    const [showCalibDebug, setShowCalibDebug] = useState(false)
    const [rimFromDetection, setRimFromDetection] = useState<{ x: number; y: number; width: number; height: number; confidence: number } | null>(null)

    const { alert, showError, showWarning } = useCustomAlert()
    const { stats: wsStats, status: wsStatus } = useWorkoutWebSocket(sessionId ?? null, user?.id ?? null)
    const tracking = useTrackingEngine()
    const { sharedValues } = tracking
    const feedbackOpacity = useRef(new Animated.Value(0)).current
    const isActiveRef     = useRef(true)
    // Sync isRecordingRef con lo state (per evitare stale closure)
    useEffect(() => { isRecordingRef.current = isRecording }, [isRecording])
    const rafRef          = useRef<number | null>(null)
    const frameBatch      = useRef<any[]>([])
    const batchTimer      = useRef<ReturnType<typeof setInterval> | null>(null)
    const cameraRef       = useRef<CameraType>(null)
    const lastUiUpdate    = useRef<number>(0)

    // Performance monitoring - tracking state updates
    useEffect(() => {
        startPerfMonitor()
        return () => stopPerfMonitor()
    }, [])

    // ── Pose callback (new architecture) ─────────────────────────────────────
    const handlePoseResult = useCallback((result: PoseResult) => {
        console.log('[WorkoutSession] Pose keypoints:', Object.keys(result.keypoints).length, 'joints')
        setPoseKeypoints(result.keypoints)
        setJointAngles(result.angles)
    }, [])

    // ── Rim detection callback - sostituisce rim calibrato se confidence alta ──
    const handleRimDetection = useCallback((rim: { x: number; y: number; width: number; height: number; confidence: number }) => {
        console.log('[WorkoutSession] Rim detected with high confidence - replacing calibrated rim')
        setRimFromDetection(rim)
        // Also update tracking engine directly to update overlay shared values
        tracking.setHoopFromCalibration(rim.x, rim.y, rim.width, rim.height)
    }, [tracking])

    // ── Ball detection callback (new architecture) ────────────────────────
    const handleBallDetection = useCallback((detection: BallDetection) => {
        const ball = detection.ball
        if (ball) {
            console.log('[BallDetection] Ball detected - confidence:', ball.confidence, 'x:', ball.x, 'y:', ball.y, 'width:', ball.width, 'height:', ball.height)
        }
        const rim = detection.rim
        if (rim) {
            console.log('[BallDetection] Rim detected - confidence:', rim.confidence, 'x:', rim.x, 'y:', rim.y, 'width:', rim.width, 'height:', rim.height)
        }
        // Rim comes from calibration, keep coordinates normalized (0-1)
        const rimFromCalibration = calibration?.hoopCenter ? {
            x: calibration.hoopCenter.x,
            y: calibration.hoopCenter.y,
            width: 0.05, // Normalized width
            height: 0.05, // Normalized height
            confidence: 1.0,
        } : null

        const newState = tracking.processFrame(
            ball ? { x: ball.x, y: ball.y, width: ball.width, height: ball.height, confidence: ball.confidence } : null,
            rimFromCalibration ? { x: rimFromCalibration.x, y: rimFromCalibration.y, confidence: rimFromCalibration.confidence } : null,
            detection.timestamp
        )
        // Aggiorna l'overlay direttamente — non aspettare il RAF loop
        incrementTrackingUpdates()
        // Throttle UI updates to 15 FPS (66ms) to reduce React renders
        const now = Date.now()
        if (now - lastUiUpdate.current > 66) {
            lastUiUpdate.current = now
            setTrackingState({ ...newState })
        }
        if (ball || rimFromCalibration) {
            frameBatch.current.push({
                frameTimestamp:   detection.timestamp,
                ballX:            ball ? ball.x : undefined,
                ballY:            ball ? ball.y : undefined,
                ballWidth:        ball ? ball.width : undefined,
                ballHeight:       ball ? ball.height : undefined,
                ballConfidence:   ball?.confidence,
                hoopX:            rimFromCalibration ? rimFromCalibration.x : undefined,
                hoopY:            rimFromCalibration ? rimFromCalibration.y : undefined,
                hoopConfidence:   rimFromCalibration?.confidence,
                ballVelocityX:    newState.ballVelocity?.vx,
                ballVelocityY:    newState.ballVelocity?.vy,
                shotDetected:     newState.shotDetected,
                trajectoryData:   { points: newState.trajectory.slice(-10) },
            })
        }
    }, [tracking, calibration])

    // ── Auto shot detection handler (must be defined before handleShotEvent) ─────
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
        } catch (e: any) { showError('Errore tiro', e.message) }
        finally { isRecordingRef.current = false; setIsRecording(false) }
    }, [user?.id, sessionId, tracking, calibration, jointAngles])

    // ── Shot event callback (new architecture) ───────────────────────────
    const handleShotEvent = useCallback((event: ShotEvent) => {
        console.log('[WorkoutSession] Shot event:', event)
        if (event.shotMade) {
            void handleAutoShotDetected('MADE')
        } else if (event.shotReleased) {
            // Shot released but not yet determined if made
            // Could trigger intermediate UI feedback
        }
    }, [handleAutoShotDetected])

    // ── New architecture: useCameraPipeline integrates everything ─────────
    const rimFromCalibration = React.useMemo(() =>
        calibration?.hoopCenter
            ? { x: calibration.hoopCenter.x, y: calibration.hoopCenter.y, width: 0.05, height: 0.05 }
            : null
    , [calibration?.hoopCenter?.x, calibration?.hoopCenter?.y])

    // Usa il rim rilevato dal modello se disponibile, altrimenti usa quello calibrato
    // Mantieni l'ultima rilevazione positiva invece di tornare alla calibrazione
    const effectiveRim = rimFromDetection || rimFromCalibration

    const {
        device,
        hasPermission,
        isActive,
        requestPermission,
        setIsActive,
        frameProcessor,
        isModelReady,
    } = useCameraPipeline(
        handleBallDetection,
        handlePoseResult,
        handleShotEvent,
        handleRimDetection,
        effectiveRim,
        true
    )

    // ── Lifecycle ─────────────────────────────────────────────────────────
    useEffect(() => {
        void loadSession()
        batchTimer.current = setInterval(flushFrameBatch, 2000)
        
        const rafLoop = () => {
            if (!isActiveRef.current) return
            const s = tracking.getState()
            // Throttle UI updates to 15 FPS (66ms) to reduce React renders
            const now = Date.now()
            if (now - lastUiUpdate.current > 66) {
                lastUiUpdate.current = now
                setTrackingState(prev => {
                    if (!prev) return s
                    // Aggiorna solo se qualcosa è cambiato (evita re-render inutili)
                    if (
                        prev.shotDetected !== s.shotDetected ||
                        prev.inFlight     !== s.inFlight     ||
                        prev.ballPosition?.x !== s.ballPosition?.x ||
                        prev.confidence      !== s.confidence ||
                        prev.trajectory.length !== s.trajectory.length
                    ) return s
                    return prev
                })
            }
            rafRef.current = requestAnimationFrame(rafLoop)
        }
        rafRef.current = requestAnimationFrame(rafLoop)

        return () => {
            isActiveRef.current = false
            setIsActive(false)
            if (batchTimer.current) clearInterval(batchTimer.current)
            if (rafRef.current)     cancelAnimationFrame(rafRef.current)
        }
    }, [])

    // Avvio: quando il modello è pronto
    useEffect(() => {
        console.log('[WorkoutSession] isModelReady:', isModelReady)
        setModelsReady(isModelReady)
    }, [isModelReady])

    useEffect(() => {
        if (trackingState?.shotDetected && trackingState.shotResult)
            void handleAutoShotDetected(trackingState.shotResult)
    }, [trackingState?.shotDetected])

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
        const last = frameBatch.current[frameBatch.current.length - 1]
        frameBatch.current = []
        try { await saveFrameData(sid, uid, last) } catch (_) {}
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
            await addShotEvent(sessionId, user.id, {
                timestampMs: Date.now(), shotResult: result, ...coords,
                detectionConfidence: 1.0,
                trackingData: JSON.stringify({ manualEntry: true }),
            })
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
        } catch (e: any) { showError('Errore', e.message) }
        finally { setIsRecording(false) }
    }

    const handleEndSession = () => {
        showWarning('Termina Sessione', 'Sei sicuro di voler terminare?', async () => {
            setIsEnding(true)
            try {
                await flushFrameBatch()
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
                    <TouchableOpacity onPress={handlePauseResume} style={styles.headerBtn}>
                        <Text style={styles.headerBtnText}>{isPaused ? '▶' : '⏸'}</Text>
                    </TouchableOpacity>
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
                    {calibration && (
                        <TouchableOpacity
                            onPress={() => setShowCalibDebug(v => !v)}
                            style={[styles.calDebugBtn, showCalibDebug && styles.calDebugBtnOn]}
                        >
                            <Text style={[styles.calBadge, showCalibDebug && { color: '#fff' }]}>
                                🔍 Cal {showCalibDebug ? 'ON' : 'OFF'}
                            </Text>
                        </TouchableOpacity>
                    )}
                    <View style={[styles.wsDot, modelsReady ? styles.wsDotOn : styles.wsDotOff, {marginLeft:8}]} />
                    <Text style={styles.wsText}>{modelsReady ? 'AI On' : 'AI Off'}</Text>
                </View>
            </View>

            <View style={{ height: CAMERA_H }}>
                <Camera
                    ref={cameraRef}
                    style={StyleSheet.absoluteFill}
                    device={device}
                    isActive={isActive && !isPaused}
                    frameProcessor={frameProcessor}
                    onError={(error) => {
                        if (error.code === 'session/invalid-output-configuration') {
                            console.log('[WorkoutSession] Camera session error - remounting')
                            setIsActive(false)
                            setTimeout(() => setIsActive(true), 500)
                        }
                    }}
                />

                {/* Overlay completo: scia + palla + canestro + pose */}
                <TrackingOverlay
                    trackingState={trackingState}
                    poseKeypoints={poseKeypoints}
                    jointAngles={jointAngles}
                    releaseAngle={trackingState?.releaseAngle}
                    arcHeight={trackingState?.releasePoint && trackingState?.apexPoint
                        ? trackingState.releasePoint.y - trackingState.apexPoint.y
                        : undefined}
                    calibration={calibration}
                    sharedValues={sharedValues}
                />

                {/* Debug overlay calibrazione */}
                {showCalibDebug && calibration && (
                    <SessionCalibDebug
                        calibration={calibration}
                        cameraMode={cameraMode}
                        hoopPosition={trackingState?.hoopPosition ?? null}
                    />
                )}

                <View style={styles.guideH} pointerEvents="none" />
                <View style={styles.guideV} pointerEvents="none" />

                <View style={styles.trackingBadge} pointerEvents="none">
                    <View style={[styles.trackingDot, trackingState?.ballPosition && styles.trackingDotActive]} />
                    <Text style={styles.trackingText}>
                        {trackingState?.ballPosition
                            ? `🏀 ${Math.round((trackingState.confidence??0)*100)}%`
                            : modelsReady ? 'Cerca palla...' : 'Caricamento AI...'}
                    </Text>
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
                        <View style={[styles.autoDot, trackingState?.ballPosition ? styles.autoDotActive : styles.autoDotIdle]} />
                        <Text style={styles.autoLabel}>
                            {!modelsReady             ? 'Caricamento modelli AI...' :
                             trackingState?.inFlight  ? '✈ Tiro rilevato — scia attiva' :
                             trackingState?.ballPosition ? 'Rilevamento automatico attivo' : 'In attesa della palla…'}
                        </Text>
                    </View>
                    <TouchableOpacity
                        style={[styles.endBtn, isEnding && styles.endBtnDisabled]}
                        onPress={handleEndSession}
                        disabled={isEnding}
                    >
                        <Text style={styles.endBtnText}>{isEnding ? '...' : '⏹ Fine'}</Text>
                    </TouchableOpacity>
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
    guideH:            { position: 'absolute', left: 0, right: 0, top: '50%', height: 1, backgroundColor: 'rgba(255,140,0,0.12)' },
    guideV:            { position: 'absolute', top: 0, bottom: 0, left: '50%', width: 1, backgroundColor: 'rgba(255,140,0,0.12)' },
    trackingBadge:     { position: 'absolute', top: 12, left: 12, flexDirection: 'row', alignItems: 'center',
                         backgroundColor: 'rgba(0,0,0,0.65)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
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
    autoDot:           { width: 9, height: 9, borderRadius: 4.5 },
    autoDotActive:     { backgroundColor: '#4ade80' },
    autoDotIdle:       { backgroundColor: '#555' },
    autoLabel:         { fontSize: 12, color: '#aaa', fontWeight: '500' },
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
