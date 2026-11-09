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

const IMAGE_CONTAINER_WIDTH = 400
const IMAGE_CONTAINER_HEIGHT = 300

export const BenchmarkVisualization: React.FC<BenchmarkVisualizationProps> = ({
  results,
  imageUris,
  onClose,
}) => {
  const [selectedIndex, setSelectedIndex] = React.useState(0)
  const [imageSize, setImageSize] = React.useState<{ width: number; height: number } | null>(null)

  const result = results[selectedIndex]
  const imageUri = imageUris[selectedIndex]

  React.useEffect(() => {
    let cancelled = false
    setImageSize(null)

    if (imageUri) {
      Image.getSize(
        imageUri,
        (width, height) => {
          if (!cancelled) {
            setImageSize({ width, height })
          }
        },
        error => {
          console.warn('[BenchmarkVisualization] Unable to read image dimensions:', error)
          if (!cancelled) {
            setImageSize(null)
          }
        },
      )
    }

    return () => {
      cancelled = true
    }
  }, [imageUri])

  if (!result || !imageUri) {
    return null
  }

  // Match the exact "contain" rectangle used by the Image inside its 400x300 box.
  // The SVG is placed over that rectangle, not over the letterboxed container.
  const imageScale = imageSize
    ? Math.min(
        IMAGE_CONTAINER_WIDTH / imageSize.width,
        IMAGE_CONTAINER_HEIGHT / imageSize.height,
      )
    : 0
  const renderedWidth = imageSize ? imageSize.width * imageScale : 0
  const renderedHeight = imageSize ? imageSize.height * imageScale : 0
  const imageLeft = (IMAGE_CONTAINER_WIDTH - renderedWidth) / 2
  const imageTop = (IMAGE_CONTAINER_HEIGHT - renderedHeight) / 2

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
        {imageSize && (
          <Svg
            width={renderedWidth}
            height={renderedHeight}
            viewBox={`0 0 ${renderedWidth} ${renderedHeight}`}
            style={[
              styles.svgOverlay,
              {
                left: imageLeft,
                top: imageTop,
                width: renderedWidth,
                height: renderedHeight,
              },
            ]}
          >
            {result.ball && (
              <BBox
                x={result.ball.x}
                y={result.ball.y}
                width={result.ball.width}
                height={result.ball.height}
                canvasWidth={renderedWidth}
                canvasHeight={renderedHeight}
                color={CLASS_COLORS.ball}
              />
            )}
            {result.player && (
              <BBox
                x={result.player.x}
                y={result.player.y}
                width={result.player.width}
                height={result.player.height}
                canvasWidth={renderedWidth}
                canvasHeight={renderedHeight}
                color={CLASS_COLORS.player}
              />
            )}
          </Svg>
        )}
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
  canvasWidth: number
  canvasHeight: number
  color: string
}

const BBox: React.FC<BBoxProps> = ({
  x,
  y,
  width,
  height,
  canvasWidth,
  canvasHeight,
  color,
}) => {
  // Detection x/y are normalized center coordinates, not top-left coordinates.
  const rectWidth = width * canvasWidth
  const rectHeight = height * canvasHeight
  const left = (x - width / 2) * canvasWidth
  const top = (y - height / 2) * canvasHeight

  return (
    <Rect
      x={left}
      y={top}
      width={rectWidth}
      height={rectHeight}
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
    width: IMAGE_CONTAINER_WIDTH,
    height: IMAGE_CONTAINER_HEIGHT,
    backgroundColor: '#222',
    borderRadius: 8,
    overflow: 'hidden',
  },
  image: {
    width: IMAGE_CONTAINER_WIDTH,
    height: IMAGE_CONTAINER_HEIGHT,
  },
  svgOverlay: {
    position: 'absolute',
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
    width: IMAGE_CONTAINER_WIDTH,
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
