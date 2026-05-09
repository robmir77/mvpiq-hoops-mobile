export type TrainerSpecialization = 
  | 'SHOOTING'           // Tiro
  | 'BALL_HANDLING'      // Palleggio
  | 'FOOTWORK'           // Footwork
  | 'DEFENSE'            // Difesa
  | 'PHYSICAL'           // Preparazione fisica
  | 'MENTAL'             // Preparazione mentale
  | 'TACTICS'            // Tattica
  | 'GENERAL'            // Allenamento generale

export type CertificationLevel = 
  | 'NONE'
  | 'BASIC'
  | 'INTERMEDIATE' 
  | 'ADVANCED'
  | 'ELITE'

export type TrainerProfile = {
  id: string
  userId: string
  bio: string
  experience: number // anni di esperienza
  specializations: TrainerSpecialization[]
  certificationLevel: CertificationLevel
  certifications: Certification[]
  achievements: Achievement[]
  stats: TrainerStats
  socialLinks: SocialLink[]
  isVerified: boolean
  rating: number // 1-5
  reviewCount: number
  createdAt: string
  updatedAt: string
}

export type Certification = {
  id: string
  name: string
  issuer: string
  issueDate: string
  expiryDate?: string
  credentialUrl?: string
  isVerified: boolean
}

export type Achievement = {
  id: string
  title: string
  description: string
  date: string
  type: 'CHAMPIONSHIP' | 'TOURNAMENT' | 'RECOGNITION' | 'OTHER'
  isVerified: boolean
}

export type TrainerStats = {
  athletesTrained: number
  programsCreated: number
  totalSessions: number
  averageRating: number
  responseRate: number
  successRate: number
}

export type SocialLink = {
  platform: 'instagram' | 'twitter' | 'linkedin' | 'youtube' | 'website'
  url: string
  username: string
}

export type TrainingProgram = {
  id: string
  trainerId: string
  title: string
  description: string
  category: TrainerSpecialization
  difficulty: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED'
  duration: number // in days
  price: number
  isPublic: boolean
  rating: number
  reviewCount: number
  enrollmentCount: number
  createdAt: string
  updatedAt: string
}

export type TrainerReview = {
  id: string
  trainerId: string
  reviewerId: string
  rating: number
  comment: string
  isPublic: boolean
  createdAt: string
}
