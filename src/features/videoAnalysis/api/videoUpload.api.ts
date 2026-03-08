import { supabase } from "@/shared/lib/supabase"

export const uploadVideo = async (
    uri: string,
    userId: string
): Promise<string> => {

    const fileExt = uri.split(".").pop()
    const fileName = `${Date.now()}.${fileExt}`
    const filePath = `${userId}/${fileName}`

    const file = {
        uri,
        name: fileName,
        type: `video/${fileExt}`,
    } as any

    const { error } = await supabase.storage
        .from("videos")
        .upload(filePath, file)

    if (error) {
        throw new Error(error.message)
    }

    const { data } = supabase.storage
        .from("videos")
        .getPublicUrl(filePath)

    return data.publicUrl
}