import React, { useEffect, useState } from 'react'
import {
    View,
    Text,
    TextInput,
    ScrollView,
    TouchableOpacity,
    Alert,
    Modal,
} from 'react-native'
import { useRoute } from '@react-navigation/native'
import { getPlayerCv, updatePlayerCv, getCvHighlights, addExternalCvHighlight, deleteCvHighlight } from '../api/cv.api'
import { PlayerCv, PlayerCvTeam, PlayerCvHighlight } from '../types/cv.types'
import { globalStyles } from '@/shared/theme/globalStyles'
import { useCustomAlert, CustomAlert } from '@/shared/components/CustomAlert'

export default function EditCvScreen() {
    const route = useRoute<any>()

    console.log('ROUTE PARAMS', route.params)

    const playerId = route.params.playerId
    const { alert, showError, showSuccess } = useCustomAlert()


    const [cv, setCv] = useState<PlayerCv>({
        teams: [],
    })
    const [highlights, setHighlights] = useState<PlayerCvHighlight[]>([])
    const [showAddHighlightModal, setShowAddHighlightModal] = useState(false)
    const [newHighlightTitle, setNewHighlightTitle] = useState('')
    const [newHighlightUrl, setNewHighlightUrl] = useState('')
    const [newHighlightDescription, setNewHighlightDescription] = useState('')

    useEffect(() => {
        load()
    }, [])

    const load = async () => {
        try {
            const data = await getPlayerCv(playerId)
            setCv({
                ...data,
                teams: data.teams ?? [],
            })
            // Load highlights
            const highlightsData = await getCvHighlights(playerId)
            setHighlights(highlightsData)
        } catch {
            showError('Errore', 'Impossibile caricare CV')
        }
    }

    const addTeam = () => {
        const newTeam: PlayerCvTeam = {
            teamName: '',
            categoryId: 1,
        }

        setCv(prev => ({
            ...prev,
            teams: [...(prev.teams ?? []), newTeam],
        }))
    }

    const updateTeam = (
        index: number,
        field: keyof PlayerCvTeam,
        value: any
    ) => {
        const updatedTeams = [...(cv.teams ?? [])]
        updatedTeams[index] = {
            ...updatedTeams[index],
            [field]: value,
        }

        setCv({ ...cv, teams: updatedTeams })
    }

    const removeTeam = (index: number) => {
        const updatedTeams = [...(cv.teams ?? [])]
        updatedTeams.splice(index, 1)
        setCv({ ...cv, teams: updatedTeams })
    }

    const validateTeams = () => {
        if (!cv.teams || cv.teams.length === 0) {
            return true // No teams is valid
        }

        for (let i = 0; i < cv.teams.length; i++) {
            const team = cv.teams[i]
            if (!team.teamName || team.teamName.trim() === '') {
                showError('Errore', `Compila il nome della squadra ${i + 1}`)
                return false
            }
            if (!team.startYear) {
                showError('Errore', `Compila l'anno inizio della squadra ${i + 1}`)
                return false
            }
            if (!team.endYear) {
                showError('Errore', `Compila l'anno fine della squadra ${i + 1}`)
                return false
            }
        }
        return true
    }

    const save = async () => {
        if (!validateTeams()) {
            return
        }

        try {
            await updatePlayerCv(playerId, cv)
            showSuccess('Successo', 'CV aggiornato')
        } catch {
            showError('Errore', 'Errore salvataggio CV')
        }
    }

    const handleAddExternalHighlight = async () => {
        if (!newHighlightTitle.trim()) {
            showError('Errore', 'Il titolo è obbligatorio')
            return
        }
        if (!newHighlightUrl.trim()) {
            showError('Errore', 'L\'URL è obbligatorio')
            return
        }

        try {
            await addExternalCvHighlight(playerId, newHighlightUrl, newHighlightTitle, newHighlightDescription)
            showSuccess('Successo', 'Highlight aggiunto')
            setNewHighlightTitle('')
            setNewHighlightUrl('')
            setNewHighlightDescription('')
            setShowAddHighlightModal(false)
            load() // Reload highlights
        } catch (error: any) {
            showError('Errore', error.message || 'Impossibile aggiungere highlight')
        }
    }

    const handleDeleteHighlight = (highlightId: string) => {
        Alert.alert(
            'Elimina highlight',
            'Sei sicuro di voler eliminare questo highlight?',
            [
                { text: 'Annulla', style: 'cancel' },
                {
                    text: 'Elimina',
                    style: 'destructive',
                    onPress: async () => {
                        try {
                            await deleteCvHighlight(playerId, highlightId)
                            showSuccess('Successo', 'Highlight eliminato')
                            load() // Reload highlights
                        } catch (error: any) {
                            showError('Errore', error.message || 'Impossibile eliminare highlight')
                        }
                    }
                }
            ]
        )
    }

    return (
        <ScrollView style={globalStyles.container}>
            <Text style={globalStyles.sectionTitle}>
                Profilo CV
            </Text>

            <Text style={globalStyles.label}>Headline</Text>
            <TextInput
                style={globalStyles.input}
                placeholder="Titolo del profilo"
                placeholderTextColor="#888"
                value={cv.headline}
                onChangeText={text =>
                    setCv({ ...cv, headline: text })
                }
            />

            <Text style={globalStyles.label}>Summary</Text>
            <TextInput
                style={[globalStyles.input, { height: 100 }]}
                multiline
                placeholder="Descrizione del profilo"
                placeholderTextColor="#888"
                value={cv.summary}
                onChangeText={text =>
                    setCv({ ...cv, summary: text })
                }
            />

            <Text style={globalStyles.sectionTitle}>
                Squadre
            </Text>

            {cv.teams?.map((team, index) => (
                <View
                    key={index}
                    style={{ marginBottom: 20 }}
                >
                    <TextInput
                        style={globalStyles.input}
                        placeholder="Nome squadra"
                        placeholderTextColor="#888"
                        value={team.teamName}
                        onChangeText={text =>
                            updateTeam(index, 'teamName', text)
                        }
                    />

                    <TextInput
                        style={globalStyles.input}
                        placeholder="Anno inizio (es. 2020)"
                        keyboardType="numeric"
                        placeholderTextColor="#888"
                        value={
                            team.startYear
                                ? String(team.startYear)
                                : ''
                        }
                        onChangeText={text => {
                            // Allow empty or partial input during typing
                            if (text === '') {
                                updateTeam(index, 'startYear', undefined)
                                return
                            }
                            const year = Number(text)
                            // Only validate if input is complete (4 digits) or reasonable
                            if (text.length <= 4 && (text.length < 4 || (year >= 1900 && year <= new Date().getFullYear() + 10))) {
                                updateTeam(index, 'startYear', year)
                            }
                        }}
                    />

                    <TextInput
                        style={globalStyles.input}
                        placeholder="Anno fine (es. 2023)"
                        keyboardType="numeric"
                        placeholderTextColor="#888"
                        value={
                            team.endYear
                                ? String(team.endYear)
                                : ''
                        }
                        onChangeText={text => {
                            // Allow empty or partial input during typing
                            if (text === '') {
                                updateTeam(index, 'endYear', undefined)
                                return
                            }
                            const year = Number(text)
                            // Only validate if input is complete (4 digits) or reasonable
                            if (text.length <= 4 && (text.length < 4 || (year >= 1900 && year <= new Date().getFullYear() + 10))) {
                                updateTeam(index, 'endYear', year)
                            }
                        }}
                    />

                    <TouchableOpacity
                        style={globalStyles.button}
                        onPress={() => removeTeam(index)}
                    >
                        <Text style={globalStyles.buttonText}>Rimuovi</Text>
                    </TouchableOpacity>
                </View>
            ))}

            <TouchableOpacity style={globalStyles.button} onPress={addTeam}>
                <Text style={globalStyles.buttonText}>Aggiungi squadra</Text>
            </TouchableOpacity>

            <Text style={globalStyles.sectionTitle}>
                Highlights
            </Text>

            {highlights.map((highlight, index) => (
                <View
                    key={highlight.id || index}
                    style={{ marginBottom: 20, backgroundColor: '#121826', padding: 16, borderRadius: 8 }}
                >
                    <Text style={{ color: '#fff', fontWeight: 'bold', fontSize: 16, marginBottom: 8 }}>
                        {highlight.title || 'Senza titolo'}
                    </Text>
                    {highlight.description && (
                        <Text style={{ color: '#ccc', fontSize: 14, marginBottom: 8 }}>
                            {highlight.description}
                        </Text>
                    )}
                    {highlight.externalUrl && (
                        <Text style={{ color: '#ff8c00', fontSize: 12, marginBottom: 8 }}>
                            {highlight.externalUrl}
                        </Text>
                    )}
                    <TouchableOpacity
                        style={[globalStyles.button, { backgroundColor: '#dc3545', marginTop: 8 }]}
                        onPress={() => handleDeleteHighlight(highlight.id || '')}
                    >
                        <Text style={globalStyles.buttonText}>Elimina</Text>
                    </TouchableOpacity>
                </View>
            ))}

            <TouchableOpacity
                style={[globalStyles.button, { backgroundColor: '#333', borderWidth: 1, borderColor: '#ff8c00' }]}
                onPress={() => setShowAddHighlightModal(true)}
            >
                <Text style={globalStyles.buttonText}>Aggiungi link esterno</Text>
            </TouchableOpacity>

            <View style={{ marginTop: 30 }}>
                <TouchableOpacity style={globalStyles.button} onPress={save}>
                    <Text style={globalStyles.buttonText}>Salva CV</Text>
                </TouchableOpacity>
            </View>
            <CustomAlert {...alert} />

            {/* Add Highlight Modal */}
            <Modal
                visible={showAddHighlightModal}
                animationType="slide"
                transparent={true}
                onRequestClose={() => setShowAddHighlightModal(false)}
            >
                <View style={{
                    flex: 1,
                    justifyContent: 'center',
                    alignItems: 'center',
                    backgroundColor: 'rgba(0, 0, 0, 0.8)'
                }}>
                    <View style={{
                        backgroundColor: '#121826',
                        padding: 20,
                        borderRadius: 12,
                        width: '90%',
                        maxWidth: 400
                    }}>
                        <Text style={{ color: '#fff', fontSize: 20, fontWeight: 'bold', marginBottom: 20 }}>
                            Aggiungi Highlight
                        </Text>

                        <Text style={{ color: '#fff', marginBottom: 5 }}>Titolo *</Text>
                        <TextInput
                            style={globalStyles.input}
                            placeholder="Titolo del highlight"
                            placeholderTextColor="#888"
                            value={newHighlightTitle}
                            onChangeText={setNewHighlightTitle}
                        />

                        <Text style={{ color: '#fff', marginBottom: 5, marginTop: 10 }}>URL Video *</Text>
                        <TextInput
                            style={globalStyles.input}
                            placeholder="https://youtube.com/..."
                            placeholderTextColor="#888"
                            value={newHighlightUrl}
                            onChangeText={setNewHighlightUrl}
                        />

                        <Text style={{ color: '#fff', marginBottom: 5, marginTop: 10 }}>Descrizione</Text>
                        <TextInput
                            style={[globalStyles.input, { height: 80 }]}
                            multiline
                            placeholder="Descrizione opzionale"
                            placeholderTextColor="#888"
                            value={newHighlightDescription}
                            onChangeText={setNewHighlightDescription}
                        />

                        <View style={{ flexDirection: 'row', gap: 10, marginTop: 20 }}>
                            <TouchableOpacity
                                style={[globalStyles.button, { flex: 1, backgroundColor: '#333' }]}
                                onPress={() => setShowAddHighlightModal(false)}
                            >
                                <Text style={globalStyles.buttonText}>Annulla</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[globalStyles.button, { flex: 1 }]}
                                onPress={handleAddExternalHighlight}
                            >
                                <Text style={globalStyles.buttonText}>Aggiungi</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>
        </ScrollView>
    )
}