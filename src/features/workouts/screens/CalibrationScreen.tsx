// src/features/workouts/screens/CalibrationScreen.tsx
//
// Calibrazione campo con overlay SVG realistici per ogni angolazione:
//   - ANGLE_45: vista a 45° laterale — campo con prospettiva diagonale
//   - LATERAL:  vista laterale pura — palo + tabellone + traiettoria arco
//   - FRONTAL:  vista frontale dal fondo — paint + tabellone centrato

import React, { useState, useContext, useEffect, useRef, useCallback } from 'react'
import {
    View, Text, StyleSheet, TouchableOpacity,
    Dimensions, ScrollView, Platform,
} from 'react-native'
import Svg, {
    Circle, Line, Polygon, Rect, Path, Defs,
    LinearGradient, Stop, G, Text as SvgText, Ellipse,
} from 'react-native-svg'
import { Camera, useCameraDevice, useCameraPermission, type CameraRef } from 'react-native-vision-camera'
import { Picker } from '@react-native-picker/picker'
import { useIsFocused } from '@react-navigation/native'
import { AuthContext } from '@/features/auth/context/AuthContext'
import { CameraMode, CalibrationData, CourtType } from '../types/workouts.types'
import { saveCourtCalibration } from '../api/workouts.api'
import { useCustomAlert, CustomAlert } from '@/shared/components/CustomAlert'
import {
    ANDROID_DELEGATE_OPTIONS,
    DEFAULT_ANDROID_DELEGATE,
    DEFAULT_IOS_DELEGATE,
    type AndroidDelegateOption,
    type IosDelegateOption,
} from '@/vision'

const { width: SW, height: SH } = Dimensions.get('window')
const CAM_H = SH * 0.52
const MIN_CAPTURE = { width: 1280, height: 720 }
const DEFAULT_CAPTURE = { width: 1280, height: 720 }
const DEFAULT_FPS = 15

interface Point { x: number; y: number }
type CalibStep = 'hoop' | 'corners' | 'done'

// ─── Overlay 45° ─────────────────────────────────────────────────────────────
// Campo da basket visto a 45° laterale: prospettiva diagonale
// Il canestro è in alto a destra, il campo si estende verso sinistra/basso
const Overlay45 = ({ hoopCenter, corners, step }: {
    hoopCenter: Point | null, corners: Point[], step: CalibStep
}) => {
    const W = SW, H = CAM_H
    const ghostHoop = { x: W * 0.70, y: H * 0.28 }

    // Punti campo in prospettiva 45°
    const courtPts = {
        // Linea di fondo (vicina)
        bl: { x: W * 0.04, y: H * 0.87 },
        br: { x: W * 0.96, y: H * 0.76 },
        // Linea di fondo (lontana / tiro libero)
        tl: { x: W * 0.20, y: H * 0.38 },
        tr: { x: W * 0.82, y: H * 0.28 },
        // Paint
        pl1: { x: W * 0.30, y: H * 0.87 },
        pl2: { x: W * 0.42, y: H * 0.50 },
        pr1: { x: W * 0.55, y: H * 0.83 },
        pr2: { x: W * 0.62, y: H * 0.48 },
        // Tiro libero
        ftl: { x: W * 0.42, y: H * 0.50 },
        ftr: { x: W * 0.62, y: H * 0.48 },
        // Tabellone
        bbl: { x: W * 0.60, y: H * 0.20 },
        bbr: { x: W * 0.76, y: H * 0.18 },
        bbtl: { x: W * 0.61, y: H * 0.13 },
        bbtr: { x: W * 0.77, y: H * 0.11 },
    }

    const line = (p1: Point, p2: Point, color = 'rgba(255,255,255,0.28)', w = 1.5, dash?: string) => (
        <Line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y}
              stroke={color} strokeWidth={w} strokeDasharray={dash} />
    )

    // Arco 3pt in prospettiva (approssimato con segmenti)
    const arc3pts = [
        { x: W * 0.04, y: H * 0.75 },
        { x: W * 0.08, y: H * 0.60 },
        { x: W * 0.16, y: H * 0.48 },
        { x: W * 0.28, y: H * 0.40 },
        { x: W * 0.44, y: H * 0.36 },
        { x: W * 0.60, y: H * 0.35 },
        { x: W * 0.72, y: H * 0.33 },
        { x: W * 0.84, y: H * 0.30 },
        { x: W * 0.96, y: H * 0.68 },
    ]

    return (
        <Svg style={StyleSheet.absoluteFill} width={W} height={H} pointerEvents="none">
            <Defs>
                <LinearGradient id="paintFill45" x1="0" y1="0" x2="0" y2="1">
                    <Stop offset="0" stopColor="#ff8c00" stopOpacity="0.03" />
                    <Stop offset="1" stopColor="#ff8c00" stopOpacity="0.10" />
                </LinearGradient>
            </Defs>

            {/* Paint area */}
            <Polygon
                points={`${courtPts.pl1.x},${courtPts.pl1.y} ${courtPts.pr1.x},${courtPts.pr1.y} ${courtPts.pr2.x},${courtPts.pr2.y} ${courtPts.ftr.x},${courtPts.ftr.y} ${courtPts.ftl.x},${courtPts.ftl.y} ${courtPts.pl2.x},${courtPts.pl2.y}`}
                fill="url(#paintFill45)" stroke="rgba(255,140,0,0.20)" strokeWidth={1} />

            {/* Linee perimetro campo */}
            {line(courtPts.bl, courtPts.br)}
            {line(courtPts.bl, courtPts.tl)}
            {line(courtPts.br, courtPts.tr)}
            {line(courtPts.tl, courtPts.tr)}

            {/* Paint */}
            {line(courtPts.pl1, courtPts.pl2)}
            {line(courtPts.pr1, courtPts.pr2)}
            {line(courtPts.ftl, courtPts.ftr)}

            {/* Arco 3pt */}
            {arc3pts.map((p, i) => i > 0 && (
                <Line key={i}
                      x1={arc3pts[i - 1].x} y1={arc3pts[i - 1].y}
                      x2={p.x} y2={p.y}
                      stroke="rgba(255,255,255,0.22)" strokeWidth={1.5}
                      strokeDasharray="5,3" />
            ))}

            {/* Tabellone */}
            {line(courtPts.bbl, courtPts.bbr, 'rgba(255,255,255,0.35)', 1.5)}
            {line(courtPts.bbl, courtPts.bbtl, 'rgba(255,255,255,0.35)', 1.5)}
            {line(courtPts.bbr, courtPts.bbtr, 'rgba(255,255,255,0.35)', 1.5)}
            {line(courtPts.bbtl, courtPts.bbtr, 'rgba(255,255,255,0.35)', 1.5)}
            {/* Rettangolo mira sul tabellone */}
            <Rect
                x={W * 0.64} y={H * 0.14}
                width={W * 0.09} height={H * 0.05}
                fill="none" stroke="rgba(255,255,255,0.40)" strokeWidth={1.5} />

            {/* Canestro — ferro ellisse */}
            <Ellipse
                cx={W * 0.700} cy={H * 0.290}
                rx={W * 0.028} ry={H * 0.012}
                fill="rgba(255,100,0,0.10)"
                stroke="rgba(255,140,0,0.45)" strokeWidth={2} />
            {/* Palo */}
            {line({ x: W * 0.700, y: H * 0.30 }, { x: W * 0.700, y: H * 0.80 },
                'rgba(255,255,255,0.18)', 2)}

            {/* Labels */}
            <SvgText x={W * 0.71} y={H * 0.23} textAnchor="middle"
                     fill="rgba(255,140,0,0.70)" fontSize={10} fontWeight="700">CANESTRO</SvgText>
            <SvgText x={W * 0.46} y={H * 0.67} textAnchor="middle"
                     fill="rgba(255,255,255,0.35)" fontSize={9}>Paint</SvgText>
            <SvgText x={W * 0.14} y={H * 0.55} textAnchor="middle"
                     fill="rgba(255,255,255,0.30)" fontSize={9}>3PT</SvgText>

            {/* Ghost hoop quando non ancora toccato */}
            {!hoopCenter && (
                <G>
                    <Circle cx={ghostHoop.x} cy={ghostHoop.y} r={32}
                            fill="rgba(255,140,0,0.06)" stroke="rgba(255,140,0,0.30)"
                            strokeWidth={1.5} strokeDasharray="5,3" />
                    <Circle cx={ghostHoop.x} cy={ghostHoop.y} r={18}
                            fill="rgba(255,140,0,0.10)" stroke="rgba(255,140,0,0.55)"
                            strokeWidth={2} strokeDasharray="4,3" />
                    <Circle cx={ghostHoop.x} cy={ghostHoop.y} r={4} fill="rgba(255,140,0,0.60)" />
                    <SvgText x={ghostHoop.x} y={ghostHoop.y - 40} textAnchor="middle"
                             fill="rgba(255,140,0,0.90)" fontSize={11} fontWeight="800">👆 tocca qui</SvgText>
                </G>
            )}
            {hoopCenter && <HoopConfirmed p={hoopCenter} />}
            <CornersOverlay corners={corners} step={step} />
        </Svg>
    )
}

// ─── Overlay 45° Full Court ─────────────────────────────────────────────────────
// Campo intero visto a 45° laterale: prospettiva diagonale estesa
const Overlay45Full = ({ hoopCenter, corners, step }: {
    hoopCenter: Point | null, corners: Point[], step: CalibStep
}) => {
    const W = SW, H = CAM_H
    const ghostHoop = { x: W * 0.70, y: H * 0.28 }

    // Punti campo intero in prospettiva 45°
    const courtPts = {
        // Linea di fondo (vicina - nostro canestro)
        bl: { x: W * 0.04, y: H * 0.87 },
        br: { x: W * 0.96, y: H * 0.76 },
        // Linea di fondo (lontana / tiro libero)
        tl: { x: W * 0.20, y: H * 0.38 },
        tr: { x: W * 0.82, y: H * 0.28 },
        // Linea centro campo (estesa per full court)
        cl: { x: W * 0.08, y: H * 0.15 },
        cr: { x: W * 0.92, y: H * 0.12 },
        // Paint
        pl1: { x: W * 0.30, y: H * 0.87 },
        pl2: { x: W * 0.42, y: H * 0.50 },
        pr1: { x: W * 0.55, y: H * 0.83 },
        pr2: { x: W * 0.62, y: H * 0.48 },
        // Tiro libero
        ftl: { x: W * 0.42, y: H * 0.50 },
        ftr: { x: W * 0.62, y: H * 0.48 },
        // Tabellone
        bbl: { x: W * 0.60, y: H * 0.20 },
        bbr: { x: W * 0.76, y: H * 0.18 },
        bbtl: { x: W * 0.61, y: H * 0.13 },
        bbtr: { x: W * 0.77, y: H * 0.11 },
    }

    const line = (p1: Point, p2: Point, color = 'rgba(255,255,255,0.28)', w = 1.5, dash?: string) => (
        <Line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y}
              stroke={color} strokeWidth={w} strokeDasharray={dash} />
    )

    // Arco 3pt in prospettiva (approssimato con segmenti)
    const arc3pts = [
        { x: W * 0.04, y: H * 0.75 },
        { x: W * 0.08, y: H * 0.60 },
        { x: W * 0.16, y: H * 0.48 },
        { x: W * 0.28, y: H * 0.40 },
        { x: W * 0.44, y: H * 0.36 },
        { x: W * 0.60, y: H * 0.35 },
        { x: W * 0.72, y: H * 0.33 },
        { x: W * 0.84, y: H * 0.30 },
        { x: W * 0.96, y: H * 0.68 },
    ]

    return (
        <Svg style={StyleSheet.absoluteFill} width={W} height={H} pointerEvents="none">
            <Defs>
                <LinearGradient id="paintFill45Full" x1="0" y1="0" x2="0" y2="1">
                    <Stop offset="0" stopColor="#ff8c00" stopOpacity="0.03" />
                    <Stop offset="1" stopColor="#ff8c00" stopOpacity="0.10" />
                </LinearGradient>
            </Defs>

            {/* Paint area */}
            <Polygon
                points={`${courtPts.pl1.x},${courtPts.pl1.y} ${courtPts.pr1.x},${courtPts.pr1.y} ${courtPts.pr2.x},${courtPts.pr2.y} ${courtPts.ftr.x},${courtPts.ftr.y} ${courtPts.ftl.x},${courtPts.ftl.y} ${courtPts.pl2.x},${courtPts.pl2.y}`}
                fill="url(#paintFill45Full)" stroke="rgba(255,140,0,0.20)" strokeWidth={1} />

            {/* Linee perimetro campo (full court) */}
            {line(courtPts.bl, courtPts.br)}
            {line(courtPts.bl, courtPts.cl)}
            {line(courtPts.br, courtPts.cr)}
            {line(courtPts.cl, courtPts.cr)}
            {line(courtPts.tl, courtPts.tr)}

            {/* Paint */}
            {line(courtPts.pl1, courtPts.pl2)}
            {line(courtPts.pr1, courtPts.pr2)}
            {line(courtPts.ftl, courtPts.ftr)}

            {/* Arco 3pt */}
            {arc3pts.map((p, i) => i > 0 && (
                <Line key={i}
                      x1={arc3pts[i - 1].x} y1={arc3pts[i - 1].y}
                      x2={p.x} y2={p.y}
                      stroke="rgba(255,255,255,0.22)" strokeWidth={1.5}
                      strokeDasharray="5,3" />
            ))}

            {/* Linea centro campo */}
            {line(courtPts.cl, courtPts.cr, 'rgba(255,255,255,0.15)', 1.5, '8,4')}

            {/* Tabellone */}
            {line(courtPts.bbl, courtPts.bbr, 'rgba(255,255,255,0.35)', 1.5)}
            {line(courtPts.bbl, courtPts.bbtl, 'rgba(255,255,255,0.35)', 1.5)}
            {line(courtPts.bbr, courtPts.bbtr, 'rgba(255,255,255,0.35)', 1.5)}
            {line(courtPts.bbtl, courtPts.bbtr, 'rgba(255,255,255,0.35)', 1.5)}
            {/* Rettangolo mira sul tabellone */}
            <Rect
                x={W * 0.64} y={H * 0.14}
                width={W * 0.09} height={H * 0.05}
                fill="none" stroke="rgba(255,255,255,0.40)" strokeWidth={1.5} />

            {/* Canestro — ferro ellisse */}
            <Ellipse
                cx={W * 0.700} cy={H * 0.290}
                rx={W * 0.028} ry={H * 0.012}
                fill="rgba(255,100,0,0.10)"
                stroke="rgba(255,140,0,0.45)" strokeWidth={2} />
            {/* Palo */}
            {line({ x: W * 0.700, y: H * 0.30 }, { x: W * 0.700, y: H * 0.80 },
                'rgba(255,255,255,0.18)', 2)}

            {/* Labels */}
            <SvgText x={W * 0.71} y={H * 0.23} textAnchor="middle"
                     fill="rgba(255,140,0,0.70)" fontSize={10} fontWeight="700">CANESTRO</SvgText>
            <SvgText x={W * 0.46} y={H * 0.67} textAnchor="middle"
                     fill="rgba(255,255,255,0.35)" fontSize={9}>Paint</SvgText>
            <SvgText x={W * 0.14} y={H * 0.55} textAnchor="middle"
                     fill="rgba(255,255,255,0.30)" fontSize={9}>3PT</SvgText>
            <SvgText x={W * 0.50} y={H * 0.14} textAnchor="middle"
                     fill="rgba(255,255,255,0.25)" fontSize={8}>CENTRO CAMPO</SvgText>

            {/* Ghost hoop quando non ancora toccato */}
            {!hoopCenter && (
                <G>
                    <Circle cx={ghostHoop.x} cy={ghostHoop.y} r={32}
                            fill="rgba(255,140,0,0.06)" stroke="rgba(255,140,0,0.30)"
                            strokeWidth={1.5} strokeDasharray="5,3" />
                    <Circle cx={ghostHoop.x} cy={ghostHoop.y} r={18}
                            fill="rgba(255,140,0,0.10)" stroke="rgba(255,140,0,0.55)"
                            strokeWidth={2} strokeDasharray="4,3" />
                    <Circle cx={ghostHoop.x} cy={ghostHoop.y} r={4} fill="rgba(255,140,0,0.60)" />
                    <SvgText x={ghostHoop.x} y={ghostHoop.y - 40} textAnchor="middle"
                             fill="rgba(255,140,0,0.90)" fontSize={11} fontWeight="800">👆 tocca qui</SvgText>
                </G>
            )}
            {hoopCenter && <HoopConfirmed p={hoopCenter} />}
            <CornersOverlay corners={corners} step={step} />
        </Svg>
    )
}

// ─── Overlay Laterale ─────────────────────────────────────────────────────────
// Vista perfettamente di lato: palo verticale, tabellone, arco traiettoria
const OverlayLateral = ({ hoopCenter, corners, step }: {
    hoopCenter: Point | null, corners: Point[], step: CalibStep
}) => {
    const W = SW, H = CAM_H
    const ghostHoop = { x: W * 0.76, y: H * 0.34 }

    const F = H * 0.88  // pavimento
    const poleX = W * 0.76
    const poleTop = H * 0.10

    const line = (x1: number, y1: number, x2: number, y2: number,
                  color = 'rgba(255,255,255,0.28)', w = 1.5, dash?: string) => (
        <Line x1={x1} y1={y1} x2={x2} y2={y2}
              stroke={color} strokeWidth={w} strokeDasharray={dash} />
    )

    // Traiettoria parabola del tiro (arco)
    const arcPath = `M ${W * 0.18} ${F * 0.96}
        Q ${W * 0.45} ${H * 0.05} ${poleX} ${H * 0.36}`

    return (
        <Svg style={StyleSheet.absoluteFill} width={W} height={H} pointerEvents="none">
            <Defs>
                <LinearGradient id="floorGrad" x1="0" y1="0" x2="0" y2="1">
                    <Stop offset="0" stopColor="#ffffff" stopOpacity="0" />
                    <Stop offset="1" stopColor="#ffffff" stopOpacity="0.06" />
                </LinearGradient>
            </Defs>

            {/* Pavimento */}
            {line(W * 0.01, F, W * 0.99, F)}

            {/* Linee campo laterali */}
            {/* 3pt */}
            {line(W * 0.06, F, W * 0.06, H * 0.40, 'rgba(255,255,255,0.22)', 1.5, '5,3')}
            {/* Tiro libero */}
            {line(W * 0.28, F, W * 0.28, H * 0.45, 'rgba(255,255,255,0.22)', 1.5, '5,3')}
            {/* Linea fondo */}
            {line(W * 0.78, F, W * 0.78, H * 0.50, 'rgba(255,255,255,0.18)', 1.5)}

            {/* Palo canestro */}
            {line(poleX, F, poleX, poleTop + H * 0.14,
                'rgba(255,255,255,0.30)', 3)}

            {/* Tabellone */}
            <Rect
                x={poleX - W * 0.09} y={poleTop}
                width={W * 0.18} height={H * 0.14}
                fill="rgba(255,255,255,0.06)"
                stroke="rgba(255,255,255,0.40)" strokeWidth={1.5} />
            {/* Rettangolo mira */}
            <Rect
                x={poleX - W * 0.045} y={poleTop + H * 0.048}
                width={W * 0.09} height={H * 0.055}
                fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth={1.5} />

            {/* Ferro canestro */}
            {line(poleX - W * 0.025, H * 0.35, poleX + W * 0.010, H * 0.35,
                'rgba(255,120,0,0.55)', 2.5)}
            <Ellipse cx={poleX - W * 0.010} cy={H * 0.355}
                     rx={W * 0.022} ry={H * 0.010}
                     fill="none" stroke="rgba(255,120,0,0.50)" strokeWidth={2} />

            {/* Rete (semplificata) */}
            {[0, 0.008, -0.008, 0.016, -0.016].map((dx, i) => (
                <Line key={i}
                      x1={poleX - W * 0.010 + W * dx} y1={H * 0.360}
                      x2={poleX - W * 0.010 + W * dx * 0.5} y2={H * 0.420}
                      stroke="rgba(255,255,255,0.20)" strokeWidth={1} />
            ))}

            {/* Traiettoria tiro (arco tratteggiato arancione) */}
            <Path d={arcPath}
                  fill="none" stroke="rgba(255,140,0,0.35)"
                  strokeWidth={1.5} strokeDasharray="6,4" />
            {/* Freccia sulla traiettoria */}
            <SvgText x={W * 0.44} y={H * 0.12} textAnchor="middle"
                     fill="rgba(255,140,0,0.55)" fontSize={14}>↗</SvgText>

            {/* Zona di tiro (rettangolo semitrasparente) */}
            <Rect x={W * 0.01} y={H * 0.75} width={W * 0.38} height={H * 0.13}
                  fill="rgba(255,140,0,0.05)" stroke="rgba(255,140,0,0.15)"
                  strokeWidth={1} strokeDasharray="4,3" />

            {/* Labels */}
            <SvgText x={poleX} y={H * 0.06} textAnchor="middle"
                     fill="rgba(255,140,0,0.75)" fontSize={10} fontWeight="700">CANESTRO</SvgText>
            <SvgText x={W * 0.28} y={H * 0.72} textAnchor="middle"
                     fill="rgba(255,255,255,0.30)" fontSize={9}>T.Libero</SvgText>
            <SvgText x={W * 0.06} y={H * 0.72} textAnchor="middle"
                     fill="rgba(255,255,255,0.28)" fontSize={9}>3PT</SvgText>
            <SvgText x={W * 0.20} y={H * 0.55} textAnchor="middle"
                     fill="rgba(255,140,0,0.45)" fontSize={9}>↗ Tiro</SvgText>

            {!hoopCenter && (
                <G>
                    <Circle cx={ghostHoop.x} cy={ghostHoop.y} r={32}
                            fill="rgba(255,140,0,0.06)" stroke="rgba(255,140,0,0.30)"
                            strokeWidth={1.5} strokeDasharray="5,3" />
                    <Circle cx={ghostHoop.x} cy={ghostHoop.y} r={18}
                            fill="rgba(255,140,0,0.10)" stroke="rgba(255,140,0,0.55)"
                            strokeWidth={2} strokeDasharray="4,3" />
                    <Circle cx={ghostHoop.x} cy={ghostHoop.y} r={4} fill="rgba(255,140,0,0.60)" />
                    <SvgText x={ghostHoop.x} y={ghostHoop.y - 40} textAnchor="middle"
                             fill="rgba(255,140,0,0.90)" fontSize={11} fontWeight="800">👆 tocca qui</SvgText>
                </G>
            )}
            {hoopCenter && <HoopConfirmed p={hoopCenter} />}
            <CornersOverlay corners={corners} step={step} />
        </Svg>
    )
}

// ─── Overlay Laterale Full Court ─────────────────────────────────────────────────
// Vista laterale campo intero: estensione delle linee fino al centro campo
const OverlayLateralFull = ({ hoopCenter, corners, step }: {
    hoopCenter: Point | null, corners: Point[], step: CalibStep
}) => {
    const W = SW, H = CAM_H
    const ghostHoop = { x: W * 0.76, y: H * 0.34 }

    const F = H * 0.88  // pavimento
    const poleX = W * 0.76
    const poleTop = H * 0.10

    const line = (x1: number, y1: number, x2: number, y2: number,
                  color = 'rgba(255,255,255,0.28)', w = 1.5, dash?: string) => (
        <Line x1={x1} y1={y1} x2={x2} y2={y2}
              stroke={color} strokeWidth={w} strokeDasharray={dash} />
    )

    // Traiettoria parabola del tiro (arco)
    const arcPath = `M ${W * 0.18} ${F * 0.96}
        Q ${W * 0.45} ${H * 0.05} ${poleX} ${H * 0.36}`

    return (
        <Svg style={StyleSheet.absoluteFill} width={W} height={H} pointerEvents="none">
            <Defs>
                <LinearGradient id="floorGradFull" x1="0" y1="0" x2="0" y2="1">
                    <Stop offset="0" stopColor="#ffffff" stopOpacity="0" />
                    <Stop offset="1" stopColor="#ffffff" stopOpacity="0.06" />
                </LinearGradient>
            </Defs>

            {/* Pavimento esteso */}
            {line(W * 0.01, F, W * 0.99, F)}

            {/* Linee campo laterali (full court) */}
            {/* 3pt */}
            {line(W * 0.06, F, W * 0.06, H * 0.40, 'rgba(255,255,255,0.22)', 1.5, '5,3')}
            {/* Tiro libero */}
            {line(W * 0.28, F, W * 0.28, H * 0.45, 'rgba(255,255,255,0.22)', 1.5, '5,3')}
            {/* Linea fondo */}
            {line(W * 0.78, F, W * 0.78, H * 0.50, 'rgba(255,255,255,0.18)', 1.5)}
            {/* Linea centro campo */}
            {line(W * 0.01, H * 0.15, W * 0.99, H * 0.15, 'rgba(255,255,255,0.15)', 1.5, '8,4')}

            {/* Palo canestro */}
            {line(poleX, F, poleX, poleTop + H * 0.14,
                'rgba(255,255,255,0.30)', 3)}

            {/* Tabellone */}
            <Rect
                x={poleX - W * 0.09} y={poleTop}
                width={W * 0.18} height={H * 0.14}
                fill="rgba(255,255,255,0.06)"
                stroke="rgba(255,255,255,0.40)" strokeWidth={1.5} />
            {/* Rettangolo mira */}
            <Rect
                x={poleX - W * 0.045} y={poleTop + H * 0.048}
                width={W * 0.09} height={H * 0.055}
                fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth={1.5} />

            {/* Ferro canestro */}
            {line(poleX - W * 0.025, H * 0.35, poleX + W * 0.010, H * 0.35,
                'rgba(255,120,0,0.55)', 2.5)}
            <Ellipse cx={poleX - W * 0.010} cy={H * 0.355}
                     rx={W * 0.022} ry={H * 0.010}
                     fill="none" stroke="rgba(255,120,0,0.50)" strokeWidth={2} />

            {/* Rete (semplificata) */}
            {[0, 0.008, -0.008, 0.016, -0.016].map((dx, i) => (
                <Line key={i}
                      x1={poleX - W * 0.010 + W * dx} y1={H * 0.360}
                      x2={poleX - W * 0.010 + W * dx * 0.5} y2={H * 0.420}
                      stroke="rgba(255,255,255,0.20)" strokeWidth={1} />
            ))}

            {/* Traiettoria tiro (arco tratteggiato arancione) */}
            <Path d={arcPath}
                  fill="none" stroke="rgba(255,140,0,0.35)"
                  strokeWidth={1.5} strokeDasharray="6,4" />
            {/* Freccia sulla traiettoria */}
            <SvgText x={W * 0.44} y={H * 0.12} textAnchor="middle"
                     fill="rgba(255,140,0,0.55)" fontSize={14}>↗</SvgText>

            {/* Zona di tiro (rettangolo semitrasparente) */}
            <Rect x={W * 0.01} y={H * 0.75} width={W * 0.38} height={H * 0.13}
                  fill="rgba(255,140,0,0.05)" stroke="rgba(255,140,0,0.15)"
                  strokeWidth={1} strokeDasharray="4,3" />

            {/* Labels */}
            <SvgText x={poleX} y={H * 0.06} textAnchor="middle"
                     fill="rgba(255,140,0,0.75)" fontSize={10} fontWeight="700">CANESTRO</SvgText>
            <SvgText x={W * 0.28} y={H * 0.72} textAnchor="middle"
                     fill="rgba(255,255,255,0.30)" fontSize={9}>T.Libero</SvgText>
            <SvgText x={W * 0.06} y={H * 0.72} textAnchor="middle"
                     fill="rgba(255,255,255,0.28)" fontSize={9}>3PT</SvgText>
            <SvgText x={W * 0.20} y={H * 0.55} textAnchor="middle"
                     fill="rgba(255,140,0,0.45)" fontSize={9}>↗ Tiro</SvgText>
            <SvgText x={W * 0.50} y={H * 0.12} textAnchor="middle"
                     fill="rgba(255,255,255,0.25)" fontSize={8}>CENTRO CAMPO</SvgText>

            {!hoopCenter && (
                <G>
                    <Circle cx={ghostHoop.x} cy={ghostHoop.y} r={32}
                            fill="rgba(255,140,0,0.06)" stroke="rgba(255,140,0,0.30)"
                            strokeWidth={1.5} strokeDasharray="5,3" />
                    <Circle cx={ghostHoop.x} cy={ghostHoop.y} r={18}
                            fill="rgba(255,140,0,0.10)" stroke="rgba(255,140,0,0.55)"
                            strokeWidth={2} strokeDasharray="4,3" />
                    <Circle cx={ghostHoop.x} cy={ghostHoop.y} r={4} fill="rgba(255,140,0,0.60)" />
                    <SvgText x={ghostHoop.x} y={ghostHoop.y - 40} textAnchor="middle"
                             fill="rgba(255,140,0,0.90)" fontSize={11} fontWeight="800">👆 tocca qui</SvgText>
                </G>
            )}
            {hoopCenter && <HoopConfirmed p={hoopCenter} />}
            <CornersOverlay corners={corners} step={step} />
        </Svg>
    )
}

// ─── Overlay Frontale ─────────────────────────────────────────────────────────
// Vista frontale dal fondo campo: paint simmetrico, tabellone centrato in alto
const OverlayFrontal = ({ hoopCenter, corners, step }: {
    hoopCenter: Point | null, corners: Point[], step: CalibStep
}) => {
    const W = SW, H = CAM_H
    const ghostHoop = { x: W * 0.50, y: H * 0.30 }

    const line = (x1: number, y1: number, x2: number, y2: number,
                  color = 'rgba(255,255,255,0.28)', w = 1.5, dash?: string) => (
        <Line x1={x1} y1={y1} x2={x2} y2={y2}
              stroke={color} strokeWidth={w} strokeDasharray={dash} />
    )

    // Paint simmetrico
    const paintL = W * 0.22, paintR = W * 0.78
    const paintTop = H * 0.43, paintBot = H * 0.87

    // Arco pittura (semicerchio tiro libero)
    const ftR = W * 0.14  // raggio semicerchio
    const ftCx = W * 0.50, ftCy = H * 0.43
    const ftArc = `M ${ftCx - ftR} ${ftCy} A ${ftR} ${ftR * 0.6} 0 0 1 ${ftCx + ftR} ${ftCy}`

    // Arco 3pt frontale (grande)
    const arc3Path = `M ${W * 0.04} ${H * 0.87}
        Q ${W * 0.04} ${H * 0.30} ${W * 0.50} ${H * 0.22}
        Q ${W * 0.96} ${H * 0.30} ${W * 0.96} ${H * 0.87}`

    return (
        <Svg style={StyleSheet.absoluteFill} width={W} height={H} pointerEvents="none">
            <Defs>
                <LinearGradient id="paintFillF" x1="0" y1="0" x2="0" y2="1">
                    <Stop offset="0" stopColor="#ff8c00" stopOpacity="0.04" />
                    <Stop offset="1" stopColor="#ff8c00" stopOpacity="0.12" />
                </LinearGradient>
            </Defs>

            {/* Paint */}
            <Rect x={paintL} y={paintTop} width={paintR - paintL} height={paintBot - paintTop}
                  fill="url(#paintFillF)" stroke="rgba(255,140,0,0.22)" strokeWidth={1.5} />

            {/* Linea di fondo */}
            {line(W * 0.01, H * 0.87, W * 0.99, H * 0.87)}

            {/* Laterali campo */}
            {line(W * 0.01, H * 0.10, W * 0.01, H * 0.87, 'rgba(255,255,255,0.20)')}
            {line(W * 0.99, H * 0.10, W * 0.99, H * 0.87, 'rgba(255,255,255,0.20)')}

            {/* Arco 3pt */}
            <Path d={arc3Path} fill="none"
                  stroke="rgba(255,255,255,0.22)" strokeWidth={1.5} strokeDasharray="6,4" />
            {/* Linee corner 3pt */}
            {line(W * 0.04, H * 0.65, W * 0.04, H * 0.87, 'rgba(255,255,255,0.22)', 1.5)}
            {line(W * 0.96, H * 0.65, W * 0.96, H * 0.87, 'rgba(255,255,255,0.22)', 1.5)}

            {/* Semicerchio tiro libero */}
            <Path d={ftArc} fill="none"
                  stroke="rgba(255,255,255,0.25)" strokeWidth={1.5} />

            {/* Palo canestro */}
            {line(W * 0.50, H * 0.87, W * 0.50, H * 0.46, 'rgba(255,255,255,0.18)', 2.5)}

            {/* Tabellone */}
            <Rect x={W * 0.33} y={H * 0.10}
                  width={W * 0.34} height={H * 0.14}
                  fill="rgba(255,255,255,0.06)"
                  stroke="rgba(255,255,255,0.40)" strokeWidth={1.5} />
            {/* Rettangolo mira */}
            <Rect x={W * 0.39} y={H * 0.147}
                  width={W * 0.22} height={H * 0.065}
                  fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth={1.5} />

            {/* Ferro canestro — ellisse frontale */}
            <Ellipse cx={W * 0.50} cy={H * 0.305}
                     rx={W * 0.065} ry={H * 0.018}
                     fill="rgba(255,100,0,0.08)"
                     stroke="rgba(255,120,0,0.55)" strokeWidth={2.5} />
            {/* Rete */}
            {[-0.04, -0.02, 0, 0.02, 0.04].map((dx, i) => (
                <Line key={i}
                      x1={W * 0.50 + W * dx} y1={H * 0.318}
                      x2={W * 0.50 + W * dx * 0.6} y2={H * 0.385}
                      stroke="rgba(255,255,255,0.18)" strokeWidth={1} />
            ))}
            <Line x1={W * 0.46} y1={H * 0.385} x2={W * 0.54} y2={H * 0.385}
                  stroke="rgba(255,255,255,0.18)" strokeWidth={1} />

            {/* Labels */}
            <SvgText x={W * 0.50} y={H * 0.07} textAnchor="middle"
                     fill="rgba(255,140,0,0.75)" fontSize={10} fontWeight="700">CANESTRO</SvgText>
            <SvgText x={W * 0.50} y={H * 0.66} textAnchor="middle"
                     fill="rgba(255,255,255,0.30)" fontSize={9}>Paint</SvgText>
            <SvgText x={W * 0.10} y={H * 0.60} textAnchor="middle"
                     fill="rgba(255,255,255,0.28)" fontSize={9}>← 3PT</SvgText>
            <SvgText x={W * 0.90} y={H * 0.60} textAnchor="middle"
                     fill="rgba(255,255,255,0.28)" fontSize={9}>3PT →</SvgText>

            {!hoopCenter && (
                <G>
                    <Circle cx={ghostHoop.x} cy={ghostHoop.y} r={36}
                            fill="rgba(255,140,0,0.06)" stroke="rgba(255,140,0,0.30)"
                            strokeWidth={1.5} strokeDasharray="5,3" />
                    <Circle cx={ghostHoop.x} cy={ghostHoop.y} r={20}
                            fill="rgba(255,140,0,0.10)" stroke="rgba(255,140,0,0.55)"
                            strokeWidth={2} strokeDasharray="4,3" />
                    <Circle cx={ghostHoop.x} cy={ghostHoop.y} r={4} fill="rgba(255,140,0,0.60)" />
                    <SvgText x={ghostHoop.x} y={ghostHoop.y - 44} textAnchor="middle"
                             fill="rgba(255,140,0,0.90)" fontSize={11} fontWeight="800">👆 tocca qui</SvgText>
                </G>
            )}
            {hoopCenter && <HoopConfirmed p={hoopCenter} />}
            <CornersOverlay corners={corners} step={step} />
        </Svg>
    )
}

// ─── Overlay Frontale Full Court ─────────────────────────────────────────────────
// Vista frontale campo intero: estensione delle linee fino al centro campo
const OverlayFrontalFull = ({ hoopCenter, corners, step }: {
    hoopCenter: Point | null, corners: Point[], step: CalibStep
}) => {
    const W = SW, H = CAM_H
    const ghostHoop = { x: W * 0.50, y: H * 0.30 }

    const line = (x1: number, y1: number, x2: number, y2: number,
                  color = 'rgba(255,255,255,0.28)', w = 1.5, dash?: string) => (
        <Line x1={x1} y1={y1} x2={x2} y2={y2}
              stroke={color} strokeWidth={w} strokeDasharray={dash} />
    )

    // Paint simmetrico
    const paintL = W * 0.22, paintR = W * 0.78
    const paintTop = H * 0.43, paintBot = H * 0.87

    // Arco pittura (semicerchio tiro libero)
    const ftR = W * 0.14  // raggio semicerchio
    const ftCx = W * 0.50, ftCy = H * 0.43
    const ftArc = `M ${ftCx - ftR} ${ftCy} A ${ftR} ${ftR * 0.6} 0 0 1 ${ftCx + ftR} ${ftCy}`

    // Arco 3pt frontale (grande)
    const arc3Path = `M ${W * 0.04} ${H * 0.87}
        Q ${W * 0.04} ${H * 0.30} ${W * 0.50} ${H * 0.22}
        Q ${W * 0.96} ${H * 0.30} ${W * 0.96} ${H * 0.87}`

    return (
        <Svg style={StyleSheet.absoluteFill} width={W} height={H} pointerEvents="none">
            <Defs>
                <LinearGradient id="paintFillFFull" x1="0" y1="0" x2="0" y2="1">
                    <Stop offset="0" stopColor="#ff8c00" stopOpacity="0.04" />
                    <Stop offset="1" stopColor="#ff8c00" stopOpacity="0.12" />
                </LinearGradient>
            </Defs>

            {/* Paint */}
            <Rect x={paintL} y={paintTop} width={paintR - paintL} height={paintBot - paintTop}
                  fill="url(#paintFillFFull)" stroke="rgba(255,140,0,0.22)" strokeWidth={1.5} />

            {/* Linea di fondo */}
            {line(W * 0.01, H * 0.87, W * 0.99, H * 0.87)}

            {/* Laterali campo (full court) */}
            {line(W * 0.01, H * 0.10, W * 0.01, H * 0.87, 'rgba(255,255,255,0.20)')}
            {line(W * 0.99, H * 0.10, W * 0.99, H * 0.87, 'rgba(255,255,255,0.20)')}

            {/* Linea centro campo */}
            {line(W * 0.01, H * 0.15, W * 0.99, H * 0.15, 'rgba(255,255,255,0.15)', 1.5, '8,4')}

            {/* Arco 3pt */}
            <Path d={arc3Path} fill="none"
                  stroke="rgba(255,255,255,0.22)" strokeWidth={1.5} strokeDasharray="6,4" />
            {/* Linee corner 3pt */}
            {line(W * 0.04, H * 0.65, W * 0.04, H * 0.87, 'rgba(255,255,255,0.22)', 1.5)}
            {line(W * 0.96, H * 0.65, W * 0.96, H * 0.87, 'rgba(255,255,255,0.22)', 1.5)}

            {/* Semicerchio tiro libero */}
            <Path d={ftArc} fill="none"
                  stroke="rgba(255,255,255,0.25)" strokeWidth={1.5} />

            {/* Palo canestro */}
            {line(W * 0.50, H * 0.87, W * 0.50, H * 0.46, 'rgba(255,255,255,0.18)', 2.5)}

            {/* Tabellone */}
            <Rect x={W * 0.33} y={H * 0.10}
                  width={W * 0.34} height={H * 0.14}
                  fill="rgba(255,255,255,0.06)"
                  stroke="rgba(255,255,255,0.40)" strokeWidth={1.5} />
            {/* Rettangolo mira */}
            <Rect x={W * 0.39} y={H * 0.147}
                  width={W * 0.22} height={H * 0.065}
                  fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth={1.5} />

            {/* Ferro canestro — ellisse frontale */}
            <Ellipse cx={W * 0.50} cy={H * 0.305}
                     rx={W * 0.065} ry={H * 0.018}
                     fill="rgba(255,100,0,0.08)"
                     stroke="rgba(255,120,0,0.55)" strokeWidth={2.5} />
            {/* Rete */}
            {[-0.04, -0.02, 0, 0.02, 0.04].map((dx, i) => (
                <Line key={i}
                      x1={W * 0.50 + W * dx} y1={H * 0.318}
                      x2={W * 0.50 + W * dx * 0.6} y2={H * 0.385}
                      stroke="rgba(255,255,255,0.18)" strokeWidth={1} />
            ))}
            <Line x1={W * 0.46} y1={H * 0.385} x2={W * 0.54} y2={H * 0.385}
                  stroke="rgba(255,255,255,0.18)" strokeWidth={1} />

            {/* Labels */}
            <SvgText x={W * 0.50} y={H * 0.07} textAnchor="middle"
                     fill="rgba(255,140,0,0.75)" fontSize={10} fontWeight="700">CANESTRO</SvgText>
            <SvgText x={W * 0.50} y={H * 0.66} textAnchor="middle"
                     fill="rgba(255,255,255,0.30)" fontSize={9}>Paint</SvgText>
            <SvgText x={W * 0.10} y={H * 0.60} textAnchor="middle"
                     fill="rgba(255,255,255,0.28)" fontSize={9}>← 3PT</SvgText>
            <SvgText x={W * 0.90} y={H * 0.60} textAnchor="middle"
                     fill="rgba(255,255,255,0.28)" fontSize={9}>3PT →</SvgText>
            <SvgText x={W * 0.50} y={H * 0.12} textAnchor="middle"
                     fill="rgba(255,255,255,0.25)" fontSize={8}>CENTRO CAMPO</SvgText>

            {!hoopCenter && (
                <G>
                    <Circle cx={ghostHoop.x} cy={ghostHoop.y} r={36}
                            fill="rgba(255,140,0,0.06)" stroke="rgba(255,140,0,0.30)"
                            strokeWidth={1.5} strokeDasharray="5,3" />
                    <Circle cx={ghostHoop.x} cy={ghostHoop.y} r={20}
                            fill="rgba(255,140,0,0.10)" stroke="rgba(255,140,0,0.55)"
                            strokeWidth={2} strokeDasharray="4,3" />
                    <Circle cx={ghostHoop.x} cy={ghostHoop.y} r={4} fill="rgba(255,140,0,0.60)" />
                    <SvgText x={ghostHoop.x} y={ghostHoop.y - 44} textAnchor="middle"
                             fill="rgba(255,140,0,0.90)" fontSize={11} fontWeight="800">👆 tocca qui</SvgText>
                </G>
            )}
            {hoopCenter && <HoopConfirmed p={hoopCenter} />}
            <CornersOverlay corners={corners} step={step} />
        </Svg>
    )
}

// ─── Componenti condivisi ─────────────────────────────────────────────────────
const HoopConfirmed = ({ p }: { p: Point }) => (
    <G>
        <Circle cx={p.x} cy={p.y} r={28}
                fill="rgba(255,140,0,0.15)" stroke="#ff8c00" strokeWidth={2.5} />
        <Circle cx={p.x} cy={p.y} r={6} fill="#ff8c00" />
        {[[-36, 0, -24, 0], [24, 0, 36, 0], [0, -36, 0, -24], [0, 24, 0, 36]].map(([x1, y1, x2, y2], i) => (
            <Line key={i}
                  x1={p.x + x1} y1={p.y + y1} x2={p.x + x2} y2={p.y + y2}
                  stroke="#ff8c00" strokeWidth={2} />
        ))}
        <SvgText x={p.x} y={p.y - 38} textAnchor="middle"
                 fill="#ff8c00" fontSize={11} fontWeight="700">✓ Canestro</SvgText>
    </G>
)

const CornersOverlay = ({ corners, step }: { corners: Point[], step: CalibStep }) => {
    const W = SW, H = CAM_H
    const ghostPositions = [
        { x: W * 0.08, y: H * 0.10 },
        { x: W * 0.92, y: H * 0.10 },
        { x: W * 0.92, y: H * 0.90 },
        { x: W * 0.08, y: H * 0.90 },
    ]
    return (
        <G>
            {/* Angoli confermati */}
            {corners.map((c, i) => (
                <G key={i}>
                    <Circle cx={c.x} cy={c.y} r={16}
                            fill="rgba(74,222,128,0.20)" stroke="#4ade80" strokeWidth={2} />
                    <Circle cx={c.x} cy={c.y} r={4} fill="#4ade80" />
                    <SvgText x={c.x} y={c.y - 22} textAnchor="middle"
                             fill="#4ade80" fontSize={13}>
                        {['↖', '↗', '↘', '↙'][i]}
                    </SvgText>
                </G>
            ))}
            {/* Linee perimetro */}
            {corners.length > 1 && corners.map((c, i) => {
                if (i === 0) return null
                return <Line key={i}
                             x1={corners[i - 1].x} y1={corners[i - 1].y} x2={c.x} y2={c.y}
                             stroke="#4ade80" strokeWidth={1.5} strokeOpacity={0.55} />
            })}
            {corners.length === 4 && (
                <Line x1={corners[3].x} y1={corners[3].y}
                      x2={corners[0].x} y2={corners[0].y}
                      stroke="#4ade80" strokeWidth={1.5} strokeOpacity={0.55} />
            )}
            {/* Ghost angolo successivo */}
            {step === 'corners' && corners.length < 4 && (() => {
                const gc = ghostPositions[corners.length]
                return (
                    <G>
                        <Circle cx={gc.x} cy={gc.y} r={18}
                                fill="rgba(74,222,128,0.07)" stroke="rgba(74,222,128,0.38)"
                                strokeWidth={1.5} strokeDasharray="4,3" />
                        <SvgText x={gc.x} y={gc.y - 26} textAnchor="middle"
                                 fill="rgba(74,222,128,0.65)" fontSize={10} fontWeight="600">
                            👆 angolo {corners.length + 1}
                        </SvgText>
                    </G>
                )
            })()}
        </G>
    )
}

// ─── Schermata principale ─────────────────────────────────────────────────────
const MODE_META: Record<CameraMode, { title: string; icon: string; description: string; tips: string[] }> = {
    ANGLE_45: {
        title: 'Angolo 45°',
        icon: '↗',
        description: 'Camera a 45° laterale — il canestro è visibile a destra nel frame',
        tips: [
            '📍 Camera a 4-5m dal canestro',
            '📐 45° rispetto alla linea di fondo',
            '📏 Altezza: livello spalle (~1.5m)',
            '🎯 Canestro visibile in alto a destra',
        ],
    },
    LATERAL: {
        title: 'Vista Laterale',
        icon: '→',
        description: 'Camera esattamente di lato, allineata con il ferro',
        tips: [
            '📍 90° rispetto alla linea di tiro',
            '📏 Allineata con il ferro (h ~3.05m)',
            '📐 Distanza: 6-8m laterale',
            '🎯 Palo e tabellone a destra',
        ],
    },
    FRONTAL: {
        title: 'Vista Frontale',
        icon: '↑',
        description: 'Camera centrata sotto il canestro, puntata verso il campo',
        tips: [
            '📍 Sotto il canestro, 1-2m oltre il fondo',
            '📐 Puntata verso il centro',
            '🎯 Canestro centrato e in alto',
            '📏 Tutto il paint visibile',
        ],
    },
}

export default function CalibrationScreen({ navigation, route }: any) {
    const { sessionId, cameraMode: rawMode, courtType: rawCourtType } = route.params || {}
    const cameraMode: CameraMode = rawMode || 'ANGLE_45'
    const courtType: 'HALF_COURT' | 'FULL_COURT' = rawCourtType || 'HALF_COURT'
    const { user } = useContext(AuthContext) || {}
    const { hasPermission, requestPermission } = useCameraPermission()
    const device = useCameraDevice('back')

    // Camera configuration state
    // Legato al focus reale della route: con lo stack navigator la schermata
    // resta montata dopo navigation.navigate('WorkoutSession', ...), quindi
    // senza questo la Camera qui restava isActive=true e teneva bindata la
    // fotocamera, impedendo a WorkoutSessionScreen di attivare la sua
    // (schermo nero, 0fps, nessun errore perché il conflitto è silenzioso).
    const isFocused = useIsFocused()
    const isActive = isFocused
    const cameraRef = useRef<CameraRef>(null)
    const [selectedResolution, setSelectedResolution] = useState<{ width: number; height: number } | null>(DEFAULT_CAPTURE)
    const [selectedFps, setSelectedFps] = useState<number | null>(DEFAULT_FPS)
    const [yoloDelegate, setYoloDelegate] = useState<AndroidDelegateOption | IosDelegateOption>(
        Platform.OS === 'android' ? DEFAULT_ANDROID_DELEGATE : DEFAULT_IOS_DELEGATE
    )
    const [poseDelegate, setPoseDelegate] = useState<AndroidDelegateOption | IosDelegateOption>(
        Platform.OS === 'android' ? DEFAULT_ANDROID_DELEGATE : DEFAULT_IOS_DELEGATE
    )
    const hoopCameraPointRef = useRef<Point | null>(null)
    const cornerCameraPointsRef = useRef<Point[]>([])
    const [showConfigPanel, setShowConfigPanel] = useState(false)

    // Get available resolutions and FPS from device
    const availableResolutions = React.useMemo(() => {
        if (!device) return [DEFAULT_CAPTURE]
        try {
            const resolutions = device.getSupportedResolutions('video') || []
            const filtered = resolutions
                .filter((r: { width: number; height: number }) => {
                    const aspect = r.width / r.height
                    return r.width >= MIN_CAPTURE.width &&
                        r.height >= MIN_CAPTURE.height &&
                        Math.abs(aspect - 16 / 9) < 0.08
                })
                .sort((a: any, b: any) => a.width * a.height - b.width * b.height)
            console.log('[Calibration] Available workout resolutions:', filtered)
            return filtered.length ? filtered : [DEFAULT_CAPTURE]
        } catch (e) {
            console.warn('[Calibration] Error getting resolutions:', e)
            return [DEFAULT_CAPTURE]
        }
    }, [device])

    const availableFps = React.useMemo(() => {
        if (!device) return [DEFAULT_FPS]
        try {
            const values = new Set<number>()
            for (const range of device.supportedFPSRanges || []) {
                values.add(range.min)
                values.add(range.max)
            }
            const result = [...values].filter(v => v >= 15 && v <= 30).sort((a, b) => a - b)
            console.log('[Calibration] Available FPS targets:', result)
            return result.length ? result : [DEFAULT_FPS]
        } catch (e) {
            console.warn('[Calibration] Error getting FPS ranges:', e)
            return [DEFAULT_FPS]
        }
    }, [device])

    const constraints = React.useMemo(
        () => selectedFps !== null ? [{ fps: selectedFps }] : [],
        [selectedFps]
    )

    // Available delegates based on platform — sourced from the same
    // constants useShotTracker.ts uses, so this list can't drift out of
    // sync with what's actually valid. No CPU option: it was never a
    // deliberate choice, and 'android-cpu'/'metal' weren't real delegate
    // strings fast-tflite recognizes.
    const availableDelegates = React.useMemo(() => {
        if (Platform.OS === 'android') {
            return ANDROID_DELEGATE_OPTIONS.map(value => ({
                value,
                label: value === 'android-gpu' ? 'GPU (Android)' : 'NNAPI (Android)',
            }))
        } else {
            return [
                { value: DEFAULT_IOS_DELEGATE, label: 'Core ML (iOS)' },
            ]
        }
    }, [])

    // Keep defaults valid when a device exposes a different set of resolutions/FPS.
    useEffect(() => {
        if (availableResolutions.length > 0 &&
            !availableResolutions.some(r => r.width === selectedResolution?.width && r.height === selectedResolution?.height)) {
            setSelectedResolution(availableResolutions[0])
        }
        if (availableFps.length > 0 && !availableFps.includes(selectedFps ?? DEFAULT_FPS)) {
            setSelectedFps(availableFps[0])
        }
    }, [availableResolutions, availableFps])

    // Zoom handling with VisionCamera
    const minZoom = device?.minZoom ?? 1
    const maxZoom = Math.min(device?.maxZoom ?? 5, 5)
    const [zoom, setZoom] = useState(minZoom)

    const [step, setStep] = useState<CalibStep>('hoop')
    const [hoopCenter, setHoopCenter] = useState<Point | null>(null)
    const [corners, setCorners] = useState<Point[]>([])
    const [isSaving, setIsSaving] = useState(false)
    const [savedCalibration, setSavedCalibration] = useState<CalibrationData | null>(null)
    const [isNavigating, setIsNavigating] = useState(false)
    const { alert, showError, showSuccess, showWarning } = useCustomAlert()

    const meta = MODE_META[cameraMode]

    // Early returns for permission/device checks - must be after all hooks
    if (!hasPermission) {
        return (
            <View style={[styles.container, styles.center]}>
                <Text style={styles.permTitle}>📷 Permesso Camera</Text>
                <Text style={styles.permDesc}>Necessario per la calibrazione del campo</Text>
                <TouchableOpacity style={styles.primaryBtn} onPress={requestPermission}>
                    <Text style={styles.primaryBtnText}>Concedi Permesso</Text>
                </TouchableOpacity>
            </View>
        )
    }

    if (!device) {
        return (
            <View style={[styles.container, styles.center]}>
                <Text style={styles.permDesc}>Nessuna camera disponibile</Text>
            </View>
        )
    }

    const viewToCameraPoint = (rawX: number, rawY: number): Point => {
        try {
            const p = cameraRef.current?.convertViewPointToCameraPoint({ x: rawX, y: rawY })
            if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) {
                return { x: Math.max(0, Math.min(1, p.x)), y: Math.max(0, Math.min(1, p.y)) }
            }
        } catch (e) {
            console.warn('[Calibration] View->camera conversion failed:', e)
        }
        return { x: rawX / SW, y: rawY / CAM_H }
    }

    const handleCameraTouch = (event: any) => {
        const { locationX, locationY } = event.nativeEvent
        const cameraPoint = viewToCameraPoint(locationX, locationY)
        if (step === 'hoop') {
            setHoopCenter({ x: locationX, y: locationY })
            hoopCameraPointRef.current = cameraPoint
        } else if (step === 'corners' && corners.length < 4) {
            setCorners(prev => [...prev, { x: locationX, y: locationY }])
            cornerCameraPointsRef.current = [...cornerCameraPointsRef.current, cameraPoint]
            if (corners.length + 1 === 4) setStep('done')
        }
    }

    const handleSave = async () => {
        if (!hoopCenter || !user?.id || !sessionId) {
            showError('Errore', 'Seleziona prima il centro del canestro')
            return
        }
        setIsSaving(true)
        try {
            const normHoop = hoopCameraPointRef.current ?? { x: hoopCenter.x / SW, y: hoopCenter.y / CAM_H }
            let courtCorners
            if (corners.length === 4) {
                const nc = cornerCameraPointsRef.current.length === 4 ? cornerCameraPointsRef.current : corners.map(c => ({ x: c.x / SW, y: c.y / CAM_H }))
                courtCorners = {
                    topLeft: nc[0], topRight: nc[1],
                    bottomRight: nc[2], bottomLeft: nc[3],
                }
            }
            const cal: CalibrationData = {
                homographyMatrix: corners.length === 4 ? [1, 0, 0, 0, 1, 0, 0, 0, 1] : [],
                hoopCenter: normHoop,
                courtCorners,
            }
            await saveCourtCalibration(sessionId, user.id, cal)
            setSavedCalibration(cal)
            showSuccess('✓ Calibrazione salvata', 'Puoi procedere con la sessione')
        } catch (e: unknown) {
            showError('Errore', e instanceof Error ? e.message : 'Impossibile salvare')
        } finally {
            setIsSaving(false)
        }
    }

    const handleProceed = () => {
        // Guard against double-tap: navigation.replace() is not itself
        // reentrancy-safe, and a fast double-tap here was mounting two
        // instances of WorkoutSessionScreen (each with its own Camera +
        // Worklet Runtime) before the first was torn down.
        if (isNavigating) return
        setIsNavigating(true)
        navigation.replace('WorkoutSession', { sessionId, cameraMode, zoom, selectedResolution, selectedFps, yoloDelegate, poseDelegate })
    }

    const handleSkip = () => {
        showWarning(
            'Salta calibrazione',
            'Senza calibrazione il tracking sarà meno preciso.',
            () => {
                if (isNavigating) return
                setIsNavigating(true)
                navigation.replace('WorkoutSession', { sessionId, cameraMode, zoom, selectedResolution, selectedFps, yoloDelegate, poseDelegate })
            }
        )
    }

    const resetAll = () => {
        setCorners([]); cornerCameraPointsRef.current = []; hoopCameraPointRef.current = null; setStep('hoop'); setHoopCenter(null); setSavedCalibration(null); setZoom(minZoom)
    }

    const handleZoomIn = () => {
        setZoom(prev => Math.min(maxZoom, prev + 0.1))
    }

    const handleZoomOut = () => {
        setZoom(prev => Math.max(minZoom, prev - 0.1))
    }

    const CORNER_LABELS = ['Ang. SX alto', 'Ang. DX alto', 'Ang. DX basso', 'Ang. SX basso']
    const stepInfo = {
        hoop: { label: '1/2 — Canestro', hint: 'Tocca il centro del ferro', color: '#ff8c00' },
        corners: { label: '2/2 — Angoli', hint: `${CORNER_LABELS[corners.length] ?? '✓'}`, color: '#4ade80' },
        done: { label: '✓ Completo', hint: 'Tutti i punti definiti', color: '#4ade80' },
    }[step]

    const OverlayComponent =
        cameraMode === 'LATERAL' && courtType === 'FULL_COURT' ? OverlayLateralFull :
            cameraMode === 'LATERAL' ? OverlayLateral :
                cameraMode === 'FRONTAL' && courtType === 'FULL_COURT' ? OverlayFrontalFull :
                    cameraMode === 'FRONTAL' ? OverlayFrontal :
                        courtType === 'FULL_COURT' ? Overlay45Full :
                            Overlay45

    return (
        <View style={styles.container}>
            {/* Header */}
            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation.goBack()}>
                    <Text style={styles.skipText}>← Indietro</Text>
                </TouchableOpacity>
                <View style={styles.headerCenter}>
                    <View style={styles.modeTag}>
                        <Text style={styles.modeTagIcon}>{meta.icon}</Text>
                        <Text style={styles.modeTagText}>{meta.title}</Text>
                    </View>
                    <Text style={[styles.stepLabel, { color: stepInfo.color }]}>{stepInfo.label}</Text>
                </View>
                <TouchableOpacity onPress={resetAll}>
                    <Text style={styles.resetText}>↺</Text>
                </TouchableOpacity>
            </View>

            {/* Camera + overlay */}
            <View style={{ height: CAM_H }} onTouchEnd={handleCameraTouch}>
                <Camera
                    ref={cameraRef}
                    style={StyleSheet.absoluteFill}
                    device={device}
                    isActive={isActive}
                    resizeMode="cover"
                    zoom={zoom}
                    constraints={constraints}
                    onError={(error: any) => {
                        // Race condition nota: setZoomRatio chiamato prima che la sessione
                        // CameraX sia attiva o concorrente. Transitorio e innocuo, non loggarlo.
                        const msg = error?.message || error?.cause?.message || ''
                        if (msg.includes('Camera is not active')) return
                        if (msg.includes('Cancelled due to another zoom value being set')) return
                        console.warn('[Calibration] Camera error:', error)
                    }}
                />
                <OverlayComponent
                    hoopCenter={hoopCenter}
                    corners={corners}
                    step={step}
                />

                {/* Crosshair sottile */}
                <View style={styles.guideH} pointerEvents="none" />
                <View style={styles.guideV} pointerEvents="none" />
                {/* Hint testo */}
                <View style={styles.tapHintWrap} pointerEvents="none">
                    <Text style={styles.tapHintText}>
                        {step === 'hoop'
                            ? hoopCenter ? '✅ Canestro — tocca di nuovo per spostare' : '👆 Tocca il centro del canestro'
                            : step === 'corners'
                                ? `👆 ${CORNER_LABELS[corners.length] ?? 'Completo'}`
                                : '✅ Tutti i punti definiti'}
                    </Text>
                </View>

                {/* Camera config button */}
                <TouchableOpacity
                    style={styles.configBtn}
                    onPress={() => setShowConfigPanel(!showConfigPanel)}
                >
                    <Text style={styles.configBtnText}>⚙️</Text>
                </TouchableOpacity>

                {/* Camera config panel */}
                {showConfigPanel && (
                    <View style={[styles.configPanel, { bottom: 12 }]}>
                        <Text style={styles.configPanelTitle}>Configurazione Camera</Text>
                        <ScrollView style={styles.configPanelScroll} contentContainerStyle={styles.configPanelContent}>
                            {/* Zoom controls */}
                            <View style={styles.configSection}>
                                <Text style={styles.configLabel}>Zoom</Text>
                                <View style={styles.zoomRow}>
                                    <TouchableOpacity
                                        style={styles.zoomBtn}
                                        onPress={handleZoomOut}
                                        disabled={zoom <= minZoom}
                                    >
                                        <Text style={[styles.zoomBtnText, zoom <= minZoom && styles.zoomBtnTextDisabled]}>−</Text>
                                    </TouchableOpacity>
                                    <View style={styles.zoomIndicator}>
                                        <Text style={styles.zoomText}>{Math.round(zoom * 100)}%</Text>
                                    </View>
                                    <TouchableOpacity
                                        style={styles.zoomBtn}
                                        onPress={handleZoomIn}
                                        disabled={zoom >= maxZoom}
                                    >
                                        <Text style={[styles.zoomBtnText, zoom >= maxZoom && styles.zoomBtnTextDisabled]}>+</Text>
                                    </TouchableOpacity>
                                </View>
                            </View>

                            {/* YOLO Delegate selector */}
                            <View style={styles.configSection}>
                                <Text style={styles.configLabel}>YOLO Delegate (Rilevamento palla/ferro)</Text>
                                <View style={styles.pickerWrap}>
                                    <Picker
                                        selectedValue={yoloDelegate}
                                        onValueChange={(value) => {
                                            setYoloDelegate(value)
                                        }}
                                        dropdownIconColor="#ff8c00"
                                        style={styles.picker}
                                    >
                                        {availableDelegates.map(del => (
                                            <Picker.Item key={del.value} label={del.label} value={del.value} />
                                        ))}
                                    </Picker>
                                </View>
                                <Text style={styles.configHint}>Accelerazione hardware per il modello YOLO</Text>
                            </View>

                            {/* Pose Delegate selector */}
                            <View style={styles.configSection}>
                                <Text style={styles.configLabel}>Pose Delegate (Rilevamento corpo)</Text>
                                <View style={styles.pickerWrap}>
                                    <Picker
                                        selectedValue={poseDelegate}
                                        onValueChange={(value) => {
                                            setPoseDelegate(value)
                                        }}
                                        dropdownIconColor="#ff8c00"
                                        style={styles.picker}
                                    >
                                        {availableDelegates.map(del => (
                                            <Picker.Item key={del.value} label={del.label} value={del.value} />
                                        ))}
                                    </Picker>
                                </View>
                                <Text style={styles.configHint}>Accelerazione hardware per il modello Pose</Text>
                            </View>

                            {/* Resolution selector */}
                            <View style={styles.configSection}>
                                <Text style={styles.configLabel}>Risoluzione acquisizione</Text>
                                <View style={styles.pickerWrap}>
                                    <Picker
                                        selectedValue={`${selectedResolution?.width ?? 1280}x${selectedResolution?.height ?? 720}`}
                                        onValueChange={(value) => {
                                            const found = availableResolutions.find(r => `${r.width}x${r.height}` === value)
                                            if (found) setSelectedResolution(found)
                                        }}
                                        dropdownIconColor="#ff8c00"
                                        style={styles.picker}
                                    >
                                        {availableResolutions.map(res => (
                                            <Picker.Item key={`${res.width}x${res.height}`} label={`${res.width} × ${res.height}`} value={`${res.width}x${res.height}`} />
                                        ))}
                                    </Picker>
                                </View>
                                <Text style={styles.configHint}>Minimo 1280 × 720 · default 1280 × 720</Text>
                            </View>

                            {/* FPS selector */}
                            <View style={styles.configSection}>
                                <Text style={styles.configLabel}>FPS desiderati</Text>
                                <View style={styles.pickerWrap}>
                                    <Picker
                                        selectedValue={selectedFps ?? DEFAULT_FPS}
                                        onValueChange={value => setSelectedFps(Number(value))}
                                        dropdownIconColor="#ff8c00"
                                        style={styles.picker}
                                    >
                                        {availableFps.map(fps => (
                                            <Picker.Item key={fps} label={`${fps} FPS`} value={fps} />
                                        ))}
                                    </Picker>
                                </View>
                                <Text style={styles.configHint}>VisionCamera negozia la combinazione compatibile con la risoluzione scelta.</Text>
                            </View>
                        </ScrollView>

                        <TouchableOpacity
                            style={styles.closeConfigButton}
                            onPress={() => setShowConfigPanel(false)}
                        >
                            <Text style={styles.closeConfigButtonText}>Chiudi</Text>
                        </TouchableOpacity>
                    </View>
                )}

            </View>

            {/* Pannello info */}
            <ScrollView style={styles.bottomPanel} contentContainerStyle={{ paddingBottom: 24 }}>
                {/* Card modalità */}
                <View style={styles.modeCard}>
                    <Text style={styles.modeCardTitle}>{meta.icon} {meta.title}</Text>
                    <Text style={styles.modeCardDesc}>{meta.description}</Text>
                    <View style={styles.tipsGrid}>
                        {meta.tips.map((tip, i) => (
                            <Text key={i} style={styles.tipText}>{tip}</Text>
                        ))}
                    </View>
                </View>

                {/* Step buttons */}
                <View style={styles.stepsRow}>
                    <TouchableOpacity
                        style={[styles.stepBtn, step === 'hoop' && styles.stepBtnActive]}
                        onPress={() => setStep('hoop')}
                    >
                        <Text style={[styles.stepBtnNum, { color: hoopCenter ? '#4ade80' : '#ff8c00' }]}>
                            {hoopCenter ? '✓' : '1'}
                        </Text>
                        <Text style={styles.stepBtnLabel}>Canestro</Text>
                    </TouchableOpacity>
                    <View style={styles.stepConnector} />
                    <TouchableOpacity
                        style={[styles.stepBtn, (step === 'corners' || step === 'done') && styles.stepBtnActive]}
                        onPress={() => hoopCenter && setStep('corners')}
                        disabled={!hoopCenter}
                    >
                        <Text style={[styles.stepBtnNum, { color: corners.length === 4 ? '#4ade80' : '#888' }]}>
                            {corners.length === 4 ? '✓' : '2'}
                        </Text>
                        <Text style={styles.stepBtnLabel}>
                            Angoli {corners.length > 0 ? `${corners.length}/4` : '(opz.)'}
                        </Text>
                    </TouchableOpacity>
                </View>

                {step === 'hoop' && hoopCenter && (
                    <TouchableOpacity style={styles.secondaryBtn} onPress={() => setStep('corners')}>
                        <Text style={styles.secondaryBtnText}>+ Aggiungi angoli campo →</Text>
                    </TouchableOpacity>
                )}

                {!savedCalibration ? (
                    <TouchableOpacity
                        style={[styles.primaryBtn, (!hoopCenter || isSaving) && styles.primaryBtnDisabled]}
                        onPress={handleSave}
                        disabled={!hoopCenter || isSaving}
                    >
                        <Text style={styles.primaryBtnText}>
                            {isSaving ? 'Salvataggio...' : 'Salva calibrazione'}
                        </Text>
                    </TouchableOpacity>
                ) : (
                    <TouchableOpacity
                        style={styles.proceedBtn}
                        onPress={handleProceed}
                        disabled={isNavigating}
                    >
                        <Text style={styles.proceedBtnText}>
                            {isNavigating ? 'Avvio...' : '▶ Inizia sessione'}
                        </Text>
                    </TouchableOpacity>
                )}
            </ScrollView>

            <CustomAlert {...alert} />
        </View>
    )
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#0b0f1a' },
    center: { justifyContent: 'center', alignItems: 'center', padding: 24 },
    header: {
        flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
        paddingHorizontal: 16,
        paddingTop: Platform.OS === 'ios' ? 44 : 12,
        paddingBottom: 10,
        backgroundColor: '#121826',
        borderBottomWidth: 1, borderBottomColor: '#2a2a2a',
    },
    skipText: { color: '#888', fontSize: 14 },
    headerCenter: { flex: 1, alignItems: 'center', paddingHorizontal: 8, gap: 3 },
    modeTag: {
        flexDirection: 'row', alignItems: 'center', gap: 4,
        backgroundColor: 'rgba(255,140,0,0.12)',
        borderWidth: 1, borderColor: 'rgba(255,140,0,0.30)',
        borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2,
    },
    modeTagIcon: { fontSize: 11, color: '#ff8c00' },
    modeTagText: { fontSize: 10, color: '#ff8c00', fontWeight: '700' },
    stepLabel: { fontSize: 12, fontWeight: '700' },
    resetText: { color: '#888', fontSize: 18 },
    guideH: {
        position: 'absolute', left: 0, right: 0, top: '50%',
        height: 1, backgroundColor: 'rgba(255,255,255,0.06)',
    },
    guideV: {
        position: 'absolute', top: 0, bottom: 0, left: '50%',
        width: 1, backgroundColor: 'rgba(255,255,255,0.06)',
    },
    tapHintWrap: { position: 'absolute', bottom: 12, left: 0, right: 0, alignItems: 'center' },
    tapHintText: {
        backgroundColor: 'rgba(0,0,0,0.72)', color: '#fff',
        fontSize: 12, fontWeight: '600',
        paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20,
    },
    zoomControls: {
        position: 'absolute',
        right: 16,
        top: '50%',
        marginTop: -30,
        alignItems: 'center',
        gap: 8,
    },
    zoomBtn: {
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: 'rgba(0,0,0,0.75)',
        borderWidth: 1.5,
        borderColor: 'rgba(255,255,255,0.3)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    zoomBtnText: {
        color: '#fff',
        fontSize: 24,
        fontWeight: '700',
        lineHeight: 28,
    },
    zoomBtnTextDisabled: {
        color: 'rgba(255,255,255,0.3)',
    },
    zoomIndicator: {
        backgroundColor: 'rgba(0,0,0,0.75)',
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.2)',
    },
    zoomText: {
        color: '#fff',
        fontSize: 11,
        fontWeight: '700',
    },
    zoomRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
    },
    configBtn: {
        position: 'absolute',
        left: 16,
        top: '50%',
        marginTop: -22,
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: 'rgba(0,0,0,0.75)',
        borderWidth: 1.5,
        borderColor: 'rgba(255,255,255,0.3)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    configBtnText: {
        fontSize: 20,
    },
    configPanel: {
        position: 'absolute',
        top: 56,
        left: 16,
        right: 16,
        bottom: 12,
        backgroundColor: 'rgba(18,24,38,0.95)',
        borderRadius: 12,
        padding: 16,
        borderWidth: 1,
        borderColor: '#2a2a2a',
        zIndex: 1000,
    },
    configPanelScroll: {
        flex: 1,
        maxHeight: SH * 0.5,
    },
    configPanelContent: {
        paddingBottom: 4,
    },
    configPanelTitle: {
        fontSize: 14,
        fontWeight: '700',
        color: '#fff',
        marginBottom: 12,
    },
    configSection: {
        marginBottom: 12,
    },
    pickerWrap: {
        borderRadius: 8,
        overflow: 'hidden',
        backgroundColor: 'rgba(255,255,255,0.08)',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.16)',
    },
    picker: {
        color: '#fff',
        height: 48,
    },
    configHint: {
        marginTop: 5,
        fontSize: 10,
        color: '#777',
        lineHeight: 14,
    },
    configLabel: {
        fontSize: 12,
        fontWeight: '600',
        color: '#888',
        marginBottom: 8,
    },
    configOptions: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    configOption: {
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 8,
        backgroundColor: 'rgba(255,255,255,0.1)',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.2)',
    },
    configOptionSelected: {
        backgroundColor: 'rgba(255,140,0,0.2)',
        borderColor: '#ff8c00',
    },
    configOptionText: {
        fontSize: 12,
        fontWeight: '600',
        color: '#fff',
    },
    configOptionTextSelected: {
        color: '#ff8c00',
    },
    configScroll: {
        marginBottom: 8,
    },
    closeConfigButton: {
        marginTop: 12,
        backgroundColor: '#2a2a2a',
        borderRadius: 8,
        paddingVertical: 10,
        paddingHorizontal: 16,
        alignItems: 'center',
    },
    closeConfigButtonText: {
        color: '#fff',
        fontSize: 14,
        fontWeight: '600',
    },
    configCloseBtn: {
        marginTop: 8,
        backgroundColor: '#2a2a2a',
        borderRadius: 8,
        paddingVertical: 10,
        alignItems: 'center',
    },
    configCloseBtnText: {
        fontSize: 13,
        fontWeight: '600',
        color: '#fff',
    },
    bottomPanel: { flex: 1, padding: 14 },
    modeCard: {
        backgroundColor: '#121826', borderRadius: 12,
        padding: 12, marginBottom: 12,
        borderWidth: 1, borderColor: '#2a2a2a',
    },
    modeCardTitle: { fontSize: 14, fontWeight: '700', color: '#fff', marginBottom: 4 },
    modeCardDesc: { fontSize: 12, color: '#888', lineHeight: 17, marginBottom: 8 },
    tipsGrid: { gap: 4 },
    tipText: { fontSize: 11, color: '#aaa', lineHeight: 16 },
    stepsRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
    stepBtn: {
        flex: 1, alignItems: 'center', backgroundColor: '#1e2433',
        borderRadius: 10, padding: 10, borderWidth: 1, borderColor: '#2a2a2a',
    },
    stepBtnActive: { borderColor: '#ff8c00' },
    stepBtnNum: { fontSize: 18, fontWeight: '800' },
    stepBtnLabel: { fontSize: 11, color: '#888', marginTop: 3 },
    stepConnector: { width: 20, height: 1, backgroundColor: '#2a2a2a', marginHorizontal: 6 },
    primaryBtn: {
        backgroundColor: '#ff8c00', borderRadius: 12,
        paddingVertical: 14, alignItems: 'center', marginBottom: 10,
    },
    primaryBtnDisabled: { opacity: 0.4 },
    primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
    proceedBtn: {
        backgroundColor: '#22c55e', borderRadius: 12,
        paddingVertical: 14, alignItems: 'center', marginBottom: 10,
    },
    proceedBtnText: { color: '#fff', fontWeight: '800', fontSize: 15 },
    secondaryBtn: {
        borderRadius: 12, paddingVertical: 12, alignItems: 'center',
        borderWidth: 1, borderColor: '#4ade80', marginBottom: 10,
    },
    secondaryBtnText: { color: '#4ade80', fontWeight: '600', fontSize: 13 },
    permTitle: { fontSize: 22, fontWeight: '800', color: '#fff', marginBottom: 12 },
    permDesc: { fontSize: 14, color: '#888', textAlign: 'center', marginBottom: 24 },
})