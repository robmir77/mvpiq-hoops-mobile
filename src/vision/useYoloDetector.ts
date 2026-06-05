// src/vision/useYoloDetector.ts
//
// YOLO Ball/Rim Detection - runs entirely in Frame Processor Worklet
// ZERO image data passes to JS thread
// Only BallDetection (coordinates) crosses the boundary
// Uses vision-camera-resize-plugin for native resizing

import { useEffect, useRef, useCallback } from 'react'
import { useFrameProcessor as useVisionCameraFrameProcessor } from 'react-native-vision-camera'
import { useResizePlugin } from 'vision-camera-resize-plugin'
import { Worklets } from 'react-native-worklets-core'
import { useTensorflowModel } from 'react-native-fast-tflite'
import type { Frame } from 'react-native-vision-camera'
import { parseYoloOutput } from './yoloParser'
import type { BallDetection } from './types'

const INPUT_SIZE = 320

export const useYoloDetector = (
  onDetection: (detection: BallDetection) => void,
  enabled: boolean = true
) => {
  const tfModel = useTensorflowModel(
    require('../../assets/models/ball_rimV8_float16.tflite'),
    'nnapi'
  )
  
  const onDetectionRef = useRef(onDetection)
  useEffect(() => {
    onDetectionRef.current = onDetection
  }, [onDetection])
  
  const { resize } = useResizePlugin()
  
  // Create runOnJS callback - receives ONLY BallDetection (coordinates)
  // Memoized with useRef to prevent worklet rebuild on every render
  const onDetectionJS = useRef(
    (Worklets.createRunOnJS as any)((detection: BallDetection) => {
      onDetectionRef.current(detection)
    })
  ).current
  
  // Frame processor - runs YOLO entirely in worklet
  const frameProcessor = useVisionCameraFrameProcessor((frame: Frame) => {
    'worklet'
    
    if (!enabled || tfModel.state !== 'loaded' || !tfModel.model) return
    
    const model = tfModel.model
    
    // Resize frame to 320x320 RGB float32 using native plugin
    const resized = resize(frame, {
      scale: { width: INPUT_SIZE, height: INPUT_SIZE },
      pixelFormat: 'rgb',
      dataType: 'float32',
    })
    
    // Convert HWC to CHW for YOLO
    const plane = INPUT_SIZE * INPUT_SIZE
    const chw = new Float32Array(3 * plane)
    for (let i = 0; i < plane; i++) {
      chw[i] = resized[i * 3]
      chw[plane + i] = resized[i * 3 + 1]
      chw[plane * 2 + i] = resized[i * 3 + 2]
    }
    
    // Run YOLO inference - this happens in the worklet
    const outputs = model.runSync([chw])
    const output = outputs[0] as Float32Array
    
    // Parse YOLO output to BallDetection - also in worklet
    const { ball } = parseYoloOutput(output)
    
    // Send ONLY coordinates to JS thread - ZERO image data
    onDetectionJS({
      ball: ball ? {
        x: ball.x,
        y: ball.y,
        width: ball.width,
        height: ball.height,
        confidence: ball.confidence,
      } : undefined,
      timestamp: Date.now(),
    })
  }, [enabled, tfModel.state, tfModel.model, resize])
  
  const isModelReady = tfModel.state === 'loaded' && tfModel.model != null
  
  return { frameProcessor, isModelReady }
}
