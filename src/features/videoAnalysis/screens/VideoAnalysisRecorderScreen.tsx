import React, { useRef, useState, useEffect } from "react"
import { View, Button, Text, StyleSheet } from "react-native"

import { CameraView, useCameraPermissions } from "expo-camera"
import { NativeStackScreenProps } from "@react-navigation/native-stack"
import { uploadVideo } from "../api/videoUpload.api"
import { VideoAnalysisType } from "../types/videoAnalysis.types"
import * as ImagePicker from "expo-image-picker"

type VideoAnalysisStackParamList = {
    VideoRecorder: {
        type: VideoAnalysisType
    }
    VideoProcessing: {
        videoUrl: string
        type: VideoAnalysisType
    }
}

type Props = NativeStackScreenProps<
    VideoAnalysisStackParamList,
    "VideoRecorder"
>

export default function VideoAnalysisRecorderScreen({
                                                        route,
                                                        navigation,
                                                    }: Props) {

    const cameraRef = useRef<any>(null)

    const [permission, requestPermission] = useCameraPermissions()
    const [recording, setRecording] = useState(false)

    const { type } = route.params

    useEffect(() => {
        if (!permission) return
        if (!permission.granted) {
            requestPermission()
        }
    }, [permission])

    const recordVideo = async () => {

        if (!cameraRef.current) return

        try {

            setRecording(true)

            const video = await cameraRef.current.recordAsync({
                maxDuration: type?.maxVideoSeconds || 10,
            })

            setRecording(false)

            console.log("Video URI:", video.uri)

            // TODO recuperare userId dal tuo auth store
            const userId = "test-user"

            // upload su supabase
            const videoUrl = await uploadVideo(video.uri, userId)

            console.log("Uploaded video URL:", videoUrl)

            navigation.navigate("VideoProcessing", {
                videoUrl,
                type,
            })

        } catch (err) {
            console.error(err)
            setRecording(false)
        }
    }

    const pickVideoFromGallery = async () => {

        try {

            const permission =
                await ImagePicker.requestMediaLibraryPermissionsAsync()

            if (!permission.granted) {
                alert("Gallery permission required")
                return
            }

            const result = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ["videos"],
                quality: 1,
            })

            if (result.canceled || !result.assets?.length) {
                return
            }

            const asset = result.assets[0]

            console.log("Selected video:", asset.uri)

            const userId = "test-user"

            const videoUrl = await uploadVideo(asset.uri, userId)

            navigation.navigate("VideoProcessing", {
                videoUrl,
                type,
            })

        } catch (err) {

            console.error("Gallery error:", err)
            alert("Video upload failed")

        }
    }

    const stopRecording = () => {
        if (cameraRef.current) {
            cameraRef.current.stopRecording()
        }
    }

    if (!permission) {
        return <Text>Loading camera...</Text>
    }

    if (!permission.granted) {
        return <Text>No camera permission</Text>
    }

    return (
        <View style={styles.container}>

            <CameraView
                ref={cameraRef}
                style={styles.camera}
                facing="back"
                mode="video"
            />

            <Button
                title="📂 Upload from gallery"
                onPress={pickVideoFromGallery}
            />

            {!recording ? (
                <Button title="🎥 Record video" onPress={recordVideo} />
            ) : (
                <Button title="🎥 Stop Recording" onPress={stopRecording} />
            )}

        </View>
    )
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: "#000",
    },
    camera: {
        flex: 1,
    },
})
