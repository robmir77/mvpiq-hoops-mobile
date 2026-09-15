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
}

export const TelemetryOverlay: React.FC<TelemetryOverlayProps> = ({ visible, onClose, yoloFps, moveNetFps }) => {
  const [yoloPerf, setYoloPerf] = useState<YoloPerfMetrics>({ fps: 0, avgMs: 0, minMs: 0, maxMs: 0, samples: 0 })
  const [ballMetrics, setBallMetrics] = useState<BallDetectionMetrics>({
    framesProcessed: 0,
    framesDetected: 0,
    detectionRate: 0,
    avgConfidence: 0,
    minConfidence: 0,
    maxConfidence: 0,
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
    dropped: 0,
    dropRate: 0,
    trackingAccepted: 0,
    overlayRendered: 0,
  })

  // Aggiorna le metriche ogni 500ms
  useEffect(() => {
    const interval = setInterval(() => {
      if (!visible) return
      
      setYoloPerf(telemetryLogger.getYoloPerfMetrics())
      setBboxMetrics(telemetryLogger.getBboxStabilityMetrics())
      setFpMetrics(telemetryLogger.getFalsePositiveMetrics())
      setPipelineMetrics(telemetryLogger.getPipelineMetrics())
      
      // Ball metrics needs framesProcessed
      const pipelineMetrics = telemetryLogger.getPipelineMetrics()
      setBallMetrics(telemetryLogger.getBallDetectionMetrics(pipelineMetrics.processed))
    }, 500)

    return () => clearInterval(interval)
  }, [visible])

  if (!visible) return null

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>📊 TELEMETRIA</Text>
        <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
          <Text style={styles.closeBtnText}>✕</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Model Info */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>MODELLO</Text>
          <View style={styles.row}>
            <Text style={styles.label}>YOLO FPS:</Text>
            <Text style={styles.value}>{yoloFps?.toFixed(1) || '0.0'}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>MoveNet FPS:</Text>
            <Text style={styles.value}>{moveNetFps?.toFixed(1) || '0.0'}</Text>
          </View>
        </View>

        {/* Performance */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>PERFORMANCE</Text>
          <View style={styles.row}>
            <Text style={styles.label}>Avg Inference:</Text>
            <Text style={styles.value}>{yoloPerf.avgMs.toFixed(1)}ms</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Min Inference:</Text>
            <Text style={styles.value}>{yoloPerf.minMs.toFixed(1)}ms</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Max Inference:</Text>
            <Text style={styles.value}>{yoloPerf.maxMs.toFixed(1)}ms</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Samples:</Text>
            <Text style={styles.value}>{yoloPerf.samples}</Text>
          </View>
        </View>

        {/* Ball Detection */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>RILEVAMENTO PALLA</Text>
          <View style={styles.row}>
            <Text style={styles.label}>Frame Processati:</Text>
            <Text style={styles.value}>{ballMetrics.framesProcessed}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Palle Rilevate:</Text>
            <Text style={[styles.value, { color: '#4ade80' }]}>{ballMetrics.framesDetected}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Detection Rate:</Text>
            <Text style={[styles.value, { color: ballMetrics.detectionRate > 50 ? '#4ade80' : '#fbbf24' }]}>
              {ballMetrics.detectionRate.toFixed(1)}%
            </Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Avg Confidence:</Text>
            <Text style={styles.value}>{ballMetrics.avgConfidence.toFixed(2)}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Min Confidence:</Text>
            <Text style={styles.value}>{ballMetrics.minConfidence.toFixed(2)}</Text>
          </View>
        </View>

        {/* False Positives */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>FALSI POSITIVI</Text>
          <View style={styles.row}>
            <Text style={styles.label}>Sospetti:</Text>
            <Text style={[styles.value, { color: fpMetrics.fpRate > 10 ? '#ef4444' : '#4ade80' }]}>
              {fpMetrics.suspicious}
            </Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>FP Rate:</Text>
            <Text style={[styles.value, { color: fpMetrics.fpRate > 10 ? '#ef4444' : '#4ade80' }]}>
              {fpMetrics.fpRate.toFixed(1)}%
            </Text>
          </View>
          {fpMetrics.reasons.size > 0 && (
            <View style={styles.reasonsContainer}>
              {Array.from(fpMetrics.reasons.entries()).map(([reason, count]) => (
                <View key={reason} style={styles.reasonRow}>
                  <Text style={styles.reasonText}>{reason}:</Text>
                  <Text style={styles.reasonCount}>{count}</Text>
                </View>
              ))}
            </View>
          )}
        </View>

        {/* Bbox Stability */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>STABILITÀ BBOX</Text>
          <View style={styles.row}>
            <Text style={styles.label}>Avg Size:</Text>
            <Text style={styles.value}>{bboxMetrics.avgSize.toFixed(1)}px</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Avg Jump:</Text>
            <Text style={[styles.value, { color: bboxMetrics.avgJump < 10 ? '#4ade80' : '#fbbf24' }]}>
              {bboxMetrics.avgJump.toFixed(1)}px
            </Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Max Jump:</Text>
            <Text style={styles.value}>{bboxMetrics.maxJump.toFixed(1)}px</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Jitter:</Text>
            <Text style={styles.value}>{bboxMetrics.jitter.toFixed(1)}px</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Stability:</Text>
            <Text style={[styles.value, { color: bboxMetrics.stability > 80 ? '#4ade80' : '#fbbf24' }]}>
              {bboxMetrics.stability.toFixed(0)}%
            </Text>
          </View>
        </View>

        {/* Pipeline */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>PIPELINE</Text>
          <View style={styles.row}>
            <Text style={styles.label}>Ricevuti:</Text>
            <Text style={styles.value}>{pipelineMetrics.received}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Processati:</Text>
            <Text style={styles.value}>{pipelineMetrics.processed}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Droppati:</Text>
            <Text style={[styles.value, { color: pipelineMetrics.dropRate > 5 ? '#ef4444' : '#4ade80' }]}>
              {pipelineMetrics.dropped}
            </Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Drop Rate:</Text>
            <Text style={[styles.value, { color: pipelineMetrics.dropRate > 5 ? '#ef4444' : '#4ade80' }]}>
              {pipelineMetrics.dropRate.toFixed(1)}%
            </Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Tracking Accepted:</Text>
            <Text style={styles.value}>{pipelineMetrics.trackingAccepted}</Text>
          </View>
        </View>
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 10,
    left: 10,
    width: 220,
    maxHeight: 400,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 140, 0, 0.5)',
    zIndex: 1000,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 140, 0, 0.3)',
  },
  headerTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: '#ff8c00',
    letterSpacing: 0.5,
  },
  closeBtn: {
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  closeBtnText: {
    fontSize: 14,
    color: '#fff',
    fontWeight: '600',
  },
  content: {
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  section: {
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 10,
    fontWeight: '700',
    color: '#fbbf24',
    marginBottom: 4,
    letterSpacing: 0.3,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 2,
  },
  label: {
    fontSize: 9,
    color: '#9ca3af',
    fontWeight: '500',
  },
  value: {
    fontSize: 9,
    color: '#fff',
    fontWeight: '600',
  },
  reasonsContainer: {
    marginTop: 4,
    paddingLeft: 8,
  },
  reasonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 1,
  },
  reasonText: {
    fontSize: 8,
    color: '#9ca3af',
  },
  reasonCount: {
    fontSize: 8,
    color: '#fff',
    fontWeight: '600',
  },
})
