// src/vision/useMoveNetWorker.ts
//
// MoveNet Worker - processes frames immediately with independent timing
// Runs MoveNet inference at target FPS independently from YOLO
// No buffering - processes frames synchronously when they arrive

import { useRef, useCallback, useEffect, useMemo } from 'react'
import { useSharedValue } from 'react-native-reanimated'
import { useResizer } from 'react-native-vision-camera-resizer'
import { useTensorflowModel } from 'react-native-fast-tflite'
import { parseMoveNetOutput } from './poseParser'
import { computeJointAngles } from './biomechanics'
import type { AndroidDelegateOption, IosDelegateOption } from './delegates'
import { DEFAULT_ANDROID_DELEGATE, DEFAULT_IOS_DELEGATE } from './delegates'
import { Platform } from 'react-native'
import { getMoveNetModel, getMoveNetModelUri, DEFAULT_MOVENET_MODEL_ID } from './yoloModels'
import { playerCropManager, type PlayerCropResult } from './playerCrop'
import { telemetryLogger } from './telemetry'
import { scheduleOnRN } from 'react-native-worklets'

const DEFAULT_POSE_INPUT_SIZE = 192 // Only 192 is currently available in the registry
const MOVENET_TARGET_FPS = 3 // Target 3 FPS for MoveNet
const MOVENET_INTERVAL_MS = 1000 / MOVENET_TARGET_FPS

interface PoseWorkerResult {
  keypoints: any
  angles: any
  timestamp: number
  cropInfo?: PlayerCropResult | null
}

export const useMoveNetWorker = (
  enabled: boolean = true,
  poseDelegate?: AndroidDelegateOption | IosDelegateOption | null,
  moveNetModelId?: string
) => {
  // Latest result - use SharedValue for worklet access
  const latestResultKeypoints = useSharedValue<any>(null)
  const latestResultAngles = useSharedValue<any>(null)
  const latestResultTimestamp = useSharedValue(0)
  const latestCropInfo = useSharedValue<PlayerCropResult | null>(null)

  // Timing - use SharedValue for worklet access
  const lastInferenceAt = useSharedValue(0)
  const isProcessing = useSharedValue(false)

  // Shared values for UI
  const isReady = useSharedValue(false)
  const fps = useSharedValue(0)

  // Player bbox from YOLO (for cropping)
  const playerBbox = useSharedValue<{ x: number; y: number; width: number; height: number } | null>(null)

  // Model setup
  const selectedMoveNetModel = useMemo(
    () => getMoveNetModel(moveNetModelId ?? DEFAULT_MOVENET_MODEL_ID),
    [moveNetModelId]
  )
  const poseInputSize = selectedMoveNetModel?.inputSize ?? DEFAULT_POSE_INPUT_SIZE
  const poseInputElements = poseInputSize * poseInputSize * 3

  const moveNetUri = getMoveNetModelUri(moveNetModelId)
  const poseModelSource = useMemo(
    () => moveNetUri
      ? { url: moveNetUri } as any
      : selectedMoveNetModel?.asset as any,
    [moveNetUri, selectedMoveNetModel?.asset]
  )

  const poseDelegates = useMemo(
    () => {
      if (poseDelegate !== undefined && poseDelegate !== null) {
        return [poseDelegate]
      }
      return Platform.OS === 'android'
        ? [DEFAULT_ANDROID_DELEGATE]
        : [DEFAULT_IOS_DELEGATE]
    },
    [poseDelegate]
  )

  const poseModel = useTensorflowModel(poseModelSource, poseDelegates as any)
  const poseModelInstance = poseModel.state === 'loaded' && poseModel.model != null
    ? poseModel.model
    : null

  // Update ready state and log MoveNet model input
  useEffect(() => {
    isReady.value = poseModel.state === 'loaded' && poseModel.model != null
    
    // Log MoveNet model input size when model loads
    if (isReady.value) {
      telemetryLogger.setMoveNetModelInput(poseInputSize)
    }
  }, [poseModel.state, poseModel.model, isReady, poseInputSize])

  // Resizer config for RGB conversion at original frame size
  const rgbResizerConfig = useMemo(
    () => ({
      width: 0, // 0 = use original frame size
      height: 0, // 0 = use original frame size
      channelOrder: 'rgb' as const,
      dataType: 'uint8' as const,
      pixelLayout: 'interleaved' as const,
      scaleMode: 'contain' as const,
    }),
    []
  )

  const { resizer: rgbResizer } = useResizer(rgbResizerConfig)

  // JS-side callback for telemetry recording
  const recordTelemetry = useCallback((inferenceTime: number, keypoints: any, cropInfo: PlayerCropResult | null) => {
    telemetryLogger.recordMoveNetInference(inferenceTime)
    telemetryLogger.incrementPoseUpdates()
    
    // Calculate average keypoint confidence
    if (keypoints) {
      // Convert PoseKeypoints object to array of values
      const keypointValues = Object.values(keypoints).filter((kp: any) => kp && kp.score > 0)
      if (keypointValues.length > 0) {
        const avgConfidence = keypointValues.reduce((sum: number, kp: any) => sum + kp.score, 0) / keypointValues.length
        telemetryLogger.recordMoveNetKeypoints(avgConfidence)
      }
    }
    
    if (__DEV__ && cropInfo) {
      console.log('[MoveNetWorker] Crop info:', {
        isValid: cropInfo.isValid,
        isUsingLastBbox: cropInfo.isUsingLastBbox,
        cropSize: `${cropInfo.cropWidth.toFixed(0)}x${cropInfo.cropHeight.toFixed(0)}`,
      })
    }
  }, [])

  // Process frame immediately (no buffering)
  const processFrame = useCallback((frame: any, timestamp: number) => {
    'worklet'

    if (!poseModelInstance || isProcessing.value || !enabled) {
      return
    }

    // Throttle based on timing
    const now = Date.now()
    const timeSinceLast = lastInferenceAt.value > 0 ? now - lastInferenceAt.value : MOVENET_INTERVAL_MS
    if (timeSinceLast < MOVENET_INTERVAL_MS) {
      return
    }

    isProcessing.value = true

    let resized: any = null
    let cropInfo: PlayerCropResult | null = null
    
    try {
      const t0 = performance.now()
      
      // Get player bbox from YOLO
      const bbox = playerBbox.value
      
      // Calculate crop region if player bbox is available
      if (bbox && enabled) {
        // First convert YUV frame to RGB at ORIGINAL frame size, then crop
        resized = rgbResizer?.resize(frame)
        
        if (resized) {
          try {
            const pixelBuffer = resized.getPixelBuffer()
            
            if (pixelBuffer) {
              // Inline crop calculation (worklet-safe)
              const frameW = frame.width || 1280
              const frameH = frame.height || 720
              
              const cropX = bbox.x * frameW
              const cropY = bbox.y * frameH
              const cropW = bbox.width * frameW
              const cropH = bbox.height * frameH
              
              // Add padding (15%)
              const paddingX = cropW * 0.15
              const paddingY = cropH * 0.15
              
              let finalCropX = cropX - paddingX
              let finalCropY = cropY - paddingY
              let finalCropW = cropW + 2 * paddingX
              let finalCropH = cropH + 2 * paddingY
              
              // Clamp to frame boundaries
              finalCropX = Math.max(0, finalCropX)
              finalCropY = Math.max(0, finalCropY)
              finalCropW = Math.min(frameW - finalCropX, finalCropW)
              finalCropH = Math.min(frameH - finalCropY, finalCropH)
              
              // Ensure minimum crop size
              const minCropSize = Math.min(frameW, frameH) * 0.2
              finalCropW = Math.max(minCropSize, finalCropW)
              finalCropH = Math.max(minCropSize, finalCropH)
              
              cropInfo = {
                cropX: finalCropX,
                cropY: finalCropY,
                cropWidth: finalCropW,
                cropHeight: finalCropH,
                isValid: true,
                isUsingLastBbox: false,
              }
              
              // CPU-based cropping and resizing on RGB buffer
              const cropXInt = Math.floor(cropInfo.cropX)
              const cropYInt = Math.floor(cropInfo.cropY)
              const cropWInt = Math.floor(cropInfo.cropWidth)
              const cropHInt = Math.floor(cropInfo.cropHeight)
              
              // Get source data from RGB buffer at ORIGINAL frame size
              const srcData = new Uint8Array(pixelBuffer as ArrayBuffer)
              const bytesPerPixel = 3
              const srcStride = Math.floor(frameW * bytesPerPixel)
              
              // Create cropped buffer
              const croppedBuffer = new Uint8Array(cropWInt * cropHInt * bytesPerPixel)
              
              // Extract crop region row by row
              for (let y = 0; y < cropHInt; y++) {
                const srcOffset = ((cropYInt + y) * srcStride) + (cropXInt * bytesPerPixel)
                const dstOffset = y * cropWInt * bytesPerPixel
                croppedBuffer.set(srcData.subarray(srcOffset, srcOffset + cropWInt * bytesPerPixel), dstOffset)
              }
              
              // Resize cropped buffer to target input size (simple nearest-neighbor)
              const targetSize = poseInputSize
              const resizedBuffer = new Uint8Array(targetSize * targetSize * bytesPerPixel)
              
              const resizeScaleX = cropWInt / targetSize
              const resizeScaleY = cropHInt / targetSize
              
              for (let y = 0; y < targetSize; y++) {
                for (let x = 0; x < targetSize; x++) {
                  const srcX = Math.floor(x * resizeScaleX)
                  const srcY = Math.floor(y * resizeScaleY)
                  const srcOffset = (srcY * cropWInt + srcX) * bytesPerPixel
                  const dstOffset = (y * targetSize + x) * bytesPerPixel
                  
                  resizedBuffer[dstOffset] = croppedBuffer[srcOffset]
                  resizedBuffer[dstOffset + 1] = croppedBuffer[srcOffset + 1]
                  resizedBuffer[dstOffset + 2] = croppedBuffer[srcOffset + 2]
                }
              }
              
              if (__DEV__) {
                console.log('[MoveNetWorker] Using player crop on RGB-converted frame:', {
                  bbox: { x: bbox.x.toFixed(3), y: bbox.y.toFixed(3), width: bbox.width.toFixed(3), height: bbox.height.toFixed(3) },
                  crop: { x: cropInfo.cropX.toFixed(0), y: cropInfo.cropY.toFixed(0), width: cropInfo.cropWidth.toFixed(0), height: cropInfo.cropHeight.toFixed(0) },
                  targetSize,
                })
              }
              
              // Use the resized cropped buffer directly
              const source = resizedBuffer
              
              if (source.length === poseInputElements) {
                const inputBuffer = source.buffer.slice(
                  source.byteOffset,
                  source.byteOffset + source.byteLength
                ) as ArrayBuffer

                const outputs = poseModelInstance!.runSync([inputBuffer])
                const output = new Float32Array(outputs[0] as ArrayBufferLike)

                const keypoints = parseMoveNetOutput(output, poseInputSize)
                const angles = computeJointAngles(keypoints)

                // Transform keypoints back to original frame space
                let finalKeypoints = keypoints
                if (cropInfo && cropInfo.isValid) {
                  finalKeypoints = {}
                  for (const [key, kp] of Object.entries(keypoints)) {
                    if (kp && typeof kp === 'object') {
                      (finalKeypoints as any)[key] = {
                        ...kp,
                        x: (cropInfo.cropX + kp.x * cropInfo.cropWidth) / frameW,
                        y: (cropInfo.cropY + kp.y * cropInfo.cropHeight) / frameH,
                      }
                    }
                  }
                }

                const t2 = performance.now()

                latestResultKeypoints.value = finalKeypoints
                latestResultAngles.value = angles
                latestResultTimestamp.value = timestamp
                latestCropInfo.value = cropInfo

                const inferenceTime = t2 - t0
                const calculatedFps = 1000 / inferenceTime

                if (__DEV__) {
                  console.log(`[MoveNetWorker] Processed CROPPED frame in ${inferenceTime.toFixed(1)}ms, FPS: ${calculatedFps.toFixed(1)}`)
                }

                if (calculatedFps > 0) {
                  fps.value = calculatedFps
                }

                scheduleOnRN(recordTelemetry, inferenceTime, finalKeypoints, cropInfo)
                
                // resized will be disposed in finally block
                isProcessing.value = false
                lastInferenceAt.value = Date.now()
                return
              }
            }
          } catch (cropError) {
            console.warn('[MoveNetWorker] Crop failed, falling back to full frame:', cropError)
            cropInfo = null
            // resized will be disposed in finally block
          }
        }
      }
      
      // Fallback: use full frame if crop failed or no bbox
      resized = rgbResizer?.resize(frame)
      const t1 = performance.now()

      if (resized) {
        const pixelBuffer = resized.getPixelBuffer()
        
        if (pixelBuffer) {
          const frameW = frame.width || 1280
          const frameH = frame.height || 720
          
          // Get source data from RGB buffer at original frame size
          const srcData = new Uint8Array(pixelBuffer as ArrayBuffer)
          const bytesPerPixel = 3
          const srcStride = Math.floor(frameW * bytesPerPixel)
          
          // Resize full frame to target input size (simple nearest-neighbor)
          const targetSize = poseInputSize
          const resizedBuffer = new Uint8Array(targetSize * targetSize * bytesPerPixel)
          
          const resizeScaleX = frameW / targetSize
          const resizeScaleY = frameH / targetSize
          
          for (let y = 0; y < targetSize; y++) {
            for (let x = 0; x < targetSize; x++) {
              const srcX = Math.floor(x * resizeScaleX)
              const srcY = Math.floor(y * resizeScaleY)
              const srcOffset = (srcY * frameW + srcX) * bytesPerPixel
              const dstOffset = (y * targetSize + x) * bytesPerPixel
              
              resizedBuffer[dstOffset] = srcData[srcOffset]
              resizedBuffer[dstOffset + 1] = srcData[srcOffset + 1]
              resizedBuffer[dstOffset + 2] = srcData[srcOffset + 2]
            }
          }
          
          // MoveNet uses uint8 input
          const source = resizedBuffer

          if (source.length === poseInputElements) {
            const inputBuffer = source.buffer.slice(
              source.byteOffset,
              source.byteOffset + source.byteLength
            ) as ArrayBuffer

            const outputs = poseModelInstance!.runSync([inputBuffer])
            const output = new Float32Array(outputs[0] as ArrayBufferLike)

            const keypoints = parseMoveNetOutput(output, poseInputSize)
            const angles = computeJointAngles(keypoints)

            // Transform keypoints back to original frame space if crop was used
            let finalKeypoints = keypoints
            if (cropInfo && cropInfo.isValid) {
              // Transform each keypoint from crop space to frame space
              finalKeypoints = {}
              for (const [key, kp] of Object.entries(keypoints)) {
                if (kp && typeof kp === 'object') {
                  (finalKeypoints as any)[key] = {
                    ...kp,
                    x: (cropInfo.cropX + kp.x * cropInfo.cropWidth) / frameW,
                    y: (cropInfo.cropY + kp.y * cropInfo.cropHeight) / frameH,
                  }
                }
              }
            }

            const t2 = performance.now()

            // Update latest result
            latestResultKeypoints.value = finalKeypoints
            latestResultAngles.value = angles
            latestResultTimestamp.value = timestamp
            latestCropInfo.value = cropInfo

            // Update FPS only if valid (greater than 0)
            const inferenceTime = t2 - t0
            const calculatedFps = 1000 / inferenceTime

            if (__DEV__) {
              console.log(`[MoveNetWorker] Processed frame in ${inferenceTime.toFixed(1)}ms, FPS: ${calculatedFps.toFixed(1)}`)
            }

            if (calculatedFps > 0) {
              fps.value = calculatedFps
            } else {
              if (__DEV__) {
                console.log(`[MoveNetWorker] FPS is 0, not updating. InferenceTime: ${inferenceTime.toFixed(1)}ms`)
              }
            }

            // Record telemetry via scheduleOnRN
            scheduleOnRN(recordTelemetry, inferenceTime, finalKeypoints, cropInfo)
          }
        }
      }

    } catch (error) {
      console.error('[MoveNetWorker] Error processing frame:', error)
    } finally {
      // Dispose GPUFrame to release GPU resources
      if (resized) {
        try {
          resized.dispose()
        } catch (e) {
          // Ignore if already disposed
        }
      }
      isProcessing.value = false
      lastInferenceAt.value = Date.now()
    }
  }, [poseModelInstance, rgbResizer, poseInputElements, enabled, fps, latestResultKeypoints, latestResultAngles, latestResultTimestamp, latestCropInfo, isProcessing, lastInferenceAt, playerBbox, recordTelemetry])

  // Get latest result (called from JS thread)
  const getLatestResult = useCallback((): PoseWorkerResult | null => {
    if (latestResultKeypoints.value === null && latestResultTimestamp.value === 0) {
      return null
    }
    return {
      keypoints: latestResultKeypoints.value,
      angles: latestResultAngles.value,
      timestamp: latestResultTimestamp.value,
      cropInfo: latestCropInfo.value,
    }
  }, [latestResultKeypoints, latestResultAngles, latestResultTimestamp, latestCropInfo])

  // Reset
  const reset = useCallback(() => {
    latestResultKeypoints.value = null
    latestResultAngles.value = null
    latestResultTimestamp.value = 0
    latestCropInfo.value = null
    lastInferenceAt.value = 0
    isProcessing.value = false
    playerBbox.value = null
  }, [latestResultKeypoints, latestResultAngles, latestResultTimestamp, latestCropInfo, lastInferenceAt, isProcessing, playerBbox])

  return {
    processFrame,
    getLatestResult,
    reset,
    isReady,
    fps,
    latestResultKeypoints,
    latestResultAngles,
    latestResultTimestamp,
    latestCropInfo,
    playerBbox,
  }
}
