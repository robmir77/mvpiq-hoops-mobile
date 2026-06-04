// src/vision/useShotTracker.ts
//
// Orchestrates ball detection, pose detection, and shot analysis
// Coordinates YOLO (realtime in Frame Processor) and MoveNet (on-demand on JS thread)
// Only processed data (BallDetection, PoseResult, ShotEvent) crosses to JS
// Pose detection triggered via snapshot callback

import { useRef, useCallback, useEffect } from 'react'
import { useYoloDetector } from './useYoloDetector'
import { usePoseDetector } from './usePoseDetector'
import { ShotDetector } from './shotDetector'
import type { BallDetection, PoseResult, ShotEvent } from './types'

const SHOT_CANDIDATE_THRESHOLD_Y = 0.3 // Ball above 30% of frame height
const SHOT_CANDIDATE_VELOCITY_Y = -50 // Ball moving upward

export const useShotTracker = (
  onBallDetection: (detection: BallDetection) => void,
  onPoseResult: (result: PoseResult) => void,
  onShotEvent: (event: ShotEvent) => void,
  onPoseRequest?: () => void,
  rimFromCalibration?: { x: number; y: number; width: number; height: number } | null
) => {
  const shotDetector = useRef(new ShotDetector())
  const lastBallRef = useRef<{ x: number; y: number; t: number } | null>(null)

  // Pose detection callback - receives ONLY PoseResult (keypoints + angles)
  const handlePoseResult = useCallback((result: PoseResult) => {
    onPoseResult(result)
  }, [onPoseResult])

  // Initialize pose detector - returns runPoseFromSnapshot function
  const { runPoseFromSnapshot, isReady: poseReady } = usePoseDetector(handlePoseResult)

  // YOLO detection callback - receives ONLY BallDetection (coordinates)
  const handleBallDetection = useCallback((detection: BallDetection) => {
    const { ball } = detection
    
    // Send to parent
    onBallDetection(detection)
    
    // Update shot detector trajectory
    if (ball) {
      shotDetector.current.updateTrajectory(ball)
      
      // Calculate velocity
      const prev = lastBallRef.current
      let velocity = { vx: 0, vy: 0 }
      if (prev) {
        const dt = (detection.timestamp - prev.t) / 1000
        if (dt > 0) {
          const centerX = ball.x + ball.width / 2
          const centerY = ball.y + ball.height / 2
          velocity = {
            vx: (centerX - prev.x) / dt,
            vy: (centerY - prev.y) / dt,
          }
        }
      }
      
      lastBallRef.current = {
        x: ball.x + ball.width / 2,
        y: ball.y + ball.height / 2,
        t: detection.timestamp,
      }
      
      // Check for shot candidate - trigger pose detection via callback
      const normalizedY = ball.y / 480
      const isShotCandidate = 
        normalizedY > SHOT_CANDIDATE_THRESHOLD_Y && 
        velocity.vy < SHOT_CANDIDATE_VELOCITY_Y
      
      if (isShotCandidate) {
        // Signal parent to take snapshot and run pose detection
        console.log('[ShotTracker] Shot candidate detected - requesting snapshot')
        onPoseRequest?.()
      }
    }
    
    // Detect shot events
    if (shotDetector.current.detectShotStart(ball)) {
      console.log('[ShotTracker] Shot started')
    }
    
    if (shotDetector.current.detectShotRelease()) {
      console.log('[ShotTracker] Shot released')
      const shotEvent = shotDetector.current.getShotEvent()
      if (shotEvent) onShotEvent(shotEvent)
    }
    
    if (shotDetector.current.detectShotMade(rimFromCalibration || null)) {
      console.log('[ShotTracker] Shot made!')
      const shotEvent = shotDetector.current.getShotEvent()
      if (shotEvent) onShotEvent(shotEvent)
      shotDetector.current.reset()
    }
  }, [onBallDetection, onShotEvent, onPoseRequest, rimFromCalibration])

  // Initialize YOLO detector - no pose frame callback
  const { frameProcessor: yoloProcessor, isModelReady: yoloReady } = useYoloDetector(
    handleBallDetection,
    true
  )

  const resetShotTracking = useCallback(() => {
    shotDetector.current.reset()
    lastBallRef.current = null
  }, [])

  return {
    frameProcessor: yoloProcessor,
    isModelReady: yoloReady && poseReady,
    resetShotTracking,
    runPoseFromSnapshot,
  }
}
