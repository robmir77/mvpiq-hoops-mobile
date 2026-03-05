import React, { useEffect, useState } from 'react'
import {
    View,
    Text,
    TextInput,
    ScrollView,
    Button,
    Alert,
} from 'react-native'
import { useRoute } from '@react-navigation/native'
import { getPlayerCv, updatePlayerCv } from '../api/cv.api'
import { PlayerCv, PlayerCvTeam } from '../types/cv.types'
import { globalStyles } from '@/shared/theme/globalStyles'

export default function EditCvScreen() {
    const route = useRoute<any>()

    console.log('ROUTE PARAMS', route.params)

    const playerId = route.params.playerId


    const [cv, setCv] = useState<PlayerCv>({
        teams: [],
    })

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
        } catch {
            Alert.alert('Errore', 'Impossibile caricare CV')
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

    const save = async () => {
        try {
            await updatePlayerCv(playerId, cv)
            Alert.alert('Successo', 'CV aggiornato')
        } catch {
            Alert.alert('Errore', 'Errore salvataggio CV')
        }
    }

    return (
        <ScrollView style={globalStyles.container}>
            <Text style={globalStyles.sectionTitle}>
                Profilo CV
            </Text>

            <Text style={globalStyles.label}>Headline</Text>
            <TextInput
                style={globalStyles.input}
                value={cv.headline}
                onChangeText={text =>
                    setCv({ ...cv, headline: text })
                }
            />

            <Text style={globalStyles.label}>Summary</Text>
            <TextInput
                style={[globalStyles.input, { height: 100 }]}
                multiline
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
                        value={team.teamName}
                        onChangeText={text =>
                            updateTeam(index, 'teamName', text)
                        }
                    />

                    <TextInput
                        style={globalStyles.input}
                        placeholder="Anno inizio"
                        keyboardType="numeric"
                        value={
                            team.startYear
                                ? String(team.startYear)
                                : ''
                        }
                        onChangeText={text =>
                            updateTeam(
                                index,
                                'startYear',
                                Number(text)
                            )
                        }
                    />

                    <TextInput
                        style={globalStyles.input}
                        placeholder="Anno fine"
                        keyboardType="numeric"
                        value={
                            team.endYear
                                ? String(team.endYear)
                                : ''
                        }
                        onChangeText={text =>
                            updateTeam(
                                index,
                                'endYear',
                                Number(text)
                            )
                        }
                    />

                    <Button
                        title="Rimuovi"
                        onPress={() => removeTeam(index)}
                    />
                </View>
            ))}

            <Button title="Aggiungi squadra" onPress={addTeam} />

            <View style={{ marginTop: 30 }}>
                <Button title="Salva CV" onPress={save} />
            </View>
        </ScrollView>
    )
}