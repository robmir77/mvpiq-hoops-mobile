// ShotEventBuilder
// Fase 1: Costruttore per ShotEvent completo con tutti i campi richiesti dalla specifica
// Genera shotId idempotente, calcola posizione sul campo, converte traiettoria e posa grezza

import type {
  ShotEvent,
  AddShotEventPayload,
  ShotPoint,
  RawPoseFrame,
  CourtPositionQuality,
  ShotResult,
  TrackingState,
  PoseKeypoints,
  CalibrationData,
} from '../types/workouts.types'

// Schema version per evoluzione del formato
const SHOT_EVENT_SCHEMA_VERSION = 1

// Genera UUID v4 semplice (compatibile React Native)
// Fallback a crypto.randomUUID() se disponibile, altrimenti implementazione manuale
const generateUUID = (): string => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }

  // Implementazione UUID v4 manuale
  const template = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'
  return template.replace(/[xy]/g, (c: string) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

// Configurazione per calcolo posizione sul campo
interface CourtProjectionConfig {
  calibration?: CalibrationData | null
  cameraResolution?: { width: number; height: number }
}

// Buffer per posa grezza associata al tiro
interface PoseBufferEntry {
  timestampMs: number
  keypoints: PoseKeypoints
  coordinateSpace: 'IMAGE_NORMALIZED' | 'IMAGE_PIXELS'
}

export class ShotEventBuilder {
  private poseBuffer: PoseBufferEntry[] = []
  private readonly maxPoseFrames: number
  private readonly poseWindowMs: number

  constructor(maxPoseFrames: number = 30, poseWindowMs: number = 500) {
    this.maxPoseFrames = maxPoseFrames
    this.poseWindowMs = poseWindowMs
  }

  // Aggiunge frame di posa al buffer
  addPoseFrame(
    keypoints: PoseKeypoints,
    timestampMs: number,
    coordinateSpace: 'IMAGE_NORMALIZED' | 'IMAGE_PIXELS' = 'IMAGE_NORMALIZED'
  ): void {
    this.poseBuffer.push({ timestampMs, keypoints, coordinateSpace })

    // Trim buffer per mantenere solo frame recenti
    const cutoffTime = timestampMs - this.poseWindowMs
    this.poseBuffer = this.poseBuffer.filter((entry) => entry.timestampMs >= cutoffTime)

    // Limita numero massimo di frame
    if (this.poseBuffer.length > this.maxPoseFrames) {
      this.poseBuffer = this.poseBuffer.slice(-this.maxPoseFrames)
    }
  }

  // Pulisce il buffer posa
  clearPoseBuffer(): void {
    this.poseBuffer = []
  }

  // Converte trajectory da TrackingState a ShotPoint[]
  private convertTrajectory(
    trajectory: Array<{ x: number; y: number; t: number }>,
    releaseTimestampMs?: number
  ): ShotPoint[] {
    if (!trajectory || trajectory.length === 0) return []

    return trajectory.map((point) => ({
      x: point.x,
      y: point.y,
      timestampMs: point.t,
      source: 'DETECTION', // Per ora tutti i punti sono detection, predizioni da aggiungere in futuro
      confidence: undefined, // TrackingState non include confidence per punto
    }))
  }

  // Calcola posizione sul campo da calibrazione (placeholder per ora)
  // TODO: Implementare proiezione omografia da coordinate immagine a coordinate campo
  private calculateCourtPosition(
    ballPosition: { x: number; y: number } | null,
    config: CourtProjectionConfig
  ): { courtX: number; courtY: number; quality: CourtPositionQuality } {
    if (!ballPosition) {
      return { courtX: 0, courtY: 0, quality: 'UNAVAILABLE' }
    }

    // Placeholder: usa coordinate normalizzate come approssimazione
    // In futuro: usare homographyMatrix per proiezione accurata
    if (config.calibration?.homographyMatrix && config.calibration.homographyMatrix.length > 0) {
      // TODO: Implementare proiezione omografia
      return {
        courtX: ballPosition.x * 15.24, // Approssimazione: width campo
        courtY: ballPosition.y * 14.32, // Approssimazione: half-court height
        quality: 'APPROXIMATE',
      }
    }

    return {
      courtX: ballPosition.x * 15.24,
      courtY: ballPosition.y * 14.32,
      quality: 'UNAVAILABLE',
    }
  }

  // Calcola distanza dal canestro
  private calculateDistanceFromHoop(courtX: number, courtY: number): number {
    // Canestro al centro del campo (7.62m da lato, 1.575m da baseline)
    const hoopX = 7.62
    const hoopY = 1.575
    const dx = courtX - hoopX
    const dy = courtY - hoopY
    return Math.sqrt(dx * dx + dy * dy)
  }

  // Costruisce ShotEvent completo da TrackingState
  buildShotEvent(
    trackingState: TrackingState,
    sessionId: string,
    config: CourtProjectionConfig = {}
  ): ShotEvent {
    const shotId = generateUUID()
    const timestampMs = Date.now()

    // Calcola posizione sul campo
    const { courtX, courtY, quality } = this.calculateCourtPosition(
      trackingState.ballPosition,
      config
    )

    // Calcola distanza dal canestro
    const distanceFromHoop = this.calculateDistanceFromHoop(courtX, courtY)

    // Converte traiettoria
    const trajectory = this.convertTrajectory(
      trackingState.trajectory,
      trackingState.releasePoint ? timestampMs : undefined
    )

    // Estrae posa grezza dal buffer
    const rawPoseFrames: RawPoseFrame[] = this.poseBuffer.map((entry) => ({
      timestampMs: entry.timestampMs,
      keypoints: entry.keypoints,
      coordinateSpace: entry.coordinateSpace,
    }))

    // Costruisce ShotEvent
    const shotEvent: ShotEvent = {
      id: shotId, // Placeholder: backend genererà id reale
      shotId, // UUID idempotente client-side
      sessionId,
      timestampMs,
      shotResult: trackingState.shotResult ?? 'UNCERTAIN',
      courtX,
      courtY,
      distanceFromHoop,
      releaseAngle: trackingState.releaseAngle,
      releaseVelocity: undefined, // Non disponibile in TrackingState
      detectionConfidence: trackingState.confidence,
      trackingData: JSON.stringify(trackingState),
      zone: undefined, // TODO: Calcolare da courtX/courtY
      shotZone: undefined,
      releaseTimeMs: trackingState.releasePoint ? timestampMs : undefined,
      // Nuovi campi
      courtPositionQuality: quality,
      trajectory,
      rawPoseFrames,
      schemaVersion: SHOT_EVENT_SCHEMA_VERSION,
    }

    return shotEvent
  }

  // Costruisce AddShotEventPayload per API
  buildAddShotPayload(
    trackingState: TrackingState,
    sessionId: string,
    config: CourtProjectionConfig = {}
  ): AddShotEventPayload {
    const shotEvent = this.buildShotEvent(trackingState, sessionId, config)

    return {
      shotId: shotEvent.shotId,
      timestampMs: shotEvent.timestampMs,
      shotResult: shotEvent.shotResult,
      courtX: shotEvent.courtX,
      courtY: shotEvent.courtY,
      distanceFromHoop: shotEvent.distanceFromHoop,
      releaseAngle: shotEvent.releaseAngle,
      releaseVelocity: shotEvent.releaseVelocity,
      detectionConfidence: shotEvent.detectionConfidence,
      trackingData: shotEvent.trackingData,
      courtPositionQuality: shotEvent.courtPositionQuality,
      trajectory: shotEvent.trajectory,
      rawPoseFrames: shotEvent.rawPoseFrames,
      schemaVersion: shotEvent.schemaVersion,
    }
  }

  // Converte AIRBLOCK/AIRBALL a UNCERTAIN per contratto pubblico
  normalizeShotResult(result: ShotResult): 'MADE' | 'MISS' | 'UNCERTAIN' {
    if (result === 'AIRBALL' || result === 'BLOCKED') {
      return 'UNCERTAIN'
    }
    if (result === 'MADE' || result === 'MISS') {
      return result
    }
    return 'UNCERTAIN'
  }
}
