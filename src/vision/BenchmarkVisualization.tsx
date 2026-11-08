import React from 'react'
import { View, StyleSheet, Text, TouchableOpacity, Image } from 'react-native'
import Svg, { Rect } from 'react-native-svg'
import type { BenchmarkResult } from './useImageBenchmark'

interface BenchmarkVisualizationProps {
  results: BenchmarkResult[]
  imageUris: string[]
  onClose: () => void
}

const CLASS_COLORS = {
  ball: '#FFFF00',      // Giallo
  player: '#00FF00',    // Verde
  rim: '#0000FF',       // Blu
}

export const BenchmarkVisualization: React.FC<BenchmarkVisualizationProps> = ({
  results,
  imageUris,
  onClose,
}) => {
  const [selectedIndex, setSelectedIndex] = React.useState(0)

  const result = results[selectedIndex]
  const imageUri = imageUris[selectedIndex]

  if (!result || !imageUri) {
    return null
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerText}>
          Frame {selectedIndex + 1} / {results.length} - {result.videoName}
        </Text>
        <TouchableOpacity onPress={onClose} style={styles.closeButton}>
          <Text style={styles.closeButtonText}>Chiudi</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.imageContainer}>
        <Image
          source={{ uri: imageUri }}
          style={styles.image}
          resizeMode="contain"
        />
        <Svg style={styles.svgOverlay}>
          {result.ball && (
            <BBox
              x={result.ball.x}
              y={result.ball.y}
              width={result.ball.width}
              height={result.ball.height}
              color={CLASS_COLORS.ball}
            />
          )}
          {result.player && (
            <BBox
              x={result.player.x}
              y={result.player.y}
              width={result.player.width}
              height={result.player.height}
              color={CLASS_COLORS.player}
            />
          )}
        </Svg>
      </View>

      <View style={styles.info}>
        <Text style={styles.infoText}>
          Ball: {result.ball ? `✓ (${result.ball.confidence.toFixed(3)})` : '✗'}
        </Text>
        <Text style={styles.infoText}>
          Player: {result.player ? `✓ (${result.player.confidence.toFixed(3)})` : '✗'}
        </Text>
        <Text style={styles.infoText}>
          Inference: {result.inferenceMs.toFixed(1)}ms
        </Text>
      </View>

      <View style={styles.navigation}>
        <TouchableOpacity
          style={styles.navButton}
          onPress={() => setSelectedIndex(Math.max(0, selectedIndex - 1))}
          disabled={selectedIndex === 0}
        >
          <Text style={styles.navButtonText}>← Prec</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.navButton}
          onPress={() => setSelectedIndex(Math.min(results.length - 1, selectedIndex + 1))}
          disabled={selectedIndex === results.length - 1}
        >
          <Text style={styles.navButtonText}>Succ →</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

interface BBoxProps {
  x: number
  y: number
  width: number
  height: number
  color: string
}

const BBox: React.FC<BBoxProps> = ({ x, y, width, height, color }) => {
  // Convert normalized coordinates to canvas coordinates (400x300)
  const canvasWidth = 400
  const canvasHeight = 300
  
  const x1 = (x - width / 2) * canvasWidth
  const y1 = (y - height / 2) * canvasHeight
  const x2 = (x + width / 2) * canvasWidth
  const y2 = (y + height / 2) * canvasHeight
  const w = x2 - x1
  const h = y2 - y1

  return (
    <Rect
      x={x1}
      y={y1}
      width={w}
      height={h}
      stroke={color}
      strokeWidth={3}
      fill="transparent"
    />
  )
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  headerText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  closeButton: {
    backgroundColor: '#FF4444',
    paddingHorizontal: 15,
    paddingVertical: 8,
    borderRadius: 5,
  },
  closeButtonText: {
    color: '#fff',
    fontWeight: 'bold',
  },
  imageContainer: {
    width: 400,
    height: 300,
    backgroundColor: '#222',
    borderRadius: 8,
    overflow: 'hidden',
  },
  image: {
    width: 400,
    height: 300,
  },
  svgOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 400,
    height: 300,
  },
  info: {
    marginTop: 20,
    alignItems: 'center',
  },
  infoText: {
    color: '#fff',
    fontSize: 16,
    marginVertical: 4,
  },
  navigation: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: 400,
    marginTop: 20,
  },
  navButton: {
    backgroundColor: '#444',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 5,
  },
  navButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
})
