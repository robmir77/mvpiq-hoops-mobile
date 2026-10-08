// BallTrajectoryAnalyzer
// Phase 5: Separazione palleggio / traiettoria di tiro
// Ispirato a TrajectoryService del backend (stabilizeReleaseFrame, findApexIndex, extractFlightArc)
// Questo livello opera sopra BallTrackingEngine per classificare il movimento della palla

import type { BallPosition, BallVelocity } from './BallTrackingState'

// Stati del movimento della palla
export enum BallMotionState {
  IDLE = 'IDLE',                    // Nessun tracking attivo
  DRIBBLE = 'DRIBBLE',              // Palleggio (movimento breve/alternato)
  SHOT_CANDIDATE = 'SHOT_CANDIDATE', // Ascesa coerente e prolungata
  SHOT_ASCENDING = 'SHOT_ASCENDING', // Release confermato, ascesa in corso
  SHOT_APEX = 'SHOT_APEX',          // Apice raggiunto
  SHOT_DESCENDING = 'SHOT_DESCENDING', // Discesa verso il ferro
}

// Punto di traiettoria per analisi
export interface TrajectoryPoint {
  x: number
  y: number
  vx: number
  vy: number
  timestamp: number
}

// Risultato dell'analisi
export interface TrajectoryAnalysis {
  motionState: BallMotionState
  releaseCandidate?: TrajectoryPoint | null
  apexCandidate?: TrajectoryPoint | null
  isAscending: boolean
  verticalSpeed: number
  directionChanges: number
  motionDuration: number
}

// Configurazione dell'analizzatore
const TRAJECTORY_CONFIG = {
  // Finestra temporale per analisi del movimento (ms)
  motionWindowMs: 500,

  // Soglia per considerare movimento verso l'alto (coordinate normalizzate)
  ascendingThreshold: -0.005,

  // Soglia per considerare movimento verso il basso
  descendingThreshold: 0.005,

  // Velocità minima per considerare movimento significativo
  minSpeed: 0.01,

  // Numero massimo di cambi di direzione prima di classificare come palleggio
  maxDirectionChanges: 3,

  // Durata minima dell'ascesa per candidata tiro (ms)
  minAscentDuration: 200,

  // Massimo salto tra punti consecutivi (normalizzato)
  maxPointJump: 0.15,

  // Soglia per stabilizzazione release (dy < threshold)
  releaseAscendingThreshold: -0.01,
}

export class BallTrajectoryAnalyzer {
  private motionHistory: TrajectoryPoint[] = []
  private lastDirection: 'up' | 'down' | 'none' = 'none'
  private directionChanges = 0
  private ascentStartTime = 0
  private currentState: BallMotionState = BallMotionState.IDLE

  // Aggiungi un punto alla traiettoria e analizza
  analyze(
    position: BallPosition,
    velocity: BallVelocity | null,
    timestamp: number
  ): TrajectoryAnalysis {
    const point: TrajectoryPoint = {
      x: position.x,
      y: position.y,
      vx: velocity?.vx ?? 0,
      vy: velocity?.vy ?? 0,
      timestamp,
    }

    // Aggiungi alla storia
    this.motionHistory.push(point)

    // Mantieni solo finestra temporale
    this.trimMotionWindow()

    // Calcola metriche
    const verticalSpeed = Math.abs(point.vy)
    const isAscending = point.vy < TRAJECTORY_CONFIG.ascendingThreshold
    const motionDuration = this.getMotionDuration()

    // Aggiorna conteggio cambi direzione
    this.updateDirectionTracking(isAscending)

    // Classifica movimento
    this.classifyMotion(isAscending, verticalSpeed, motionDuration)

    // Trova candidati release/apex
    const releaseCandidate = this.findReleaseCandidate()
    const apexCandidate = this.findApexCandidate()

    return {
      motionState: this.currentState,
      releaseCandidate,
      apexCandidate,
      isAscending,
      verticalSpeed,
      directionChanges: this.directionChanges,
      motionDuration,
    }
  }

  private trimMotionWindow(): void {
    if (this.motionHistory.length === 0) return

    const latestTimestamp = this.motionHistory[this.motionHistory.length - 1].timestamp
    const cutoff = latestTimestamp - TRAJECTORY_CONFIG.motionWindowMs

    this.motionHistory = this.motionHistory.filter(
      p => p.timestamp >= cutoff
    )
  }

  private updateDirectionTracking(isAscending: boolean): void {
    const currentDirection = isAscending ? 'up' : 'down'

    if (currentDirection !== this.lastDirection && this.lastDirection !== 'none') {
      this.directionChanges++
    }

    this.lastDirection = currentDirection
  }

  private classifyMotion(
    isAscending: boolean,
    verticalSpeed: number,
    motionDuration: number
  ): void {
    // Se non abbastanza punti
    if (this.motionHistory.length < 3) {
      this.currentState = BallMotionState.IDLE
      return
    }

    // Troppi cambi di direzione → palleggio
    if (this.directionChanges >= TRAJECTORY_CONFIG.maxDirectionChanges) {
      this.currentState = BallMotionState.DRIBBLE
      this.ascentStartTime = 0
      return
    }

    // Movimento alternato breve → palleggio
    if (this.isAlternatingMotion()) {
      this.currentState = BallMotionState.DRIBBLE
      this.ascentStartTime = 0
      return
    }

    // Ascesa prolungata → candidato tiro
    if (isAscending) {
      if (this.ascentStartTime === 0) {
        this.ascentStartTime = Date.now()
      }

      const ascentDuration = Date.now() - this.ascentStartTime

      if (ascentDuration > TRAJECTORY_CONFIG.minAscentDuration) {
        if (this.currentState === BallMotionState.SHOT_CANDIDATE) {
          this.currentState = BallMotionState.SHOT_ASCENDING
        } else {
          this.currentState = BallMotionState.SHOT_CANDIDATE
        }
      } else {
        this.currentState = BallMotionState.SHOT_CANDIDATE
      }
    } else {
      // Discesa dopo ascesa → tiro in discesa
      if (this.currentState === BallMotionState.SHOT_ASCENDING ||
          this.currentState === BallMotionState.SHOT_CANDIDATE) {
        this.currentState = BallMotionState.SHOT_DESCENDING
      }

      this.ascentStartTime = 0
    }
  }

  private isAlternatingMotion(): boolean {
    if (this.motionHistory.length < 5) return false

    const recent = this.motionHistory.slice(-5)
    let directionChanges = 0

    for (let i = 1; i < recent.length; i++) {
      const prevVy = recent[i - 1].vy
      const currVy = recent[i].vy

      const prevUp = prevVy < 0
      const currUp = currVy < 0

      if (prevUp !== currUp) {
        directionChanges++
      }
    }

    return directionChanges >= 2
  }

  private findReleaseCandidate(): TrajectoryPoint | null {
    if (this.motionHistory.length < 3) return null

    // Cerca punto dove la palla inizia ascesa prolungata
    for (let i = 2; i < this.motionHistory.length; i++) {
      const p0 = this.motionHistory[i - 2]
      const p1 = this.motionHistory[i - 1]
      const p2 = this.motionHistory[i]

      const dy = p1.y - p0.y

      // Stabilizzazione release: dy deve essere negativo (ascesa)
      if (dy < TRAJECTORY_CONFIG.releaseAscendingThreshold) {
        // Verifica che l'ascesa continui
        const dy2 = p2.y - p1.y
        if (dy2 < 0) {
          return p1
        }
      }
    }

    return null
  }

  private findApexCandidate(): TrajectoryPoint | null {
    if (this.motionHistory.length < 3) return null

    // Cerca minimo Y nella finestra (apice = punto più alto = minimo Y)
    let minY = Infinity
    let apexPoint: TrajectoryPoint | null = null

    for (const point of this.motionHistory) {
      if (point.y < minY) {
        minY = point.y
        apexPoint = point
      }
    }

    return apexPoint
  }

  private getMotionDuration(): number {
    if (this.motionHistory.length < 2) return 0

    const first = this.motionHistory[0]
    const last = this.motionHistory[this.motionHistory.length - 1]

    return last.timestamp - first.timestamp
  }

  // Reset dell'analizzatore
  reset(): void {
    this.motionHistory = []
    this.lastDirection = 'none'
    this.directionChanges = 0
    this.ascentStartTime = 0
    this.currentState = BallMotionState.IDLE
  }

  // Stato corrente
  getState(): BallMotionState {
    return this.currentState
  }

  // Storia completa
  getHistory(): TrajectoryPoint[] {
    return [...this.motionHistory]
  }
}
