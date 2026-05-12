import React, { useState } from 'react'
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Image,
} from 'react-native'
import { useTrainer } from '../hooks/useTrainer'
import { TrainerProfile, TrainerSpecialization } from '../types/trainer.types'
import { SPECIALIZATION_LABELS, CERTIFICATION_LEVEL_LABELS } from '../api/trainer.api'
import { useCustomAlert, CustomAlert } from '@/shared/components/CustomAlert'

export default function TrainerProfileScreen() {
  const { profile, loading, isEditing, setIsEditing, createProfile, updateProfile } = useTrainer()
  const [formData, setFormData] = useState<Partial<TrainerProfile>>({})
  const { alert, showError, showSuccess } = useCustomAlert()

  const handleEdit = () => {
    if (profile) {
      setFormData(profile)
    }
    setIsEditing(true)
  }

  const handleSave = async () => {
    try {
      if (!profile) {
        // Create new profile
        await createProfile(formData)
      } else {
        // Update existing profile
        await updateProfile(formData)
      }
      setIsEditing(false)
      showSuccess('Successo', 'Profilo trainer salvato')
    } catch (error) {
      showError('Errore', 'Impossibile salvare il profilo')
    }
  }

  const handleCancel = () => {
    setIsEditing(false)
    setFormData({})
  }

  const toggleSpecialization = (spec: TrainerSpecialization) => {
    const currentSpecs = formData.specializations || []
    if (currentSpecs.includes(spec)) {
      setFormData(prev => ({
        ...prev,
        specializations: currentSpecs.filter(s => s !== spec)
      }))
    } else {
      setFormData(prev => ({
        ...prev,
        specializations: [...currentSpecs, spec]
      }))
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#F97316" />
      </View>
    )
  }

  if (!profile && !isEditing) {
    return (
      <ScrollView style={styles.container}>
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>Diventa Trainer</Text>
          <Text style={styles.emptyDescription}>
            Crea il tuo profilo trainer per offrire programmi di allenamento personalizzati
          </Text>
          <TouchableOpacity style={styles.createButton} onPress={handleEdit}>
            <Text style={styles.createButtonText}>Crea Profilo Trainer</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    )
  }

  const currentData = isEditing ? formData : profile

  return (
    <View style={styles.container}>
      <ScrollView>
        <View style={styles.header}>
          <Text style={styles.title}>
            {isEditing ? 'Modifica Profilo Trainer' : 'Profilo Trainer'}
          </Text>
          
          {!isEditing ? (
            <TouchableOpacity style={styles.editButton} onPress={handleEdit}>
              <Text style={styles.editButtonText}>Modifica</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.editActions}>
              <TouchableOpacity style={styles.cancelButton} onPress={handleCancel}>
                <Text style={styles.cancelButtonText}>Annulla</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveButton} onPress={handleSave}>
                <Text style={styles.saveButtonText}>Salva</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Informazioni Base</Text>
          
          {isEditing ? (
            <TextInput
              style={styles.textInput}
              placeholder="Bio del trainer..."
              placeholderTextColor="#6B7280"
              value={formData.bio || ''}
              onChangeText={(text) => setFormData(prev => ({ ...prev, bio: text }))}
              multiline
              numberOfLines={4}
            />
          ) : (
            <Text style={styles.bio}>{currentData?.bio || 'Nessuna bio disponibile'}</Text>
          )}

          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Text style={styles.statNumber}>{currentData?.experience || 0}</Text>
              <Text style={styles.statLabel}>Anni di Esperienza</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={styles.statNumber}>{currentData?.rating || 0}</Text>
              <Text style={styles.statLabel}>Rating</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={styles.statNumber}>{currentData?.reviewCount || 0}</Text>
              <Text style={styles.statLabel}>Recensioni</Text>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Specializzazioni</Text>
          
          {isEditing ? (
            <View style={styles.specializationsGrid}>
              {Object.entries(SPECIALIZATION_LABELS).map(([key, label]) => {
                const spec = key as TrainerSpecialization
                const isSelected = formData.specializations?.includes(spec)
                
                return (
                  <TouchableOpacity
                    key={key}
                    style={[
                      styles.specializationChip,
                      isSelected && styles.specializationChipSelected
                    ]}
                    onPress={() => toggleSpecialization(spec)}
                  >
                    <Text style={[
                      styles.specializationText,
                      isSelected && styles.specializationTextSelected
                    ]}>
                      {label}
                    </Text>
                  </TouchableOpacity>
                )
              })}
            </View>
          ) : (
            <View style={styles.specializationsList}>
              {currentData?.specializations?.map(spec => (
                <View key={spec} style={styles.specializationTag}>
                  <Text style={styles.specializationTagText}>
                    {SPECIALIZATION_LABELS[spec]}
                  </Text>
                </View>
              ))}
              {(!currentData?.specializations || currentData.specializations.length === 0) && (
                <Text style={styles.noSpecializations}>Nessuna specializzazione</Text>
              )}
            </View>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Certificazioni</Text>
          
          {currentData?.certifications && currentData.certifications.length > 0 ? (
            currentData.certifications.map(cert => (
              <View key={cert.id} style={styles.certificationCard}>
                <View style={styles.certificationHeader}>
                  <Text style={styles.certificationName}>{cert.name}</Text>
                  {cert.isVerified && (
                    <Text style={styles.verifiedBadge}>✓ Verificato</Text>
                  )}
                </View>
                <Text style={styles.certificationIssuer}>{cert.issuer}</Text>
                <Text style={styles.certificationDate}>
                  Rilasciato: {new Date(cert.issueDate).toLocaleDateString('it-IT')}
                </Text>
              </View>
            ))
          ) : (
            <Text style={styles.noCertifications}>Nessuna certificazione</Text>
          )}
        </View>

        {currentData?.isVerified && (
          <View style={styles.verifiedBanner}>
            <Text style={styles.verifiedBannerText}>✓ Profilo Trainer Verificato</Text>
          </View>
        )}
      </ScrollView>
      <CustomAlert {...alert} />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0B0F1A',
    padding: 20,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0B0F1A',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: 'white',
  },
  editButton: {
    backgroundColor: '#F97316',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  editButtonText: {
    color: 'white',
    fontWeight: '600',
  },
  editActions: {
    flexDirection: 'row',
    gap: 8,
  },
  cancelButton: {
    backgroundColor: '#374151',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  cancelButtonText: {
    color: 'white',
    fontWeight: '600',
  },
  saveButton: {
    backgroundColor: '#F97316',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  saveButtonText: {
    color: 'white',
    fontWeight: '600',
  },
  section: {
    marginBottom: 32,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: 'white',
    marginBottom: 16,
  },
  bio: {
    color: '#9CA3AF',
    fontSize: 16,
    lineHeight: 24,
    marginBottom: 16,
  },
  textInput: {
    backgroundColor: '#1F2937',
    color: 'white',
    padding: 16,
    borderRadius: 12,
    fontSize: 16,
    textAlignVertical: 'top',
    minHeight: 100,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 16,
  },
  statItem: {
    alignItems: 'center',
    flex: 1,
  },
  statNumber: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#F97316',
  },
  statLabel: {
    fontSize: 12,
    color: '#9CA3AF',
    marginTop: 4,
    textAlign: 'center',
  },
  specializationsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  specializationChip: {
    backgroundColor: '#1F2937',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#374151',
  },
  specializationChipSelected: {
    backgroundColor: '#F97316',
    borderColor: '#F97316',
  },
  specializationText: {
    color: '#9CA3AF',
    fontSize: 14,
    fontWeight: '600',
  },
  specializationTextSelected: {
    color: 'white',
  },
  specializationsList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  specializationTag: {
    backgroundColor: '#1F2937',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  specializationTagText: {
    color: 'white',
    fontSize: 14,
  },
  noSpecializations: {
    color: '#6B7280',
    fontStyle: 'italic',
  },
  certificationCard: {
    backgroundColor: '#1F2937',
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
  },
  certificationHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  certificationName: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  verifiedBadge: {
    color: '#10B981',
    fontSize: 12,
    fontWeight: '600',
  },
  certificationIssuer: {
    color: '#9CA3AF',
    fontSize: 14,
    marginBottom: 4,
  },
  certificationDate: {
    color: '#6B7280',
    fontSize: 12,
  },
  noCertifications: {
    color: '#6B7280',
    fontStyle: 'italic',
  },
  verifiedBanner: {
    backgroundColor: '#10B981',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 16,
  },
  verifiedBannerText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyTitle: {
    color: 'white',
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  emptyDescription: {
    color: '#9CA3AF',
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 32,
    lineHeight: 24,
  },
  createButton: {
    backgroundColor: '#F97316',
    paddingHorizontal: 32,
    paddingVertical: 16,
    borderRadius: 12,
  },
  createButtonText: {
    color: 'white',
    fontSize: 18,
    fontWeight: '600',
  },
})
