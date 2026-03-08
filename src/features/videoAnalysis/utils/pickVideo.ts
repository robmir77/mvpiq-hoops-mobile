import * as ImagePicker from "expo-image-picker"

export const pickVideoFromGallery = async (): Promise<string | null> => {

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync()

    if (!permission.granted) {
        alert("Permission required to access gallery")
        return null
    }

    const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Videos,
        quality: 1,
    })

    if (result.canceled) {
        return null
    }

    return result.assets[0].uri
}