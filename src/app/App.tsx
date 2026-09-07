import { NavigationContainer } from '@react-navigation/native'
import { SafeAreaView } from 'react-native'
import { Platform } from 'react-native'
import AppNavigator from '@/app/navigation/AppNavigator'
import AppProviders from '@/app/providers/AppProviders'

export default function App() {
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