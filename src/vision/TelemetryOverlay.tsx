// src/vision/TelemetryOverlay.tsx
//
// Overlay per visualizzare le metriche di telemetria in tempo reale
// Mostra FPS, detection rate, stabilità bbox, falsi positivi, pipeline metrics

import React, { useState, useEffect, useCallback } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native'
import { telemetryLogger } from './telemetry'
import type { YoloPerfMetrics, BallDetectionMetrics, FalsePositiveMetrics, BboxStabilityMetrics, PipelineMetrics } from './telemetry'

interface TelemetryOverlayProps {
  visible: boolean
  onClose: () => void
  yoloFps?: number
  moveNetFps?: number
  debugMode?: boolean
  yoloData?: { x: number; y: number; w: number; h: number; conf: number }
  hoopData?: { x: number; y: number; w: number; h: number; conf: number }
  calibration?: {
    hoopCenter: { x: number; y: number }
    homographyMatrix: number[]
    courtCorners?: any
    cameraMode?: string
  }
}

export const TelemetryOverlay: React.FC<TelemetryOverlayProps> = ({ visible, onClose, yoloFps, moveNetFps, debugMode = false, yoloData, hoopData, calibration }) => {
  const [yoloPerf, setYoloPerf] = useState<YoloPerfMetrics>({ fps: 0, avgMs: 0, minMs: 0, maxMs: 0, samples: 0 })
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
    received: 0,
    processed: 0,
    droppedBusy: 0,
    dropped: 0,
    dropRate: 0,
    yoloDetections: 0,
    ballDetections: 0,
    playerDetections: 0,
    trackingAccepted: 0,
    poseUpdates: 0,
    overlayRendered: 0,
  })

  // Aggiorna le metriche ogni 500ms
  useEffect(() => {
    console.log('[TelemetryOverlay] Visible:', visible)
    const interval = setInterval(() => {
      if (!visible) return
      
      const yoloPerf = telemetryLogger.getYoloPerfMetrics()
      const bboxMetrics = telemetryLogger.getBboxStabilityMetrics()
      const fpMetrics = telemetryLogger.getFalsePositiveMetrics()
      const pipelineMetrics = telemetryLogger.getPipelineMetrics()
      
      console.log('[TelemetryOverlay] Updating metrics:', {
        yoloFps: yoloPerf.fps.toFixed(1),
        detectionRate: telemetryLogger.getBallDetectionMetrics(pipelineMetrics.processed).detectionRate.toFixed(1),
        pipelineProcessed: pipelineMetrics.processed
      })
      
      setYoloPerf(yoloPerf)
      setBboxMetrics(bboxMetrics)
      setFpMetrics(fpMetrics)
      setPipelineMetrics(pipelineMetrics)
      
      // Ball metrics needs framesProcessed
      setBallMetrics(telemetryLogger.getBallDetectionMetrics(pipelineMetrics.processed))
      
      // Player metrics
      setPlayerMetrics(telemetryLogger.getPlayerDetectionMetrics(pipelineMetrics.processed))
    }, 500)

    return () => clearInterval(interval)
  }, [visible])

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
        {debugMode ? (
          // DEBUG MODE: Full diagnostic panel
          <>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>YOLO {yoloPerf.samples > 0 ? '512' : 'N/A'}</Text>
              <View style={styles.row}>
                <Text style={styles.label}>FPS:</Text>
                <Text style={styles.value}>{yoloFps?.toFixed(1) || '0.0'}</Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.label}>Avg:</Text>
                <Text style={styles.value}>{yoloPerf.avgMs.toFixed(1)}ms</Text>
              </View>
              {yoloData && (
                <>
                  <View style={styles.row}>
                    <Text style={styles.label}>Ball X:</Text>
                    <Text style={styles.value}>{yoloData.x.toFixed(3)}</Text>
                  </View>
                  <View style={styles.row}>
                    <Text style={styles.label}>Ball Y:</Text>
                    <Text style={styles.value}>{yoloData.y.toFixed(3)}</Text>
                  </View>
                  <View style={styles.row}>
                    <Text style={styles.label}>W/H:</Text>
                    <Text style={styles.value}>{yoloData.w.toFixed(3)} / {yoloData.h.toFixed(3)}</Text>
                  </View>
                  <View style={styles.row}>
                    <Text style={styles.label}>Conf:</Text>
                    <Text style={styles.value}>{(yoloData.conf * 100).toFixed(1)}%</Text>
                  </View>
                </>
              )}
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>CANESTRO</Text>
              {hoopData ? (
                <>
                  <View style={styles.row}>
                    <Text style={styles.label}>X:</Text>
                    <Text style={styles.value}>{hoopData.x.toFixed(3)}</Text>
                  </View>
                  <View style={styles.row}>
                    <Text style={styles.label}>Y:</Text>
                    <Text style={styles.value}>{hoopData.y.toFixed(3)}</Text>
                  </View>
                  <View style={styles.row}>
                    <Text style={styles.label}>W/H:</Text>
                    <Text style={styles.value}>{hoopData.w.toFixed(3)} / {hoopData.h.toFixed(3)}</Text>
                  </View>
                  <View style={styles.row}>
                    <Text style={styles.label}>Conf:</Text>
                    <Text style={styles.value}>{hoopData.conf.toFixed(3)}</Text>
                  </View>
                </>
              ) : (
                <View style={styles.row}>
                  <Text style={styles.value}>Nessun dato</Text>
                </View>
              )}
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>CALIBRAZIONE</Text>
              {calibration ? (
                <>
                  <View style={styles.row}>
                    <Text style={styles.label}>Hoop salvato:</Text>
                    <Text style={styles.value}>({calibration.hoopCenter.x.toFixed(3)}, {calibration.hoopCenter.y.toFixed(3)})</Text>
                  </View>
                  <View style={styles.row}>
                    <Text style={styles.label}>Homography:</Text>
                    <Text style={styles.value}>{calibration.homographyMatrix.length > 0 ? `${calibration.homographyMatrix.length} coeff.` : 'identità'}</Text>
                  </View>
                  {calibration.cameraMode && (
                    <View style={styles.row}>
                      <Text style={styles.label}>Mode:</Text>
                      <Text style={styles.value}>{calibration.cameraMode}</Text>
                    </View>
                  )}
                  {calibration.courtCorners && (
                    <View style={styles.row}>
                      <Text style={styles.label}>Campo:</Text>
                      <Text style={styles.value}>4 angoli ✓</Text>
                    </View>
                  )}
                </>
              ) : (
                <View style={styles.row}>
                  <Text style={styles.value}>Non calibrato</Text>
                </View>
              )}
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
              <Text style={styles.sectionTitle}>MOVENET 192</Text>
              <View style={styles.row}>
                <Text style={styles.label}>FPS:</Text>
                <Text style={styles.value}>{moveNetFps?.toFixed(1) || '0.0'}</Text>
              </View>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>PIPE</Text>
              <View style={styles.row}>
                <Text style={styles.label}>Total:</Text>
                <Text style={styles.value}>{pipelineMetrics.processed} / {pipelineMetrics.received}</Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.label}>Ball:</Text>
                <Text style={styles.value}>{pipelineMetrics.ballDetections}</Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.label}>Player:</Text>
                <Text style={styles.value}>{pipelineMetrics.playerDetections}</Text>
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
              <Text style={styles.label}>YOLO FPS:</Text>
              <Text style={styles.value}>{yoloFps?.toFixed(1) || '0.0'}</Text>
            </View>

            <View style={styles.row}>
              <Text style={styles.label}>Ball Detection:</Text>
              <Text style={[styles.value, { color: ballMetrics.detectionRate > 50 ? '#4ade80' : '#fbbf24' }]}>
                {ballMetrics.detectionRate.toFixed(1)}%
              </Text>
            </View>

            <View style={styles.row}>
              <Text style={styles.label}>FP Rate:</Text>
              <Text style={[styles.value, { color: fpMetrics.fpRate > 10 ? '#ef4444' : '#4ade80' }]}>
                {fpMetrics.fpRate.toFixed(1)}%
              </Text>
            </View>

            <View style={styles.row}>
              <Text style={styles.label}>Stabilità:</Text>
              <Text style={[styles.value, { color: bboxMetrics.stability > 80 ? '#4ade80' : '#fbbf24' }]}>
                {bboxMetrics.stability.toFixed(0)}%
              </Text>
            </View>

            <View style={styles.row}>
              <Text style={styles.label}>Batteria:</Text>
              <Text style={styles.value}>N/A</Text>
            </View>
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
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
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
