import { VideoAnalysisType } from "@/features/videoAnalysis/types/videoAnalysis.types"

export type RootStackParamList = {
    Main: undefined
    EditProfile: undefined
    EditCv: undefined
    GoalWizard: undefined
    ChatScreen: { chatId: string }
    NewChat: undefined
    messages: undefined
    notifications: undefined
    home: undefined
    profile: { userId?: string }
    player_profile: { userId: string }
    player_goals: { userId: string }
    player_cv: { userId: string }
    scout_rankings: undefined
    admin_users: undefined
    player_journal: undefined
    player_training: undefined
    player_workouts: undefined
    ai_training_tools: undefined
    trainer_ai: undefined
    admin_checklist: undefined
    player_stats: undefined
    player_media: undefined
    scout_search: undefined
    scout_reports: undefined
    trainer_programs: undefined
    trainer_clients: undefined
    trainer_exercises: undefined
    creator_content: undefined
    creator_templates: undefined
    creator_analytics: undefined
    admin_subscriptions: undefined
    admin_gamification: undefined
    admin_notifications: undefined
    settings: undefined
    video_analysis: undefined
    VideoRecorder: { type: VideoAnalysisType }
    VideoProcessing: { videoUrl: string; type: VideoAnalysisType }
    VideoResult: { sessionId: string }
    live_shot_tracking: undefined
    Auth: undefined
}

export type AuthStackParamList = {
    Login: undefined
    Register: undefined
}

export type MainStackParamList = {
    Main: undefined
    GoalWizard: undefined
    Goals: undefined
    EditProfile: { playerId: string }
    EditCv: { playerId: string }
    Cv: undefined
    Positions: undefined
    ChatScreen: { conversationId: string }
    NewChat: undefined
}