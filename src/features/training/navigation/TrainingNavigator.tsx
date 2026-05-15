import { createNativeStackNavigator } from '@react-navigation/native-stack'

import TrainingScreen from '../screens/TrainingScreen'
import VideoAnalysisHomeScreen from '../../videoAnalysis/screens/VideoAnalysisHomeScreen'
import VideoAnalysisRecorderScreen from '../../videoAnalysis/screens/VideoAnalysisRecorderScreen'
import VideoAnalysisProcessingScreen from '../../videoAnalysis/screens/VideoAnalysisProcessingScreen'
import VideoAnalysisResultScreen from '../../videoAnalysis/screens/VideoAnalysisResultScreen'
import { VideoAnalysisType } from '../../videoAnalysis/types/videoAnalysis.types'

export type TrainingStackParamList = {
    TrainingHome: undefined
    VideoAnalysisHome: undefined
    VideoRecorder: { type: VideoAnalysisType }
    VideoProcessing: { videoUrl: string; type: VideoAnalysisType }
    VideoResult: { sessionId: string }
}

const Stack = createNativeStackNavigator<TrainingStackParamList>()

export default function TrainingNavigator() {
    return (
        <Stack.Navigator screenOptions={{}}>
            <Stack.Screen
                name="TrainingHome"
                component={TrainingScreen}
                options={{ headerShown: false }}
            />

            <Stack.Screen
                name="VideoAnalysisHome"
                component={VideoAnalysisHomeScreen}
                options={{ title: "Video Analysis" }}
            />

            <Stack.Screen
                name="VideoRecorder"
                component={VideoAnalysisRecorderScreen}
            />

            <Stack.Screen
                name="VideoProcessing"
                component={VideoAnalysisProcessingScreen}
            />

            <Stack.Screen
                name="VideoResult"
                component={VideoAnalysisResultScreen}
            />
        </Stack.Navigator>
    )
}