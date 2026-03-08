import { useEffect, useState } from "react"
import { getAnalysisTypes } from "../api/videoAnalysis.api"
import { VideoAnalysisType } from "../types/videoAnalysis.types"

export const useAnalysisTypes = () => {

    const [types, setTypes] = useState<VideoAnalysisType[]>([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        const load = async () => {
            const data = await getAnalysisTypes()
            setTypes(data)
            setLoading(false)
        }

        load()
    }, [])

    return { types, loading }
}