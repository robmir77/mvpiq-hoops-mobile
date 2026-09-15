import React, { useState } from 'react'
import Animated, {
    runOnJS,
    useAnimatedReaction,
    useAnimatedStyle,
} from 'react-native-reanimated'

export function BallOverlay({
    ballX,
    ballY,
    ballW,
    ballH,
    ballConf,
}: any) {
    const [ballInfo, setBallInfo] = useState({
        confidence: '0.0',
        dimensions: '0x0',
        size: 'N/A',
    })

    useAnimatedReaction(
        () => {
            const confidence = Number(ballConf?.value ?? 0)
            const width = Number(ballW?.value ?? 0)
            const height = Number(ballH?.value ?? 0)
            
            // Classifica dimensione palla
            let size = 'N/A'
            const avgSize = (width + height) / 2
            if (avgSize < 0.05) {
                size = '🔴 PICCOLA'
            } else if (avgSize < 0.15) {
                size = '🟡 MEDIA'
            } else {
                size = '🟢 GRANDE'
            }
            
            return `${(confidence * 100).toFixed(1)}|${width.toFixed(0)}x${height.toFixed(0)}|${size}`
        },
        (current, previous) => {
            if (current !== previous) {
                const parts = current.split('|')
                const confidence = parts[0] || '0.0'
                const dimensions = parts[1] || '0x0'
                const size = parts[2] || 'N/A'
                runOnJS(setBallInfo)({ confidence, dimensions, size })
            }
        },
        [ballConf, ballW, ballH]
    )

    const style = useAnimatedStyle(() => {
        return {
            position: 'absolute',
            left: ballX.value - ballW.value / 2,
            top: ballY.value - ballH.value / 2,
            width: ballW.value,
            height: ballH.value,
            borderWidth: 2,
            borderColor: 'lime',
            backgroundColor: 'rgba(0,255,0,0.15)',
        }
    })

    const labelStyle = useAnimatedStyle(() => {
        return {
            position: 'absolute',
            left: ballX.value,
            top: ballY.value - 20,
            color: 'lime',
            fontSize: 12,
            fontWeight: 'bold',
        }
    })

    return (
        <>
            <Animated.View style={style} />
            <Animated.Text style={labelStyle}>
                🏀 {ballInfo.confidence}% ({ballInfo.dimensions}) {ballInfo.size}
            </Animated.Text>
        </>
    )
}
