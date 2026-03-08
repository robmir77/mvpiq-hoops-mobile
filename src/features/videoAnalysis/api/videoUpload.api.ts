import apiClient from "@/shared/api/apiClient"

export const uploadVideo = async (
    uri: string,
    userId: string
): Promise<string> => {

    console.log("🎥 Upload start")
    console.log("📁 URI:", uri)

    const formData = new FormData()

    formData.append("file", {
        uri,
        name: "video.mp4",
        type: "video/mp4",
    } as any)

    formData.append("userId", userId)

    const response = await apiClient.post(
        "/videos/upload",
        formData,
        {
            headers: {
                "Content-Type": "multipart/form-data",
            },
        }
    )

    console.log("✅ Upload response:", response.data)

    return response.data.storageUrl
}