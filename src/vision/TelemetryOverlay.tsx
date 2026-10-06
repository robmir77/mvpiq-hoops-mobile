// src/vision/TelemetryOverlay.tsx
//
// Overlay per visualizzare le metriche di performance in tempo reale
// Mostra FPS YOLO/MoveNet, detection rate, pipeline metrics
// NOTA: Dati specifici (palla, canestro, calibrazione) sono in ReactOverlay

import React, { useState, useEffect, useCallback } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native'
import { telemetryLogger } from './telemetry'
import type { YoloPerfMetrics, BallDetectionMetrics, FalsePositiveMetrics, BboxStabilityMetrics, PipelineMetrics, MoveNetMetrics } from './telemetry'

interface TelemetryOverlayProps {
  visible: boolean
  onClose: () => void
  yoloFps?: number
  moveNetFps?: number
  actualCameraFps?: number
  debugMode?: boolean
  cameraConfig?: {
    resolution?: { width: number; height: number }
    fps?: number
  }
  modelConfig?: {
    yoloModel?: string
    moveNetModel?: string
    moveNetResolution?: number
    fpsMin?: number
    fpsMax?: number
    epochs?: number
    usageMinutes?: number
    usageSeconds?: number
  }
}

export const TelemetryOverlay: React.FC<TelemetryOverlayProps> = ({ visible, onClose, yoloFps, moveNetFps, actualCameraFps, debugMode = false, cameraConfig, modelConfig }) => {
  const [yoloPerf, setYoloPerf] = useState<YoloPerfMetrics>({ throughputFps: 0, theoreticalFps: 0, avgMs: 0, minMs: 0, maxMs: 0, samples: 0, requested: 0, executed: 0, skipped: 0, scheduleWaitMs: 0, resizeMs: 0, runMs: 0, parseMs: 0 })
  const [ballMetrics, setBallMetrics] = useState<BallDetectionMetrics>({
    framesProcessed: 0,
    framesDetected: 0,
    detectionRate: 0,
    avgConfidence: 0,
    minConfidence: 0,
    maxConfidence: 0,
  })
  const [playerMetrics, setPlayerMetrics] = useState<any>({
    framesProcessed: 0,
    framesDetected: 0,
    detectionRate: 0,
    avgConfidence: 0,
    avgBboxSize: 0,
    bboxStability: 0,
  })
  const [fpMetrics, setFpMetrics] = useState<FalsePositiveMetrics>({ suspicious: 0, fpRate: 0, reasons: new Map() })
  const [bboxMetrics, setBboxMetrics] = useState<BboxStabilityMetrics>({
    avgSize: 0,
    avgJump: 0,
    maxJump: 0,
    jitter: 0,
    stability: 0,
  })
  const [pipelineMetrics, setPipelineMetrics] = useState<PipelineMetrics>({
    cameraFPS: 0,
    received: 0,
    processed: 0,
    droppedBusy: 0,
    dropped: 0,
    dropRate: 0,
    yoloExecuted: 0,
    framesWithBall: 0,
    framesWithPlayer: 0,
    trackingAccepted: 0,
    poseUpdates: 0,
    overlayRendered: 0,
  })
  const [moveNetMetrics, setMoveNetMetrics] = useState<MoveNetMetrics>({
    modelInput: 192,
    inferenceTimes: [],
    throughputFps: 0,
    theoreticalFps: 0,
    avgMs: 0,
    minMs: 0,
    maxMs: 0,
    validKeypoints: 0,
    avgConfidence: 0,
    keypointStability: 0,
    requested: 0,
    executed: 0,
    skipped: 0,
    workletPrepMs: 0,
    cropMs: 0,
    resizeMs: 0,
    runMs: 0,
    parseMs: 0,
    scheduleWaitMs: 0,
  })

  // Aggiorna le metriche ogni 500ms
  useEffect(() => {
    console.log('[TelemetryOverlay] Visible:', visible)
    const interval = setInterval(() => {
      if (!visible) return

      const tStart = performance.now()
      telemetryLogger.recordRnUiUpdate()

      const yoloPerf = telemetryLogger.getYoloPerfMetrics()
      const bboxMetrics = telemetryLogger.getBboxStabilityMetrics()
      const fpMetrics = telemetryLogger.getFalsePositiveMetrics()
      const pipelineMetrics = telemetryLogger.getPipelineMetrics()
      const moveNetMetrics = telemetryLogger.getMoveNetMetrics()

      // Use props if available, otherwise use telemetryLogger
      const displayYoloFps = yoloFps ?? yoloPerf.throughputFps
      const displayMoveNetFps = moveNetFps ?? moveNetMetrics.throughputFps

      console.log('[TelemetryOverlay] Updating metrics:', {
        yoloFps: displayYoloFps.toFixed(1),
        yoloMinMs: yoloPerf.minMs?.toFixed(1) || '0.0',
        yoloMaxMs: yoloPerf.maxMs?.toFixed(1) || '0.0',
        yoloSamples: yoloPerf.samples,
        detectionRate: telemetryLogger.getBallDetectionMetrics(pipelineMetrics.processed).detectionRate.toFixed(1),
        pipelineProcessed: pipelineMetrics.processed,
        usageMinutes: modelConfig?.usageMinutes
      })

      // Update yoloPerf with prop FPS but keep latency data from logger
      setYoloPerf({
        ...yoloPerf,
        throughputFps: displayYoloFps,
        // Keep latency metrics from telemetryLogger
        minMs: yoloPerf.minMs,
        maxMs: yoloPerf.maxMs,
        avgMs: yoloPerf.avgMs,
        samples: yoloPerf.samples,
      })
      setBboxMetrics(bboxMetrics)
      setFpMetrics(fpMetrics)
      setPipelineMetrics(pipelineMetrics)
      // Update moveNetMetrics with prop FPS but keep latency data from logger
      setMoveNetMetrics({
        ...moveNetMetrics,
        throughputFps: displayMoveNetFps,
        // Keep latency metrics from telemetryLogger
        minMs: moveNetMetrics.minMs,
        maxMs: moveNetMetrics.maxMs,
        avgMs: moveNetMetrics.avgMs,
      })

      // Ball metrics needs framesProcessed
      setBallMetrics(telemetryLogger.getBallDetectionMetrics(pipelineMetrics.processed))

      // Player metrics
      setPlayerMetrics(telemetryLogger.getPlayerDetectionMetrics(pipelineMetrics.processed))
      const tEnd = performance.now()
      const duration = tEnd - tStart
      if (duration > 5) {
        console.log('[TELEMETRY OVERLAY UPDATE] slow:', duration.toFixed(1) + 'ms')
      }
    }, 500)

    return () => clearInterval(interval)
  }, [visible, modelConfig?.usageMinutes, modelConfig?.usageSeconds, modelConfig?.fpsMin, modelConfig?.fpsMax, yoloFps, moveNetFps])

  if (!visible) {
    console.log('[TelemetryOverlay] Not rendering - visible is false')
    return null
  }
  
  console.log('[TelemetryOverlay] Rendering overlay')

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{debugMode ? '🔍 DEBUG' : '📊 TELEMETRIA'}</Text>
        <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
          <Text style={styles.closeBtnText}>✕</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.content}>
        {/* FPS section */}
        <View style={styles.section}>
          <View style={styles.row}>
            <Text style={styles.label}>Camera:</Text>
            <Text style={styles.value}>{Math.round(pipelineMetrics.cameraFPS)} FPS</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>YOLO:</Text>
            <Text style={styles.value}>{Math.round(yoloPerf.throughputFps)} FPS</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>MoveNet:</Text>
            <Text style={styles.value}>{Math.round(moveNetMetrics.throughputFps)} FPS</Text>
          </View>
        </View>
        {debugMode ? (
          // DEBUG MODE: Full diagnostic panel
          <>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>YOLO {yoloPerf.samples > 0 ? '512' : 'N/A'}</Text>
              <View style={styles.row}>
                <Text style={styles.label}>Cam FPS:</Text>
                <Text style={styles.value}>{pipelineMetrics.cameraFPS.toFixed(1)}</Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.label}>Req/Exec/Skip:</Text>
                <Text style={styles.value}>{yoloPerf.requested}/{yoloPerf.executed}/{yoloPerf.skipped}</Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.label}>Throughput FPS:</Text>
                <Text style={styles.value}>{yoloPerf.throughputFps.toFixed(1)}</Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.label}>FPS Range:</Text>
                <Text style={styles.value}>
                  {yoloPerf.maxMs > 0 ? (1000 / yoloPerf.maxMs).toFixed(1) : '0.0'}-{yoloPerf.minMs > 0 ? (1000 / yoloPerf.minMs).toFixed(1) : '0.0'}
                </Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.label}>Avg:</Text>
                <Text style={styles.value}>{yoloPerf.avgMs?.toFixed(1) || '0.0'}ms</Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.label}>Min/Max:</Text>
                <Text style={styles.value}>{yoloPerf.minMs?.toFixed(1) || '0.0'}/{yoloPerf.maxMs?.toFixed(1) || '0.0'}ms</Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.label}>Resize:</Text>
                <Text style={styles.value}>{yoloPerf.resizeMs?.toFixed(1) || '0.0'}ms</Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.label}>Run:</Text>
                <Text style={styles.value}>{yoloPerf.runMs?.toFixed(1) || '0.0'}ms</Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.label}>Parse:</Text>
                <Text style={styles.value}>{yoloPerf.parseMs?.toFixed(1) || '0.0'}ms</Text>
              </View>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>DETECTION</Text>
              <View style={styles.row}>
                <Text style={styles.label}>Ball:</Text>
                <Text style={[styles.value, { color: ballMetrics.avgConfidence > 0.5 ? '#4ade80' : '#fbbf24' }]}>
                  {ballMetrics.avgConfidence > 0 ? '✓' : '✗'} {ballMetrics.avgConfidence.toFixed(2)}
                </Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.label}>Player:</Text>
                <Text style={[styles.value, { color: playerMetrics.avgConfidence > 0.5 ? '#4ade80' : '#fbbf24' }]}>
                  {playerMetrics.avgConfidence > 0 ? '✓' : '✗'} {playerMetrics.avgConfidence.toFixed(2)}
                </Text>
              </View>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>TRACKING</Text>
              <View style={styles.row}>
                <Text style={styles.label}>Status:</Text>
                <Text style={[styles.value, { color: pipelineMetrics.trackingAccepted > 0 ? '#4ade80' : '#ef4444' }]}>
                  {pipelineMetrics.trackingAccepted > 0 ? '✓' : '✗'}
                </Text>
              </View>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>MOVENET {moveNetMetrics.modelInput}</Text>
              <View style={styles.row}>
                <Text style={styles.label}>Req/Exec/Drop:</Text>
                <Text style={styles.value}>{moveNetMetrics.requested}/{moveNetMetrics.executed}/{pipelineMetrics.droppedBusy}</Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.label}>Throughput:</Text>
                <Text style={styles.value}>{moveNetMetrics.throughputFps.toFixed(1)} FPS</Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.label}>Avg Latency:</Text>
                <Text style={styles.value}>{moveNetMetrics.avgMs.toFixed(1)}ms</Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.label}>Crop:</Text>
                <Text style={styles.value}>{moveNetMetrics.cropMs.toFixed(1)}ms</Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.label}>Resize:</Text>
                <Text style={styles.value}>{moveNetMetrics.resizeMs.toFixed(1)}ms</Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.label}>Run:</Text>
                <Text style={styles.value}>{moveNetMetrics.runMs.toFixed(1)}ms</Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.label}>Parse:</Text>
                <Text style={styles.value}>{moveNetMetrics.parseMs.toFixed(1)}ms</Text>
              </View>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>CAMERA</Text>
              <View style={styles.row}>
                <Text style={styles.label}>Res:</Text>
                <Text style={styles.value}>{cameraConfig?.resolution ? `${cameraConfig.resolution.width}×${cameraConfig.resolution.height}` : 'N/A'}</Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.label}>FPS:</Text>
                <Text style={styles.value}>{cameraConfig?.fps ?? 'N/A'}</Text>
              </View>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>MODELS</Text>
              <View style={styles.row}>
                <Text style={styles.label}>YOLO:</Text>
                <Text style={styles.value}>{modelConfig?.yoloModel ?? 'N/A'}</Text>
              </View>
              {modelConfig?.fpsMin && modelConfig?.fpsMax && (
                <View style={styles.row}>
                  <Text style={styles.label}>FPS Range:</Text>
                  <Text style={styles.value}>{modelConfig.fpsMin}-{modelConfig.fpsMax}</Text>
                </View>
              )}
              {modelConfig?.epochs && (
                <View style={styles.row}>
                  <Text style={styles.label}>Epoche:</Text>
                  <Text style={styles.value}>{modelConfig.epochs}</Text>
                </View>
              )}
              {modelConfig?.usageMinutes !== undefined && (
                <View style={styles.row}>
                  <Text style={styles.label}>Utilizzo:</Text>
                  <Text style={styles.value}>{modelConfig.usageMinutes} min</Text>
                </View>
              )}
              <View style={styles.row}>
                <Text style={styles.label}>MoveNet:</Text>
                <Text style={styles.value}>{modelConfig?.moveNetModel ?? 'N/A'}</Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.label}>Pose Res:</Text>
                <Text style={styles.value}>{modelConfig?.moveNetResolution ?? 'N/A'}</Text>
              </View>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>SYSTEM</Text>
              <View style={styles.row}>
                <Text style={styles.label}>CPU:</Text>
                <Text style={styles.value}>N/A</Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.label}>RAM:</Text>
                <Text style={styles.value}>N/A</Text>
              </View>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>PIPE</Text>
              <View style={styles.row}>
                <Text style={styles.label}>Cam FPS:</Text>
                <Text style={styles.value}>{pipelineMetrics.cameraFPS.toFixed(1)}</Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.label}>Received:</Text>
                <Text style={styles.value}>{pipelineMetrics.received}</Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.label}>Processed:</Text>
                <Text style={styles.value}>{pipelineMetrics.processed}</Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.label}>Dropped:</Text>
                <Text style={styles.value}>{pipelineMetrics.droppedBusy}</Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.label}>YOLO Exec:</Text>
                <Text style={styles.value}>{pipelineMetrics.yoloExecuted}</Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.label}>Ball Frames:</Text>
                <Text style={styles.value}>{pipelineMetrics.framesWithBall}</Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.label}>Player Frames:</Text>
                <Text style={styles.value}>{pipelineMetrics.framesWithPlayer}</Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.label}>Track:</Text>
                <Text style={styles.value}>{pipelineMetrics.trackingAccepted}</Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.label}>Pose:</Text>
                <Text style={styles.value}>{pipelineMetrics.poseUpdates}</Text>
              </View>
            </View>
          </>
        ) : (
          // NORMAL MODE: Simplified telemetry
          <>
            <View style={styles.row}>
              <Text style={styles.label}>FPS Range:</Text>
              <Text style={styles.value}>
                {Math.round(yoloPerf.throughputFps * 0.8)}-{Math.round(yoloPerf.throughputFps * 1.2)}
              </Text>
            </View>

            {modelConfig?.usageMinutes !== undefined && (
              <View style={styles.row}>
                <Text style={styles.label}>Utilizzo:</Text>
                <Text style={styles.value}>{modelConfig.usageMinutes}:{(modelConfig.usageSeconds ?? 0).toString().padStart(2, '0')}</Text>
              </View>
            )}
          </>
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 10,
    left: 10,
    width: 160,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ff8c00',
    zIndex: 9999,
    elevation: 10,
    padding: 6,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  headerTitle: {
    fontSize: 10,
    fontWeight: '800',
    color: '#ff8c00',
    letterSpacing: 0.5,
  },
  closeBtn: {
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  closeBtnText: {
    fontSize: 12,
    color: '#fff',
    fontWeight: '600',
  },
  content: {
    gap: 2,
  },
  section: {
    marginBottom: 4,
    paddingBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 140, 0, 0.3)',
  },
  sectionTitle: {
    fontSize: 9,
    fontWeight: '700',
    color: '#ff8c00',
    marginBottom: 2,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  label: {
    fontSize: 8,
    color: '#9ca3af',
    fontWeight: '500',
  },
  value: {
    fontSize: 8,
    color: '#fff',
    fontWeight: '600',
  },
})
