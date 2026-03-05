import { NavigationContainer } from '@react-navigation/native'
import AppNavigator from '@/app/navigation/AppNavigator'
import AppProviders from '@/app/providers/AppProviders'

export default function App() {
    return (
        <AppProviders>
            <NavigationContainer>
                <AppNavigator />
            </NavigationContainer>
        </AppProviders>
    )
}