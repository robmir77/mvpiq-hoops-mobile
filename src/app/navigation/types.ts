export type RootStackParamList = {
    VideoAnalysisHome: undefined
    VideoRecorder: { type: any } // poi lo tipizziamo meglio
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