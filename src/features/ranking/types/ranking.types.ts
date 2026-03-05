export interface RankingItem {
    id: string
    playerId: string
    playerName: string
    roleCode: string
    score: number
    rankPosition: number
    seasonYear: number
}

export interface RankingResponse {
    scope: string
    seasonYear: number
    rankings: RankingItem[]
}