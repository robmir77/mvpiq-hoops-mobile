// src/vision/useYoloDetector.ts
//
// YOLO Ball/Rim Detection - runs entirely in Frame Processor Worklet
// ZERO image data passes to JS thread
// Only BallDetection (coordinates) crosses the boundary
// Uses vision-camera-resize-plugin for native resizing

import { useEffect, useRef, useCallback } from 'react'
import { useFrameOutput } from 'react-native-vision-camera'
import { useResizer } from 'react-native-vision-camera-resizer'
import { scheduleOnRN } from 'react-native-worklets'
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
  
  const { resizer } = useResizer({
    width: INPUT_SIZE,
    height: INPUT_SIZE,
    channelOrder: 'rgb',
    dataType: 'float32',
    pixelLayout: 'planar',
    scaleMode: 'contain',
  })
  
  // Receives ONLY BallDetection (coordinates); scheduled onto the RN Runtime
  // from inside the worklet below via scheduleOnRN, no pre-wrapping needed.
  const emitDetection = useCallback((detection: BallDetection) => {
    onDetectionRef.current(detection)
  }, [])

  
  // Frame output - runs YOLO entirely in worklet
  const frameOutput = useFrameOutput({
    pixelFormat: 'rgb',
    onFrame: (frame: Frame) => {
      'worklet'
      
      try {
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
        const resized = resizer?.resize(frame)
        if (!resized) return
        
        const arrayBuffer = resized.getPixelBuffer()
        const buffer = new Float32Array(arrayBuffer)
        resized.dispose()
        
        // The resizer already outputs planar format (CHW)
        const chw = buffer
        
        // Run YOLO inference - this happens in the worklet
        const outputs = model.runSync([chw])
        const output = outputs[0] as Float32Array
        
        // Parse YOLO output to BallDetection - also in worklet
        const { ball } = parseYoloOutput(output, 0.01, frameWidth, frameHeight)
        
        // Send ONLY coordinates to JS thread - ZERO image data
        scheduleOnRN(emitDetection, {
          ball: ball ? {
            x: ball.x,
            y: ball.y,
            width: ball.width,
            height: ball.height,
            confidence: ball.confidence,
          } : undefined,
          timestamp: Date.now(),
        })
      } catch (error) {
        // Error occurred in worklet
      } finally {
        frame.dispose()
      }
    },
  })
  
  const isModelReady = tfModel.state === 'loaded' && tfModel.model != null
  
  return { frameOutput, isModelReady }
}
