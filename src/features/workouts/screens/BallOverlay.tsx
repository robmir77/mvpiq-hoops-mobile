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
    })

    useAnimatedReaction(
        () => {
            const confidence = Number(ballConf?.value ?? 0)
            const width = Number(ballW?.value ?? 0)
            const height = Number(ballH?.value ?? 0)
            return `${(confidence * 100).toFixed(1)}|${width.toFixed(0)}x${height.toFixed(0)}`
        },
        (current, previous) => {
            if (current !== previous) {
                const separator = current.indexOf('|')
                const confidence = separator >= 0 ? current.slice(0, separator) : '0.0'
                const dimensions = separator >= 0 ? current.slice(separator + 1) : '0x0'
                runOnJS(setBallInfo)({ confidence, dimensions })
            }
        },
        [ballConf, ballW, ballH]
    )

    const style = useAnimatedStyle(() => {
        return {
            position: 'absolute',
            left: ballX.value,
            top: ballY.value,
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
                🏀 {ballInfo.confidence}% ({ballInfo.dimensions})
            </Animated.Text>
        </>
    )
}
