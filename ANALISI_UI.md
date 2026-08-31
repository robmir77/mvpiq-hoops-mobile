# Documento di Analisi Tecnica - UI Mobile MVPiQ Hoops

## 1. Panoramica del Progetto

### 1.1 Informazioni Generali

- **Nome Progetto**: MVPiQ Hoops Mobile
- **Framework**: React Native 0.79.6
- **Runtime**: Expo ~53.0.0
- **Linguaggio**: TypeScript ~5.8.3
- **Gestione Stato**: React Query (@tanstack/react-query) + Context API
- **Navigazione**: React Navigation v7
- **Versione**: 1.0.0

### 1.2 Architettura Software

L'app mobile segue un'architettura a feature-based con separazione dei compiti e componenti riutilizzabili:

```
┌─────────────────────────────────────┐
│         App Layer                    │
│  (App.tsx, AppProviders)             │
└─────────────────────────────────────┘
                  ↓
┌─────────────────────────────────────┐
│      Navigation Layer               │
│  (AppNavigator, AuthNavigator,      │
│   MainNavigator, Feature Navigators)│
└─────────────────────────────────────┘
                  ↓
┌─────────────────────────────────────┐
│      Feature Layer                  │
│  (Screens, Components, Hooks, API)  │
└─────────────────────────────────────┘
                  ↓
┌─────────────────────────────────────┐
│      Shared Layer                   │
│  (Components, Theme, Utils, API)    │
└─────────────────────────────────────┘
                  ↓
┌─────────────────────────────────────┐
│      External Services              │
│  (Backend API, Firebase, Supabase)  │
└─────────────────────────────────────┘
```

1. **App Layer**: Entry point dell'applicazione con configurazione dei providers globali
2. **Navigation Layer**: Gestione del routing e navigazione tra schermate
3. **Feature Layer**: Moduli funzionali indipendenti con logica specifica
4. **Shared Layer**: Componenti riutilizzabili, tema, utility e configurazione API
5. **External Services**: Integrazione con backend, Firebase Cloud Messaging, storage

---

## 2. Stack Tecnologico

### 2.1 Core Framework e Librerie

- **React Native 0.79.6**: Framework principale per lo sviluppo mobile cross-platform
- **Expo ~53.0.0**: Platform per sviluppo React Native con tooling e SDK
- **TypeScript ~5.8.3**: Supertipo di JavaScript per type-safety
- **React 19.0.0**: Library UI per componenti interattivi

### 2.2 Navigazione e Routing

- **@react-navigation/native v7.3.1**: Nucleo del sistema di navigazione
- **@react-navigation/native-stack v7.17.3**: Navigazione stack-based
- **@react-navigation/bottom-tabs v7.18.0**: Navigazione a tab inferiore

### 2.3 Gestione Stato e Dati

- **@tanstack/react-query v5.90.21**: Gestione stato server-side, caching e sincronizzazione
- **Context API**: Gestione stato globale (auth, alerts)

### 2.4 UI e Grafica

- **@shopify/react-native-skia v2.0.0-next.4**: Rendering grafico ad alte prestazioni
- **react-native-svg v15.11.2**: Supporto SVG per grafici e icone
- **@expo/vector-icons v14.1.0**: Icone vettoriali
- **lucide-react-native v1.18.0**: Icone moderne e consistenti
- **react-native-reanimated v3.17.4**: Animazioni fluide e performanti
- **react-native-gesture-handler v2.24.0**: Gestione gesture avanzati

### 2.5 Camera e Visione Artificiale

- **expo-camera v16.1.11**: Accesso alla fotocamera
- **react-native-vision-camera v4.7.2**: Fotocamera avanzata con frame processing
- **react-native-fast-tflite v2.0.0**: Runtime TensorFlow Lite per modelli ML on-device
- **react-native-worklets-core v1.6.2**: Worklets per esecuzione codice su thread UI
- **vision-camera-resize-plugin v3.0.0**: Plugin per resize frame video

### 2.6 Firebase e Servizi Cloud

- **@react-native-firebase/app v24.1.1**: Core Firebase SDK
- **@react-native-firebase/auth v24.1.1**: Autenticazione Firebase
- **@react-native-firebase/firestore v24.1.1**: Database Firestore
- **@react-native-firebase/storage v24.1.1**: Storage Firebase
- **@react-native-firebase/messaging v24.1.1**: Cloud Messaging per notifiche push
- **@react-native-firebase/analytics v24.1.1**: Analytics Firebase

### 2.7 Storage e File System

- **@supabase/supabase-js v2.108.1**: Client Supabase per storage e database
- **@react-native-async-storage/async-storage v2.1.2**: Storage persistente locale
- **expo-file-system v18.1.11**: Gestione file system locale
- **expo-media-library v17.1.7**: Accesso alla galleria multimediale

### 2.8 Networking e API

- **axios v1.13.6**: Client HTTP per richieste REST
- **@tanstack/react-query v5.90.21**: Gestione chiamate API con caching

### 2.9 Utility e Altro

- **expo-image-picker v16.1.4**: Selezione immagini dalla galleria
- **expo-clipboard v7.1.5**: Gestione clipboard
- **expo-sharing v13.1.5**: Condivisione file nativa
- **expo-print v14.1.4**: Generazione PDF
- **@react-native-picker/picker v2.11.1**: Componenti select dropdown
- **@react-native-community/datetimepicker v8.4.1**: Selezione data/ora

### 2.10 Testing

- **jest v30.5.0**: Framework di testing
- **jest-expo v57.0.5**: Adapter Jest per Expo
- **@testing-library/react-native v14.0.1**: Testing componenti UI
- **@testing-library/jest-native v5.4.3**: Matcher custom per React Native

---

## 3. Struttura del Progetto

### 3.1 Organizzazione delle Directory

```
src/
├── app/                          # Layer applicativo
│   ├── App.tsx                   # Entry point
│   ├── providers/                # Providers globali
│   │   └── AppProviders.tsx      # QueryClient, AuthProvider, AlertProvider
│   └── navigation/               # Sistema di navigazione
│       ├── AppNavigator.tsx      # Navigatore principale
│       ├── AuthNavigator.tsx     # Navigatore autenticazione
│       ├── MainNavigator.tsx     # Navigatore principale autenticato
│       └── types.ts              # TypeScript types per navigazione
│
├── features/                     # Feature-based modules
│   ├── ai-training/              # Generazione programmi allenamento AI
│   ├── auth/                     # Autenticazione (login, register)
│   ├── badges/                   # Sistema gamification badge
│   ├── checklist-templates/     # Template checklist valutazione
│   ├── cv/                       # CV sportivo e condivisione
│   ├── events/                   # Gestione eventi (match, training)
│   ├── exercises/                # Catalogo esercizi
│   ├── goals/                    # Obiettivi sportivi
│   ├── home/                     # Dashboard home
│   ├── journal/                  # Diario sportivo
│   ├── messaging/                # Messaggistica interna
│   ├── navigation/               # Navigazione feature-specifica
│   ├── notifications/            # Gestione notifiche
│   ├── positions/                # Gestione ruoli giocatore
│   ├── profile/                  # Profilo utente
│   ├── ranking/                  # Classifiche e leaderboard
│   ├── scouting/                 # Funzionalità scout
│   ├── social/                   # Funzionalità social
│   ├── subscriptions/            # Gestione abbonamenti
│   ├── teams/                    # Gestione squadre
│   ├── trainer/                  # Funzionalità allenatore
│   ├── trainerFollow/            # Gestione follow allenatore-giocatore
│   ├── training/                 # Esecuzione programmi allenamento
│   ├── users/                    # Gestione utenti
│   ├── videoAnalysis/            # Analisi video asincrona
│   └── workouts/                 # Sessioni workout e tracking tiri
│
└── shared/                       # Componenti condivisi
    ├── api/                      # Configurazione API client
    │   ├── apiClient.ts          # Axios client configurato
    │   ├── apiConfig.ts          # Configurazione endpoint base
    │   ├── apiHealthCheck.ts     # Health check backend
    │   └── supportedEndpoints.ts # Endpoints supportati
    ├── components/               # Componenti UI riutilizzabili
    │   ├── BadgeIcon.tsx         # Icona badge
    │   ├── CustomAlert.tsx       # Alert personalizzato
    │   ├── ErrorBoundary.tsx     # Boundary per errori
    │   ├── ErrorMessage.tsx      # Messaggio errore
    │   ├── LoadingSpinner.tsx    # Spinner caricamento
    │   └── PositionCard.tsx      # Card posizione
    ├── context/                  # Context globali
    │   └── AlertContext.tsx      # Gestione alert globali
    ├── lib/                      # Librerie utility
    ├── storage/                  # Storage persistente
    ├── theme/                    # Tema e styling
    │   ├── colors.ts             # Palette colori
    │   └── globalStyles.ts       # Stili globali
    └── utils/                    # Funzioni utility
```

### 3.2 Struttura Standard Feature

Ogni feature segue una struttura consistente:

```
feature-name/
├── api/              # API calls e servizi
├── components/       # Componenti specifici della feature
├── hooks/            # Custom React hooks
├── navigation/       # Navigatore feature-specifico
├── screens/          # Schermate della feature
├── types/            # TypeScript types
└── utils/            # Utility specifici
```

---

## 4. Sistema di Navigazione

### 4.1 Navigatori Principali

#### AppNavigator
Navigatore radice che gestisce lo stato di autenticazione e routing globale.

- **Tipo**: Native Stack Navigator
- **Responsabilità**:
  - Verifica stato autenticazione tramite AuthContext
  - Reindirizza a AuthNavigator se non autenticato
  - Reindirizza a MainNavigator se autenticato
  - Gestisce schermate globali (profile, notifications, messaging)

#### AuthNavigator
Navigatore per il flusso di autenticazione.

- **Tipo**: Native Stack Navigator
- **Schermate**:
  - `Login`: LoginScreen
  - `Register`: RegisterScreen

#### MainNavigator
Navigatore principale per utenti autenticati.

- **Tipo**: Native Stack Navigator
- **Schermate**:
  - `Main`: HomeScreen (schermata principale)
  - `Goals`: GoalsScreen
  - `EditProfile`: EditProfileScreen
  - `EditCv`: EditCvScreen
  - `Cv`: CvScreen
  - `Positions`: PositionsScreen
  - `ChatScreen`: ChatScreen
  - `NewChat`: NewChatScreen

### 4.2 Navigatori Feature-Specifici

#### WorkoutNavigator
Gestisce il flusso completo delle sessioni workout.

- **Schermate**:
  - `WorkoutHome`: Dashboard workout
  - `WorkoutSetup`: Configurazione sessione
  - `WorkoutSession`: Sessione attiva con tracking AI
  - `Calibration`: Calibrazione campo
  - `Stats`: Statistiche post-sessione
  - `ShotChart`: Shot chart visualizzazione

#### JournalNavigator
Gestisce il diario sportivo.

- **Schermate**:
  - `JournalHome`: Lista entry diario
  - `JournalCreate`: Creazione nuova entry
  - `JournalDetail`: Dettaglio entry

#### AiTrainingNavigator
Gestisce la generazione programmi allenamento AI.

- **Schermate**:
  - `AiTrainingTools`: Strumenti AI training
  - `AiTrainingGenerator`: Generatore programmi
  - `AiTrainingProgram`: Visualizzazione programma

#### ChecklistTemplatesNavigator
Gestisce i template di checklist.

- **Schermate**:
  - `ChecklistTemplatesAdmin`: Gestione template
  - `ChecklistTemplateEdit`: Editor template

### 4.3 Tipi di Navigazione

```typescript
// RootStackParamList - Navigazione globale
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

// AuthStackParamList - Navigazione autenticazione
export type AuthStackParamList = {
    Login: undefined
    Register: undefined
}

// MainStackParamList - Navigazione principale
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
```

---

## 5. Sistema di Stato e Context Providers

### 5.1 Providers Globali

#### AppProviders
Wrapper principale che fornisce i context globali all'applicazione.

```typescript
<QueryClientProvider client={queryClient}>
    <AuthProvider>
        <AlertProvider>
            {children}
        </AlertProvider>
    </AuthProvider>
</QueryClientProvider>
```

#### QueryClientProvider
Fornisce il client React Query per gestione stato server-side.

- **Configurazione**: Default React Query settings
- **Responsabilità**: Caching, sincronizzazione, refetch automatico

#### AuthProvider
Gestisce lo stato di autenticazione globale.

- **Stato**:
  - `user`: User | null - Utente autenticato
  - `isLoading`: boolean - Stato caricamento iniziale
  - `logout`: Function - Funzione di logout

- **Funzionalità**:
  - Caricamento utente salvato da AsyncStorage all'avvio
  - Gestione logout con pulizia cache React Query
  - Invalidazione query navigazione al logout

#### AlertProvider
Gestisce alert globali e notifiche UI.

- **Responsabilità**:
  - Mostrare alert personalizzati
  - Gestire errori globali
  - Feedback utente uniforme

### 5.2 React Query Integration

React Query viene utilizzato per:

- **Data Fetching**: Chiamate API con caching automatico
- **State Synchronization**: Sincronizzazione dati tra schermate
- **Background Refetch**: Aggiornamento dati in background
- **Optimistic Updates**: Aggiornamenti UI ottimistici
- **Error Handling**: Gestione centralizzata errori API

---

## 6. Tema e Styling

### 6.1 Palette Colori

```typescript
export const colors = {
    background: '#0b0f1a',      // Sfondo principale scuro
    card: '#121826',            // Sfondo card
    cardBorder: '#1f2a3d',      // Bordo card
    primary: '#ff8c00',         // Colore primario (arancione)
    textPrimary: '#ffffff',     // Testo principale bianco
    textSecondary: '#aaaaaa',  // Testo secondario grigio
}
```

### 6.2 Stili Globali

Definiti in `globalStyles.ts` per consistenza UI:

- **Container**: Layout container standard
- **Card**: Styling card riutilizzabile
- **Text**: Varianti di testo (primary, secondary, placeholder)
- **Button**: Varianti di pulsanti (primary, secondary, danger)
- **Input**: Styling input form

### 6.3 Design System

- **Dark Mode First**: Design ottimizzato per tema scuro
- **Contrasto WCAG AA**: Conformità standard accessibilità
- **Responsive**: Layout adattivo per diverse dimensioni schermo
- **Typography**: Font size minimo 14px per leggibilità

---

## 7. Feature Implementate

### 7.1 Autenticazione (auth)

**Schermate**:
- `LoginScreen`: Login con email/password
- `RegisterScreen`: Registrazione nuovo utente

**Componenti**:
- `AuthContext`: Context globale autenticazione
- `auth API`: API calls per login/register/logout

**Funzionalità**:
- Login con credenziali
- Registrazione nuovo account
- Persistenza sessione (AsyncStorage)
- Logout con pulizia cache

### 7.2 CV Sportivo (cv)

**Schermate**:
- `CvScreen`: Visualizzazione CV sportivo
- `EditCvScreen`: Modifica CV sportivo

**Funzionalità**:
- Visualizzazione profilo (headline, summary, stats)
- Gestione squadre (nome, categoria, anni)
- Gestione highlights (video, link esterni)
- Condivisione CV pubblica
- Generazione token condivisione
- Share sheet nativo

### 7.3 Workout e Tracking Tiri (workouts)

**Schermate**:
- `WorkoutHomeScreen`: Dashboard workout
- `WorkoutSetupScreen`: Configurazione sessione
- `WorkoutSessionScreen`: Sessione attiva con tracking AI
- `CalibrationScreen`: Calibrazione campo
- `StatsScreen`: Statistiche post-sessione
- `ShotChartScreen`: Visualizzazione shot chart

**Componenti**:
- `BallOverlay`: Overlay palla durante tracking
- `Workout API`: API calls per sessioni workout
- `Workout Hooks`: Custom hooks per gestione workout

**Funzionalità**:
- Configurazione camera mode (laterale, frontale, 45°)
- Configurazione court type (half court, full court)
- Tracking AI palla in tempo reale
- Rilevamento canestri (made/miss)
- Calibrazione campo automatica
- Statistiche live (tiri totali, realizzati, percentuali)
- Shot chart con heatmap
- Analisi zone (paint, mid-range, 3-point, corner)
- WebSocket per aggiornamenti live

### 7.4 Diario Sportivo (journal)

**Schermate**:
- `JournalHomeScreen`: Lista entry diario
- `JournalCreateScreen`: Creazione nuova entry
- `JournalDetailScreen`: Dettaglio entry

**Funzionalità**:
- Creazione entry (match, training)
- Compilazione checklist personalizzate
- Rating mood e performance
- Tag e categorizzazione
- Visibilità (private, trainer, public)

### 7.5 Obiettivi Sportivi (goals)

**Schermate**:
- `GoalsScreen`: Lista obiettivi
- `GoalWizardScreen`: Wizard creazione obiettivo

**Funzionalità**:
- Creazione obiettivi con wizard
- Tracking progresso
- Scadenze e priorità
- Categorie (tiri, salti, percentuali)

### 7.6 Video Analysis (videoAnalysis)

**Schermate**:
- `VideoAnalysisHomeScreen`: Home video analysis
- `VideoAnalysisRecorderScreen`: Registrazione video
- `VideoAnalysisProcessingScreen`: Elaborazione video
- `VideoAnalysisResultScreen`: Risultati analisi

**Funzionalità**:
- Registrazione video con camera
- Upload video per analisi asincrona
- Tracking stato elaborazione
- Visualizzazione risultati AI

### 7.7 AI Training (ai-training)

**Schermate**:
- `AiTrainingGeneratorScreen`: Generatore programmi AI
- `AiTrainingProgramScreen`: Visualizzazione programma

**Funzionalità**:
- Generazione programmi allenamento via AI
- Personalizzazione base obiettivi
- Visualizzazione esercizi strutturati

### 7.8 Messaggistica (messaging)

**Schermate**:
- `MessagingHomeScreen`: Lista conversazioni
- `ChatScreen`: Chat singola
- `NewChatScreen`: Nuova conversazione

**Funzionalità**:
- Lista conversazioni
- Chat real-time
- Creazione nuove conversazioni
- Notifiche messaggi

### 7.9 Notifiche (notifications)

**Schermate**:
- `NotificationsScreen`: Lista notifiche

**Funzionalità**:
- Visualizzazione notifiche push
- Marcatura come lette
- Categorizzazione notifiche

### 7.10 Profilo (profile)

**Schermate**:
- `ProfileScreen`: Visualizzazione profilo
- `EditProfileScreen`: Modifica profilo

**Funzionalità**:
- Visualizzazione profilo utente
- Modifica dati personali
- Gestione avatar
- Statistiche generali

### 7.11 Badge Gamification (badges)

**Schermate**:
- `BadgesScreen`: Visualizzazione badge

**Funzionalità**:
- Visualizzazione badge ottenuti
- Sistema rarità (common, rare, epic, legendary)
- Progresso badge

### 7.12 Checklist Templates (checklist-templates)

**Schermate**:
- `ChecklistTemplatesAdminScreen`: Gestione template
- `ChecklistTemplateEditScreen`: Editor template

**Funzionalità**:
- Creazione template checklist
- Gestione campi custom
- Regole validazione
- Tipi dati (boolean, number, text, date, select)

### 7.13 Eventi (events)

**Schermate**:
- `EventsHomeScreen`: Lista eventi
- `EventCreateScreen`: Creazione evento
- `EventDetailScreen`: Dettaglio evento

**Funzionalità**:
- Creazione eventi (match, training)
- Gestione partecipanti
- Dettagli logistici

### 7.14 Training (training)

**Schermate**:
- `TrainingScreen`: Esecuzione training
- `ComingSoonScreen`: Placeholder feature future

### 7.15 Home Dashboard (home)

**Schermate**:
- `HomeScreen`: Dashboard principale

**Funzionalità**:
- Riepilogo attività recenti
- Accesso rapido feature principali
- Statistiche overview

### 7.16 Ranking (ranking)

**Schermate**:
- `RankingScreen`: Classifiche

**Funzionalità**:
- Leaderboard globale
- Filtri per categoria
- Posizionamento utente

### 7.17 Trainer (trainer)

**Schermate**:
- `TrainerProfileScreen`: Profilo allenatore

**Funzionalità**:
- Visualizzazione profilo trainer
- Gestione clienti
- Feedback agli atleti

### 7.18 Altre Feature

Le seguenti feature sono parzialmente implementate o in sviluppo:

- **positions**: Gestione ruoli giocatore
- **scouting**: Funzionalità scout
- **social**: Funzionalità social
- **subscriptions**: Gestione abbonamenti
- **teams**: Gestione squadre
- **trainerFollow**: Follow allenatore-giocatore
- **users**: Gestione utenti
- **exercises**: Catalogo esercizi

---

## 8. Componenti Condivisi

### 8.1 Componenti UI

#### BadgeIcon
Icona badge con styling personalizzato per sistema gamification.

#### CustomAlert
Componente alert personalizzato con styling consistente.

#### ErrorBoundary
Boundary per catturare errori React e prevenire crash app.

#### ErrorMessage
Componente per visualizzazione messaggi errore standardizzati.

#### LoadingSpinner
Spinner di caricamento riutilizzabile.

#### PositionCard
Card per visualizzazione posizione giocatore.

### 8.2 API Layer

#### apiClient
Client Axios configurato con:
- Base URL backend
- Interceptor per headers autenticazione
- Gestione errori centralizzata
- Timeout configurazione

#### apiConfig
Configurazione endpoint e parametri API.

#### apiHealthCheck
Health check per verificare connettività backend.

#### supportedEndpoints
Lista endpoint supportati dal backend.

---

## 9. Integrazione Backend

### 9.1 Autenticazione

- **Endpoint**: `/api/auth/login`, `/api/auth/register`, `/api/auth/logout`
- **Metodo**: JWT tokens
- **Storage**: AsyncStorage per persistenza token

### 9.2 CV Sportivo

- **Endpoint**: `/api/players/{playerId}/cv`
- **Operazioni**: GET, PUT
- **Condivisione**: `/api/players/{playerId}/cv/share` (POST, DELETE)
- **Pubblico**: `/public/cv/{token}` (GET)

### 9.3 Workout

- **Endpoint**: `/api/workouts/sessions`
- **WebSocket**: `/api/workouts/live/{sessionId}`
- **Operazioni**: CRUD sessioni, shot events, calibration
- **Analytics**: `/api/workouts/{sessionId}/analytics/*`

### 9.4 Journal

- **Endpoint**: API journal (da definire)
- **Operazioni**: CRUD entry, checklist templates

### 9.5 Goals

- **Endpoint**: API goals (da definire)
- **Operazioni**: CRUD obiettivi, tracking progresso

---

## 10. Testing

### 10.1 Framework di Testing

- **Jest**: Framework di testing principale
- **jest-expo**: Adapter per ambiente Expo
- **@testing-library/react-native**: Testing componenti UI
- **@testing-library/jest-native**: Matcher custom

### 10.2 Strategia di Testing

- **Unit Tests**: Test singoli componenti e hook
- **Integration Tests**: Test flussi multi-schermata
- **API Tests**: Test chiamate API e mocking

### 10.3 Test Implementati

Feature con test implementati:
- **workouts**: Test manual shot registration, workout flow, API calls

---

## 11. Performance e Ottimizzazioni

### 11.1 Ottimizzazioni Implementate

- **React Query Caching**: Riduzione chiamate API ridondanti
- **Lazy Loading**: Caricamento componenti on-demand
- **Image Optimization**: Ottimizzazione immagini e thumbnail
- **Code Splitting**: Splitting codice per riduzione bundle size

### 11.2 Performance AI/Video

- **Worklets**: Esecuzione codice su thread UI per performance
- **TensorFlow Lite**: Modello ML ottimizzato per mobile
- **Frame Processing**: Elaborazione frame efficiente
- **Memory Management**: Gestione memoria per video processing

---

## 12. Sicurezza

### 12.1 Autenticazione

- **JWT Tokens**: Token JSON Web per autenticazione
- **Token Storage**: AsyncStorage sicuro per token
- **Token Refresh**: Refresh automatico token scaduti

### 12.2 Data Security

- **HTTPS**: Tutte le chiamate API su HTTPS
- **Input Validation**: Validazione input lato client
- **Error Handling**: Gestione errori senza esporre dati sensibili

---

## 13. Accessibilità

### 13.1 Standard Implementati

- **WCAG AA**: Conformità standard accessibilità
- **Contrasto Colori**: Contrasto sufficiente testo/sfondo
- **Font Size**: Font size minimo 14px
- **Touch Targets**: Dimensioni target touch adeguate (min 44px)
- **Screen Reader**: Supporto screen reader (VoiceOver/TalkBack)

---

## 14. Stato Sviluppo

### 14.1 Feature Complete

- ✅ Autenticazione (login, register)
- ✅ CV Sportivo (visualizzazione, modifica, condivisione)
- ✅ Workout (setup, sessione, tracking AI, statistiche)
- ✅ Diario Sportivo
- ✅ Obiettivi Sportivi
- ✅ Video Analysis (base)
- ✅ AI Training (base)
- ✅ Messaggistica (base)
- ✅ Notifiche
- ✅ Profilo
- ✅ Badge Gamification
- ✅ Checklist Templates
- ✅ Eventi
- ✅ Home Dashboard
- ✅ Ranking

### 14.2 Feature in Sviluppo

- 🔄 Training programs avanzati
- 🔄 Scout search avanzato
- 🔄 Social features
- 🔄 Subscriptions

### 14.3 Feature Future (Placeholder)

- ⏳ Admin users
- ⏳ Player stats avanzate
- ⏳ Player media
- ⏳ Scout reports
- ⏳ Trainer programs
- ⏳ Trainer clients
- ⏳ Trainer exercises
- ⏳ Creator content
- ⏳ Creator templates
- ⏳ Creator analytics
- ⏳ Admin subscriptions
- ⏳ Admin gamification
- ⏳ Admin notifications
- ⏳ Settings

---

## 15. Note Tecniche

### 15.1 Architettura Feature-Based

Il progetto adotta un'architettura feature-based per:
- **Scalabilità**: Facile aggiunta nuove feature
- **Manutenibilità**: Codice organizzato per dominio
- **Collaborazione**: Team possono lavorare su feature diverse
- **Testing**: Isolamento test per feature

### 15.2 TypeScript Strict Mode

TypeScript configurato in strict mode per:
- Type safety completo
- Rilevamento errori compile-time
- Migliore developer experience
- Refactoring sicuro

### 15.3 Expo Managed Workflow

Utilizzo Expo managed workflow per:
- Sviluppo rapido
- Aggiornamenti OTA (Over-The-Air)
- Configurazione semplificata
- Accesso a servizi Expo

### 15.4 Firebase Integration

Firebase utilizzato per:
- Autenticazione alternativa
- Push notifications
- Analytics
- Firestore (database secondario)
- Storage (file storage)

---

## 16. Prossimi Sviluppi

### 16.1 Short Term

- Completamento feature placeholder
- Miglioramento performance AI tracking
- Ampliamento test coverage
- Ottimizzazione bundle size

### 16.2 Medium Term

- Implementazione feature social complete
- Sistema abbonamenti completo
- Analytics avanzati per trainer
- Offline mode con sincronizzazione

### 16.3 Long Term

- AR integration per training
- Machine learning avanzato on-device
- Multi-platform support (Web, Desktop)
- Internationalization (i18n)

---

**Documento Versione**: 1.0.0  
**Ultimo Aggiornamento**: Agosto 2026  
**Mantenuto da**: Team MVPiQ Hoops
