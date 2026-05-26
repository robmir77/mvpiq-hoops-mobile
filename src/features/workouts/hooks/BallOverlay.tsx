import React from 'react'
import Animated, {
    useAnimatedStyle,
} from 'react-native-reanimated'
import { View } from 'react-native'

export function BallOverlay({
                                ballX,
                                ballY,
                                ballW,
                                ballH,
                                ballConf,
                            }: any) {

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
                🏀 {(ballConf.value * 100).toFixed(1)}%
            </Animated.Text>
        </>
    )
}