import React, { useRef, useState, useEffect } from "react"
import { View, TouchableOpacity, Text, StyleSheet } from "react-native"

import { Camera, useCameraPermission } from "react-native-vision-camera"
import type { CameraRef } from "react-native-vision-camera"
import { NativeStackScreenProps } from "@react-navigation/native-stack"
import { uploadVideo } from "../api/videoUpload.api"
import { RootStackParamList } from "@/app/navigation/types"
import * as ImagePicker from "expo-image-picker"
import { AuthContext } from "@/features/auth/context/AuthContext"
import { useContext } from "react"
import { globalStyles } from "@/shared/theme/globalStyles"

type Props = NativeStackScreenProps<RootStackParamList, "VideoRecorder">

export default function VideoAnalysisRecorderScreen({
                                                        route,
                                                        navigation,
                                                    }: Props) {

    const cameraRef = useRef<CameraRef>(null)

    const { hasPermission, requestPermission } = useCameraPermission()
    const [recording, setRecording] = useState(false)

    const { type } = route.params

    const auth = useContext(AuthContext)

    if (!auth) {
        throw new Error("AuthContext not available")
    }

    const { user } = auth

    if (!user) {
        throw new Error("User not available")
    }

    useEffect(() => {
        if (!hasPermission) {
            requestPermission()
        }
    }, [hasPermission, requestPermission])

    // NOTE: Video recording API changed in v5 - needs migration
    const recordVideo = async () => {
        console.warn('[VideoAnalysisRecorder] Video recording not yet migrated to v5 API')
        alert('Video recording requires migration to react-native-vision-camera v5 API')
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

            const userId = user.id

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
        console.warn('[VideoAnalysisRecorder] Video recording not yet migrated to v5 API')
        setRecording(false)
    }

    if (!hasPermission) {
        return <Text>Requesting camera permission...</Text>
    }

    return (
        <View style={styles.container}>

            <Camera
                ref={cameraRef}
                style={styles.camera}
                device={"back"}
                isActive={true}
            />

            <TouchableOpacity
                style={globalStyles.button}
                onPress={pickVideoFromGallery}
            >
                <Text style={globalStyles.buttonText}>📂 Upload from gallery</Text>
            </TouchableOpacity>

            {!recording ? (
                <TouchableOpacity style={globalStyles.button} onPress={recordVideo}>
                    <Text style={globalStyles.buttonText}>🎥 Record video</Text>
                </TouchableOpacity>
            ) : (
                <TouchableOpacity style={globalStyles.button} onPress={stopRecording}>
                    <Text style={globalStyles.buttonText}>🎥 Stop Recording</Text>
                </TouchableOpacity>
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
