import { useState, useEffect, useContext } from 'react'
import { AuthContext } from '@/features/auth/context/AuthContext'
import { 
  getTrainerProfile, 
  createTrainerProfile,
  updateTrainerProfile,
  getTrainerPrograms,
  TrainerProfile,
  TrainingProgram 
} from '../api/trainer.api'

export const useTrainer = (trainerId?: string) => {
  const auth = useContext(AuthContext)
  const [profile, setProfile] = useState<TrainerProfile | null>(null)
  const [programs, setPrograms] = useState<TrainingProgram[]>([])
  const [loading, setLoading] = useState(true)
  const [isEditing, setIsEditing] = useState(false)

  const userId = trainerId || auth?.user?.id

  useEffect(() => {
    if (userId) {
      loadTrainerData()
    }
  }, [userId])

  const loadTrainerData = async () => {
    if (!userId) return
    try {
      setLoading(true)
      const [profileData, programsData] = await Promise.all([
        getTrainerProfile(userId),
        getTrainerPrograms(userId)
      ])
      setProfile(profileData)
      setPrograms(programsData)
    } catch (error) {
      console.error('Error loading trainer data:', error)
      // If profile doesn't exist, it might be a new trainer
      if (error && typeof error === 'object' && 'response' in error && 
          (error as any).response?.status === 404) {
        setProfile(null)
      }
    } finally {
      setLoading(false)
    }
  }

  const createProfile = async (profileData: Partial<TrainerProfile>) => {
    if (!userId) throw new Error('User ID is required')
    try {
      const newProfile = await createTrainerProfile({
        ...profileData,
        userId
      })
      setProfile(newProfile)
      return newProfile
    } catch (error) {
      console.error('Error creating trainer profile:', error)
      throw error
    }
  }

  const updateProfile = async (updates: Partial<TrainerProfile>) => {
    if (!userId) throw new Error('User ID is required')
    try {
      const updatedProfile = await updateTrainerProfile(userId, updates)
      setProfile(updatedProfile)
      return updatedProfile
    } catch (error) {
      console.error('Error updating trainer profile:', error)
      throw error
    }
  }

  const refresh = () => {
    loadTrainerData()
  }

  return {
    profile,
    programs,
    loading,
    isEditing,
    setIsEditing,
    createProfile,
    updateProfile,
    refresh
  }
}
