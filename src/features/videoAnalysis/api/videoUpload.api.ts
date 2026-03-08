import { supabase } from "@/shared/lib/supabase"

export const uploadVideo = async (
    uri: string,
    userId: string
): Promise<string> => {

    const fileExt = uri.split(".").pop()
    const fileName = `${Date.now()}.${fileExt}`
    const filePath = `${userId}/${fileName}`

    // conversione file:// -> blob
    const response = await fetch(uri)
    const blob = await response.blob()

    const mimeType =
        fileExt === "mov" ? "video/quicktime" : `video/${fileExt}`

    const { error } = await supabase.storage
        .from("videos")
        .upload(filePath, blob, {
            contentType: mimeType,
        })

    if (error) {
        throw new Error(error.message)
    }

    const { data } = supabase.storage
        .from("videos")
        .getPublicUrl(filePath)

    return data.publicUrl
}