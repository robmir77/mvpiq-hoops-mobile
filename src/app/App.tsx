import { NavigationContainer } from '@react-navigation/native'
import { View } from 'react-native'
import AppNavigator from '@/app/navigation/AppNavigator'
import AppProviders from '@/app/providers/AppProviders'

export default function App() {
    return (
        <AppProviders>
            <NavigationContainer>
                <View 
                    style={{ 
                        flex: 1, 
                        backgroundColor: '#0b0f1a'
                    }}
                >
                    <AppNavigator />
                </View>
            </NavigationContainer>
        </AppProviders>
    )
}