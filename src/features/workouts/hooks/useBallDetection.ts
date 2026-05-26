// src/features/workouts/hooks/useBallDetection.ts

import { useEffect, useRef, useCallback } from 'react'
import { useFrameProcessor, Frame } from 'react-native-vision-camera'
import { Worklets } from 'react-native-worklets-core'
import { InferenceSession, Tensor } from 'onnxruntime-react-native'
import { Asset } from 'expo-asset'
import { useSharedValue } from 'react-native-reanimated'

import { DetectionResult } from '../types/workouts.types'

const MODEL_ASSET = require('../../../../assets/models/ball_detection.onnx')

const INPUT_SIZE = 320
const SKIP_FRAMES = 2
const CONF_THRESHOLD = 0.25

const CLASSES = ['basketball', 'hoop', 'player'] as const

// -------------------- HOOK --------------------
export const useBallDetection = (onDetection: (r: any) => void) => {

    const sessionRef = useRef<InferenceSession | null>(null)
    const isInferring = useRef(false)
    const frameCounter = useRef(0)

    // -------------------- OVERLAY STATE --------------------
    const ballX = useSharedValue(0)
    const ballY = useSharedValue(0)
    const ballW = useSharedValue(0)
    const ballH = useSharedValue(0)
    const ballConf = useSharedValue(0)

    // -------------------- LOAD MODEL --------------------
    useEffect(() => {
        let mounted = true

        const load = async () => {
            try {
                console.log('[BallDetection] Loading ONNX asset...')

                const asset = Asset.fromModule(MODEL_ASSET)
                await asset.downloadAsync()

                if (!asset.localUri) {
                    throw new Error('Model localUri missing')
                }

                const modelPath = asset.localUri.replace('file://', '')

                console.log('[BallDetection] MODEL PATH:', modelPath)

                const session = await InferenceSession.create(modelPath, {
                    executionProviders: ['cpu'],
                    graphOptimizationLevel: 'all',
                })

                if (!mounted) return

                sessionRef.current = session

                console.log('[BallDetection] Input names:', session.inputNames)
                console.log('[BallDetection] Output names:', session.outputNames)

            } catch (e) {
                console.error('[BallDetection] MODEL LOAD ERROR:', e)
            }
        }

        load()

        return () => { mounted = false }
    }, [])

    const handleDetection = useCallback(onDetection, [])

    // -------------------- INFERENCE --------------------
    const runInference = useCallback(async (
        w: number,
        h: number,
        ts: number
    ) => {

        if (!sessionRef.current || isInferring.current) return

        isInferring.current = true

        try {
            console.log('[BallDetection] inference start', { w, h, ts })

            const input = new Float32Array(1 * 3 * INPUT_SIZE * INPUT_SIZE)

            const tensor = new Tensor('float32', input, [
                1, 3, INPUT_SIZE, INPUT_SIZE
            ])

            const output = await sessionRef.current.run({
                images: tensor
            })

            const out = output['output0']

            if (!out) {
                console.warn('[BallDetection] missing output0')
                return
            }

            const data = out.data as Float32Array
            const dims = out.dims

            console.log('[BallDetection] dims:', dims)

            const numBoxes = dims?.[2] ?? 2100

            let bestBall: any = null
            let bestConf = 0

            // -------------------- SIMPLE PARSER (SAFE) --------------------
            for (let i = 0; i < numBoxes; i++) {

                const base = i * 84

                const cx = data[base + 0]
                const cy = data[base + 1]
                const bw = data[base + 2]
                const bh = data[base + 3]
                const score = data[base + 4]

                if (score < CONF_THRESHOLD) continue

                const conf = Math.max(0, Math.min(score, 1))

                const x1 = (cx - bw / 2) / INPUT_SIZE
                const y1 = (cy - bh / 2) / INPUT_SIZE
                const x2 = (cx + bw / 2) / INPUT_SIZE
                const y2 = (cy + bh / 2) / INPUT_SIZE

                const width = (x2 - x1) * w
                const height = (y2 - y1) * h

                const cxPx = x1 * w
                const cyPx = y1 * h

                // 🟢 ONLY BALL tracking (per ora)
                if (conf > bestConf) {
                    bestConf = conf
                    bestBall = {
                        x: cxPx,
                        y: cyPx,
                        width,
                        height,
                        confidence: conf
                    }
                }
            }

            // -------------------- UPDATE OVERLAY --------------------
            if (bestBall) {
                ballX.value = bestBall.x
                ballY.value = bestBall.y
                ballW.value = bestBall.width
                ballH.value = bestBall.height
                ballConf.value = bestBall.confidence
            }

            // -------------------- CALLBACK --------------------
            handleDetection({
                ball: bestBall ?? null,
                hoop: null,
                player: null,
                frameTimestamp: ts
            })

        } catch (e) {
            console.error('[BallDetection] inference error:', e)
        } finally {
            isInferring.current = false
        }

    }, [handleDetection])

    // -------------------- WORKLET BRIDGE --------------------
    const runJS = Worklets.createRunOnJS(runInference)

    // -------------------- FRAME PROCESSOR --------------------
    const frameProcessor = useFrameProcessor((frame: Frame) => {
        'worklet'

        frameCounter.current++

        if (frameCounter.current % (SKIP_FRAMES + 1) !== 0) return

        runJS(frame.width, frame.height, frame.timestamp)

    }, [])

    return {
        frameProcessor,
        isReady: sessionRef.current !== null,

        // overlay values
        ballX,
        ballY,
        ballW,
        ballH,
        ballConf,
    }
}