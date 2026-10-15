import { useEffect, useState } from 'react'
import { NavigationContainer } from '@react-navigation/native'
import { SafeAreaView, View, Text, ActivityIndicator } from 'react-native'
import { Platform } from 'react-native'
import AppNavigator from '@/app/navigation/AppNavigator'
import AppProviders from '@/app/providers/AppProviders'
import { preloadModelAssets } from '@/vision/yoloModels'
import { useKeepAlive } from '@/shared/api/keepAliveService'

export default function App() {
    const [assetsLoaded, setAssetsLoaded] = useState(false)
    const { start: startKeepAlive, stop: stopKeepAlive } = useKeepAlive()

    useEffect(() => {
        preloadModelAssets().then(() => {
            setAssetsLoaded(true)
        }).catch(error => {
            console.error('[App] Failed to preload model assets:', error)
            setAssetsLoaded(true) // Continue anyway to not block the app
        })
    }, [])

    useEffect(() => {
        if (assetsLoaded) {
            startKeepAlive()
        }
        return () => {
            stopKeepAlive()
        }
    }, [assetsLoaded, startKeepAlive, stopKeepAlive])

    if (!assetsLoaded) {
        return (
            <View style={{ flex: 1, backgroundColor: '#0b0f1a', justifyContent: 'center', alignItems: 'center' }}>
                <ActivityIndicator size="large" color="#ffffff" />
                <Text style={{ color: '#ffffff', marginTop: 16 }}>Caricamento Modelli AI...</Text>
            </View>
        )
    }

    return (
        <AppProviders>
            <NavigationContainer>
                <SafeAreaView
                    style={{
                        flex: 1,
                        backgroundColor: '#0b0f1a',
                        // Padding extra per Android per evitare sovrapposizione con tasti di sistema
                        paddingBottom: Platform.OS === 'android' ? 20 : 0
                    }}
                >
                    <AppNavigator />
                </SafeAreaView>
            </NavigationContainer>
        </AppProviders>
    )
}