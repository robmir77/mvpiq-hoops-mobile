import apiClient from '@/shared/api/apiClient'
import { 
  TrainerProfile, 
  TrainingProgram, 
  TrainerReview,
  TrainerSpecialization 
} from '../types/trainer.types'

// Export types for use in other components
export type { TrainerProfile, TrainingProgram, TrainerReview, TrainerSpecialization }

export const getTrainerProfile = async (userId: string): Promise<TrainerProfile> => {
  try {
    const response = await apiClient.get(`/trainers/${userId}`)
    return response.data
  } catch (error) {
    console.error('Error fetching trainer profile:', error)
    throw error
  }
}

export const createTrainerProfile = async (profile: Partial<TrainerProfile>): Promise<TrainerProfile> => {
  try {
    const response = await apiClient.post('/trainers', profile)
    return response.data
  } catch (error) {
    console.error('Error creating trainer profile:', error)
    throw error
  }
}

export const updateTrainerProfile = async (userId: string, updates: Partial<TrainerProfile>): Promise<TrainerProfile> => {
  try {
    const response = await apiClient.put(`/trainers/${userId}`, updates)
    return response.data
  } catch (error) {
    console.error('Error updating trainer profile:', error)
    throw error
  }
}

export const getTrainerPrograms = async (trainerId: string): Promise<TrainingProgram[]> => {
  try {
    const response = await apiClient.get(`/trainers/${trainerId}/programs`)
    return response.data
  } catch (error) {
    console.error('Error fetching trainer programs:', error)
    return []
  }
}

export const createTrainingProgram = async (program: Partial<TrainingProgram>): Promise<TrainingProgram> => {
  try {
    const response = await apiClient.post('/trainers/programs', program)
    return response.data
  } catch (error) {
    console.error('Error creating training program:', error)
    throw error
  }
}

export const getTrainerReviews = async (trainerId: string): Promise<TrainerReview[]> => {
  try {
    const response = await apiClient.get(`/trainers/${trainerId}/reviews`)
    return response.data
  } catch (error) {
    console.error('Error fetching trainer reviews:', error)
    return []
  }
}

export const submitTrainerReview = async (review: Partial<TrainerReview>): Promise<TrainerReview> => {
  try {
    const response = await apiClient.post('/trainers/reviews', review)
    return response.data
  } catch (error) {
    console.error('Error submitting trainer review:', error)
    throw error
  }
}

export const searchTrainers = async (filters: {
  specialization?: TrainerSpecialization
  certificationLevel?: string
  minRating?: number
  location?: string
  isVerified?: boolean
}): Promise<TrainerProfile[]> => {
  try {
    const params = new URLSearchParams()
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined) {
        params.append(key, value.toString())
      }
    })

    const response = await apiClient.get(`/trainers/search?${params.toString()}`)
    return response.data
  } catch (error) {
    console.error('Error searching trainers:', error)
    return []
  }
}

export const followTrainer = async (trainerId: string): Promise<void> => {
  try {
    await apiClient.post(`/trainers/${trainerId}/follow`)
  } catch (error) {
    console.error('Error following trainer:', error)
    throw error
  }
}

export const unfollowTrainer = async (trainerId: string): Promise<void> => {
  try {
    await apiClient.delete(`/trainers/${trainerId}/follow`)
  } catch (error) {
    console.error('Error unfollowing trainer:', error)
    throw error
  }
}

export const enrollInProgram = async (programId: string): Promise<void> => {
  try {
    await apiClient.post(`/training-programs/${programId}/enroll`)
  } catch (error) {
    console.error('Error enrolling in program:', error)
    throw error
  }
}

// Constants for UI
export const SPECIALIZATION_LABELS: Record<TrainerSpecialization, string> = {
  SHOOTING: 'Tiro',
  BALL_HANDLING: 'Palleggio',
  FOOTWORK: 'Footwork',
  DEFENSE: 'Difesa',
  PHYSICAL: 'Prep. Fisica',
  MENTAL: 'Prep. Mentale',
  TACTICS: 'Tattica',
  GENERAL: 'Generale'
}

export const CERTIFICATION_LEVEL_LABELS = {
  NONE: 'Nessuna',
  BASIC: 'Base',
  INTERMEDIATE: 'Intermedia',
  ADVANCED: 'Avanzata',
  ELITE: 'Elite'
}

export const DIFFICULTY_LABELS = {
  BEGINNER: 'Principiante',
  INTERMEDIATE: 'Intermedio',
  ADVANCED: 'Avanzato'
}
