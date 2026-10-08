// src/features/workouts/components/RealtimeBallOverlay.tsx
//
// Skia overlay for real-time ball, hoop, player, and skeleton visualization
// Pure Skia rendering with no React state for optimal performance

import React from 'react'
import { Dimensions, StyleSheet } from 'react-native'
import {
    Canvas, Path as SkiaPath, Circle as SkiaCircle,
    Group, Skia,
} from '@shopify/react-native-skia'
import { useDerivedValue } from 'react-native-reanimated'
import type { PoseKeypoints } from '../types/workouts.types'

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window')
const CAMERA_H = SCREEN_H * 0.52

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

interface RealtimeBallOverlayProps {
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
        playerX: any
        playerY: any
        playerWidth: any
        playerHeight: any
        playerConfidence: any
        ballRejectionReason: any
        rimRejectionReason: any
        // Visual tracking state for debugging
        ballTrackState: any
        ballTrackAge: any
        playerTrackState: any
        playerTrackAge: any
        rimTrackState: any
        rimTrackAge: any
    }
    effectiveResolution: { width: number; height: number }
    poseKeypoints: any
}

// Realtime Ball Overlay (Pure Skia, no React state)
const RealtimeBallOverlay = React.memo(({
    sharedValues,
    effectiveResolution,
    poseKeypoints,
}: RealtimeBallOverlayProps) => {
    const shotTrailPathRef = React.useRef(Skia.Path.Make())

    // Removed hot-path logging to reduce overhead during workout

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

    const ballXPxRaw = useDerivedValue(() => {
        const x = sharedValues?.ballXRaw.value ?? 0
        const y = sharedValues?.ballYRaw.value ?? 0
        const mapped = mapNormalizedToCameraView(x, y, effectiveResolution.width, effectiveResolution.height)
        return mapped.x
    })
    const ballYPxRaw = useDerivedValue(() => {
        const x = sharedValues?.ballXRaw.value ?? 0
        const y = sharedValues?.ballYRaw.value ?? 0
        const mapped = mapNormalizedToCameraView(x, y, effectiveResolution.width, effectiveResolution.height)
        return mapped.y
    })

    const ballRadius = useDerivedValue(() => {
        const ballW = sharedValues?.ballWidth.value ?? 0
        const ballH = sharedValues?.ballHeight.value ?? 0
        const cameraResW = effectiveResolution.width
        const cameraResH = effectiveResolution.height
        const containScale = Math.min(SCREEN_W / cameraResW, CAMERA_H / cameraResH)
        const avgSize = ((ballW * cameraResW) + (ballH * cameraResH)) / 2
        const scaledSize = avgSize * containScale
        return Math.max(8, scaledSize / 2.5)
    })

    const ballRawOpacity = useDerivedValue(() => {
        const hasRaw = (sharedValues?.ballXRaw.value ?? 0) > 0 && (sharedValues?.ballYRaw.value ?? 0) > 0
        return hasRaw ? 1 : 0
    })
    const ballKalmanOpacity = useDerivedValue(() => {
        const hasKalman = (sharedValues?.ballX.value ?? 0) > 0 && (sharedValues?.ballY.value ?? 0) > 0
        return hasKalman ? 1 : 0
    })

    // Ball color based on tracking state
    const ballColor = useDerivedValue(() => {
        const state = sharedValues?.ballTrackState?.value ?? 'LOST'
        if (state === 'DETECTED') return '#FFEB3B' // Yellow
        if (state === 'PREDICTED') return '#F44336' // Red
        return '#F44336' // Red (LOST)
    })
    const isMadeOpacity = useDerivedValue(() => {
        return sharedValues?.shotResult.value === 'MADE' ? 1 : 0
    })

    const trailColor = useDerivedValue(() => {
        const inFlight = sharedValues?.inFlight.value ?? false
        const shotResult = sharedValues?.shotResult.value ?? null
        if (inFlight) return 'rgba(255,140,0,0.90)'
        if (shotResult === 'MADE') return 'rgba(34,197,94,0.90)'
        if (shotResult === 'UNCERTAIN') return 'rgba(234,179,8,0.90)' // Yellow for UNCERTAIN
        if (shotResult) return 'rgba(239,68,68,0.90)' // Red for MISS
        return 'rgba(255,140,0,0.70)'
    })
    const trailGlowColor = useDerivedValue(() => {
        const inFlight = sharedValues?.inFlight.value ?? false
        const shotResult = sharedValues?.shotResult.value ?? null
        if (inFlight) return 'rgba(255,140,0,0.30)'
        if (shotResult === 'MADE') return 'rgba(34,197,94,0.30)'
        if (shotResult === 'UNCERTAIN') return 'rgba(234,179,8,0.30)' // Yellow for UNCERTAIN
        if (shotResult) return 'rgba(239,68,68,0.30)' // Red for MISS
        return 'rgba(255,140,0,0.20)'
    })

    const hoopOvalPath = useDerivedValue(() => {
        const hoopWidthNorm = sharedValues?.hoopWidth.value ?? 0
        const hoopHeightNorm = sharedValues?.hoopHeight.value ?? 0
        const cameraResW = effectiveResolution.width
        const cameraResH = effectiveResolution.height
        const containScale = Math.min(SCREEN_W / cameraResW, CAMERA_H / cameraResH)
        
        const w = hoopWidthNorm > 0 ? (hoopWidthNorm * cameraResW) * containScale : 40
        const h = hoopHeightNorm > 0 ? (hoopHeightNorm * cameraResH) * containScale : 40
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
    })

    // Player bbox from YOLO - returns rect for Skia
    const playerBboxPath = useDerivedValue(() => {
        const playerXVal = sharedValues?.playerX?.value ?? 0
        const playerYVal = sharedValues?.playerY?.value ?? 0
        const playerW = sharedValues?.playerWidth?.value ?? 0
        const playerH = sharedValues?.playerHeight?.value ?? 0

        if (playerXVal === 0 && playerYVal === 0) return Skia.Path.Make()

        // Convert to screen coordinates (playerX/Y are center coordinates from YOLO)
        const topLeft = mapNormalizedToCameraView(playerXVal - playerW/2, playerYVal - playerH/2, effectiveResolution.width, effectiveResolution.height)
        const bottomRight = mapNormalizedToCameraView(playerXVal + playerW/2, playerYVal + playerH/2, effectiveResolution.width, effectiveResolution.height)

        const rect = Skia.XYWHRect(
            topLeft.x,
            topLeft.y,
            bottomRight.x - topLeft.x,
            bottomRight.y - topLeft.y
        )
        return Skia.Path.Make().addRect(rect)
    })

    const playerBboxOpacity = useDerivedValue(() => {
        const playerXVal = sharedValues?.playerX?.value ?? 0
        const playerYVal = sharedValues?.playerY?.value ?? 0
        return (playerXVal > 0 && playerYVal > 0) ? 1 : 0
    })

    // Dynamic colors based on rejection state
    const ballRawColor = useDerivedValue(() => {
        const rejectionReason = sharedValues?.ballRejectionReason?.value ?? ''
        return rejectionReason !== '' ? '#ef4444' : '#ff8c00'
    })
    const ballRawFillColor = useDerivedValue(() => {
        const rejectionReason = sharedValues?.ballRejectionReason?.value ?? ''
        return rejectionReason !== '' ? 'rgba(239,68,68,0.22)' : 'rgba(255,140,0,0.22)'
    })
    
    const hoopColor = useDerivedValue(() => {
        const state = sharedValues?.rimTrackState?.value ?? 'LOST'
        if (state === 'DETECTED') return '#22c55e' // Green
        if (state === 'PREDICTED') return '#F44336' // Red
        return '#F44336' // Red (LOST)
    })
    const hoopFillColor = useDerivedValue(() => {
        const state = sharedValues?.rimTrackState?.value ?? 'LOST'
        if (state === 'DETECTED') return 'rgba(34,197,94,0.18)' // Green
        if (state === 'PREDICTED') return 'rgba(244,67,54,0.18)' // Red
        return 'rgba(244,67,54,0.18)' // Red (LOST)
    })
    
    const playerColor = useDerivedValue(() => {
        const state = sharedValues?.playerTrackState?.value ?? 'LOST'
        if (state === 'DETECTED') return '#FF9800' // Orange
        if (state === 'PREDICTED') return '#F44336' // Red
        return '#F44336' // Red (LOST)
    })
    const playerFillColor = useDerivedValue(() => {
        const state = sharedValues?.playerTrackState?.value ?? 'LOST'
        if (state === 'DETECTED') return 'rgba(255,152,0,0.2)' // Orange
        if (state === 'PREDICTED') return 'rgba(244,67,54,0.2)' // Red
        return 'rgba(244,67,54,0.2)' // Red (LOST)
    })

    // Skeleton segment colors
    const LIMB_COLORS: Record<string, string> = {
        'leftShoulder-rightShoulder': '#a855f7', // viola - spalle
        'leftShoulder-leftElbow': '#ef4444', // rosso - braccio SX
        'leftElbow-leftWrist': '#ef4444',
        'rightShoulder-rightElbow': '#3b82f6', // blu - braccio DX
        'rightElbow-rightWrist': '#3b82f6',
        'leftShoulder-leftHip': '#22c55e', // verde - torso SX
        'rightShoulder-rightHip': '#22c55e', // verde - torso DX
        'leftHip-rightHip': '#eab308', // giallo - bacino
        'leftHip-leftKnee': '#f97316', // arancione - gamba SX
        'leftKnee-leftAnkle': '#f97316',
        'rightHip-rightKnee': '#06b6d4', // ciano - gamba DX
        'rightKnee-rightAnkle': '#06b6d4',
    }

    // Create separate paths for each color group
    const createLimbPath = (connections: Array<[string, string]>) => {
        return useDerivedValue(() => {
            if (!poseKeypoints) return Skia.Path.Make()
            const path = Skia.Path.Make()

            connections.forEach(([kp1Name, kp2Name]) => {
                const kp1 = poseKeypoints[kp1Name as keyof PoseKeypoints]
                const kp2 = poseKeypoints[kp2Name as keyof PoseKeypoints]

                if (kp1 && kp2 && kp1.score > 0.15 && kp2.score > 0.15) {
                    const p1 = mapNormalizedToCameraView(kp1.x, kp1.y, effectiveResolution.width, effectiveResolution.height)
                    const p2 = mapNormalizedToCameraView(kp2.x, kp2.y, effectiveResolution.width, effectiveResolution.height)
                    path.moveTo(p1.x, p1.y)
                    path.lineTo(p2.x, p2.y)
                }
            })

            return path
        })
    }

    const leftArmPath = createLimbPath([['leftShoulder', 'leftElbow'], ['leftElbow', 'leftWrist']])
    const rightArmPath = createLimbPath([['rightShoulder', 'rightElbow'], ['rightElbow', 'rightWrist']])
    const leftLegPath = createLimbPath([['leftHip', 'leftKnee'], ['leftKnee', 'leftAnkle']])
    const rightLegPath = createLimbPath([['rightHip', 'rightKnee'], ['rightKnee', 'rightAnkle']])
    const torsoPath = createLimbPath([['leftShoulder', 'rightShoulder'], ['leftShoulder', 'leftHip'], ['rightShoulder', 'rightHip'], ['leftHip', 'rightHip']])

    const skeletonOpacity = useDerivedValue(() => {
        if (!poseKeypoints) return 0
        const validKeypoints = Object.values(poseKeypoints).filter((kp: any) => kp && kp.score > 0.15).length
        return validKeypoints >= 2 ? 1 : 0
    })

    const shotTrailPath = useDerivedValue(() => {
        const showTrail = sharedValues?.showShotTrail.value ?? false
        const isInFlight = sharedValues?.inFlight.value ?? false
        const shotResult = sharedValues?.shotResult.value ?? null

        // Show trail during flight AND after result (until new shot detected)
        if (!showTrail && !shotResult) return shotTrailPathRef.current

        const trajPoints = sharedValues?.trajectoryPoints.value
        const trajCount = sharedValues?.trajectoryPointCount.value ?? 0

        if (!trajPoints || trajCount < 2) return shotTrailPathRef.current

        const points: Array<{ x: number; y: number }> = []
        const delayPoints = isInFlight ? TRAIL_DELAY_POINTS : 0
        const effectiveCount = Math.max(0, trajCount - delayPoints)

        for (let i = 0; i < effectiveCount; i++) {
            points.push({
                x: trajPoints[i * 2],
                y: trajPoints[i * 2 + 1]
            })
        }

        if (points.length < 2) return shotTrailPathRef.current

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
    })

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
                        color={ballRawFillColor}
                    />
                    <SkiaCircle
                        cx={ballXPxRaw}
                        cy={ballYPxRaw}
                        r={ballRadius}
                        color={ballRawColor} style="stroke" strokeWidth={2.5}
                    />
                </Group>

                <Group opacity={ballKalmanOpacity}>
                    <SkiaCircle
                        cx={ballXPx}
                        cy={ballYPx}
                        r={8}
                        color={ballColor}
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
                        color={hoopFillColor}
                    />
                    <SkiaPath
                        path={hoopOvalPath}
                        color={hoopColor} style="stroke" strokeWidth={2.5}
                    />
                </Group>

                <Group opacity={playerBboxOpacity}>
                    <SkiaPath
                        path={playerBboxPath}
                        color={playerFillColor}
                    />
                    <SkiaPath
                        path={playerBboxPath}
                        color={playerColor} style="stroke" strokeWidth={2}
                    />
                </Group>

                <Group opacity={skeletonOpacity}>
                    {/* Left arm - red */}
                    <SkiaPath path={leftArmPath} color="rgba(239,68,68,0.3)" style="stroke" strokeWidth={4} strokeJoin="round" strokeCap="round" />
                    <SkiaPath path={leftArmPath} color="#ef4444" style="stroke" strokeWidth={2} strokeJoin="round" strokeCap="round" />

                    {/* Right arm - blue */}
                    <SkiaPath path={rightArmPath} color="rgba(59,130,246,0.3)" style="stroke" strokeWidth={4} strokeJoin="round" strokeCap="round" />
                    <SkiaPath path={rightArmPath} color="#3b82f6" style="stroke" strokeWidth={2} strokeJoin="round" strokeCap="round" />

                    {/* Left leg - orange */}
                    <SkiaPath path={leftLegPath} color="rgba(249,115,22,0.3)" style="stroke" strokeWidth={4} strokeJoin="round" strokeCap="round" />
                    <SkiaPath path={leftLegPath} color="#f97316" style="stroke" strokeWidth={2} strokeJoin="round" strokeCap="round" />

                    {/* Right leg - cyan */}
                    <SkiaPath path={rightLegPath} color="rgba(6,182,212,0.3)" style="stroke" strokeWidth={4} strokeJoin="round" strokeCap="round" />
                    <SkiaPath path={rightLegPath} color="#06b6d4" style="stroke" strokeWidth={2} strokeJoin="round" strokeCap="round" />

                    {/* Torso - green */}
                    <SkiaPath path={torsoPath} color="rgba(34,197,94,0.3)" style="stroke" strokeWidth={4} strokeJoin="round" strokeCap="round" />
                    <SkiaPath path={torsoPath} color="#22c55e" style="stroke" strokeWidth={2} strokeJoin="round" strokeCap="round" />
                </Group>
            </Group>
        </Canvas>
    )
})

export default RealtimeBallOverlay
