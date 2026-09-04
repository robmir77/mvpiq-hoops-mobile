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
import { parseYoloOutput, setCropParameters } from './yoloParser'
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
  const onDetectionJS = (Worklets.createRunOnJS as any)((detection: BallDetection) => {
    onDetectionRef.current(detection)
  })
  
  // Frame processor - runs YOLO entirely in worklet
  const frameProcessor = useVisionCameraFrameProcessor((frame: Frame) => {
    'worklet'
    
    if (!enabled || tfModel.state !== 'loaded' || !tfModel.model) return
    
    const model = tfModel.model
    
    // Calculate crop parameters for the frame
    const frameWidth = frame.width
    const frameHeight = frame.height
    const cropDim = Math.min(frameWidth, frameHeight)
    const cropX = (frameWidth - cropDim) / 2
    const cropY = (frameHeight - cropDim) / 2
    
    // Set crop parameters for the parser
    setCropParameters(cropX, cropY, cropDim)
    
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
    // Try lower threshold to see if model detects anything
    const { ball } = parseYoloOutput(output, 0.01, frameWidth, frameHeight)
    
    // Log detection for debugging
    if (ball) {
      console.log('[YOLO] Ball detected:', ball.x.toFixed(3), ball.y.toFixed(3), ball.confidence.toFixed(3))
    } else {
      // Log occasionally when no ball detected
      if (Math.random() < 0.01) {
        console.log('[YOLO] No ball detected - frame:', frameWidth, 'x', frameHeight)
      }
    }
    
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
  }, [enabled, tfModel.state, tfModel.model, resize, onDetectionJS])
  
  const isModelReady = tfModel.state === 'loaded' && tfModel.model != null
  
  return { frameProcessor, isModelReady }
}
